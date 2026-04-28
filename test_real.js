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
