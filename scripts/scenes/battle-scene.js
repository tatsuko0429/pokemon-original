(() => {
  const App = window.MonsterPrototype;

  function createBattleScene({
    store,
    dataRegistry,
    input,
    modal,
    audio,
    random,
    openMenu,
    createEmptyTransition,
  }) {
    const animationConfig = App.config.game.animation;
    const ballConfig = animationConfig.ball;
    const battleConfig = App.config.game.battle || {};

    function getPlayerMonster(state) {
      return state.party[0];
    }

    function createStep(text, effect, soundId) {
      return {
        text,
        effect: effect || null,
        soundId: soundId || "",
      };
    }

    function canUseFullHeal(state) {
      const playerMonster = getPlayerMonster(state);
      return Boolean(
        playerMonster &&
          state.inventory.fullHealCount > 0 &&
          playerMonster.currentHp < playerMonster.maxHp
      );
    }

    function rememberCapturedSpecies(state, speciesId) {
      if (!speciesId) {
        return false;
      }

      if (state.collection.capturedSpeciesIds.includes(speciesId)) {
        return false;
      }

      state.collection.capturedSpeciesIds.push(speciesId);
      return true;
    }

    function healParty(state) {
      state.party.forEach((monster) => {
        monster.currentHp = monster.maxHp;
        monster.currentPp = monster.moveIds.map((moveId) => dataRegistry.getMove(moveId).pp);
      });
    }

    function createAnimation(effect) {
      if (!effect) {
        return null;
      }

      if (effect.kind === "damage") {
        return {
          kind: "damage",
          target: effect.target,
          fromHp: effect.fromHp,
          toHp: effect.toHp,
          elapsedMs: 0,
          durationMs: animationConfig.damage.durationMs,
        };
      }

      if (effect.kind === "heal") {
        return {
          kind: "heal",
          target: effect.target,
          fromHp: effect.fromHp,
          toHp: effect.toHp,
          elapsedMs: 0,
          durationMs: animationConfig.damage.durationMs,
        };
      }

      if (effect.kind === "ball") {
        const phase = effect.phase || "throw";
        const phaseDurations = {
          throw: ballConfig.throwDurationMs || ballConfig.durationMs,
          shake: ballConfig.shakeDurationMs || ballConfig.durationMs,
          release: ballConfig.releaseDurationMs || ballConfig.durationMs,
        };

        return {
          kind: "ball",
          phase,
          elapsedMs: 0,
          durationMs: effect.durationMs || phaseDurations[phase] || ballConfig.durationMs,
          success: Boolean(effect.success),
          shakeIndex: effect.shakeIndex || 0,
          totalShakes: effect.totalShakes || 0,
        };
      }

      return null;
    }

    function showStep(state, step) {
      input.clearActions();
      state.battle.currentMessage = step ? step.text : "";
      state.battle.messageElapsedMs = 0;
      state.battle.animation = step ? createAnimation(step.effect) : null;
      input.setActionLock(Boolean(state.battle.animation), { clearQueue: true });
      if (step && step.soundId) {
        audio.playSe(step.soundId);
      }
    }

    function startSequence(state, steps, nextPhase) {
      state.battle.phase = "message";
      state.battle.steps = steps.slice();
      state.battle.nextPhase = nextPhase;
      const first = state.battle.steps.shift();
      showStep(state, first || null);
    }

    function applyBattleClose(state, result) {
      if (result && result.capturedSpeciesId) {
        result.addedToCollection = rememberCapturedSpecies(state, result.capturedSpeciesId);
      }

      if (result && result.capturedMonster) {
        state.party = [result.capturedMonster];
      }

      healParty(state);
      state.scene = "field";
      state.battle = null;
      state.field.message = result && result.message ? result.message : "";
      state.field.lastEncounterStep = state.field.steps;
      audio.playBgm("field");
    }

    function openCaptureRecordModal(result) {
      if (!result || !result.capturedSpeciesId) {
        return;
      }

      const species = dataRegistry.getSpecies(result.capturedSpeciesId);
      if (!species) {
        return;
      }

      modal.openModal({
        title: "捕獲の記録",
        lines: [
          `${species.name} Lv${result.capturedLevel}`,
          `タイプ: ${species.types.join(" / ")}`,
          result.addedToCollection
            ? "新しく図鑑へ記録しました。"
            : "このモンスターは、すでに図鑑へ記録されています。",
        ],
        buttonLabel: "戻る",
      });
    }

    function beginEncounter(enemyMonster) {
      store.update((state) => {
        const playerMonster = getPlayerMonster(state);

        state.scene = "battle";
        state.field.message = "";
        state.battle = {
          phase: "message",
          currentMessage: "",
          steps: [],
          nextPhase: "command",
          animation: null,
          messageElapsedMs: 0,
          captureBall: null,
          enemy: enemyMonster,
          display: {
            playerHp: playerMonster.currentHp,
            enemyHp: enemyMonster.currentHp,
          },
        };

        const playerSpecies = dataRegistry.getSpecies(playerMonster.speciesId);
        const enemySpecies = dataRegistry.getSpecies(enemyMonster.speciesId);

        startSequence(
          state,
          [
            createStep(`やせいの ${enemySpecies.name} が あらわれた！`),
            createStep(`${playerSpecies.name} を くりだした！`),
          ],
          "command"
        );
      });
      audio.playBgm("battle");
      input.setActionLock(false, { clearQueue: true });
      input.clearDirections();
    }

    function beginEncounterTransition(enemyMonster) {
      input.setActionLock(true, { clearQueue: true });
      store.update((state) => {
        state.transition = {
          active: true,
          kind: "wild-encounter",
          elapsedMs: 0,
          durationMs: animationConfig.wildEncounterTransitionMs,
          enemy: enemyMonster,
        };
      });
      audio.playSe("encounter");
      input.clearDirections();
    }

    function finishTransitionIfNeeded(deltaMs) {
      let pendingEncounter = null;

      store.update((state) => {
        if (!state.transition.active) {
          return;
        }

        state.transition.elapsedMs += deltaMs;
        if (state.transition.elapsedMs >= state.transition.durationMs) {
          pendingEncounter = state.transition.enemy;
          state.transition = createEmptyTransition();
        }
      });

      if (pendingEncounter) {
        beginEncounter(pendingEncounter);
      }
    }

    function handleMessageCompletion(state) {
      if (state.battle.nextPhase === "command") {
        state.battle.phase = "command";
        state.battle.currentMessage = "";
        return null;
      }

      if (state.battle.nextPhase === "moveSelect") {
        state.battle.phase = "moveSelect";
        state.battle.currentMessage = "";
        return null;
      }

      if (state.battle.nextPhase === "field_victory") {
        return { message: "戦闘が終わり、ひと息つきました。" };
      }

      if (state.battle.nextPhase === "field_capture") {
        return {
          message: "つかまえた相手と 手持ちを入れ替えた！",
          capturedSpeciesId: state.battle.enemy.speciesId,
          capturedLevel: state.battle.enemy.level,
          capturedMonster: state.battle.enemy,
        };
      }

      if (state.battle.nextPhase === "field_run") {
        return { message: "うまく戦闘を離れました。" };
      }

      if (state.battle.nextPhase === "field_defeat") {
        return { message: "力つきたため、体力を戻しました。" };
      }

      return null;
    }

    function advanceMessage() {
      let closeResult = null;

      store.update((state) => {
        if (!state.battle || state.battle.phase !== "message" || state.battle.animation) {
          return;
        }

        if (state.battle.steps.length > 0) {
          showStep(state, state.battle.steps.shift());
          return;
        }

        closeResult = handleMessageCompletion(state);
      });

      if (closeResult) {
        store.update((state) => {
          applyBattleClose(state, closeResult);
        });
        input.setActionLock(false, { clearQueue: true });
        openCaptureRecordModal(closeResult);
      }
    }

    function findMoveIndex(monster, moveId) {
      return monster.moveIds.findIndex((currentMoveId) => currentMoveId === moveId);
    }

    function trySpendPp(monster, moveId) {
      const moveIndex = findMoveIndex(monster, moveId);
      if (moveIndex < 0 || monster.currentPp[moveIndex] <= 0) {
        return false;
      }

      monster.currentPp[moveIndex] -= 1;
      return true;
    }

    function attemptMoveHit(move) {
      return random.percent(move.accuracy, "move_accuracy");
    }

    function buildAttackSequence(
      attacker,
      defender,
      moveId,
      attackerLabel,
      defenderLabel,
      hpTarget
    ) {
      const move = dataRegistry.getMove(moveId);
      const steps = [createStep(`${attackerLabel}の ${move.name}！`, null, "move")];

      if (!attemptMoveHit(move)) {
        steps.push(createStep("しかし こうげきは はずれた！"));
        return {
          steps,
          defeated: false,
        };
      }

      const fromHp = defender.currentHp;
      const outcome = dataRegistry.computeDamage(attacker, defender, moveId);
      defender.currentHp = Math.max(0, defender.currentHp - outcome.damage);

      steps.push(
        createStep(`${defenderLabel} に ${outcome.damage} ダメージ！`, {
          kind: "damage",
          target: hpTarget,
          fromHp,
          toHp: defender.currentHp,
        }, "hit")
      );

      if (outcome.typeMultiplier > 1) {
        steps.push(createStep("こうかは ばつぐんだ！"));
      } else if (outcome.typeMultiplier < 1) {
        steps.push(createStep("こうかは いまひとつのようだ。"));
      }

      return {
        steps,
        defeated: defender.currentHp <= 0,
      };
    }

    function queueEnemyTurn(state, steps) {
      const playerMonster = getPlayerMonster(state);
      const enemyMonster = state.battle.enemy;
      const playerSpecies = dataRegistry.getSpecies(playerMonster.speciesId);
      const enemySpecies = dataRegistry.getSpecies(enemyMonster.speciesId);
      trySpendPp(enemyMonster, enemyMonster.moveIds[0]);

      const enemyTurn = buildAttackSequence(
        enemyMonster,
        playerMonster,
        enemyMonster.moveIds[0],
        `やせいの ${enemySpecies.name}`,
        playerSpecies.name,
        "player"
      );
      steps.push(...enemyTurn.steps);

      if (enemyTurn.defeated) {
        steps.push(createStep(`${playerSpecies.name} は たおれた！`));
        startSequence(state, steps, "field_defeat");
        return;
      }

      startSequence(state, steps, "command");
    }

    function openMoveMenu() {
      store.update((state) => {
        if (!state.battle) {
          return;
        }
        state.battle.phase = "moveSelect";
        state.battle.currentMessage = "";
      });
    }

    function backToCommand() {
      store.update((state) => {
        if (!state.battle) {
          return;
        }
        state.battle.phase = "command";
        state.battle.currentMessage = "";
      });
    }

    function selectMove(moveId) {
      store.update((state) => {
        if (!state.battle) {
          return;
        }

        const playerMonster = getPlayerMonster(state);
        const enemyMonster = state.battle.enemy;
        const playerSpecies = dataRegistry.getSpecies(playerMonster.speciesId);
        const enemySpecies = dataRegistry.getSpecies(enemyMonster.speciesId);

        if (!trySpendPp(playerMonster, moveId)) {
          startSequence(state, [createStep("PPが たりません。", null, "error")], "command");
          return;
        }

        const attack = buildAttackSequence(
          playerMonster,
          enemyMonster,
          moveId,
          playerSpecies.name,
          `やせいの ${enemySpecies.name}`,
          "enemy"
        );
        const steps = attack.steps.slice();

        if (attack.defeated) {
          steps.push(createStep(`やせいの ${enemySpecies.name} は たおれた！`));
          startSequence(state, steps, "field_victory");
          return;
        }

        queueEnemyTurn(state, steps);
      });
    }

    function throwBall() {
      store.update((state) => {
        if (!state.battle) {
          return;
        }

        const enemyMonster = state.battle.enemy;
        const enemySpecies = dataRegistry.getSpecies(enemyMonster.speciesId);
        const healthRatio = enemyMonster.currentHp / enemyMonster.maxHp;
        const baseChance = (enemySpecies.catchRate / 255) * (1 - healthRatio * 0.65);
        const success = random.chance(baseChance, "capture_roll");
        const shakes = success ? 3 : Math.max(1, Math.min(2, Math.floor(baseChance * 4)));
        const steps = [
          createStep("モンスターボールを なげた！", {
            kind: "ball",
            phase: "throw",
            success,
          }, "ball"),
        ];

        for (let count = 0; count < shakes; count += 1) {
          steps.push(createStep("カタカタ…", {
            kind: "ball",
            phase: "shake",
            success,
            shakeIndex: count + 1,
            totalShakes: shakes,
          }, "shake"));
        }

        if (success) {
          steps.push(createStep(`${enemySpecies.name} を つかまえた！`, null, "capture"));
          startSequence(state, steps, "field_capture");
          return;
        }

        steps.push(createStep("ざんねん！ つかまらなかった！", {
          kind: "ball",
          phase: "release",
          success: false,
        }, "error"));
        queueEnemyTurn(state, steps);
      });
    }

    function useFullHeal() {
      store.update((state) => {
        if (!state.battle) {
          return;
        }

        if (!canUseFullHeal(state)) {
          startSequence(state, [createStep("回復薬は つかえない。", null, "error")], "command");
          return;
        }

        const playerMonster = getPlayerMonster(state);
        const fromHp = playerMonster.currentHp;
        state.inventory.fullHealCount -= 1;
        playerMonster.currentHp = playerMonster.maxHp;

        const steps = [
          createStep(
            "回復薬を つかった！",
            {
              kind: "heal",
              target: "player",
              fromHp,
              toHp: playerMonster.maxHp,
            },
            "heal"
          ),
        ];

        queueEnemyTurn(state, steps);
      });
    }

    function autoAdvanceMessage(deltaMs) {
      let shouldAdvance = false;

      store.update((state) => {
        if (!state.battle || state.battle.phase !== "message" || state.battle.animation) {
          return;
        }

        state.battle.messageElapsedMs =
          (state.battle.messageElapsedMs || 0) + deltaMs;

        if (state.battle.messageElapsedMs >= (battleConfig.messageAutoAdvanceMs || 650)) {
          shouldAdvance = true;
        }
      });

      if (shouldAdvance) {
        advanceMessage();
      }
    }

    function attemptRun() {
      store.update((state) => {
        if (!state.battle) {
          return;
        }
        startSequence(state, [createStep("うまく にげきれた！", null, "run")], "field_run");
      });
    }

    function updateAnimation(state, deltaMs) {
      if (!state.battle || !state.battle.animation) {
        return;
      }

      const animation = state.battle.animation;
      animation.elapsedMs += deltaMs;

      if (animation.kind === "damage" || animation.kind === "heal") {
        const progress = Math.min(1, animation.elapsedMs / animation.durationMs);
        const eased = 1 - Math.pow(1 - progress, 2);
        const currentHp =
          animation.fromHp + (animation.toHp - animation.fromHp) * eased;
        state.battle.display[`${animation.target}Hp`] = currentHp;
        if (progress >= 1) {
          state.battle.display[`${animation.target}Hp`] = animation.toHp;
          state.battle.animation = null;
        }
      } else if (animation.kind === "ball") {
        const progress = Math.min(1, animation.elapsedMs / animation.durationMs);

        if (animation.phase === "throw") {
          const x = ballConfig.startX + (ballConfig.endX - ballConfig.startX) * progress;
          const y =
            (1 - progress) * (1 - progress) * ballConfig.startY +
            2 * (1 - progress) * progress * ballConfig.curveY +
            progress * progress * ballConfig.endY;
          state.battle.captureBall = {
            phase: "throw",
            x,
            y,
            hideEnemy: progress >= (ballConfig.absorbAt || 0.62),
            open: 0,
          };
        } else if (animation.phase === "shake") {
          const shakeOffset =
            Math.sin(progress * Math.PI * (ballConfig.shakeCycles || 4)) *
            (ballConfig.shakePixels || 3);
          state.battle.captureBall = {
            phase: "shake",
            x: ballConfig.endX + shakeOffset,
            y: ballConfig.endY,
            hideEnemy: true,
            open: 0,
          };
        } else if (animation.phase === "release") {
          const open = Math.min(1, progress * 1.35);
          state.battle.captureBall =
            progress < (ballConfig.releaseHideAt || 0.55)
              ? {
                  phase: "release",
                  x: ballConfig.endX,
                  y: ballConfig.endY,
                  hideEnemy: true,
                  open,
                }
              : null;
        }

        if (progress >= 1) {
          if (animation.phase === "throw" || animation.phase === "shake") {
            state.battle.captureBall = {
              phase: "hold",
              x: ballConfig.endX,
              y: ballConfig.endY,
              hideEnemy: true,
              open: 0,
            };
          } else if (animation.phase === "release") {
            state.battle.captureBall = null;
          }
          state.battle.animation = null;
        }
      }
    }

    function update(deltaMs) {
      const rootState = store.getState();

      if (rootState.transition.active) {
        if (!modal.isOpen()) {
          finishTransitionIfNeeded(deltaMs);
        }
        return;
      }

      if (rootState.scene !== "battle" || !rootState.battle) {
        return;
      }

      store.update((state) => {
        updateAnimation(state, deltaMs);
      });

      const state = store.getState();
      if (!state.battle.animation && input.isActionLocked()) {
        input.setActionLock(false);
      }
      if (modal.isOpen()) {
        return;
      }

      if (state.battle.phase === "message") {
        input.clearActions([
          "confirm",
          "cancel",
          "menu",
          "battle_open_move_menu",
          "battle_throw_ball",
          "battle_attempt_run",
          "battle_use_item",
          "battle_select_move",
        ]);
        autoAdvanceMessage(deltaMs);
        return;
      }

      input.clearActions("menu");

      if (state.battle.phase === "command") {
        if (input.consumeAction("battle_open_move_menu")) {
          input.clearActions();
          audio.playSe("confirm");
          openMoveMenu();
          return;
        }

        if (input.consumeAction("battle_throw_ball")) {
          input.clearActions();
          audio.playSe("confirm");
          throwBall();
          return;
        }

        if (input.consumeAction("battle_attempt_run")) {
          input.clearActions();
          audio.playSe("confirm");
          attemptRun();
          return;
        }

        if (input.consumeAction("battle_use_item")) {
          input.clearActions();
          audio.playSe("confirm");
          useFullHeal();
          return;
        }
      }

      if (state.battle.phase === "moveSelect") {
        const moveCommand = input.consumeCommand("battle_select_move");
        if (moveCommand && moveCommand.payload) {
          input.clearActions();
          audio.playSe("confirm");
          selectMove(moveCommand.payload.moveId);
          return;
        }
      }

      if (input.consumeAction("cancel") && state.battle.phase === "moveSelect") {
        input.clearActions();
        audio.playSe("cancel");
        backToCommand();
      }
    }

    return {
      beginEncounterTransition,
      advanceMessage,
      openMoveMenu,
      backToCommand,
      selectMove,
      throwBall,
      attemptRun,
      update,
    };
  }

  App.scenes.createBattleScene = createBattleScene;
})();
