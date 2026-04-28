(() => {
  const App = window.MonsterPrototype;

  function createMapById(items, label, errors) {
    const result = new Map();

    (items || []).forEach((item, index) => {
      if (!item || !item.id) {
        errors.push(`${label} の ${index + 1} 件目に id がありません。`);
        return;
      }

      if (result.has(item.id)) {
        errors.push(`${label} ${item.id} が重複しています。`);
        return;
      }

      result.set(item.id, item);
    });

    return result;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function isPositiveNumber(value) {
    return isFiniteNumber(value) && value > 0;
  }

  function isNonEmptyText(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function validateStats(stats, speciesId, errors) {
    ["hp", "attack", "defense", "speed", "special"].forEach((key) => {
      if (!isPositiveNumber(stats && stats[key])) {
        errors.push(`種族 ${speciesId} の ${key} が不正です。`);
      }
    });
  }

  function validateCoordinates(entries, label, mapDef, occupied, errors) {
    (entries || []).forEach((entry) => {
      if (!Number.isInteger(entry.x) || !Number.isInteger(entry.y)) {
        errors.push(`${label} ${entry.id} の座標が不正です。`);
        return;
      }

      if (entry.y < 0 || entry.y >= mapDef.rows.length || entry.x < 0 || entry.x >= mapDef.rows[0].length) {
        errors.push(`${label} ${entry.id} の座標がマップ外です。`);
        return;
      }

      const key = `${entry.x},${entry.y}`;
      if (occupied.has(key)) {
        errors.push(`${label} ${entry.id} が別のイベントと重なっています。`);
        return;
      }

      occupied.add(key);
    });
  }

  function createDataRegistry(random) {
    const errors = [];
    const typeChart = App.config.game.typeChart || {};
    const validTypes = new Set(Object.keys(typeChart));
    const knownTiles = new Set(Object.keys(App.config.game.fieldTiles || {}));
    const knownEventKinds = new Set(["talk", "warp", "pickup", "battle", "champion_intro"]);
    const knownEventTriggers = new Set(["interact", "step"]);
    const knownSprites = new Set(
      Object.keys((App.data.pixelArt && App.data.pixelArt.field) || {}).filter(
        (key) => key !== "player"
      )
    );
    const knownBattleSprites = new Set(
      Object.keys((App.data.pixelArt && App.data.pixelArt.battle) || {})
    );
    const speciesById = createMapById(App.data.species, "種族", errors);
    const movesById = createMapById(App.data.moves, "技", errors);
    const encountersById = createMapById(App.data.encounters, "遭遇テーブル", errors);
    const questsById = createMapById(App.data.quests || [], "依頼", errors);
    const mapsById = createMapById(App.data.maps, "マップ", errors);

    movesById.forEach((move) => {
      if (!move.name) {
        errors.push(`技 ${move.id} に表示名がありません。`);
      }

      if (!validTypes.has(move.type)) {
        errors.push(`技 ${move.id} が未定義のタイプ ${move.type} を参照しています。`);
      }

      if (!isFiniteNumber(move.power) || move.power < 0) {
        errors.push(`技 ${move.id} の威力が不正です。`);
      }

      if (!isFiniteNumber(move.accuracy) || move.accuracy < 1 || move.accuracy > 100) {
        errors.push(`技 ${move.id} の命中率が不正です。`);
      }

      if (!isPositiveNumber(move.pp)) {
        errors.push(`技 ${move.id} の PP が不正です。`);
      }
    });

    speciesById.forEach((species) => {
      if (!species.name) {
        errors.push(`種族 ${species.id} に表示名がありません。`);
      }

      if (!Array.isArray(species.types) || species.types.length === 0) {
        errors.push(`種族 ${species.id} にタイプがありません。`);
      } else {
        species.types.forEach((type) => {
          if (!validTypes.has(type)) {
            errors.push(`種族 ${species.id} が未定義のタイプ ${type} を参照しています。`);
          }
        });
      }

      validateStats(species.stats, species.id, errors);

      if (!isFiniteNumber(species.catchRate) || species.catchRate < 1 || species.catchRate > 255) {
        errors.push(`種族 ${species.id} の捕獲率が不正です。`);
      }

      if (!species.palette || !species.palette.primary || !species.palette.secondary) {
        errors.push(`種族 ${species.id} に戦闘表示用の色設定が不足しています。`);
      }

      const spriteIds = species.spriteIds || {};
      const imageSprites = species.imageSprites || {};
      const hasBattleSprites = Boolean(spriteIds.battleFront && spriteIds.battleBack);
      const hasBattleImages = Boolean(imageSprites.battleFront && imageSprites.battleBack);
      if (!species.shape && !hasBattleSprites && !hasBattleImages) {
        errors.push(`種族 ${species.id} に戦闘表示用の形状またはスプライト指定がありません。`);
      }

      if (species.spriteIds) {
        ["battleFront", "battleBack"].forEach((key) => {
          if (spriteIds[key] && !knownBattleSprites.has(spriteIds[key])) {
            errors.push(`種族 ${species.id} が未知の戦闘表示 ${spriteIds[key]} を参照しています。`);
          }
        });
      }

      if (!species.defaultMoveIds || species.defaultMoveIds.length === 0) {
        errors.push(`種族 ${species.id} に技がありません。`);
      }

      (species.defaultMoveIds || []).forEach((moveId) => {
        if (!movesById.has(moveId)) {
          errors.push(`種族 ${species.id} が未定義の技 ${moveId} を参照しています。`);
        }
      });
    });

    encountersById.forEach((table) => {
      if (!isFiniteNumber(table.rate) || table.rate < 0 || table.rate > 1) {
        errors.push(`遭遇テーブル ${table.id} の出現率が不正です。`);
      }

      if (!Array.isArray(table.slots) || table.slots.length === 0) {
        errors.push(`遭遇テーブル ${table.id} にスロットがありません。`);
        return;
      }

      table.slots.forEach((slot, index) => {
        if (!speciesById.has(slot.speciesId)) {
          errors.push(
            `遭遇テーブル ${table.id} が未定義の種族 ${slot.speciesId} を参照しています。`
          );
        }

        if (!Number.isInteger(slot.level) || slot.level <= 0) {
          errors.push(`遭遇テーブル ${table.id} の ${index + 1} 件目のレベルが不正です。`);
        }

        if (!isPositiveNumber(slot.weight)) {
          errors.push(`遭遇テーブル ${table.id} の ${index + 1} 件目の重みが不正です。`);
        }
      });
    });

    questsById.forEach((quest) => {
      if (!isNonEmptyText(quest.progressKey)) {
        errors.push(`依頼 ${quest.id} に progressKey がありません。`);
      }

      if (!isNonEmptyText(quest.initialState)) {
        errors.push(`依頼 ${quest.id} に initialState がありません。`);
      }

      if (!quest.objectives || !quest.objectives[quest.initialState]) {
        errors.push(`依頼 ${quest.id} に初期状態の目的文がありません。`);
      }

      if (!quest.messages || !isNonEmptyText(quest.messages.start)) {
        errors.push(`依頼 ${quest.id} に開始メッセージがありません。`);
      }

      if (quest.completionRequirement) {
        const requirement = quest.completionRequirement;
        if (requirement.kind !== "captured_count_at_least") {
          errors.push(`依頼 ${quest.id} の達成条件 ${requirement.kind} は未対応です。`);
        }
        if (!Number.isInteger(requirement.count) || requirement.count <= 0) {
          errors.push(`依頼 ${quest.id} の達成数が不正です。`);
        }
      }
    });

    mapsById.forEach((mapDef) => {
      if (!Array.isArray(mapDef.rows) || mapDef.rows.length === 0) {
        errors.push(`マップ ${mapDef.id} に地形データがありません。`);
        return;
      }

      const width = mapDef.rows[0].length;
      const occupied = new Set();
      const mapEvents = Array.isArray(mapDef.events) ? mapDef.events : [];

      mapDef.rows.forEach((row, rowIndex) => {
        if (typeof row !== "string" || row.length !== width) {
          errors.push(`マップ ${mapDef.id} の ${rowIndex + 1} 行目の幅が不正です。`);
          return;
        }

        row.split("").forEach((tileCode, columnIndex) => {
          if (!knownTiles.has(tileCode)) {
            errors.push(
              `マップ ${mapDef.id} の (${columnIndex}, ${rowIndex}) に未定義タイル ${tileCode} があります。`
            );
          }
        });
      });

      if (!encountersById.has(mapDef.encounterTableId)) {
        errors.push(
          `マップ ${mapDef.id} が未定義の遭遇テーブル ${mapDef.encounterTableId} を参照しています。`
        );
      }

      if (!mapDef.spawn) {
        errors.push(`マップ ${mapDef.id} に開始位置がありません。`);
      } else if (
        !Number.isInteger(mapDef.spawn.x) ||
        !Number.isInteger(mapDef.spawn.y) ||
        mapDef.spawn.y < 0 ||
        mapDef.spawn.y >= mapDef.rows.length ||
        mapDef.spawn.x < 0 ||
        mapDef.spawn.x >= width
      ) {
        errors.push(`マップ ${mapDef.id} の開始位置がマップ外です。`);
      } else {
        const spawnTile = mapDef.rows[mapDef.spawn.y][mapDef.spawn.x];
        const spawnConfig = App.config.game.fieldTiles[spawnTile];
        if (!spawnConfig || !spawnConfig.passable) {
          errors.push(`マップ ${mapDef.id} の開始位置が通行不可タイルです。`);
        }
      }

      validateCoordinates(mapEvents, "イベント", mapDef, occupied, errors);

      mapEvents.forEach((event) => {
        if (!knownEventKinds.has(event.kind)) {
          errors.push(`マップ ${mapDef.id} のイベント ${event.id} の種類が不正です。`);
        }

        if (!knownEventTriggers.has(event.trigger)) {
          errors.push(`マップ ${mapDef.id} のイベント ${event.id} の発火条件が不正です。`);
        }

        if (event.sprite && !knownSprites.has(event.sprite)) {
          errors.push(`マップ ${mapDef.id} のイベント ${event.id} が未知の表示 ${event.sprite} を参照しています。`);
        }

        if (event.questId && !questsById.has(event.questId)) {
          errors.push(`マップ ${mapDef.id} のイベント ${event.id} が未知の依頼 ${event.questId} を参照しています。`);
        }

        if (event.kind === "talk") {
          if (event.trigger !== "interact") {
            errors.push(`マップ ${mapDef.id} の会話イベント ${event.id} は interact である必要があります。`);
          }
          if (!isNonEmptyText(event.message) && !event.questId) {
            errors.push(`マップ ${mapDef.id} の会話イベント ${event.id} に本文がありません。`);
          }
          if (!event.sprite) {
            errors.push(`マップ ${mapDef.id} の会話イベント ${event.id} に表示指定がありません。`);
          }
        }

        if (event.kind === "pickup") {
          if (event.trigger !== "interact") {
            errors.push(`マップ ${mapDef.id} の取得イベント ${event.id} は interact である必要があります。`);
          }
          if (!isNonEmptyText(event.itemType)) {
            errors.push(`マップ ${mapDef.id} の取得イベント ${event.id} に itemType がありません。`);
          }
          if (!Number.isInteger(event.amount) || event.amount <= 0) {
            errors.push(`マップ ${mapDef.id} の取得イベント ${event.id} の数量が不正です。`);
          }
          if (!event.sprite) {
            errors.push(`マップ ${mapDef.id} の取得イベント ${event.id} に表示指定がありません。`);
          }
        }

        if (event.kind === "warp") {
          if (event.trigger !== "step") {
            errors.push(`マップ ${mapDef.id} のワープイベント ${event.id} は step である必要があります。`);
          }
          if (!mapsById.has(event.targetMapId)) {
            errors.push(`マップ ${mapDef.id} のワープイベント ${event.id} が未定義の移動先 ${event.targetMapId} を参照しています。`);
            return;
          }

          const targetMap = mapsById.get(event.targetMapId);
          if (
            !event.target ||
            !Number.isInteger(event.target.x) ||
            !Number.isInteger(event.target.y)
          ) {
            errors.push(`マップ ${mapDef.id} のワープイベント ${event.id} の移動先座標が不正です。`);
            return;
          }

          if (
            event.target.y < 0 ||
            event.target.y >= targetMap.rows.length ||
            event.target.x < 0 ||
            event.target.x >= targetMap.rows[0].length
          ) {
            errors.push(`マップ ${mapDef.id} のワープイベント ${event.id} の移動先がマップ外です。`);
            return;
          }

          const targetTile = targetMap.rows[event.target.y][event.target.x];
          const targetConfig = App.config.game.fieldTiles[targetTile];
          if (!targetConfig || !targetConfig.passable) {
            errors.push(`マップ ${mapDef.id} のワープイベント ${event.id} の移動先が通行不可です。`);
          }
        }
      });
    });

    function getSpecies(id) {
      return speciesById.get(id);
    }

    function getMove(id) {
      return movesById.get(id);
    }

    function getEncounterTable(id) {
      return encountersById.get(id);
    }

    function getMap(id) {
      return mapsById.get(id);
    }

    function getQuest(id) {
      return questsById.get(id);
    }

    function getQuests() {
      return Array.from(questsById.values());
    }

    function getPrimaryQuest() {
      return getQuests().find((quest) => quest.primary) || getQuests()[0] || null;
    }

    function getQuestState(state, questId) {
      const quest = getQuest(questId);
      if (!quest) {
        return "";
      }
      return (state.progress && state.progress[quest.progressKey]) || quest.initialState;
    }

    function isQuestRequirementMet(state, questId) {
      const quest = getQuest(questId);
      if (!quest || !quest.completionRequirement) {
        return false;
      }

      const requirement = quest.completionRequirement;
      if (requirement.kind === "captured_count_at_least") {
        return (
          ((state.collection && state.collection.capturedSpeciesIds) || []).length >=
          requirement.count
        );
      }

      return false;
    }

    function getQuestObjectiveText(state, questId) {
      const quest = getQuest(questId);
      if (!quest || !quest.objectives) {
        return "";
      }

      const objective = quest.objectives[getQuestState(state, questId)] || quest.objectives.default;
      if (!objective) {
        return "";
      }

      if (typeof objective === "string") {
        return objective;
      }

      return isQuestRequirementMet(state, questId)
        ? objective.ready || objective.default || ""
        : objective.default || "";
    }

    function getQuestInteractionMessage(state, questId, fallbackMessage) {
      const quest = getQuest(questId);
      if (!quest || !quest.messages) {
        return fallbackMessage || "";
      }

      const questState = getQuestState(state, questId);
      if (questState === "reported") {
        return quest.messages.complete || fallbackMessage || "";
      }

      if (isQuestRequirementMet(state, questId)) {
        return quest.messages.report || fallbackMessage || "";
      }

      return questState === "active"
        ? quest.messages.active || fallbackMessage || ""
        : quest.messages.start || fallbackMessage || "";
    }

    function calculateMaxHp(stats, level) {
      return Math.floor(((stats.hp * 2) * level) / 100) + level + 10;
    }

    function calculateOtherStat(baseValue, level) {
      return Math.floor(((baseValue * 2) * level) / 100) + 5;
    }

    function createMonsterInstance(speciesId, level, overrideMoveIds) {
      const species = getSpecies(speciesId);
      if (!species) {
        throw new Error(`未定義の種族 ${speciesId} が指定されました。`);
      }

      const moveIds =
        overrideMoveIds && overrideMoveIds.length > 0
          ? overrideMoveIds.slice()
          : species.defaultMoveIds.slice();
      const maxHp = calculateMaxHp(species.stats, level);

      return {
        id: `${speciesId}_${level}_${random.token(6, "monster_id")}`,
        speciesId,
        level,
        exp: 0,
        currentHp: maxHp,
        maxHp,
        attack: calculateOtherStat(species.stats.attack, level),
        defense: calculateOtherStat(species.stats.defense, level),
        speed: calculateOtherStat(species.stats.speed, level),
        special: calculateOtherStat(species.stats.special, level),
        moveIds,
        currentPp: moveIds.map((moveId) => getMove(moveId).pp),
      };
    }

    function chooseEncounter(tableId) {
      const table = getEncounterTable(tableId);
      const total = table.slots.reduce((sum, slot) => sum + slot.weight, 0);
      let cursor = random.range(0, total, "encounter_slot");

      for (const slot of table.slots) {
        cursor -= slot.weight;
        if (cursor <= 0) {
          return createMonsterInstance(slot.speciesId, slot.level);
        }
      }

      const fallback = table.slots[table.slots.length - 1];
      return createMonsterInstance(fallback.speciesId, fallback.level);
    }

    function getTypeMultiplier(attackType, defendTypes) {
      const chart = typeChart[attackType] || {};
      return defendTypes.reduce((product, defendType) => {
        return product * (chart[defendType] || 1);
      }, 1);
    }

    function computeDamage(attacker, defender, moveId, options) {
      const move = getMove(moveId);
      const settings = options || {};
      const attackerSpecies = getSpecies(attacker.speciesId);
      const defenderSpecies = getSpecies(defender.speciesId);
      const attackStat =
        move.type === "ほのお" || move.type === "みず" ? attacker.special : attacker.attack;
      const defenseStat =
        move.type === "ほのお" || move.type === "みず" ? defender.special : defender.defense;
      const stab = attackerSpecies.types.includes(move.type) ? 1.5 : 1;
      const typeMultiplier = getTypeMultiplier(move.type, defenderSpecies.types);
      const randomFactor = 217 + random.integer(0, 38, "damage_roll");
      const multiplier = settings.damageMultiplier || 1;
      
      const base =
        Math.floor(
          (((2 * attacker.level) / 5 + 2) * move.power * attackStat * multiplier) / Math.max(1, defenseStat)
        ) /
          50 +
        2;
      const damage = clamp(
        Math.floor(base * stab * typeMultiplier * (randomFactor / 255)),
        1,
        999
      );

      return {
        move,
        damage,
        typeMultiplier,
        isCritical: random.chance(0.0625, "critical_roll"),
      };
    }

    return {
      errors,
      getSpecies,
      getMove,
      getMap,
      getEncounterTable,
      getQuest,
      getQuests,
      getPrimaryQuest,
      getQuestState,
      isQuestRequirementMet,
      getQuestObjectiveText,
      getQuestInteractionMessage,
      createMonsterInstance,
      chooseEncounter,
      computeDamage,
    };
  }

  App.core.createDataRegistry = createDataRegistry;
})();
