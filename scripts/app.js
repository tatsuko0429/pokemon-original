// 2026年4月27日時点の開発者向け保守メモ:
// 起動、初期状態、保存選択、メニュー、メインループを束ねるアプリの入口。
// 個別機能の実装はcore/scenesへ分けているが、初期表示・保存・タイマー・画面遷移の順序はここが管理する。
// 挙動変更時は「起動説明 -> 保存再開/はじめから -> フィールド -> 戦闘 -> クリア/リセット」を通しで確認する。
(() => {
  const App = window.MonsterPrototype;

  function createEmptyTransition() {
    return {
      active: false,
      kind: "",
      elapsedMs: 0,
      durationMs: 0,
      enemy: null,
    };
  }

  function createInitialState(dataRegistry) {
    // 保存復元とリセットはこの形へ戻す。新しい状態キーを足す場合はsave.jsのstable/restore対象も判断する。
    const configuredStartMapId = App.config.game.field && App.config.game.field.startMapId;
    const firstMap = dataRegistry.getMap(configuredStartMapId) || App.data.maps[0];
    const starter = dataRegistry.createMonsterInstance("nejimakidori", 5);
    const progress = {
      resolvedEventIds: [],
      storyStage: "preparation",
      storyIntroAccepted: false,
      prepElapsedMs: 0,
      prepGateUnlocked: false,
      prepGateAnnounced: false,
    };

    dataRegistry.getQuests().forEach((quest) => {
      progress[quest.progressKey] = quest.initialState;
    });

    return {
      scene: "field",
      modal: {
        open: false,
        title: "",
        lines: [],
        sections: [],
        buttonLabel: "閉じる",
        actions: [],
        dismissible: true,
      },
      field: {
        mapId: firstMap.id,
        player: {
          x: firstMap.spawn.x,
          y: firstMap.spawn.y,
          fromX: firstMap.spawn.x,
          fromY: firstMap.spawn.y,
          toX: firstMap.spawn.x,
          toY: firstMap.spawn.y,
          direction: firstMap.spawn.direction,
          moving: false,
          progress: 0,
        },
        message: "",
        steps: 0,
        lastEncounterStep: -10,
        stepEffect: null,
        bumpEffect: null,
        blockedFeedbackCooldownMs: 0,
      },
      transition: createEmptyTransition(),
      battle: null,
      party: [starter],
      inventory: {
        fullHealCount: 0,
        masterBallCount: 0,
      },
      collection: {
        capturedSpeciesIds: [],
      },
      timeAttack: {
        active: false,
        elapsedMs: 0,
        finished: false,
      },
      progress,
    };
  }

  function getObjectiveText(state, dataRegistry) {
    // 目的表示はステータス帯・メニュー系表示の共通文言。準備期間は依頼よりストーリー進行を優先する。
    if (state.progress && state.progress.storyStage === "preparation") {
      return state.progress.prepGateUnlocked
        ? "目的: 準備時間が終わりました。左の出口から次のステージへ進む。"
        : "目的: 草むらで5分間準備する。戦う、捕まえる、試す内容は自由です。";
    }

    const quest = dataRegistry.getPrimaryQuest();
    if (!quest) {
      return App.config.game.ui.fieldHint;
    }

    return dataRegistry.getQuestObjectiveText(state, quest.id) || App.config.game.ui.fieldHint;
  }

  function countPickupRecords(state) {
    const resolvedIds = new Set(state.progress.resolvedEventIds || []);
    let total = 0;
    let collected = 0;

    App.data.maps.forEach((mapDef) => {
      (mapDef.events || []).forEach((event) => {
        if (event.kind !== "pickup") {
          return;
        }

        total += 1;
        if (resolvedIds.has(event.id)) {
          collected += 1;
        }
      });
    });

    return {
      collected,
      total,
    };
  }

  function getCapturedSpeciesIds(state) {
    return Array.from(new Set((state.collection && state.collection.capturedSpeciesIds) || []));
  }

  function formatSavedAt(savedInfo) {
    // 保存日時は表示専用。保存データ本体の互換性判定はsave.jsのschemaVersionで行う。
    if (!savedInfo || !savedInfo.savedAt) {
      return "";
    }

    const savedAt = new Date(savedInfo.savedAt);
    if (Number.isNaN(savedAt.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(savedAt);
  }

  function createBackToMenuActions(openMenu) {
    return [
      {
        id: "back_to_menu",
        label: "メニューへ",
        onSelect: openMenu,
      },
      {
        id: "close",
        label: "閉じる",
        variant: "is-subtle",
      },
    ];
  }

  function getPreparationDurationMs() {
    return (App.config.game.story && App.config.game.story.preparationDurationMs) || 300000;
  }

  function boot() {
    // 起動時にDOM参照、乱数、データ検証、保存、入力、音声、モーダル、scene、rendererを順番に組み立てる。
    // index.htmlのidやscript順を変えた場合、ここが最初に壊れる。
    const shell = document.querySelector(".app-shell");
    const screen = document.getElementById("game-screen");
    const message = document.getElementById("screen-message");
    const caption = document.getElementById("screen-caption");
    const battleOverlay = document.getElementById("battle-overlay");
    const screenTimer = document.getElementById("screen-timer");
    const statusStrip = document.getElementById("status-strip");
    const actionPanel = document.getElementById("action-panel");

    const random = App.core.createRandomController(App.config.game.random);
    App.runtime.random = random;
    const dataRegistry = App.core.createDataRegistry(random);

    if (dataRegistry.errors.length > 0) {
      // データ不整合時はゲームを進めず、モーダル領域へ全エラーを出す。scene初期化前に止めるのが安全。
      const fatalRoot = document.getElementById("modal-root");
      fatalRoot.classList.remove("is-hidden");
      fatalRoot.setAttribute("aria-hidden", "false");
      document.getElementById("modal-title").textContent = "データ確認エラー";
      const body = document.getElementById("modal-body");
      body.innerHTML = "";
      dataRegistry.errors.forEach((entry) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = entry;
        body.appendChild(paragraph);
      });
      return;
    }

    const initialState = createInitialState(dataRegistry);
    const save = App.core.createSaveManager(App.config.game.save, dataRegistry);
    const shouldAskStartChoice = save.hasSavedState();
    // 保存データの有無はstore生成直後に判断する。以降はstartChoicePendingで自動保存とタイマー進行を止める。
    const store = App.core.createStore(initialState);
    App.runtime.store = store;
    App.runtime.dataRegistry = dataRegistry;
    App.runtime.save = save;
    const input = App.core.createInputController();
    const audio = App.core.createAudioManager(App.config.game.audio);
    audio.bindUserGesture(window);
    const modal = App.core.createModalController(
      {
        root: document.getElementById("modal-root"),
        title: document.getElementById("modal-title"),
        body: document.getElementById("modal-body"),
        confirm: document.getElementById("modal-confirm"),
        actionsRoot: document.getElementById("modal-actions"),
      },
      store,
      audio
    );
    const getCurrentObjectiveText = (state) => getObjectiveText(state, dataRegistry);
    let startChoicePending = shouldAskStartChoice;

    function getFieldBgmId(state) {
      const mapDef = state.field ? dataRegistry.getMap(state.field.mapId) : null;
      return (mapDef && mapDef.bgmId) || "field";
    }

    function syncFieldBgm() {
      const state = store.getState();
      if (state.scene === "field") {
        audio.playBgm(getFieldBgmId(state));
      }
    }

    function buildMonsterPreviewSection(species, caption) {
      // メニューと捕獲記録で共通利用するプレビュー定義。画像アセット優先、なければpixel-art canvasへフォールバック。
      if (!species) {
        return [];
      }

      if (species.imageSprites && species.imageSprites.battleFront) {
        return [
          {
            kind: "monsterPreview",
            imageSrc: species.imageSprites.battleFront,
            caption: caption || species.name,
            backgroundColor: species.palette && species.palette.secondary,
          },
        ];
      }

      if (!species.spriteIds || !species.spriteIds.battleFront) {
        return [];
      }

      return [
        {
          kind: "monsterPreview",
          spriteId: species.spriteIds.battleFront,
          caption: caption || species.name,
          backgroundColor: species.palette && species.palette.secondary,
        },
      ];
    }

    function getMoveSummaryLines(monster) {
      return monster.moveIds.map((moveId, index) => {
        const move = dataRegistry.getMove(moveId);
        return `${move.name} / ${move.type} / PP ${monster.currentPp[index]}/${move.pp}`;
      });
    }

    function canUseFullHeal(state) {
      const playerMonster = state.party[0];
      return Boolean(
        playerMonster &&
          state.inventory.fullHealCount > 0 &&
          playerMonster.currentHp < playerMonster.maxHp
      );
    }

    function consumeFieldFullHeal() {
      // フィールドでの回復薬使用はモーダルを閉じ、結果をfield.messageへ出す。戦闘中の使用処理とはbattle-scene.js側。
      let used = false;

      store.update((state) => {
        if (!canUseFullHeal(state)) {
          return;
        }

        const playerMonster = state.party[0];
        state.inventory.fullHealCount -= 1;
        playerMonster.currentHp = playerMonster.maxHp;
        state.field.message = "回復薬を つかった！\nHPが ぜんかいふく した！";
        used = true;
      });

      if (used) {
        modal.closeModal({ force: true, silent: true });
        audio.playSe("heal");
      }
    }

    function createBackToObservationActions(openObservationMenu) {
      return [
        {
          id: "back_to_records",
          label: "図鑑へ戻る",
          variant: "is-primary",
          onSelect: openObservationMenu,
        },
        {
          id: "back_to_menu",
          label: "メニューへ",
          variant: "is-subtle",
          onSelect: openMenu,
        },
        {
          id: "close",
          label: "閉じる",
          variant: "is-subtle",
        },
      ];
    }

    function spawnTapRipple(event) {
      if (!shell || !event || !["touch", "pen"].includes(event.pointerType)) {
        return;
      }

      const rect = shell.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "tap-ripple";
      ripple.style.left = `${event.clientX - rect.left}px`;
      ripple.style.top = `${event.clientY - rect.top}px`;
      ripple.addEventListener("animationend", () => {
        ripple.remove();
      });
      shell.appendChild(ripple);
    }

    if (shell) {
      // 画面全体のタップ演出と、戦闘メッセージ送りを兼ねる。pointerdownの扱いを変えるとモバイル操作感に影響する。
      shell.addEventListener("pointerdown", (event) => {
        spawnTapRipple(event);

        const state = store.getState();
        if (state.scene === "battle" && state.battle && state.battle.phase === "message") {
          input.queueAction("confirm");
        }
      });
    }

    function openStoryIntro() {
      // 初回説明はdismissible:false。ここを閉じない限り準備タイマーと自動保存は実質開始しない。
      const storyConfig = App.config.game.story || {};
      modal.openModal({
        title: storyConfig.introTitle || "ルール",
        lines: storyConfig.introLead ? [storyConfig.introLead] : [],
        sections: [
          {
            kind: "ruleBox",
            items: storyConfig.introRules || [],
          },
        ],
        dismissible: false,
        actions: [
          {
            id: "start_preparation",
            label: "はじめる",
            onSelect: () => {
              store.update((state) => {
                state.progress.storyIntroAccepted = true;
              });
              modal.closeModal({ force: true, silent: true });
              audio.playSe("confirm");
            },
          },
        ],
      });
    }

    function openMenu() {
      // メニューのボタン順とラベルはsmoke testの期待値にもなっている。onSelect名変更時は該当関数との対応を確認する。
      const state = store.getState();
      const playerSpecies = dataRegistry.getSpecies(state.party[0].speciesId);
      const currentMap = dataRegistry.getMap(state.field.mapId);
      audio.playSe("menu");
      modal.openModal({
        title: "メニュー",
        lines: [
          `現在地: ${currentMap.name}`,
          `手持ち: ${playerSpecies.name} Lv${state.party[0].level}`,
        ],
        actions: [
          {
            id: "party",
            label: "手持ち",
            onSelect: openPartyMenu,
          },
          {
            id: "inventory",
            label: "アイテム",
            onSelect: openInventoryMenu,
          },
          {
            id: "records",
            label: "図鑑",
            onSelect: openObservationMenu,
          },
          {
            id: "restart",
            label: "やり直す",
            variant: "is-danger",
            onSelect: openRestartMenu,
          },
          {
            id: "close",
            label: "閉じる",
            variant: "is-subtle",
          },
        ],
      });
    }

    function openPartyMenu() {
      const state = store.getState();
      const playerMonster = state.party[0];
      const playerSpecies = dataRegistry.getSpecies(playerMonster.speciesId);

      audio.playSe("confirm");
      modal.openModal({
        title: "手持ち",
        sections: buildMonsterPreviewSection(
          playerSpecies,
          `${playerSpecies.name} Lv${playerMonster.level}`
        ),
        lines: [
          `HP ${playerMonster.currentHp}/${playerMonster.maxHp}`,
          ...getMoveSummaryLines(playerMonster),
        ],
        actions: createBackToMenuActions(openMenu),
      });
    }

    function openPartyMenu() {

      const state = store.getState();
      const pickupRecord = countPickupRecords(state);
      const actions = [];
      if (canUseFullHeal(state)) {
        actions.push({
          id: "use_full_heal",
          label: "回復薬を使う",
          onSelect: consumeFieldFullHeal,
        });
      }
      actions.push(...createBackToMenuActions(openMenu));
      audio.playSe("confirm");
      modal.openModal({
        title: "アイテム",
        lines: [
          "キャプチャーボール: 使い放題",
          `パーフェクトボール: ${state.inventory.masterBallCount || 0} 個`,
          `回復薬: ${state.inventory.fullHealCount} 個`,
          `拾ったもの: ${pickupRecord.collected}/${pickupRecord.total}`,
        ],
        actions,
      });
    }

    function openObservationMenu() {
      const state = store.getState();
      const capturedSpeciesIds = getCapturedSpeciesIds(state);
      audio.playSe("confirm");

      if (capturedSpeciesIds.length === 0) {
        modal.openModal({
          title: "図鑑",
          lines: ["まだ図鑑には記録がありません。草むらで出会った相手をつかまえると、ここに記録されます。"],
          actions: createBackToMenuActions(openMenu),
        });
        return;
      }

      modal.openModal({
        title: "図鑑",
        lines: ["見たいモンスターを選んでください。"],
        actions: [
          ...capturedSpeciesIds.map((speciesId) => {
            const species = dataRegistry.getSpecies(speciesId);
            return {
              id: `record_${speciesId}`,
              label: species ? species.name : speciesId,
              onSelect: () => {
                const detailSpecies = dataRegistry.getSpecies(speciesId);
                if (!detailSpecies) {
                  return;
                }
                const moveNames = (detailSpecies.defaultMoveIds || [])
                  .map((moveId) => {
                    const move = dataRegistry.getMove(moveId);
                    return move ? move.name : moveId;
                  })
                  .join(" / ");
                audio.playSe("confirm");
                modal.openModal({
                  title: detailSpecies.name,
                  sections: buildMonsterPreviewSection(detailSpecies, "図鑑データ"),
                  lines: [
                    `タイプ: ${detailSpecies.types.join(" / ")}`,
                    `初期技: ${moveNames}`,
                  ],
                  actions: createBackToObservationActions(openObservationMenu),
                });
              },
            };
          }),
          {
            id: "back_to_menu",
            label: "メニューへ",
            variant: "is-subtle",
            onSelect: openMenu,
          },
          {
            id: "close",
            label: "閉じる",
            variant: "is-subtle",
          },
        ],
      });
    }

    function openRestartMenu() {
      // やり直しはstore.resetとsave.clearを同時に行う。片方だけだと画面上の状態と次回起動時の状態がずれる。
      audio.playSe("confirm");
      modal.openModal({
        title: "やり直しますか？",
        lines: [
          "現在の進行を消して、最初の説明からやり直します。",
          "この操作は取り消せません。",
        ],
        actions: [
          {
            id: "restart",
            label: "最初からやり直す",
            variant: "is-danger",
            onSelect: () => {
              modal.closeModal({ force: true, silent: true });
              store.reset();
              save.clear(store.getState());
              openStoryIntro();
              audio.playSe("confirm");
            },
          },
          {
            id: "back_to_menu",
            label: "メニューへ",
            variant: "is-subtle",
            onSelect: openMenu,
          },
          {
            id: "close",
            label: "閉じる",
            variant: "is-subtle",
          },
        ],
      });
    }

    const openStartChoice = () => {
      // 保存データがある時だけ起動直後に出る選択。ここでは説明文を出さず、保存日時と2択に絞っている。
      const savedAtText = formatSavedAt(save.getSavedInfo());
      modal.openModal({
        title: "",
        lines: [],
        sections: savedAtText
          ? [
              {
                kind: "saveMeta",
                text: `最新保存: ${savedAtText}`,
              },
            ]
          : [],
        dismissible: false,
        actions: [
          {
            id: "continue",
            label: "つづきから",
            onSelect: () => {
              const restoredState = save.load(initialState);
              startChoicePending = false;
              modal.closeModal({ force: true, silent: true });
              store.replace(restoredState);
              syncFieldBgm();
              if (!store.getState().progress.storyIntroAccepted) {
                openStoryIntro();
              }
              audio.playSe("confirm");
            },
          },
          {
            id: "new_game",
            label: "はじめから",
            variant: "is-subtle",
            onSelect: () => {
              startChoicePending = false;
              modal.closeModal({ force: true, silent: true });
              store.reset();
              save.clear(store.getState());
              syncFieldBgm();
              openStoryIntro();
              audio.playSe("confirm");
            },
          },
        ],
      });
    };

    const battleScene = App.scenes.createBattleScene({
      store,
      dataRegistry,
      input,
      modal,
      audio,
      random,
      openMenu,
      createEmptyTransition,
    });
    const fieldScene = App.scenes.createFieldScene({
      store,
      dataRegistry,
      battleScene,
      input,
      modal,
      audio,
      random,
      openMenu,
    });

    const renderer = App.core.createScreenRenderer(screen, message, caption, dataRegistry);
    const ui = App.core.createUiRenderer({
      statusStrip,
      actionPanel,
      battleOverlay,
      screenTimer,
      store,
      input,
      fieldScene,
      battleScene,
      modal,
      dataRegistry,
      openMenu,
      getObjectiveText: getCurrentObjectiveText,
    });

    syncFieldBgm();
    let lastFrame = performance.now();
    let saveElapsedMs = 0;
    const autoSaveIntervalMs = App.config.game.save.autoSaveIntervalMs || 600;

    window.addEventListener("pagehide", () => {
      // タブ終了・ページ離脱時の最後の保存。開始選択中と説明未承諾時は初期データで上書きしない。
      if (!startChoicePending && store.getState().progress.storyIntroAccepted) {
        save.persistIfChanged(store.getState());
      }
    });

    if (startChoicePending) {
      openStartChoice();
    } else if (!store.getState().progress.storyIntroAccepted) {
      openStoryIntro();
    }

    function updatePreparationTimer(deltaMs) {
      // モーダル表示中は準備タイマーを止める。説明や保存選択を読んでいる時間が5分に含まれない仕様。
      const state = store.getState();
      if (
        startChoicePending ||
        modal.isOpen() ||
        !state.progress.storyIntroAccepted ||
        state.progress.storyStage !== "preparation" ||
        state.progress.prepGateUnlocked
      ) {
        return;
      }

      const durationMs = getPreparationDurationMs();
      store.update((nextState) => {
        nextState.progress.prepElapsedMs = Math.min(
          durationMs,
          (nextState.progress.prepElapsedMs || 0) + deltaMs
        );

        if (nextState.progress.prepElapsedMs >= durationMs) {
          nextState.progress.prepGateUnlocked = true;
          if (!nextState.progress.prepGateAnnounced) {
            nextState.progress.prepGateAnnounced = true;
            nextState.field.message =
              (App.config.game.story && App.config.game.story.unlockedGateMessage) ||
              "5分が経過しました。次のマップへの道が開きました。";
          }
        }
      });
    }

    function updateTimeAttackTimer(deltaMs) {
      // 四天王/チャンピオン系マップに入ってからの経過時間。準備ステージとは同じscreen-timer表示を共有する。
      const state = store.getState();
      if (startChoicePending || modal.isOpen() || !state.progress.storyIntroAccepted || state.timeAttack.finished) {
        return;
      }

      const currentMapId = state.field.mapId;
      const shouldBeActive = currentMapId.startsWith("elite_") || currentMapId.startsWith("champion_");

      if (shouldBeActive && !state.timeAttack.active) {
        store.update(s => { s.timeAttack.active = true; });
      }

      if (state.timeAttack.active) {
        store.update(s => {
          s.timeAttack.elapsedMs += deltaMs;
        });
      }
    }

    function frame(now) {
      // 1フレーム内の順序は、入力処理 -> scene更新 -> タイマー -> 保存 -> 描画。
      // 順番変更はメッセージ送り、自動保存、遷移演出の競合を生みやすい。
      const deltaMs = now - lastFrame;
      lastFrame = now;

      if (store.getState().progress && store.getState().progress.gameOver) {
        startChoicePending = false;
        modal.closeModal({ force: true, silent: true });
        store.reset();
        save.clear(store.getState());
        syncFieldBgm();
        openStoryIntro();
        audio.playSe("error");
        return requestAnimationFrame(frame);
      }

      if (store.getState().progress && store.getState().progress.gameCleared) {
        startChoicePending = false;
        store.update(s => { s.timeAttack.finished = true; });
        const finalTimeMs = store.getState().timeAttack.elapsedMs;
        const totalSeconds = Math.floor(finalTimeMs / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        let timeString = "";
        if (hours > 0) timeString += `${hours}時間`;
        if (minutes > 0 || hours > 0) timeString += `${minutes}分`;
        timeString += `${seconds}秒`;

        let rank = "C";
        if (totalSeconds < 300) rank = "S";
        else if (totalSeconds < 600) rank = "A";
        else if (totalSeconds < 1200) rank = "B";

        audio.playSe("confirm");
        modal.openModal({
          title: "殿堂入り",
          lines: [
            "おめでとうございます！",
            `クリアタイム: ${timeString}`,
            `ランク: ${rank}`,
            "あなたの記録は殿堂入りとして登録されました。"
          ],
          dismissible: false,
          actions: [
            {
              id: "return_title",
              label: "タイトルへ",
              onSelect: () => {
                modal.closeModal({ force: true, silent: true });
                store.reset();
                save.clear(store.getState());
                syncFieldBgm();
                openStoryIntro();
                audio.playSe("confirm");
              }
            }
          ]
        });

        // Prevent it from triggering again by removing the flag
        store.update(s => { s.progress.gameCleared = false; });
        return requestAnimationFrame(frame);
      }

      if (modal.isOpen()) {
        if (input.consumeAction("menu")) {
          return requestAnimationFrame(frame);
        }
        if (input.consumeAction("confirm")) {
          modal.confirmPrimary();
          return requestAnimationFrame(frame);
        }
        if (input.consumeAction("cancel")) {
          modal.cancelModal();
          return requestAnimationFrame(frame);
        }
      }

      fieldScene.update(deltaMs);
      battleScene.update(deltaMs);
      syncFieldBgm();
      updatePreparationTimer(deltaMs);
      updateTimeAttackTimer(deltaMs);
      saveElapsedMs += deltaMs;
      if (saveElapsedMs >= autoSaveIntervalMs) {
        // 自動保存は差分がある時だけlocalStorageへ書く。戦闘/遷移中はsave.js側のcanPersistで弾かれる。
        if (!startChoicePending && store.getState().progress.storyIntroAccepted) {
          save.persistIfChanged(store.getState());
        }
        saveElapsedMs = 0;
      }
      renderer.render(store.getState());
      ui.render();
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  window.addEventListener("load", boot);
})();
