// 2026年4月27日時点の開発者向け保守メモ:
// namespaceからdata-registryまでを実際の読み込み順に近い形で評価し、検証エラーをJSON表示する。
// script順を変えた場合やデータ定義を増やした場合の最初の切り分けに使う。
const fs = require('fs');

global.window = {};

// Evaluate files in order
const files = [
  'scripts/core/namespace.js',
  'scripts/config/app-config.js',
  'scripts/data/moves.js',
  'scripts/data/species.js',
  'scripts/data/encounters.js',
  'scripts/data/quests.js',
  'scripts/data/maps.js',
  'scripts/data/pixel-art.js',
  'scripts/core/random.js',
  'scripts/core/data-registry.js'
];

files.forEach(f => {
  const code = fs.readFileSync(f, 'utf8');
  eval(code);
});

const App = window.MonsterPrototype;
const random = App.core.createRandomController({});
const registry = App.core.createDataRegistry(random);

console.log(JSON.stringify(registry.errors, null, 2));
