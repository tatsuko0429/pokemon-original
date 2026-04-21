(() => {
  const App = window.MonsterPrototype;

  App.data.moves = [
    {
      id: "body_tap",
      name: "たいあたり",
      type: "ノーマル",
      power: 35,
      accuracy: 95,
      pp: 35,
      effect: "damage",
    },
    {
      id: "leaf_touch",
      name: "はっぱタッチ",
      type: "くさ",
      power: 40,
      accuracy: 100,
      pp: 25,
      effect: "damage",
    },
    {
      id: "ember_peck",
      name: "ひだねつつき",
      type: "ほのお",
      power: 40,
      accuracy: 100,
      pp: 25,
      effect: "damage",
    },
    {
      id: "splash_drop",
      name: "しずくうち",
      type: "みず",
      power: 40,
      accuracy: 100,
      pp: 25,
      effect: "damage",
    },
  ];
})();
