// 2026年4月27日時点の開発者向け保守メモ:
// フィールド移動、会話/拾得/ワープ/遭遇イベントを担当するscene。
// マップ定義、地形通行可否、progress.resolvedEventIds、battleScene起動が強く結合している。
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

    function isEventLocked(state, event) {
      // unlockConditionはprep_completeだけ特別扱いし、それ以外はprogress上の真偽値を見る。
      // maps.jsで条件を増やす場合はここを拡張する。
      if (!event || !event.unlockCondition) {
        return false;
      }

      if (event.unlockCondition === "prep_complete") {
        return !(state.progress && state.progress.prepGateUnlocked);
      }

      return !state.progress[event.unlockCondition];
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
      // ワープ時は移動補間情報も移動先へ揃える。x/yだけ変えると次フレームで旧座標から補間される。
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
      // 拾得済みはprogress.resolvedEventIdsで管理する。保存復元・再取得防止・描画非表示がこのidに依存する。
      if (event.itemType === "full_heal") {
        state.inventory.fullHealCount += event.amount;
      } else if (event.itemType === "master_ball") {
        state.inventory.masterBallCount += event.amount;
      }
      rememberResolvedEvent(state, event.id);
      if (event.message) {
        state.field.message = event.message;
      } else {
        state.field.message = "アイテムを みつけた！";
      }
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
      // 正面にイベントがない場合は無音・無メッセージで戻る現在仕様。操作説明的な文言を出すと既存テストが変わる。
      if (!event) {
        return;
      }

      if (event.kind === "battle") {
        battleScene.beginTrainerBattle(event);
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
      // 移動開始では向きだけ先に更新する。通行不可でも向きが変わるので、会話対象の向き合わせに影響する。
      let soundId = "";
      store.update((state) => {
        const mapDef = currentMap(state);
        const vector = directionVectors[direction];
        const targetX = state.field.player.x + vector.x;
        const targetY = state.field.player.y + vector.y;
        state.field.player.direction = direction;

        const lockedGate = findEvent(state, mapDef, targetX, targetY, (event) => {
          return event.trigger === "step" && isEventLocked(state, event);
        });
        if (lockedGate) {
          state.field.message =
            lockedGate.lockedMessage ||
            (App.config.game.story && App.config.game.story.lockedGateMessage) ||
            "道が 閉ざされている。";
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
      // 1歩完了後にstepイベント、草むら効果、ランダム遭遇の順で判定する。順序変更はワープと遭遇の競合を生む。
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
        if (stepEvent.kind === "champion_intro") {
          return {
            kind: "champion_intro",
            event: stepEvent,
          };
        }
      }

      const tileCode = getTileCode(mapDef, state.field.player.x, state.field.player.y);
      if (tileCode === "g") {
        setGrassStepEffect(state);
      }

      const encountersLockedByProgress =
        mapDef.id === "camera_route" &&
        state.progress &&
        state.progress.prepGateUnlocked;
      // 準備ゲート解放後の初期ルートでは遭遇を止める仕様。次ステージへの移動時にランダム戦で足止めしないため。

      if (
        tileCode === "g" &&
        !encountersLockedByProgress &&
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
      // モーダルや遷移中は方向入力を捨てる。閉じた直後に押しっぱなし移動が漏れないようにするため。
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

      if (state.progress && state.progress.championCutsceneActive) {
        if (state.field.player.moving) {
          let pendingResult = null;
          const currentMoveDuration = moveDuration * 1.5; // walk slowly
          store.update((nextState) => {
            nextState.field.player.progress = Math.min(
              1,
              nextState.field.player.progress + deltaMs / currentMoveDuration
            );
            if (nextState.field.player.progress >= 1) {
              pendingResult = completeMove(nextState);
            }
          });
          if (pendingResult && pendingResult.kind === "step" && pendingResult.soundId) {
            audio.playSe(pendingResult.soundId);
          }
          return;
        } else {
          // not moving, start moving left if x > 6
          if (state.field.player.x > 6) {
            startMove("left");
          } else {
            // Reached champion
            store.update(nextState => {
              nextState.progress.championCutsceneActive = false;
            });
            const event = findEvent(state, currentMap(state), 5, 9, (e) => e.trigger === "interact");
            if (event) {
              handleInteractEvent(event);
            }
          }
          return;
        }
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
        if (pendingResult && pendingResult.kind === "champion_intro") {
          store.update((state) => {
            state.transition = {
              active: true,
              kind: "champion-intro",
              elapsedMs: 0,
              durationMs: 4000,
              event: pendingResult.event,
            };
            audio.playSe("encounter");
          });
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
