const fs = require('fs');

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body><div class="app-shell"></div><canvas id="game-screen"></canvas><div id="screen-message"></div><div id="screen-caption"></div><div id="battle-overlay"></div><div id="screen-timer"></div><div id="status-strip"></div><div id="action-panel"></div><div id="modal-root"></div><h2 id="modal-title"></h2><div id="modal-body"></div><div id="modal-actions"></div><button id="modal-confirm"></button></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.performance = { now: () => 0 };
global.requestAnimationFrame = (cb) => { setTimeout(() => cb(0), 16); };

window.MonsterPrototype = { data: {}, core: {}, scenes: {}, runtime: {}, config: { game: { 
  audio: {}, save: {}, random: {}, ui: {}, battle: {}, animation: { field: {}, damage: {}, ball: {} }, field: {}, fieldTiles: {
    'g': { passable: true, color: 'green' },
    '.': { passable: true, color: 'gray' },
    '#': { passable: false, color: 'black' },
    '~': { passable: false, color: 'blue' },
    '=': { passable: true, color: 'brown' },
  }, typeChart: {}, screen: { width: 160, height: 144, tileSize: 16 }, palette: {} 
} } };

const files = [
  'scripts/config/app-config.js',
  'scripts/data/moves.js',
  'scripts/data/species.js',
  'scripts/data/encounters.js',
  'scripts/data/quests.js',
  'scripts/data/maps.js',
  'scripts/data/pixel-art.js',
  'scripts/core/random.js',
  'scripts/core/data-registry.js',
  'scripts/core/store.js',
  'scripts/core/save.js',
  'scripts/core/input.js',
  'scripts/core/audio.js',
  'scripts/core/modal.js',
  'scripts/core/screen-renderer.js',
  'scripts/core/ui.js',
  'scripts/scenes/battle-scene.js',
  'scripts/scenes/field-scene.js',
  'scripts/app.js'
];

files.forEach(f => {
  const code = fs.readFileSync(f, 'utf8');
  eval(code);
});

console.log('App loaded, dispatching load event');
window.dispatchEvent(new dom.window.Event('load'));
setTimeout(() => {
  console.log('Boot completed without fatal error');
}, 100);

