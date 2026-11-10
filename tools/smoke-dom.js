/* ==========================================================================
   Дымовой тест страницы в настоящем DOM (jsdom) с реальным canvas.
   Ловит то, чего не видит тест логики: ошибки запуска, отрисовки и ввода.

   Запуск:
     npm i jsdom @napi-rs/canvas        # один раз
     node tools/smoke-dom.js

   Почему это важно: одна ошибка на старте (например, присваивание в
   canvas.clientWidth) полностью ломает игру и в браузере, и в APK.
   ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

function load(name, alt) {
  try { return require(name); } catch (e) {
    try { return require(alt); } catch (e2) { return null; }
  }
}

const jsdomMod = load('jsdom', '/tmp/gridsnap/node_modules/jsdom');
const canvasMod = load('@napi-rs/canvas', '/tmp/gridsnap/node_modules/@napi-rs/canvas');
if (!jsdomMod || !canvasMod) {
  console.error('Нужны jsdom и @napi-rs/canvas: npm i jsdom @napi-rs/canvas');
  process.exit(2);
}
const { JSDOM, VirtualConsole } = jsdomMod;
const { createCanvas } = canvasMod;

const root = path.join(__dirname, '..', 'prototype');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push('jsdomError: ' + (e.message || '') + ' ' + ((e.detail && e.detail.message) || '')));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
  runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://127.0.0.1:8080/', virtualConsole: vc
});
const { window } = dom;

window.HTMLCanvasElement.prototype.getContext = function (t) {
  if (t !== '2d') return null;
  if (!this.__ctx) this.__ctx = createCanvas(this.width || 390, this.height || 844).getContext('2d');
  return this.__ctx;
};
window.HTMLCanvasElement.prototype.getBoundingClientRect = () =>
  ({ left: 0, top: 0, right: 390, bottom: 844, width: 390, height: 844, x: 0, y: 0 });
window.devicePixelRatio = 1;
const origCreate = window.document.createElement.bind(window.document);
window.document.createElement = (t) =>
  (String(t).toLowerCase() === 'canvas' ? Object.assign(createCanvas(1, 1), { style: {} }) : origCreate(t));
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
let raf = [];
window.requestAnimationFrame = (cb) => { raf.push(cb); return 1; };
window.fetch = () => Promise.resolve({ ok: false, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) });

for (const s of ['js/config.js', 'js/sim.js', 'js/art.js', 'js/ui.js', 'js/game.js', 'js/main.js']) {
  try { window.eval(fs.readFileSync(path.join(root, s), 'utf8')); }
  catch (e) { errors.push('SCRIPT ' + s + ': ' + e.message); }
}

const canvas = window.document.getElementById('game');
const game = window.__game;
let frames = 0;
function frame(n = 1) {
  for (let i = 0; i < n; i++) {
    const cbs = raf; raf = [];
    for (const cb of cbs) {
      try { cb(1000 + frames * 16); frames++; }
      catch (e) { errors.push('RENDER: ' + e.message); return; }
    }
  }
}
function tap(x, y) {
  const mk = (t) => new window.PointerEvent(t, { clientX: x, clientY: y, bubbles: true, pointerId: 1 });
  canvas.dispatchEvent(mk('pointerdown'));
  canvas.dispatchEvent(mk('pointerup'));
  frame(2);
}

let fails = 0;
const ok = (name, cond, extra) => {
  if (!cond) fails++;
  console.log((cond ? '  ok   ' : '  FAIL ') + name + (extra !== undefined ? ' → ' + extra : ''));
};

console.log('\n[1] Запуск');
frame(10);
ok('скрипты выполнились без ошибок', errors.length === 0, errors[0]);
ok('игра создана', !!game);
ok('кадры рисуются', frames >= 10, frames);
ok('симуляция тикает', game && game.sim.time > 0);

if (game) {
  console.log('\n[2] Нижняя панель');
  tap(325, 665);
  ok('вкладка ТЕХ открывает техдерево', game.techOpen === true);
  tap(340, 62);
  ok('кнопка ЗАКРЫТЬ закрывает техдерево', game.techOpen === false);
  tap(195, 665);
  ok('переключение на БАЗУ', game.tab === 'base', game.tab);
  const turret = game.tileRects().find((r) => r.type === 'turret');
  const money0 = game.sim.teams.player.xenite;
  tap(turret.x + turret.w / 2, turret.y + turret.h / 2);
  ok('турель заказана', game.sim.teams.player.xenite < money0);

  console.log('\n[3] Ввод на карте');
  const harv = game.sim.units.find((u) => u.team === 'player' && u.type === 'harvester');
  const L = game.layout;
  const sx = (harv.x - game.cam.x) * game.cam.zoom + 390 / 2;
  const sy = (harv.y - game.cam.y) * game.cam.zoom + L.field.y + L.field.h / 2;
  tap(sx, sy);
  ok('тап по юниту выбирает его', game.selection === harv.id, game.selection);
  const wx = game.worldAt(sx, sy);
  ok('координаты тапа совпадают с юнитом',
    Math.hypot(wx.x - harv.x, wx.y - harv.y) < 30,
    Math.round(wx.x) + ',' + Math.round(wx.y) + ' vs ' + Math.round(harv.x) + ',' + Math.round(harv.y));

  console.log('\n[4] Устойчивость');
  for (const [x, y] of [[10, 10], [365, 25], [20, 300], [195, 560], [195, 820], [380, 840]]) tap(x, y);
  window.dispatchEvent(new window.Event('resize'));
  frame(5);
  game.sim.finish('win');
  frame(3);
  ok('после всех действий ошибок нет', errors.length === 0, errors[0]);
}

console.log('\n' + (fails === 0 && errors.length === 0 ? 'ДЫМОВОЙ ТЕСТ ПРОЙДЕН' : `ПРОВАЛЕНО: ${fails + errors.length}`));
if (errors.length) errors.slice(0, 5).forEach((e) => console.log('!!', e));
process.exit(fails === 0 && errors.length === 0 ? 0 : 1);
