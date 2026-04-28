const fs = require('fs');

global.window = {
  MonsterPrototype: {
    config: {
      game: {
        fieldTiles: {
          ".": { passable: true },
          "=": { passable: true },
          "g": { passable: true },
          "#": { passable: false },
          "~": { passable: false },
          "1": { passable: true },
          "2": { passable: true },
          "3": { passable: true },
          "4": { passable: true },
          "c": { passable: true },
        },
        typeChart: {
          "ノーマル": {}, "くさ": {}, "ほのお": {}, "みず": {}, "はがね": {}, "ドラゴン": {}
        }
      }
    },
    data: {},
    core: {},
    runtime: {}
  }
};

const files = [
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

const random = window.MonsterPrototype.core.createRandomController({});
const registry = window.MonsterPrototype.core.createDataRegistry(random);
console.log(JSON.stringify(registry.errors, null, 2));
