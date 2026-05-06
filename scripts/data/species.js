// 2026年4月27日時点の開発者向け保守メモ:
// モンスター種族データ。idは保存データ、遭遇テーブル、トレーナー戦、図鑑記録に永続的に使われる。
// 画像サイズやbattleOffsetはscreen-renderer.jsの戦闘配置と結合しているため、アセット差し替え時は戦闘画面を確認する。
(() => {
  const App = window.MonsterPrototype;

  App.data.species = [
    {
      id: "nejimakidori",
      name: "ネジマキドリ",
      types: ["ノーマル", "はがね"],
      stats: {
        hp: 20,
        attack: 14,
        defense: 12,
        speed: 13,
        special: 9,
      },
      catchRate: 150,
      defaultMoveIds: ["gear_change", "wind_up"],
      palette: {
        primary: "#858784",
        secondary: "#c9b68d",
      },
      imageSprites: {
        // PNGアセットはpixel-art定義より優先して描画される。パス変更時はfile://とHTTPサーバの両方で確認する。
        battleFront: "./assets/nejimakidori-front.png",
        battleBack: "./assets/nejimakidori-back.png",
      },
      imageSpriteSize: {
        battleFront: { height: 54 },
        battleBack: { height: 54 },
      },
    },
    {
      id: "aribou",
      name: "アリボウ",
      types: ["ノーマル"],
      stats: {
        hp: 25,
        attack: 16,
        defense: 10,
        speed: 12,
        special: 8,
      },
      catchRate: 160,
      defaultMoveIds: ["muscle_training", "punch"],
      palette: {
        primary: "#946a4d",
        secondary: "#d6c4b0",
      },
      imageSprites: {
        battleFront: "./assets/aribou-front.png",
        battleBack: "./assets/aribou-back.png",
      },
      imageSpriteSize: {
        battleFront: { height: 54 },
        battleBack: { height: 54 },
      },
    },
    {
      id: "dummy_flare",
      name: "ダンゴマル",
      types: ["くさ"],
      stats: {
        hp: 24,
        attack: 11,
        defense: 13,
        speed: 8,
        special: 10,
      },
      catchRate: 175,
      defaultMoveIds: ["leaf_eat", "horn_jab_maybe"],
      palette: {
        primary: "#7d8f62",
        secondary: "#d6d7cf",
      },
      imageSprites: {
        battleFront: "./assets/dangomaru-front.png",
        battleBack: "./assets/dangomaru-back.png",
      },
      imageSpriteSize: {
        battleFront: {
          width: 54,
        },
        battleBack: {
          width: 50,
        },
      },
      battleOffset: {
        // ダンゴマルは画像の余白・重心が他種族と異なるため、相手側だけ下げて地面との接地感を合わせている。
        enemy: { x: 0, y: 9 },
        player: { x: 0, y: 4 },
      },
      shape: "bud",
    },
    {
      id: "dummy_drop",
      name: "ダミモン雫",
      types: ["みず"],
      stats: {
        hp: 23,
        attack: 10,
        defense: 10,
        speed: 10,
        special: 12,
      },
      catchRate: 180,
      defaultMoveIds: ["body_tap", "splash_drop"],
      palette: {
        primary: "#5c8fa9",
        secondary: "#d5edf7",
      },
      imageSprites: {
        battleFront: "./assets/nejimakidori-front.png",
        battleBack: "./assets/nejimakidori-back.png",
      },
      imageSpriteSize: {
        battleFront: { width: 54, height: 54 },
        battleBack: { width: 54, height: 54 },
      },
      shape: "drop",
    },
    {
      id: "king",
      name: "キング",
      types: ["ノーマル", "はがね"],
      stats: {
        hp: 45,
        attack: 28,
        defense: 25,
        speed: 25,
        special: 30,
      },
      catchRate: 25,
      defaultMoveIds: ["gear_change", "wind_up", "punch"],
      palette: {
        primary: "#b36d6d",
        secondary: "#cfc3c3",
      },
      imageSprites: {
        battleFront: "./assets/nejimakidori-front.png",
        battleBack: "./assets/nejimakidori-back.png",
      },
      imageSpriteSize: {
        battleFront: { width: 54, height: 54 },
        battleBack: { width: 54, height: 54 },
      },
    }
  ];
})();
