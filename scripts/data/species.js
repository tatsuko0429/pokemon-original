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
        battleFront: { width: 72, height: 72 },
        battleBack: { width: 72, height: 72 },
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
          width: 36,
          height: 26,
        },
        battleBack: {
          width: 35,
          height: 28,
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
      spriteIds: {
        battleFront: "dummy_drop_front",
        battleBack: "dummy_drop_back",
      },
      shape: "drop",
    },
  ];
})();
