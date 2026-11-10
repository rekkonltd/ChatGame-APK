/* Smoke-тест симуляции: node test/sim.test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', '..');
const ctx = { console, Math, Set, Map, Uint8Array, Float32Array, Infinity };
ctx.globalThis = ctx;
vm.createContext(ctx);

for (const f of ['prototype/js/config.js', 'prototype/js/sim.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
}

const Sim = ctx.Sim;
let failures = 0;
const check = (name, cond, extra) => {
  if (cond) { console.log('  ok   ' + name); }
  else { failures++; console.log('  FAIL ' + name + (extra !== undefined ? ' → ' + extra : '')); }
};
const step = (sim, seconds) => {
  const dt = 1 / 20;
  for (let i = 0; i < seconds * 20; i++) sim.update(dt);
};

console.log('\n[1] Старт');
const sim = new Sim();
check('карта 40x40 распознана', ctx.THANDOR_UTIL.W === 40 && ctx.THANDOR_UTIL.H === 40);
check('юниты игрока на старте', sim.units.filter((u) => u.team === 'player').length === 3,
  sim.units.filter((u) => u.team === 'player').length);
check('здания игрока на старте', sim.buildings.filter((b) => b.team === 'player').length === 2);
check('турели врага', sim.buildings.filter((b) => b.team === 'enemy' && b.type === 'turret').length === 2);
check('стартовый ксенит', sim.teams.player.xenite === 350, sim.teams.player.xenite);
check('есть видимые тайлы', sim.visible.reduce((a, b) => a + b, 0) > 0);

console.log('\n[2] Экономика за 30 секунд');
const before = sim.teams.player.xenite;
step(sim, 30);
const after = sim.teams.player.xenite;
check('сборщики приносят ксенит', after > before, `${before} → ${after}`);
check('ксенит не бесконечен', after - before < 600, `${after - before} за 30 с`);

console.log('\n[3] Производство');
const factory = sim.buildings.find((b) => b.team === 'player' && b.type === 'factory');
sim.cheatResources(400);
const r1 = sim.trainUnit('player', factory.id, 'rifleman');
check('заказ пехоты принят', r1.ok === true, JSON.stringify(r1));
check('очередь заполнена', factory.queue.length === 1);
step(sim, 6);
check('пехота появилась', sim.units.filter((u) => u.team === 'player' && u.type === 'rifleman').length >= 2,
  sim.units.filter((u) => u.team === 'player' && u.type === 'rifleman').length);

console.log('\n[4] Технологии');
sim.cheatResources(1000);
const locked = sim.trainUnit('player', factory.id, 'groza');
check('Гроза закрыта без технологии', locked.ok === false && locked.reason === 'locked', JSON.stringify(locked));
const badTech = sim.research('player', 'A2');
check('Плазма I требует A1', badTech.ok === false && badTech.reason === 'requires', JSON.stringify(badTech));
const t1 = sim.research('player', 'A1');
check('A1 исследуется', t1.ok === true, JSON.stringify(t1));
step(sim, 16);
check('A1 в списке изученных', sim.hasTech('player', 'A1'));
const afterTech = sim.trainUnit('player', factory.id, 'groza');
check('Гроза открылась после A1', afterTech.ok === true, JSON.stringify(afterTech));

console.log('\n[5] Бой');
const enemyCC = sim.buildings.find((b) => b.team === 'enemy' && b.type === 'commandCenter');
const army = sim.units.filter((u) => u.team === 'player' && u.def.role !== 'worker');
const startPos = army.map((u) => ({ x: u.x, y: u.y }));
sim.issueOrder('player', army.map((u) => u.id), enemyCC.x, enemyCC.y, 'attack');
step(sim, 8);
const moved = army.filter((u) => u.alive).some((u, i) => {
  const p = startPos[i] || startPos[0];
  return ctx.THANDOR_UTIL.dist(u.x, u.y, p.x, p.y) > 120;
});
check('армия выдвинулась по приказу', moved);
check('у отряда есть маршрут', army.some((u) => u.path && u.path.length > 3));
check('симуляция не падает и идёт', sim.time > 55, sim.time.toFixed(1));

console.log('\n[6] Туман войны');
check('дальняя зона не видна', sim.isVisible(33 * 48, 4 * 48) === false);
check('своя база видна', sim.isVisible(5 * 48, 34 * 48) === true);

console.log('\n[7] Победа и поражение');
const sim2 = new Sim();
const ecc = sim2.buildings.find((b) => b.team === 'enemy' && b.type === 'commandCenter');
sim2.damage(ecc, 99999, 'player');
check('уничтожение центра врага = победа', sim2.result === 'win', sim2.result);
const sim3 = new Sim();
const pcc = sim3.buildings.find((b) => b.team === 'player' && b.type === 'commandCenter');
sim3.damage(pcc, 99999, 'enemy');
check('потеря своего центра = поражение', sim3.result === 'lose', sim3.result);

console.log('\n[8] ИИ за 120 секунд');
const sim4 = new Sim();
step(sim4, 120);
const enemyArmy = sim4.units.filter((u) => u.team === 'enemy' && u.def.role !== 'worker').length;
check('ИИ накопил армию', enemyArmy > 0, enemyArmy + ' юнитов');
check('ИИ отработал волну', sim4.ai.waveIndex >= 1, sim4.ai.waveIndex);
check('бой идёт без ошибок', sim4.result !== undefined);

console.log('\n[9] Пути и препятствия');
const sim5 = new Sim();
const tank5 = sim5.addUnit('player', 'hammer', 5 * 48 + 24, 35 * 48 + 24);
const p5 = sim5.findPath(tank5.x, tank5.y, 33 * 48, 4 * 48, false);
check('путь от своей базы до базы врага', Array.isArray(p5) && p5.length > 20, p5 ? p5.length : p5);

const blocked = sim5.findPath(tank5.x, tank5.y, 8 * 48 + 24, 12 * 48 + 24, false);
check('путь в озеро обходится или не строится', blocked === null || blocked.length > 0);

const hover = sim5.addUnit('player', 'osa', 5 * 48 + 24, 35 * 48 + 24);
const ph = sim5.findPath(hover.x, hover.y, 8 * 48 + 24, 13 * 48 + 24, true);
check('глиссер проходит над водой', Array.isArray(ph) && ph.length > 0, ph ? ph.length : ph);

console.log('\n[10] Можно ли выиграть');
const sim6 = new Sim();
const e6 = sim6.buildings.find((b) => b.team === 'enemy' && b.type === 'commandCenter');
for (let i = 0; i < 8; i++) sim6.addUnit('player', 'hammer', e6.x - 260 + i * 24, e6.y + 300);
sim6.grantTech('player', 'A1');
sim6.grantTech('player', 'A2');
const squad = sim6.units.filter((u) => u.team === 'player' && u.def.role !== 'worker');
sim6.issueOrder('player', squad.map((u) => u.id), e6.x, e6.y, 'attack');
step(sim6, 90);
check('армия из 8 танков берёт базу врага', sim6.result === 'win', sim6.result + ' / HP базы ' + Math.round(e6.hp));

console.log('\n[11] ИИ давит на игрока');
const sim7 = new Sim();
sim7.ai.nextWave = 1;
const pcc7 = sim7.buildings.find((b) => b.team === 'player' && b.type === 'commandCenter');
const enemyArmy7 = sim7.units.filter((u) => u.team === 'enemy' && u.def.role !== 'worker');
sim7.issueOrder("enemy", enemyArmy7.map((u) => u.id), pcc7.x, pcc7.y, "attack");
step(sim7, 75);
check('враг дошёл до базы игрока (75 с)', sim7.units.some((u) =>
  u.team === "enemy" && ctx.THANDOR_UTIL.dist(u.x, u.y, pcc7.x, pcc7.y) < 400) || pcc7.hp < pcc7.hpMax);

console.log('\n' + (failures === 0 ? 'ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ' : `ПРОВАЛЕНО: ${failures}`));
process.exit(failures === 0 ? 0 : 1);
