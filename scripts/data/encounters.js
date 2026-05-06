// 2026年4月27日時点の開発者向け保守メモ:
// 草むら遭遇テーブル。map.encounterTableIdから参照され、field-scene.jsが歩数クールダウン後にrateで判定する。
// rateやweight変更はゲーム難度とsmoke testの遭遇確認に影響する。
(() => {
  const App = window.MonsterPrototype;

  App.data.encounters = [
    {
      id: "prototype_meadow",
      label: "ながめのみちの草むら",
      rate: 0.16,
      // weightは合計値に対する相対比。slotsの順番は同一weight時の選ばれ方やテスト調整にも影響する。
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
