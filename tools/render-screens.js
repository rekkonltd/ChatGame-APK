/* Рендер игровых экранов в PNG (для превью и проверки вёрстки).
   node tools/render-screens.js  →  docs/screens/*.png
   Требует @napi-rs/canvas (ставьте локально: npm i @napi-rs/canvas). */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let createCanvas;
try {
  ({ createCanvas } = require('@napi-rs/canvas'));
} catch (e) {
  try { ({ createCanvas } = require('/tmp/gridsnap/node_modules/@napi-rs/canvas')); }
  catch (e2) { console.error('Нужен @napi-rs/canvas: npm i @napi-rs/canvas'); process.exit(1); }
}

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'docs', 'screens');
fs.mkdirSync(outDir, { recursive: true });

const W = 390, H = 844;

function makeCtx() {
  const ctx = { console, Math, Set, Map, Uint8Array, Float32Array, Infinity, performance: { now: () => Date.now() } };
  ctx.globalThis = ctx;
  ctx.document = { createElement: () => createCanvas(4, 4) };
  ctx.window = ctx;
  ctx.__createCanvas = createCanvas;
  vm.createContext(ctx);
  for (const f of ['prototype/js/config.js', 'prototype/js/sim.js', 'prototype/js/art.js', 'prototype/js/ui.js', 'prototype/js/game.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  }
  ctx.Art.createCanvas = (w, h) => createCanvas(w, h);
  return ctx;
}

function shot(name, setup, seconds) {
  const env = makeCtx();
  const canvas = createCanvas(W, H);
  const g = new env.Game(canvas, {});
  g.viewSize = () => ({ w: W, h: H });
  g.layout = null;
  if (setup) setup(g, env);
  const dt = 1 / 30;
  for (let i = 0; i < (seconds || 0) * 30; i++) g.update(dt);
  g.draw();
  fs.writeFileSync(path.join(outDir, name + '.png'), canvas.toBuffer('image/png'));
  console.log('  →', name + '.png');
}

console.log('Рендер экранов:');

// 1. старт игры
shot('01-start', null, 1.2);

// 2. развитая база и бой
shot('02-battle', (g, env) => {
  g.sim.cheatResources(1200);
  const f = g.sim.buildings.find((b) => b.team === 'player' && b.type === 'factory');
  for (const t of ['rifleman', 'rifleman', 'hammer', 'groza']) g.sim.trainUnit('player', f.id, t);
  g.sim.grantTech('player', 'A1');
  const cc = g.sim.buildings.find((b) => b.team === 'player');
  for (const k of ['turret', 'radar']) g.sim.placeBuilding('player', k, cc.x + 130, cc.y - 120);
  for (let i = 0; i < 3; i++) g.sim.addUnit('player', 'hammer', cc.x + 90 + i * 30, cc.y - 60);
  for (let i = 0; i < 4; i++) g.sim.addUnit('enemy', 'rifleman', cc.x + 180 + i * 34, cc.y - 210);
  for (let i = 0; i < 2; i++) g.sim.addUnit('enemy', 'hammer', cc.x + 160 + i * 46, cc.y - 300);
  g.focusOn(cc.x + 120, cc.y - 170);
  g.cam.zoom = 1.15;
}, 6);

// 3. выделение и карточка юнита
shot('03-selection', (g) => {
  const cc = g.sim.buildings.find((b) => b.team === 'player');
  g.sim.cheatResources(600);
  const f = g.sim.buildings.find((b) => b.team === 'player' && b.type === 'factory');
  g.sim.trainUnit('player', f.id, 'hammer');
  g.focusOn(cc.x + 60, cc.y - 50);
  g.cam.zoom = 1.25;
  for (let i = 0; i < 12 * 30; i++) g.update(1 / 30);
  const tank = g.sim.units.find((u) => u.team === 'player' && u.type === 'hammer');
  if (tank) { g.selection = tank.id; g.selectedType = tank.type; }
}, 2);

// 4. техдерево
shot('04-tech', (g) => {
  g.techOpen = true;
  g.sim.grantTech('player', 'A1');
  g.sim.cheatResources(320);
  g.sim.research('player', 'A2');
  g.sim.teams.player.researched.add('E1');
  const cc = g.sim.buildings.find((b) => b.team === 'player');
  g.focusOn(cc.x, cc.y);
}, 3);

// 5. победа
shot('05-victory', (g) => {
  const cc = g.sim.buildings.find((b) => b.team === 'player');
  g.focusOn(cc.x, cc.y);
  for (let i = 0; i < 90; i++) g.update(1 / 30);
  g.sim.finish('win');
}, 1);

// 6. туман войны и разведка
shot('06-fog', (g) => {
  const cc = g.sim.buildings.find((b) => b.team === 'player');
  g.focusOn(cc.x + 320, cc.y - 320);
  g.cam.zoom = 0.8;
}, 2);

console.log('Готово:', outDir);
