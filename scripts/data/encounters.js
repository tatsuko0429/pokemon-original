(() => {
  const App = window.MonsterPrototype;

  App.data.encounters = [
    {
      id: "prototype_meadow",
      label: "ながめのみちの草むら",
      rate: 0.16,
      slots: [
        {
          speciesId: "nejimakidori",
          level: 3,
          weight: 45,
        },
        {
          speciesId: "dummy_flare",
          level: 4,
          weight: 30,
        },
        {
          speciesId: "dummy_drop",
          level: 4,
          weight: 25,
        },
      ],
    },
  ];
})();
