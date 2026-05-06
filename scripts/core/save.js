// 2026年4月27日時点の開発者向け保守メモ:
// localStorage保存の境界を担当する。保存対象は「安定して復元できる進行状態」に限定し、戦闘中や遷移中は保存しない。
// schemaVersion / storageKey / buildStableStateの変更は既存セーブ互換性に直結するため、必ず保存再開テストを行う。
(() => {
  const App = window.MonsterPrototype;
  const DIRECTIONS = new Set(["up", "right", "down", "left"]);

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function getStorage() {
    try {
      const storage = window.localStorage;
      const probeKey = "__monster_prototype_storage_probe__";
      storage.setItem(probeKey, "1");
      storage.removeItem(probeKey);
      return storage;
    } catch (error) {
      return null;
    }
  }

  function asInteger(value, fallback) {
    return Number.isInteger(value) ? value : fallback;
  }

  function asNonNegativeInteger(value, fallback) {
    return Number.isInteger(value) && value >= 0 ? value : fallback;
  }

  function asPositiveInteger(value, fallback) {
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }

  function asDirection(value, fallback) {
    return DIRECTIONS.has(value) ? value : fallback;
  }

  function isPassableTile(mapDef, x, y) {
    if (
      !mapDef ||
      !Array.isArray(mapDef.rows) ||
      y < 0 ||
      y >= mapDef.rows.length ||
      x < 0 ||
      x >= mapDef.rows[0].length
    ) {
      return false;
    }

    const tileConfig = App.config.game.fieldTiles[mapDef.rows[y][x]];
    return Boolean(tileConfig && tileConfig.passable);
  }

  function buildStableProgress(progress) {
    const stable = {};
    Object.keys(progress || {}).forEach((key) => {
      const value = progress[key];
      if (key === "resolvedEventIds") {
        stable.resolvedEventIds = Array.isArray(value)
          ? Array.from(new Set(value.filter((entry) => typeof entry === "string")))
          : [];
        return;
      }

      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        stable[key] = value;
      }
    });

    if (!stable.resolvedEventIds) {
      stable.resolvedEventIds = [];
    }
    return stable;
  }

  function buildStableInventory(inventory) {
    return {
      fullHealCount: asNonNegativeInteger(inventory && inventory.fullHealCount, 0),
      masterBallCount: asNonNegativeInteger(inventory && inventory.masterBallCount, 0),
    };
  }

  function buildStableParty(party) {
    const monster = Array.isArray(party) ? party[0] : null;
    if (!monster || typeof monster.speciesId !== "string") {
      return [];
    }

    return [
      {
        speciesId: monster.speciesId,
        level: asPositiveInteger(monster.level, 1),
        currentHp: asNonNegativeInteger(monster.currentHp, 0),
        moveIds: Array.isArray(monster.moveIds)
          ? monster.moveIds.filter((moveId) => typeof moveId === "string")
          : [],
        currentPp: Array.isArray(monster.currentPp)
          ? monster.currentPp.map((pp) => asNonNegativeInteger(pp, 0))
          : [],
      },
    ];
  }

  function buildStableCollection(collection) {
    const capturedSpeciesIds = Array.isArray(collection && collection.capturedSpeciesIds)
      ? collection.capturedSpeciesIds
      : [];

    return {
      capturedSpeciesIds: Array.from(
        new Set(capturedSpeciesIds.filter((speciesId) => typeof speciesId === "string"))
      ),
    };
  }

  function buildStableState(state) {
    // DOM表示、モーダル、戦闘途中アニメーションは保存しない。復元後は必ずフィールド状態から再開する設計。
    const field = state.field || {};
    const player = field.player || {};

    return {
      field: {
        mapId: field.mapId,
        player: {
          x: player.x,
          y: player.y,
          direction: player.direction,
        },
        steps: field.steps,
        lastEncounterStep: field.lastEncounterStep,
      },
      party: buildStableParty(state.party || []),
      inventory: buildStableInventory(state.inventory || {}),
      collection: buildStableCollection(state.collection || {}),
      timeAttack: {
        active: Boolean(state.timeAttack && state.timeAttack.active),
        elapsedMs: asNonNegativeInteger(state.timeAttack && state.timeAttack.elapsedMs, 0),
        finished: Boolean(state.timeAttack && state.timeAttack.finished),
      },
      progress: buildStableProgress(state.progress || {}),
    };
  }

  function restorePlayer(savedField, nextState, mapDef) {
    // 保存位置が地形変更で通行不可になった場合はspawnへ戻す。マップ編集時の破損セーブ対策。
    const savedPlayer = (savedField && savedField.player) || {};
    const fallbackPlayer = nextState.field.player;
    const spawn = mapDef && mapDef.spawn ? mapDef.spawn : fallbackPlayer;
    let x = asInteger(savedPlayer.x, fallbackPlayer.x);
    let y = asInteger(savedPlayer.y, fallbackPlayer.y);
    let direction = asDirection(savedPlayer.direction, fallbackPlayer.direction);

    if (!isPassableTile(mapDef, x, y)) {
      x = spawn.x;
      y = spawn.y;
      direction = asDirection(spawn.direction, direction);
    }

    nextState.field.player = {
      ...fallbackPlayer,
      x,
      y,
      fromX: x,
      fromY: y,
      toX: x,
      toY: y,
      direction,
      moving: false,
      progress: 0,
    };
  }

  function restoreInventory(savedInventory, nextState) {
    if (!isPlainObject(savedInventory)) {
      return;
    }

    Object.keys(nextState.inventory || {}).forEach((key) => {
      const savedValue = savedInventory[key];
      if (Number.isInteger(savedValue) && savedValue >= 0) {
        nextState.inventory[key] = savedValue;
      }
    });
  }

  function restoreParty(savedParty, nextState, dataRegistry) {
    if (!Array.isArray(savedParty) || savedParty.length === 0 || !dataRegistry) {
      return;
    }

    const savedMonster = savedParty[0];
    if (!isPlainObject(savedMonster) || typeof savedMonster.speciesId !== "string") {
      return;
    }

    if (!dataRegistry.getSpecies(savedMonster.speciesId)) {
      return;
    }

    const moveIds = Array.isArray(savedMonster.moveIds)
      ? savedMonster.moveIds.filter((moveId) => Boolean(dataRegistry.getMove(moveId)))
      : [];
    const level = asPositiveInteger(savedMonster.level, nextState.party[0].level);
    const monster = dataRegistry.createMonsterInstance(
      savedMonster.speciesId,
      level,
      moveIds.length > 0 ? moveIds : undefined
    );

    monster.currentHp = Math.min(
      monster.maxHp,
      asNonNegativeInteger(savedMonster.currentHp, monster.currentHp)
    );

    if (Array.isArray(savedMonster.currentPp) && savedMonster.currentPp.length === monster.moveIds.length) {
      monster.currentPp = savedMonster.currentPp.map((pp, index) => {
        const maxPp = dataRegistry.getMove(monster.moveIds[index]).pp;
        return Math.min(maxPp, asNonNegativeInteger(pp, maxPp));
      });
    }

    nextState.party = [monster];
  }

  function restoreCollection(savedCollection, nextState, dataRegistry) {
    if (!isPlainObject(savedCollection)) {
      return;
    }

    const capturedSpeciesIds = Array.isArray(savedCollection.capturedSpeciesIds)
      ? savedCollection.capturedSpeciesIds
      : [];
    nextState.collection.capturedSpeciesIds = Array.from(
      new Set(
        capturedSpeciesIds.filter((speciesId) => {
          return (
            typeof speciesId === "string" &&
            (!dataRegistry || Boolean(dataRegistry.getSpecies(speciesId)))
          );
        })
      )
    );
  }

  function restoreProgress(savedProgress, nextState) {
    if (!isPlainObject(savedProgress)) {
      return;
    }

    if (Array.isArray(savedProgress.resolvedEventIds)) {
      nextState.progress.resolvedEventIds = Array.from(
        new Set(savedProgress.resolvedEventIds.filter((eventId) => typeof eventId === "string"))
      );
    }

    Object.keys(nextState.progress || {}).forEach((key) => {
      if (key === "resolvedEventIds") {
        return;
      }

      const savedValue = savedProgress[key];
      if (
        typeof savedValue === "string" ||
        typeof savedValue === "number" ||
        typeof savedValue === "boolean"
      ) {
        nextState.progress[key] = savedValue;
      }
    });
  }

  function restoreStableState(initialState, savedState, dataRegistry) {
    // 復元は初期状態へ安全な差分だけを戻す。新しいprogress/inventoryキーは初期値が基準になる。
    const nextState = deepClone(initialState);
    if (!isPlainObject(savedState)) {
      return nextState;
    }

    const savedField = isPlainObject(savedState.field) ? savedState.field : {};
    const savedMapId =
      typeof savedField.mapId === "string" && dataRegistry && dataRegistry.getMap(savedField.mapId)
        ? savedField.mapId
        : nextState.field.mapId;
    const mapDef = dataRegistry ? dataRegistry.getMap(savedMapId) : null;

    nextState.scene = "field";
    nextState.battle = null;
    nextState.field.mapId = savedMapId;
    nextState.field.message = "";
    nextState.field.stepEffect = null;
    nextState.field.bumpEffect = null;
    nextState.field.blockedFeedbackCooldownMs = 0;
    nextState.field.steps = asNonNegativeInteger(savedField.steps, nextState.field.steps);
    nextState.field.lastEncounterStep = asInteger(
      savedField.lastEncounterStep,
      nextState.field.lastEncounterStep
    );
    restorePlayer(savedField, nextState, mapDef);
    restoreParty(savedState.party, nextState, dataRegistry);
    restoreInventory(savedState.inventory, nextState);
    restoreCollection(savedState.collection, nextState, dataRegistry);
    restoreProgress(savedState.progress, nextState);

    if (isPlainObject(savedState.timeAttack)) {
      nextState.timeAttack.active = Boolean(savedState.timeAttack.active);
      nextState.timeAttack.elapsedMs = asNonNegativeInteger(savedState.timeAttack.elapsedMs, 0);
      nextState.timeAttack.finished = Boolean(savedState.timeAttack.finished);
    }

    return nextState;
  }

  function canPersist(state) {
    // 戦闘・画面遷移中は中間状態が多く、復元不能になりやすいので保存禁止。
    return Boolean(
      state &&
        state.scene === "field" &&
        !state.battle &&
        !(state.transition && state.transition.active)
    );
  }

  function createSaveManager(config = {}, dataRegistry) {
    const storage = getStorage();
    const schemaVersion = config.schemaVersion || 1;
    const storageKey = config.storageKey || "monster_prototype_save_v1";
    let lastStableJson = "";

    function createPayload(state) {
      return {
        schemaVersion,
        savedAt: new Date().toISOString(),
        state: buildStableState(state),
      };
    }

    function persist(state) {
      if (!storage || !canPersist(state)) {
        return false;
      }

      const payload = createPayload(state);
      const stableJson = JSON.stringify(payload.state);
      try {
        storage.setItem(storageKey, JSON.stringify(payload));
        lastStableJson = stableJson;
        return true;
      } catch (error) {
        return false;
      }
    }

    function persistIfChanged(state) {
      if (!storage || !canPersist(state)) {
        return false;
      }

      const stableState = buildStableState(state);
      const stableJson = JSON.stringify(stableState);
      if (stableJson === lastStableJson) {
        return false;
      }

      try {
        storage.setItem(
          storageKey,
          JSON.stringify({
            schemaVersion,
            savedAt: new Date().toISOString(),
            state: stableState,
          })
        );
        lastStableJson = stableJson;
        return true;
      } catch (error) {
        return false;
      }
    }

    function readPayload() {
      if (!storage) {
        return null;
      }

      try {
        const rawPayload = storage.getItem(storageKey);
        if (!rawPayload) {
          return null;
        }

        const payload = JSON.parse(rawPayload);
        if (
          !isPlainObject(payload) ||
          payload.schemaVersion !== schemaVersion ||
          !isPlainObject(payload.state)
        ) {
          return null;
        }

        return payload;
      } catch (error) {
        return null;
      }
    }

    function load(initialState) {
      const payload = readPayload();
      if (!payload) {
        return deepClone(initialState);
      }

      const restoredState = restoreStableState(initialState, payload.state, dataRegistry);
      lastStableJson = JSON.stringify(buildStableState(restoredState));
      return restoredState;
    }

    function hasSavedState() {
      return Boolean(readPayload());
    }

    function getSavedInfo() {
      const payload = readPayload();
      if (!payload) {
        return null;
      }

      return {
        savedAt: typeof payload.savedAt === "string" ? payload.savedAt : "",
      };
    }

    function clear(currentState) {
      if (!storage) {
        return false;
      }

      try {
        storage.removeItem(storageKey);
        lastStableJson = currentState ? JSON.stringify(buildStableState(currentState)) : "";
        return true;
      } catch (error) {
        return false;
      }
    }

    return {
      clear,
      load,
      persist,
      persistIfChanged,
      hasSavedState,
      getSavedInfo,
      canPersist,
      isAvailable: Boolean(storage),
      storageKey,
    };
  }

  App.core.createSaveManager = createSaveManager;
})();
