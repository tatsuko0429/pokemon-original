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
          level: 5,
          weight: 40,
        },
        {
          speciesId: "dummy_flare",
          level: 5,
          weight: 30,
        },
        {
          speciesId: "aribou",
          level: 5,
          weight: 30,
        },
      ],
    },
  ];
})();
