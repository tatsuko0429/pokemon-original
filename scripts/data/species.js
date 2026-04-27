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
        battleFront: "./assets/nejimakidori-front.png",
        battleBack: "./assets/nejimakidori-back.png",
      },
      imageSpriteSize: {
        battleFront: { width: 54, height: 54 },
        battleBack: { width: 54, height: 54 },
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
        battleFront: { width: 48, height: 48 },
        battleBack: { width: 48, height: 48 },
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
          width: 48,
          height: 34,
        },
        battleBack: {
          width: 46,
          height: 36,
        },
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
