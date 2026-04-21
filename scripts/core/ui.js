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
      getObjectiveText,
    } = options;

    let lastStatusKey = "";
    let lastPanelKey = "";
    let lastOverlayKey = "";
    let lastTimerKey = "";
    const fieldControlHint = "十字キーで移動 / Aで調べる / メニューで目的を確認";

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

    function createMoveButton(move, currentPp) {
      const button = createButton("", "move-button", null, currentPp <= 0);
      button.setAttribute("aria-label", `${move.name} ${move.type} PP ${currentPp}/${move.pp}`);

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
      if (!screenTimer) {
        return;
      }

      const timerText = getPreparationTimerText(state);
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
      const playerMonster = state.party[0];
      const playerSpecies = dataRegistry.getSpecies(playerMonster.speciesId);
      const shownHp =
        state.scene === "battle" && state.battle
          ? formatShownHp(state.battle.display.playerHp)
          : playerMonster.currentHp;
      const statusKey = JSON.stringify({
        scene: state.scene,
        level: playerMonster.level,
        hp: shownHp,
        balls: state.inventory.balls,
      });

      if (statusKey === lastStatusKey) {
        return;
      }
      lastStatusKey = statusKey;

      statusStrip.classList.toggle("is-compact", state.scene === "battle");
      statusStrip.innerHTML = "";
      const items =
        state.scene === "battle"
          ? [`ボール ${state.inventory.balls}`]
          : [
              `${playerSpecies.name} Lv${playerMonster.level}`,
              `HP ${shownHp}/${playerMonster.maxHp}`,
            ];

      items.forEach((text) => {
        const pill = document.createElement("div");
        pill.className = "status-pill";
        pill.textContent = text;
        statusStrip.appendChild(pill);
      });
    }

    function renderFieldControls(state) {
      const wrapper = document.createElement("div");
      wrapper.className = "field-controls";

      const note = document.createElement("p");
      note.className = "panel-note";
      note.textContent = state.field.message
        ? "メッセージを閉じると移動を再開できます。"
        : fieldControlHint;
      wrapper.appendChild(note);

      const dPad = document.createElement("div");
      dPad.className = "direction-pad";
      const up = createButton("上", "dpad-button is-up");
      const left = createButton("左", "dpad-button is-left");
      const right = createButton("右", "dpad-button is-right");
      const down = createButton("下", "dpad-button is-down");

      input.attachDirectionButton(up, "up");
      input.attachDirectionButton(left, "left");
      input.attachDirectionButton(right, "right");
      input.attachDirectionButton(down, "down");

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
      const cancel = createButton("B 戻る", "face-button is-b", null, !state.field.message);
      const menu = createButton("メニュー", "system-button");

      input.attachActionButton(confirm, "confirm");
      input.attachActionButton(cancel, "cancel");
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
      const level = document.createElement("div");
      level.className = "battle-level";
      level.textContent = `Lv${options.level}`;
      top.appendChild(name);
      top.appendChild(level);
      card.appendChild(top);

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
      return card;
    }

    function renderBattleOverlay(state) {
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
      const overlayKey = JSON.stringify({
        playerShownHp,
        enemyShownHp,
        playerName: playerSpecies.name,
        enemyName: enemySpecies.name,
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
          level: enemyMonster.level,
          hpRatio: enemyShownHp / enemyMonster.maxHp,
        })
      );
      battleOverlay.appendChild(
        createBattleCard({
          className: "is-player",
          name: playerSpecies.name,
          level: playerMonster.level,
          hpRatio: playerShownHp / playerMonster.maxHp,
          hpText: `${playerShownHp}/${playerMonster.maxHp}`,
        })
      );
    }

    function renderBattleControls(state) {
      const wrapper = document.createElement("div");
      wrapper.className = "battle-buttons";
      const battle = state.battle;
      const animationActive = Boolean(battle.animation) || state.transition.active;

      if (battle.phase === "message") {
        wrapper.classList.add("is-message");
        const confirm = createButton("つづける", "", null, animationActive);
        input.attachActionButton(confirm, "confirm");
        wrapper.appendChild(confirm);
        return wrapper;
      }

      if (battle.phase === "command") {
        const fight = createButton("たたかう");
        const ball = createButton("ボール");
        const run = createButton("にげる", "is-subtle");
        const menu = createButton("メニュー", "is-subtle");

        input.attachActionButton(fight, "battle_open_move_menu");
        input.attachActionButton(ball, "battle_throw_ball");
        input.attachActionButton(run, "battle_attempt_run");
        input.attachActionButton(menu, "menu");

        wrapper.appendChild(fight);
        wrapper.appendChild(ball);
        wrapper.appendChild(run);
        wrapper.appendChild(menu);
        return wrapper;
      }

      if (battle.phase === "moveSelect") {
        wrapper.classList.add("is-move-select");
        const playerMonster = state.party[0];
        playerMonster.moveIds.forEach((moveId, index) => {
          const move = dataRegistry.getMove(moveId);
          const currentPp = playerMonster.currentPp[index];
          const button = createMoveButton(move, currentPp);
          input.attachActionButton(button, "battle_select_move", { moveId });
          wrapper.appendChild(button);
        });
        const back = createButton("もどる", "is-subtle");
        input.attachActionButton(back, "cancel");
        wrapper.appendChild(back);
        return wrapper;
      }

      wrapper.classList.add("is-single");
      const confirm = createButton("つづける");
      input.attachActionButton(confirm, "confirm");
      wrapper.appendChild(confirm);
      return wrapper;
    }

    function renderActionPanel(state) {
      const panelKey = JSON.stringify({
        scene: state.scene,
        transition: state.transition.active ? state.transition.kind : "",
        fieldMessage: state.field.message,
        battlePhase: state.battle ? state.battle.phase : null,
        battleMessage: state.battle ? state.battle.currentMessage : null,
        battleAnimation: state.battle ? state.battle.animation && state.battle.animation.kind : null,
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
      const state = store.getState();
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
