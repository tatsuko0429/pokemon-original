(() => {
  const App = window.MonsterPrototype;

  App.data.species = [
    {
      id: "dummy_bud",
      name: "ダミモン芽",
      types: ["くさ"],
      stats: {
        hp: 22,
        attack: 11,
        defense: 10,
        speed: 9,
        special: 11,
      },
      catchRate: 190,
      defaultMoveIds: ["body_tap", "leaf_touch"],
      palette: {
        primary: "#7fa64d",
        secondary: "#d7ebb8",
      },
      spriteIds: {
        battleFront: "dummy_bud_front",
        battleBack: "dummy_bud_back",
      },
      shape: "bud",
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
          width: 72,
          height: 52,
        },
        battleBack: {
          width: 70,
          height: 56,
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
