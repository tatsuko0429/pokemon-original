// 2026年4月27日時点の開発者向け保守メモ:
// canvas外のDOM UIを描く層。状態表示、タイマー、フィールド操作、戦闘HPカード、戦闘コマンドを担当する。
// ボタンはrenderごとに作り直してinput.jsへイベント登録するため、DOMを保持する外部コードを追加しないこと。
(() => {
  const App = window.MonsterPrototype;

  function createUiRenderer(options) {
    const {
      statusStrip,
      actionPanel,
      battleOverlay,
      screenTimer,
      store,
      input,
      modal,
      dataRegistry,
      battleScene,
      getObjectiveText,
    } = options;

    let lastStatusKey = "";
    let lastPanelKey = "";
    let lastOverlayKey = "";
    let lastTimerKey = "";
    function createButton(label, className, onClick, disabled) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `control-button ${className || ""}`.trim();
      button.textContent = label;
      button.disabled = Boolean(disabled);
      if (typeof onClick === "function") {
        button.addEventListener("click", onClick);
      }
      return button;
    }

    function getMoveEffectText(move) {
      // 技選択中の補足表示用。moves.jsへ新しいeffectを追加したら、ここにもユーザー向け短文を追加する。
      if (!move) return "";
      switch (move.effect) {
        case "random_heal":
          return "HPを回復する。";
        case "evasion_up":
          return "回避率を上げる。";
        case "charge_attack":
          return "1ターン溜めて攻撃する。";
        case "damage_boost":
          return "次の攻撃の威力を上げる。";
        case "chance_big_damage":
          return "まれに大きなダメージを与える。";
        default:
          return "";
      }
    }

    function createMoveButton(move, currentPp, onHover) {
      const button = createButton("", "move-button", null, currentPp <= 0);
      button.setAttribute("aria-label", `${move.name} ${move.type} PP ${currentPp}/${move.pp}`);

      if (onHover) {
        button.addEventListener("mouseenter", () => onHover(move.id));
        button.addEventListener("mouseleave", () => onHover(null));
      }

      const name = document.createElement("span");
      name.className = "move-name";
      name.textContent = move.name;

      const meta = document.createElement("span");
      meta.className = "move-meta";

      const type = document.createElement("span");
      type.className = "move-type";
      type.textContent = move.type;

      const pp = document.createElement("span");
      pp.className = "move-pp";
      pp.textContent = `PP ${currentPp}/${move.pp}`;

      meta.appendChild(type);
      meta.appendChild(pp);
      button.appendChild(name);
      button.appendChild(meta);
      return button;
    }

    function formatShownHp(value) {
      return Math.max(0, Math.ceil(value));
    }

    function formatTimer(ms) {
      const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = String(totalSeconds % 60).padStart(2, "0");
      return `${minutes}:${seconds}`;
    }

    function getPreparationTimerText(state) {
      if (!state.progress || state.progress.storyStage !== "preparation") {
        return "";
      }

      const durationMs =
        (App.config.game.story && App.config.game.story.preparationDurationMs) || 300000;
      return formatTimer(durationMs - (state.progress.prepElapsedMs || 0));
    }

    function renderScreenTimer(state) {
      // 同じDOMで準備タイマーとタイムアタックを切り替える。表示条件はapp.jsのタイマー更新条件と合わせる。
      if (!screenTimer) {
        return;
      }

      let timerText = "";
      
      if (state.timeAttack.active || state.progress.storyStage !== "preparation") {
        timerText = formatTimer(state.timeAttack.elapsedMs);
      } else {
        timerText = getPreparationTimerText(state);
      }

      const timerKey = JSON.stringify({
        text: timerText,
        visible: Boolean(timerText),
      });
      if (timerKey === lastTimerKey) {
        return;
      }
      lastTimerKey = timerKey;

      screenTimer.textContent = timerText;
      screenTimer.classList.toggle("is-hidden", !timerText);
      screenTimer.setAttribute("aria-hidden", String(!timerText));
    }

    function renderStatus(state) {
      // 戦闘中はstatus-cardを隠す。戦闘HPはbattle-overlayへ出し、画面内メッセージとの重なりを避ける。
      const playerMonster = state.party[0];
      const playerSpecies = dataRegistry.getSpecies(playerMonster.speciesId);
      const statusCard = statusStrip.parentElement;
      const hideStatus = state.scene === "battle";
      const shownHp =
        state.scene === "battle" && state.battle
          ? formatShownHp(state.battle.display.playerHp)
          : playerMonster.currentHp;
      if (statusCard) {
        statusCard.classList.toggle("is-hidden", hideStatus);
      }
      const statusKey = JSON.stringify({
        scene: state.scene,
        hidden: hideStatus,
        level: playerMonster.level,
        hp: shownHp,
      });

      if (statusKey === lastStatusKey) {
        return;
      }
      lastStatusKey = statusKey;

      statusStrip.classList.toggle("is-compact", state.scene === "battle");
      statusStrip.innerHTML = "";
      if (hideStatus) {
        return;
      }

      const items = [
        `${playerSpecies.name} Lv${playerMonster.level}`,
        `HP ${shownHp}/${playerMonster.maxHp}`,
        getObjectiveText(state),
      ];

      items.forEach((text) => {
        const pill = document.createElement("div");
        pill.className = "status-pill";
        pill.textContent = text;
        statusStrip.appendChild(pill);
      });
    }

    function renderFieldControls(state) {
      // フィールド操作は「メッセージ表示中はB=戻る、通常時はB=走る」に切り替わる。
      // input名を変える場合はfield-scene.jsのconsumeAction側も同時に見る。
      const wrapper = document.createElement("div");
      wrapper.className = "field-controls";

      const dPad = document.createElement("div");
      dPad.className = "direction-pad";
      const up = createButton("上", "dpad-button is-up");
      const left = createButton("左", "dpad-button is-left");
      const right = createButton("右", "dpad-button is-right");
      const down = createButton("下", "dpad-button is-down");

      input.attachDirectionalPad(dPad, {
        up,
        right,
        down,
        left,
      });

      dPad.appendChild(document.createElement("div")).className = "direction-spacer";
      dPad.appendChild(up);
      dPad.appendChild(document.createElement("div")).className = "direction-spacer";
      dPad.appendChild(left);
      dPad.appendChild(document.createElement("div")).className = "direction-spacer";
      dPad.appendChild(right);
      dPad.appendChild(document.createElement("div")).className = "direction-spacer";
      dPad.appendChild(down);
      dPad.appendChild(document.createElement("div")).className = "direction-spacer";
      wrapper.appendChild(dPad);

      const actionButtons = document.createElement("div");
      actionButtons.className = "action-buttons";
      const confirm = createButton(
        state.field.message ? "A つづける" : "A 決定",
        "face-button is-a"
      );
      const cancel = createButton(state.field.message ? "B 戻る" : "B 走る", "face-button is-b");
      const menu = createButton("メニュー", "system-button is-menu");

      input.attachActionButton(confirm, "confirm");
      if (state.field.message) {
        input.attachActionButton(cancel, "cancel");
      } else {
        input.attachHoldButton(cancel, "run");
      }
      input.attachActionButton(menu, "menu");

      actionButtons.appendChild(confirm);
      actionButtons.appendChild(cancel);
      actionButtons.appendChild(menu);
      wrapper.appendChild(actionButtons);

      return wrapper;
    }

    function createBattleCard(options) {
      const card = document.createElement("div");
      card.className = `battle-card ${options.className}`.trim();

      const top = document.createElement("div");
      top.className = "battle-card-top";
      const name = document.createElement("div");
      name.className = "battle-name";
      name.textContent = options.name;
      
      const typeEl = document.createElement("div");
      typeEl.className = "battle-type";
      typeEl.textContent = options.type ? `[${options.type}]` : "";

      const level = document.createElement("div");
      level.className = "battle-level";
      level.textContent = `Lv${options.level}`;
      
      top.appendChild(name);
      top.appendChild(level);
      card.appendChild(top);

      const typeRow = document.createElement("div");
      typeRow.className = "battle-type-row";
      const typeRowEl = document.createElement("div");
      typeRowEl.className = "battle-type";
      typeRowEl.textContent = options.type ? `タイプ: ${options.type}` : "";
      typeRow.appendChild(typeRowEl);
      card.appendChild(typeRow);

      const hpRow = document.createElement("div");
      hpRow.className = "battle-hp-row";
      const label = document.createElement("div");
      label.className = "battle-hp-label";
      label.textContent = "HP";
      const track = document.createElement("div");
      track.className = "battle-hp-track";
      const fill = document.createElement("div");
      fill.className = "battle-hp-fill";
      if (options.hpRatio <= 0.3) {
        fill.classList.add("is-low");
      }
      fill.style.width = `${Math.max(0, Math.min(100, options.hpRatio * 100))}%`;
      track.appendChild(fill);
      hpRow.appendChild(label);
      hpRow.appendChild(track);

      if (options.hpText) {
        const value = document.createElement("div");
        value.className = "battle-hp-value";
        value.textContent = options.hpText;
        hpRow.appendChild(value);
      }

      card.appendChild(hpRow);

      if (typeof options.expRatio === "number") {
        const expRow = document.createElement("div");
        expRow.className = "battle-exp-row";
        const expTrack = document.createElement("div");
        expTrack.className = "battle-exp-track";
        const expFill = document.createElement("div");
        expFill.className = "battle-exp-fill";
        expFill.style.width = `${Math.max(0, Math.min(100, options.expRatio * 100))}%`;
        expTrack.appendChild(expFill);
        expRow.appendChild(expTrack);
        card.appendChild(expRow);
      }

      return card;
    }

    function createBattleCommandButtons(options) {
      const settings = options || {};
      const wrapper = document.createElement("div");
      wrapper.className = "battle-buttons";
      if (settings.hasMasterBall) {
        wrapper.classList.add("has-master-ball");
      }

      const fight = createButton("たたかう", "", null, settings.disabledAll);
      const ball = createButton("ボール", "", null, settings.disabledAll);
      const run = createButton("にげる", "is-subtle", null, settings.disabledAll);
      const item = createButton(
        "アイテム",
        settings.itemDisabled && !settings.disabledAll ? "is-subtle" : "",
        null,
        settings.disabledAll || settings.itemDisabled
      );

      if (!settings.disabledAll) {
        input.attachActionButton(fight, "battle_open_move_menu");
        input.attachActionButton(ball, "battle_throw_ball");
        input.attachActionButton(run, "battle_attempt_run");
        if (!settings.itemDisabled) {
          input.attachActionButton(item, "battle_use_item");
        }
      }

      wrapper.appendChild(fight);
      wrapper.appendChild(ball);
      wrapper.appendChild(run);
      wrapper.appendChild(item);

      if (settings.hasMasterBall) {
        const masterBall = createButton("Mボール", "is-primary", null, settings.disabledAll);
        if (!settings.disabledAll) {
          input.attachActionButton(masterBall, "battle_throw_master_ball");
        }
        wrapper.appendChild(masterBall);
      }

      return wrapper;
    }

    function renderBattleOverlay(state) {
      // HPカードは差分キーで再描画を抑える。カード位置はstyles.css、HP値はbattle-scene.jsのdisplay値に依存する。
      if (state.scene !== "battle" || !state.battle) {
        battleOverlay.classList.add("is-hidden");
        battleOverlay.setAttribute("aria-hidden", "true");
        battleOverlay.innerHTML = "";
        lastOverlayKey = "";
        return;
      }

      const playerMonster = state.party[0];
      const enemyMonster = state.battle.enemy;
      const playerSpecies = dataRegistry.getSpecies(playerMonster.speciesId);
      const enemySpecies = dataRegistry.getSpecies(enemyMonster.speciesId);
      const playerShownHp = formatShownHp(state.battle.display.playerHp);
      const enemyShownHp = formatShownHp(state.battle.display.enemyHp);

      const requiredExp = playerMonster.level * playerMonster.level * 10;
      const expRatio = (playerMonster.exp || 0) / requiredExp;

      const overlayKey = JSON.stringify({
        playerShownHp,
        enemyShownHp,
        playerName: playerSpecies.name,
        enemyName: enemySpecies.name,
        playerLevel: playerMonster.level,
        playerExp: playerMonster.exp,
      });

      battleOverlay.classList.remove("is-hidden");
      battleOverlay.setAttribute("aria-hidden", "false");

      if (overlayKey === lastOverlayKey) {
        return;
      }
      lastOverlayKey = overlayKey;

      battleOverlay.innerHTML = "";
      battleOverlay.appendChild(
        createBattleCard({
          className: "is-enemy",
          name: enemySpecies.name,
          type: enemySpecies.types.join(" / "),
          level: enemyMonster.level,
          hpRatio: enemyShownHp / enemyMonster.maxHp,
        })
      );
      battleOverlay.appendChild(
        createBattleCard({
          className: "is-player",
          name: playerSpecies.name,
          type: playerSpecies.types.join(" / "),
          level: playerMonster.level,
          hpRatio: playerShownHp / playerMonster.maxHp,
          hpText: `${playerShownHp}/${playerMonster.maxHp}`,
          expRatio: expRatio,
        })
      );
    }

    function renderBattleControls(state) {
      // battle.phaseごとに同じ操作パネルを差し替える。message中は入力ロックとdisabledボタンで誤操作を避ける。
      const battle = state.battle;
      const animationActive = Boolean(battle.animation) || state.transition.active;
      const playerMonster = state.party[0];
      const itemDisabled = state.inventory.fullHealCount <= 0;
      const hasMasterBall = state.inventory.masterBallCount > 0;
      const panel = document.createElement("div");
      panel.className = "battle-panel";

      const message = document.createElement("div");
      message.className = "battle-message-panel";
      message.setAttribute("aria-live", "polite");

      let currentMessage = battle.currentMessage;
      if (!currentMessage && battle.phase === "moveSelect" && battle.hoveredMoveId) {
        const move = dataRegistry.getMove(battle.hoveredMoveId);
        if (move) {
          const powerText = move.power > 0 ? `威力:${move.power}` : "威力:-";
          const accuracyText = move.accuracy > 0 ? `命中:${move.accuracy}` : "";
          const effectText = getMoveEffectText(move);
          currentMessage = `${powerText} ${accuracyText} ${effectText}`.trim();
        }
      }

      message.textContent =
        currentMessage ||
        (battle.phase === "moveSelect" ? "技を選んでください。" : "コマンドを選んでください。");
      panel.appendChild(message);

      if (battle.phase === "message") {
        panel.appendChild(createBattleCommandButtons({ 
          disabledAll: true, 
          itemDisabled: true,
          hasMasterBall: hasMasterBall,
        }));
        return panel;
      }

      if (battle.phase === "command") {
        panel.appendChild(
          createBattleCommandButtons({
            disabledAll: animationActive,
            itemDisabled,
            hasMasterBall: hasMasterBall,
          })
        );
        return panel;
      }

      if (battle.phase === "moveSelect") {
        // hoverMoveは説明文表示だけでなく状態を更新するため、panelKeyへhoveredMoveIdを足す必要がある場合がある。
        const wrapper = document.createElement("div");
        wrapper.className = "battle-buttons is-move-select";
        const playerMonster = state.party[0];
        playerMonster.moveIds.forEach((moveId, index) => {
          const move = dataRegistry.getMove(moveId);
          const currentPp = playerMonster.currentPp[index];
          const button = createMoveButton(move, currentPp, battleScene.hoverMove);
          input.attachActionButton(button, "battle_select_move", { moveId });
          wrapper.appendChild(button);
        });
        const back = createButton("もどる", "is-subtle");
        input.attachActionButton(back, "cancel");
        wrapper.appendChild(back);
        panel.appendChild(wrapper);
        return panel;
      }

      panel.appendChild(createBattleCommandButtons({ disabledAll: true, itemDisabled: true }));
      return panel;
    }

    function renderActionPanel(state) {
      // panelKeyに入れた値だけで再描画判断する。UIが更新されない時は、まずこのキーへ状態が含まれているか確認する。
      const panelKey = JSON.stringify({
        scene: state.scene,
        transition: state.transition.active ? state.transition.kind : "",
        fieldMessage: state.field.message,
        battlePhase: state.battle ? state.battle.phase : null,
        battleMessage: state.battle ? state.battle.currentMessage : null,
        battleAnimation: state.battle ? state.battle.animation && state.battle.animation.kind : null,
        fullHealCount: state.inventory.fullHealCount,
        playerHp: state.party[0] ? state.party[0].currentHp : 0,
      });

      if (panelKey === lastPanelKey) {
        return;
      }
      lastPanelKey = panelKey;
      actionPanel.innerHTML = "";

      if (state.transition.active) {
        actionPanel.appendChild(
          createButton("野生の気配…", "is-subtle", () => {}, true)
        );
      } else if (state.scene === "field") {
        actionPanel.appendChild(renderFieldControls(state));
      } else if (state.scene === "battle") {
        actionPanel.appendChild(renderBattleControls(state));
      }
    }

    function render() {
      // body.is-battle-sceneはCSSの画面比率切替スイッチ。scene変更と同じフレームで更新する。
      const state = store.getState();
      document.body.classList.toggle("is-battle-scene", state.scene === "battle");
      renderScreenTimer(state);
      renderStatus(state);
      renderBattleOverlay(state);
      renderActionPanel(state);
      modal.render();
    }

    return {
      render,
    };
  }

  App.core.createUiRenderer = createUiRenderer;
})();
