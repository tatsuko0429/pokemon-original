(() => {
  const App = window.MonsterPrototype;

  function createFieldScene({
    store,
    dataRegistry,
    battleScene,
    input,
    modal,
    audio,
    random,
    openMenu,
  }) {
    const directionVectors = {
      up: { x: 0, y: -1 },
      right: { x: 1, y: 0 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
    };

    const tileConfig = App.config.game.fieldTiles;
    const moveDuration = App.config.game.timing.moveDurationMs;
    const runMoveDuration = App.config.game.timing.runMoveDurationMs || moveDuration * 0.62;
    const fieldAnimation = App.config.game.animation.field || {};
    const blockedFeedbackCooldownMs =
      App.config.game.timing.blockedFeedbackCooldownMs || 420;

    function currentMap(state) {
      return dataRegistry.getMap(state.field.mapId);
    }

    function getTileCode(mapDef, x, y) {
      if (y < 0 || y >= mapDef.rows.length || x < 0 || x >= mapDef.rows[0].length) {
        return "#";
      }
      return mapDef.rows[y][x];
    }

    function isEventResolved(state, eventId) {
      return (state.progress.resolvedEventIds || []).includes(eventId);
    }

    function getActiveEvents(state, mapDef) {
      return (mapDef.events || []).filter((event) => !isEventResolved(state, event.id));
    }

    function findEvent(state, mapDef, x, y, predicate) {
      return getActiveEvents(state, mapDef).find((event) => {
        return event.x === x && event.y === y && (!predicate || predicate(event));
      });
    }

    function isPreparationGateLocked(state, event) {
      return Boolean(
        event &&
          event.kind === "warp" &&
          event.unlockCondition === "prep_complete" &&
          !(state.progress && state.progress.prepGateUnlocked)
      );
    }

    function isBlockingEvent(event) {
      return event.trigger === "interact";
    }

    function isPassable(state, mapDef, x, y) {
      const tile = tileConfig[getTileCode(mapDef, x, y)];
      if (!tile || !tile.passable) {
        return false;
      }

      return !findEvent(state, mapDef, x, y, isBlockingEvent);
    }

    function rememberResolvedEvent(state, eventId) {
      if (!state.progress.resolvedEventIds.includes(eventId)) {
        state.progress.resolvedEventIds.push(eventId);
      }
    }

    function applyWarp(state, event) {
      state.field.mapId = event.targetMapId;
      state.field.player.x = event.target.x;
      state.field.player.y = event.target.y;
      state.field.player.fromX = event.target.x;
      state.field.player.fromY = event.target.y;
      state.field.player.toX = event.target.x;
      state.field.player.toY = event.target.y;
      state.field.player.direction = event.target.direction || state.field.player.direction;
      state.field.player.moving = false;
      state.field.player.progress = 0;
      state.field.message = "";
      state.field.lastEncounterStep = state.field.steps;
    }

    function applyPickup(state, event) {
      if (event.itemType === "balls") {
        state.inventory.balls += event.amount;
      }
      rememberResolvedEvent(state, event.id);
      state.field.message =
        event.message || `モンスターボールを ${event.amount} 個 みつけた！`;
    }

    function applyQuestEvent(state, event) {
      const quest = dataRegistry.getQuest(event.questId);
      if (!quest) {
        state.field.message = event.message;
        return;
      }

      const questState = dataRegistry.getQuestState(state, event.questId);
      const message = dataRegistry.getQuestInteractionMessage(
        state,
        event.questId,
        event.message
      );

      if (questState !== "reported") {
        state.progress[quest.progressKey] = dataRegistry.isQuestRequirementMet(state, event.questId)
          ? "reported"
          : "active";
      }

      state.field.message = message;
    }

    function updateEffect(effect, deltaMs) {
      if (!effect) {
        return null;
      }

      effect.elapsedMs += deltaMs;
      return effect.elapsedMs >= effect.durationMs ? null : effect;
    }

    function updateFieldFeedback(state, deltaMs) {
      state.field.stepEffect = updateEffect(state.field.stepEffect, deltaMs);
      state.field.bumpEffect = updateEffect(state.field.bumpEffect, deltaMs);
      state.field.blockedFeedbackCooldownMs = Math.max(
        0,
        (state.field.blockedFeedbackCooldownMs || 0) - deltaMs
      );
    }

    function setGrassStepEffect(state) {
      state.field.stepEffect = {
        kind: "grass",
        x: state.field.player.x,
        y: state.field.player.y,
        elapsedMs: 0,
        durationMs: fieldAnimation.grassStepDurationMs || 220,
      };
    }

    function setBumpEffect(state, direction) {
      state.field.bumpEffect = {
        kind: "bump",
        direction,
        elapsedMs: 0,
        durationMs: fieldAnimation.bumpDurationMs || 160,
      };
      state.field.blockedFeedbackCooldownMs = blockedFeedbackCooldownMs;
    }

    function handleInteractEvent(event) {
      if (!event) {
        store.update((nextState) => {
          nextState.field.message = "いまは ここで反応するものがありません。";
        });
        audio.playSe("error");
        return;
      }

      store.update((state) => {
        if (event.kind === "talk") {
          if (event.questId) {
            applyQuestEvent(state, event);
            return;
          }

          state.field.message = event.message;
          return;
        }

        if (event.kind === "pickup") {
          applyPickup(state, event);
        }
      });
      audio.playSe("confirm");
    }

    function closeMessage() {
      store.update((state) => {
        state.field.message = "";
      });
      audio.playSe("cancel");
    }

    function startMove(direction) {
      let soundId = "";
      store.update((state) => {
        const mapDef = currentMap(state);
        const vector = directionVectors[direction];
        const targetX = state.field.player.x + vector.x;
        const targetY = state.field.player.y + vector.y;
        state.field.player.direction = direction;

        const lockedGate = findEvent(state, mapDef, targetX, targetY, (event) => {
          return event.trigger === "step" && isPreparationGateLocked(state, event);
        });
        if (lockedGate) {
          state.field.message =
            lockedGate.lockedMessage ||
            (App.config.game.story && App.config.game.story.lockedGateMessage) ||
            "5分後に解放されます。";
          if (!state.field.blockedFeedbackCooldownMs) {
            setBumpEffect(state, direction);
            soundId = "error";
          }
          return;
        }

        if (!isPassable(state, mapDef, targetX, targetY)) {
          if (!state.field.blockedFeedbackCooldownMs) {
            setBumpEffect(state, direction);
            soundId = "bump";
          }
          return;
        }

        state.field.player.moving = true;
        state.field.player.progress = 0;
        state.field.player.fromX = state.field.player.x;
        state.field.player.fromY = state.field.player.y;
        state.field.player.toX = targetX;
        state.field.player.toY = targetY;
      });
      if (soundId) {
        audio.playSe(soundId);
      }
    }

    function completeMove(state) {
      state.field.player.x = state.field.player.toX;
      state.field.player.y = state.field.player.toY;
      state.field.player.moving = false;
      state.field.player.progress = 0;
      state.field.steps += 1;

      const mapDef = currentMap(state);
      const stepEvent = findEvent(state, mapDef, state.field.player.x, state.field.player.y, (event) => {
        return event.trigger === "step";
      });
      if (stepEvent) {
        if (stepEvent.kind === "warp") {
          applyWarp(state, stepEvent);
          return {
            kind: "warp",
          };
        }
      }

      const tileCode = getTileCode(mapDef, state.field.player.x, state.field.player.y);
      if (tileCode === "g") {
        setGrassStepEffect(state);
      }

      if (
        tileCode === "g" &&
        state.field.steps - state.field.lastEncounterStep >
          App.config.game.timing.encounterCooldownSteps
      ) {
        const tableId = mapDef.encounterTableId;
        const encounterTable = dataRegistry.getEncounterTable(tableId);
        if (random.chance(encounterTable.rate, "field_encounter_check")) {
          return {
            kind: "encounter",
            enemy: dataRegistry.chooseEncounter(tableId),
          };
        }
      }

      return {
        kind: "step",
        soundId: tileCode === "g" ? "grass_step" : "step",
      };
    }

    function interact() {
      const state = store.getState();
      if (state.scene !== "field") {
        return;
      }

      if (state.field.message) {
        closeMessage();
        return;
      }

      const mapDef = currentMap(state);
      const vector = directionVectors[state.field.player.direction];
      const targetX = state.field.player.x + vector.x;
      const targetY = state.field.player.y + vector.y;
      const event = findEvent(state, mapDef, targetX, targetY, (entry) => {
        return entry.trigger === "interact";
      });
      handleInteractEvent(event);
    }

    function update(deltaMs) {
      let state = store.getState();
      if (state.scene !== "field") {
        return;
      }

      store.update((nextState) => {
        updateFieldFeedback(nextState, deltaMs);
      });

      state = store.getState();
      if (modal.isOpen() || state.transition.active) {
        input.clearDirections();
        return;
      }

      if (input.consumeAction("menu")) {
        openMenu();
        return;
      }

      if (state.field.message) {
        input.clearDirections();
        if (input.consumeAction("confirm") || input.consumeAction("cancel")) {
          closeMessage();
        }
        return;
      }

      if (input.consumeAction("confirm")) {
        interact();
        return;
      }

      if (state.field.player.moving) {
        let pendingResult = null;
        const currentMoveDuration = input.isHoldActive("run") ? runMoveDuration : moveDuration;
        store.update((nextState) => {
          nextState.field.player.progress = Math.min(
            1,
            nextState.field.player.progress + deltaMs / currentMoveDuration
          );
          if (nextState.field.player.progress >= 1) {
            pendingResult = completeMove(nextState);
          }
        });
        if (pendingResult && pendingResult.kind === "warp") {
          audio.playSe("confirm");
        }
        if (pendingResult && pendingResult.kind === "step" && pendingResult.soundId) {
          audio.playSe(pendingResult.soundId);
        }
        if (pendingResult && pendingResult.kind === "encounter") {
          battleScene.beginEncounterTransition(pendingResult.enemy);
        }
        return;
      }

      const direction = input.getDirection();
      if (direction) {
        startMove(direction);
      }
    }

    return {
      update,
      interact,
      closeMessage,
    };
  }

  App.scenes.createFieldScene = createFieldScene;
})();
