const fs = require('fs');
const window = { MonsterPrototype: { config: { game: {} }, data: {}, core: {}, runtime: {} } };
const files = [
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

const random = window.MonsterPrototype.core.createRandomController({});
const registry = window.MonsterPrototype.core.createDataRegistry(random);
console.log('Errors:', registry.errors);
