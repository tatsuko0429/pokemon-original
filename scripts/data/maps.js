// 2026年4月27日時点の開発者向け保守メモ:
// マップ、イベント、四天王/チャンピオン導線の定義。rowsの文字はapp-config.jsのfieldTilesと対応する。
// event.id / resolvedEventId / unlockConditionはprogressや保存データに残るため、変更時は復元・再取得防止・ワープ解放を確認する。
(() => {
  const App = window.MonsterPrototype;

  const ELITE_1_LEVEL = 10;
  const ELITE_2_LEVEL = 20;
  const ELITE_3_LEVEL = 30;
  const ELITE_4_LEVEL = 40;
  const CHAMPION_LEVEL = 50;

  function createEliteChamber(id, name, tile, level, trainerName, intro, win, lose, clearedKey, nextMapId) {
    // 四天王部屋は同じ構造を生成する。出口解放はbattleイベントのresolvedEventIdとwarp.unlockConditionでつながる。
    return {
      id,
      name,
      encounterTableId: "prototype_meadow",
      spawn: { x: 18, y: 9, direction: "left" },
      rows: Array(18).fill("####################").map((row, i) => {
        if (i === 0 || i === 17) return row;
        if (i === 9) return tile.repeat(20);
        return "#" + tile.repeat(18) + "#";
      }),
      events: [
        {
          id: id + "_npc",
          kind: "battle",
          trigger: "interact",
          sprite: "npc",
          x: 10,
          y: 9,
          trainerName,
          monsterSpecies: "first_caught",
          // first_caughtはbattle-scene.jsで「図鑑の最初の1匹、なければ手持ち」を相手にする特別指定。
          level,
          introMessage: intro,
          winMessage: win,
          loseMessage: lose,
          resolvedEventId: clearedKey,
          rewardItem: "full_heal",
        },
        {
          id: id + "_exit",
          kind: "warp",
          trigger: "step",
          x: 0,
          y: 9,
          targetMapId: nextMapId,
          target: { x: 18, y: 9, direction: "left" },
          unlockCondition: clearedKey,
          // 勝利フラグが立つまで左出口をロックする。lockedMessageはfield-scene.jsの移動開始時に表示される。
          lockedMessage: "勝負に勝つまでは 先へは通せません。",
        },
        {
          id: id + "_back",
          kind: "warp",
          trigger: "step",
          x: 19,
          y: 9,
          targetMapId: id === "elite_chamber_1" ? "quiet_square" : "elite_chamber_" + (parseInt(id.slice(-1)) - 1),
          target: { x: 1, y: 9, direction: "right" },
        },
      ],
    };
  }

  const maps = [
    {
      id: "camera_route",
      name: "ながめのみち",
      encounterTableId: "prototype_meadow",
      bgmId: "first_grass",
      spawn: { x: 10, y: 10, direction: "right" },
      rows: [
        "############################",
        "#...........~~~~...........#",
        "#.ggggg.....~~~~.....gggg..#",
        "#.ggggg.....~~~~.....gggg..#",
        "#.....=======....~~~~......#",
        "#..........=...............#",
        "#...gggg...=....gggg.......#",
        "#...gggg...=....gggg.......#",
        "#..........=...............#",
        "#..~~~~....=====...........#",
        "====.......................#",
        "#..~~~~......gggg....gggg..#",
        "#............gggg....gggg..#",
        "#....=======...............#",
        "#............~~~~..........#",
        "#...gggg.....~~~~.....gggg.#",
        "#...gggg.....~~~~.....gggg.#",
        "#..........................#",
        "#......=====...............#",
        "#......=........gggg.......#",
        "#......=........gggg.......#",
        "#...........~~~~...........#",
        "#...........~~~~...........#",
        "############################",
      ],
      events: [
        {
          id: "route_warp_square",
          kind: "warp",
          trigger: "step",
          x: 0,
          y: 10,
          unlockCondition: "prep_complete",
          // 初期ルートの左出口は準備5分完了で解放される特別条件。field-scene.jsのisEventLockedで個別扱い。
          lockedMessage: "5分後に解放されます。",
          targetMapId: "quiet_square",
          target: { x: 18, y: 9, direction: "left" },
        },
        { id: "route_sign_square", kind: "talk", trigger: "interact", sprite: "sign", x: 2, y: 9, message: "特定のモンスターを倒すことで覚えられる特別な技があるみたいだよ" },
        { id: "route_sign_grass", kind: "talk", trigger: "interact", sprite: "sign", x: 8, y: 8, message: "特定のモンスターを持っていないと遭遇できない特別なモンスターもいるみたいだよ" },
        { id: "route_guide", kind: "talk", trigger: "interact", sprite: "npc", x: 17, y: 12, message: "レベルを上げるもよし、強いモンスターを探すもよし！" },
        { id: "route_ball_pickup", kind: "pickup", trigger: "interact", sprite: "pickup", x: 24, y: 17, itemType: "full_heal", amount: 1, message: "回復薬を みつけた！" },
      ],
    },
    {
      id: "quiet_square",
      name: "受付",
      encounterTableId: "prototype_meadow",
      spawn: { x: 18, y: 9, direction: "left" },
      rows: [
        "####################",
        "#...####.....~~~~..#",
        "#...#..#.....~~~~..#",
        "#...####...........#",
        "#..................#",
        "#.....####.........#",
        "#.....#..#..====...#",
        "#.....####..=..=...#",
        "#............=.....#",
        "=======.......=....=",
        "#............=.....#",
        "#..~~~~......=.....#",
        "#..~~~~..####......#",
        "#........#..#......#",
        "#........####......#",
        "#..................#",
        "#....====..........#",
        "####################",
      ],
      events: [
        { id: "square_warp_elite", kind: "warp", trigger: "step", x: 0, y: 9, targetMapId: "elite_chamber_1", target: { x: 18, y: 9, direction: "left" } },
        { id: "square_warp_route", kind: "warp", trigger: "step", x: 19, y: 9, targetMapId: "camera_route", target: { x: 1, y: 10, direction: "right" } },
        { id: "square_sign_cleared", kind: "talk", trigger: "interact", sprite: "sign", x: 9, y: 8, message: "一度このゲームをクリアすると、新しく出会えるモンスターが増えるらしいよ。" },
        { id: "square_sign_secret", kind: "talk", trigger: "interact", sprite: "sign", x: 5, y: 2, message: "この世界のどこかに、幻のモンスターが眠っているという噂がある。" },
        {
          id: "square_npc_elder",
          kind: "talk",
          trigger: "interact",
          sprite: "npc",
          x: 4,
          y: 10,
          questId: "first_observation",
          message: "おお、きみは 新しいモンスタートレーナーじゃな。\\nもしよければ、野生の相手を1体つかまえて\\n図鑑に記録を見せてくれないか？",
        },
      ],
    },
    createEliteChamber("elite_chamber_1", "四天王の部屋 1", "1", ELITE_1_LEVEL, "四天王 カンナ風", "四天王の 1人目だ。 相手に なってもらおう！", "やるな！ 次へ 進むがいい。\\n回復薬を さずけよう。", "修行が 足りないようだな。", "elite_1_cleared", "elite_chamber_2"),
    createEliteChamber("elite_chamber_2", "四天王の部屋 2", "2", ELITE_2_LEVEL, "四天王 シバ風", "四天王の 2人目だ。 ここを 通れるかな？", "なかなかの 腕前だ。\\nこれを持って いけ。", "まだまだ だな。", "elite_2_cleared", "elite_chamber_3"),
    createEliteChamber("elite_chamber_3", "四天王の部屋 3", "3", ELITE_3_LEVEL, "四天王 キクコ風", "四天王の 3人目だよ。 驚かせてあげよう。", "ふん、 面白い。\\nほうびに これをやろう。", "ひっこんで おいで。", "elite_3_cleared", "elite_chamber_4"),
    createEliteChamber("elite_chamber_4", "四天王の部屋 4", "4", ELITE_4_LEVEL, "四天王 ワタル風", "最後の 四天王だ！ 全力で いこう！", "素晴らしい バトルだった！\\n最後の 備えだ、受け取れ。", "ここを 通るには まだ 早い。", "elite_4_cleared", "champion_chamber"),
    {
      id: "champion_chamber",
      name: "チャンピオンの間",
      encounterTableId: "prototype_meadow",
      spawn: { x: 18, y: 9, direction: "left" },
      rows: Array(18).fill("####################").map((row, i) => {
        if (i === 0 || i === 17) return row;
        if (i === 9) return "c".repeat(20);
        return "#" + "c".repeat(18) + "#";
      }),
      events: [
        // チャンピオン部屋の自動歩行演出入口。screen-renderer.jsのchampion-intro描画とfield-scene.jsのcutscene処理に依存する。
        { id: "champion_intro_trigger", kind: "champion_intro", trigger: "step", x: 17, y: 9, resolvedEventId: "champion_intro_seen" },
        {
          id: "champion_npc",
          kind: "battle",
          trigger: "interact",
          sprite: "npc",
          x: 5,
          y: 9,
          trainerName: "チャンピオン",
          monsterSpecies: "king",
          level: CHAMPION_LEVEL,
          introMessage: "よくぞ ここまで たどりついた！ わたしの 全力で 相手をしよう！",
          winMessage: "みごとだ！ 君が 新しい チャンピオンだ！",
          loseMessage: "まだまだ だな。 出直してきなさい。",
          resolvedEventId: "game_cleared",
        },
        { id: "champion_back", kind: "warp", trigger: "step", x: 19, y: 9, targetMapId: "elite_chamber_4", target: { x: 1, y: 9, direction: "right" } },
      ],
    },
  ];

  App.data.maps = maps;
})();
