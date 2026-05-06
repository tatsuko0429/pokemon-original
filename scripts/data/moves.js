// 2026年4月27日時点の開発者向け保守メモ:
// 技データの定義。idはspecies.defaultMoveIds、battle-scene.jsの効果分岐、ui.jsの表示に参照される。
// effectを増やす場合はdata-registry.jsの検証、battle-scene.jsの処理、ui.jsの説明文をセットで更新する。
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
      id: "leaf_eat",
      name: "葉を食べる",
      type: "くさ",
      power: 0,
      accuracy: 100,
      pp: 10,
      effect: "random_heal",
      // 回復量は最大HP比率の乱数。randomの呼び出し順が戦闘結果の再現性に影響する。
      healRatioMin: 0.18,
      healRatioMax: 0.42,
    },
    {
      id: "horn_jab_maybe",
      name: "角で突く？",
      type: "ノーマル",
      power: 45,
      accuracy: 100,
      pp: 15,
      effect: "chance_big_damage",
      // 成功時だけ大ダメージを出す特殊技。minimumDamageRatioは低レベル戦の見せ場を保証する下限。
      triggerChance: 0.25,
      damageMultiplier: 3,
      minimumDamageRatio: 0.35,
      failText: "角で突かなかった・・・",
      successText: "角で突いてくれた！",
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
    {
      id: "gear_change",
      name: "ギアチェンジ",
      type: "はがね",
      power: 0,
      accuracy: 100,
      pp: 5,
      effect: "evasion_up",
    },
    {
      id: "wind_up",
      name: "ネジまき",
      type: "ノーマル",
      power: 90,
      accuracy: 100,
      pp: 10,
      effect: "charge_attack",
    },
    {
      id: "muscle_training",
      name: "きんとれ",
      type: "ノーマル",
      power: 0,
      accuracy: 100,
      pp: 5,
      effect: "damage_boost",
    },
    {
      id: "punch",
      name: "なぐる",
      type: "ノーマル",
      power: 40,
      accuracy: 100,
      pp: 20,
      effect: "damage",
    },
  ];
})();
