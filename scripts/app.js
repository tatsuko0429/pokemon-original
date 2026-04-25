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
    const configuredStartMapId = App.config.game.field && App.config.game.field.startMapId;
    const firstMap = dataRegistry.getMap(configuredStartMapId) || App.data.maps[0];
    const starter = dataRegistry.createMonsterInstance("dummy_bud", 5);
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
      },
      collection: {
        capturedSpeciesIds: [],
      },
      progress,
    };
  }

  function getObjectiveText(state, dataRegistry) {
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

    function buildMonsterPreviewSection(species, caption) {
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
      shell.addEventListener("pointerdown", spawnTapRipple);
    }

    function openStoryIntro() {
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
            id: "objective",
            label: "目的",
            onSelect: openObjectiveMenu,
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

    function openObjectiveMenu() {
      const state = store.getState();
      const currentMap = dataRegistry.getMap(state.field.mapId);
      audio.playSe("confirm");
      modal.openModal({
        title: "目的",
        lines: [getCurrentObjectiveText(state), `現在地: ${currentMap.name}`],
        actions: createBackToMenuActions(openMenu),
      });
    }

    function openInventoryMenu() {
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
          "モンスターボール: 使い放題",
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
      const savedAtText = formatSavedAt(save.getSavedInfo());
      modal.openModal({
        title: "",
        lines: [],
        sections: savedAtText
          ? [
              {
                kind: "saveMeta",
                text: `保存: ${savedAtText}`,
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

    audio.playBgm("field");
    let lastFrame = performance.now();
    let saveElapsedMs = 0;
    const autoSaveIntervalMs = App.config.game.save.autoSaveIntervalMs || 600;

    window.addEventListener("pagehide", () => {
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

    function frame(now) {
      const deltaMs = now - lastFrame;
      lastFrame = now;

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
      updatePreparationTimer(deltaMs);
      saveElapsedMs += deltaMs;
      if (saveElapsedMs >= autoSaveIntervalMs) {
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
