/* ==========================================================================
   THAN-DOR — симуляция боя
   Чистая логика, без DOM и canvas. Всё, что здесь есть, переносится в GDScript
   практически строка в строку. Тестируется через node (см. test/sim.test.js).
   ========================================================================== */
(function (global) {
  'use strict';

  const C = global.NOVA;
  const TS = C.BALANCE.tileSize;
  const W = C.BALANCE.worldW;
  const H = C.BALANCE.worldH;

  // ── утилиты ──────────────────────────────────────────────────────────────
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const tileIndex = (tx, ty) => ty * W + tx;

  let nextId = 1;

  // ── простая очередь с приоритетом для A* ─────────────────────────────────
  class Heap {
    constructor() { this.a = []; }
    push(node, f) { this.a.push({ node, f }); this.up(this.a.length - 1); }
    up(i) {
      const a = this.a;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (a[p].f <= a[i].f) break;
        [a[p], a[i]] = [a[i], a[p]];
        i = p;
      }
    }
    down(i) {
      const a = this.a;
      for (;;) {
        let s = i;
        const l = 2 * i + 1, r = l + 1;
        if (l < a.length && a[l].f < a[s].f) s = l;
        if (r < a.length && a[r].f < a[s].f) s = r;
        if (s === i) break;
        [a[s], a[i]] = [a[i], a[s]];
        i = s;
      }
    }
    pop() {
      const a = this.a;
      if (!a.length) return null;
      const top = a[0];
      const last = a.pop();
      if (a.length) { a[0] = last; this.down(0); }
      return top.node;
    }
    get size() { return this.a.length; }
  }

  function Sim() {
    this.reset();
  }

  Sim.prototype.reset = function () {
    nextId = 1;
    this.time = 0;
    this.result = 'playing';
    this.units = [];
    this.buildings = [];
    this.projectiles = [];
    this.effects = [];
    this.events = [];

    this.teams = {
      player: { xenite: C.BALANCE.startXenite, researched: new Set(), researching: null, techQueue: [], buildQueue: [], lost: 0, killed: 0 },
      enemy:  { xenite: C.BALANCE.enemyStartXenite, researched: new Set(), researching: null, techQueue: [], buildQueue: [], lost: 0, killed: 0 }
    };

    // карта
    this.tiles = new Uint8Array(W * H);
    this.xeniteLeft = new Float32Array(W * H);
    this.occupied = new Uint8Array(W * H);
    for (let ty = 0; ty < H; ty++) {
      const row = C.MAP[ty];
      for (let tx = 0; tx < W; tx++) {
        const t = row.charCodeAt(tx) - 48;
        this.tiles[tileIndex(tx, ty)] = t;
        if (t === C.TILE.XENITE) this.xeniteLeft[tileIndex(tx, ty)] = C.BALANCE.xenitePatch;
      }
    }

    this.visible = new Uint8Array(W * H);
    this.explored = new Uint8Array(W * H);

    this.ai = { nextThink: 0, waveIndex: 0, nextWave: C.ENEMY_AI.firstWaveAt, built: 0 };

    this.spawnStart();
    this.recomputeVisibility();
    this.announce('start');
  };

  // ── стартовая расстановка ────────────────────────────────────────────────
  Sim.prototype.spawnStart = function () {
    const p = C.LEVEL.playerHC, e = C.LEVEL.enemyHC;

    this.addBuilding('player', 'commandCenter', p.tx * TS + TS / 2, p.ty * TS + TS / 2, true);
    this.addBuilding('player', 'factory', (p.tx + 2) * TS + TS / 2, p.ty * TS + TS / 2, true);
    this.addUnit('player', 'harvester', (p.tx + 1) * TS, (p.ty + 1) * TS);
    this.addUnit('player', 'harvester', (p.tx + 2) * TS, (p.ty + 1) * TS);
    this.addUnit('player', 'rifleman', (p.tx + 3) * TS, (p.ty + 1) * TS);

    this.addBuilding('enemy', 'commandCenter', e.tx * TS + TS / 2, e.ty * TS + TS / 2, true);
    this.addBuilding('enemy', 'factory', (e.tx - 2) * TS + TS / 2, e.ty * TS + TS / 2, true);
    this.addUnit('enemy', 'harvester', (e.tx - 1) * TS, (e.ty + 1) * TS);
    this.addUnit('enemy', 'harvester', (e.tx - 2) * TS, (e.ty + 1) * TS);
    this.addUnit('enemy', 'rifleman', (e.tx - 3) * TS, (e.ty + 1) * TS);

    // защита базы врага
    for (let i = 0; i < C.ENEMY_AI.guardTurrets; i++) {
      this.addBuilding('enemy', 'turret', (e.tx - 4 + i * 3) * TS + TS / 2, (e.ty + 3) * TS + TS / 2, true);
    }
  };

  Sim.prototype.addUnit = function (team, type, x, y) {
    const def = C.UNITS[type];
    if (!def) return null;
    const mods = this.mods(team);
    const hpMul = (def.role === 'vehicle' ? 1 + (mods.hpVehicle || 0) : 1);
    const u = {
      id: nextId++, kind: 'unit', team, type, def,
      x, y, hpMax: Math.round(def.hp * hpMul), hp: Math.round(def.hp * hpMul),
      radius: def.radius, cooldown: 0, facing: 0,
      order: { type: 'idle' }, path: null, pathIdx: 0,
      repathIn: 0, target: null, carrying: 0, harvestTimer: 0,
      homeX: x, homeY: y, alive: true, hitFlash: 0, muzzle: 0, moving: false
    };
    this.units.push(u);
    return u;
  };

  Sim.prototype.addBuilding = function (team, type, x, y, complete) {
    const def = C.BUILDINGS[type];
    if (!def) return null;
    const b = {
      id: nextId++, kind: 'building', team, type, def,
      x, y, hpMax: def.hp, hp: complete ? def.hp : Math.round(def.hp * 0.35),
      radius: def.radius, cooldown: 0, facing: Math.PI,
      built: !!complete, progress: complete ? 1 : 0,
      queue: [], alive: true, hitFlash: 0, muzzle: 0
    };
    if (!complete) b.hp = Math.round(def.hp * 0.35);
    this.buildings.push(b);
    this.markOccupied(b, 1);
    return b;
  };

  Sim.prototype.markOccupied = function (b, v) {
    const r = Math.ceil(b.radius / TS);
    const cx = Math.floor(b.x / TS), cy = Math.floor(b.y / TS);
    for (let ty = cy - r; ty <= cy + r; ty++) {
      for (let tx = cx - r; tx <= cx + r; tx++) {
        if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        if (dist(tx * TS + TS / 2, ty * TS + TS / 2, b.x, b.y) <= b.radius + TS * 0.3) {
          this.occupied[tileIndex(tx, ty)] = v;
        }
      }
    }
  };

  // ── модификаторы от технологий ───────────────────────────────────────────
  Sim.prototype.mods = function (team) {
    const set = this.teams[team].researched;
    const m = { dmg: 0, hpVehicle: 0, speed: 0, harvest: 0, costMod: 0, buildTime: 0 };
    for (const t of C.TECHS) {
      if (!set.has(t.id)) continue;
      if (t.dmg) m.dmg += t.dmg;
      if (t.hpVehicle) m.hpVehicle += t.hpVehicle;
      if (t.speed) m.speed += t.speed;
      if (t.harvest) m.harvest += t.harvest;
      if (t.costMod) m.costMod += t.costMod;
      if (t.buildTime) m.buildTime += t.buildTime;
    }
    return m;
  };

  Sim.prototype.hasTech = function (team, id) {
    return this.teams[team].researched.has(id);
  };

  Sim.prototype.unitCost = function (team, type) {
    const def = C.UNITS[type];
    const m = this.mods(team);
    return Math.max(10, Math.round(def.cost * (1 + m.costMod)));
  };

  Sim.prototype.buildTime = function (team, type) {
    const def = C.UNITS[type] || C.BUILDINGS[type];
    const m = this.mods(team);
    return Math.max(1, def.buildTime * (1 + m.buildTime));
  };

  // ── проходимость и поиск пути ────────────────────────────────────────────
  Sim.prototype.passable = function (tx, ty, hover) {
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
    const i = tileIndex(tx, ty);
    const t = this.tiles[i];
    if (t === C.TILE.ROCK || t === C.TILE.WATER) return !!hover;
    if (this.occupied[i]) return false;
    return true;
  };

  Sim.prototype.findPath = function (sx, sy, gx, gy, hover) {
    let stx = clamp(Math.floor(sx / TS), 0, W - 1), sty = clamp(Math.floor(sy / TS), 0, H - 1);
    let gtx = clamp(Math.floor(gx / TS), 0, W - 1), gty = clamp(Math.floor(gy / TS), 0, H - 1);

    if (!this.passable(gtx, gty, hover)) {
      // ищем ближайшую проходимую клетку рядом с целью
      let best = null, bestD = Infinity;
      for (let r = 1; r <= 4 && !best; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const tx = gtx + dx, ty = gty + dy;
            if (!this.passable(tx, ty, hover)) continue;
            const d = dist(tx, ty, gtx, gty);
            if (d < bestD) { bestD = d; best = { tx, ty }; }
          }
        }
      }
      if (!best) return null;
      gtx = best.tx; gty = best.ty;
    }
    if (!this.passable(stx, sty, hover)) {
      let found = null;
      for (let r = 1; r <= 4 && !found; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (this.passable(stx + dx, sty + dy, hover)) { found = { tx: stx + dx, ty: sty + dy }; break; }
          }
          if (found) break;
        }
      }
      if (!found) return null;
      stx = found.tx; sty = found.ty;
    }

    if (stx === gtx && sty === gty) return [{ tx: gtx, ty: gty }];

    const startIdx = tileIndex(stx, sty), goalIdx = tileIndex(gtx, gty);
    const open = new Heap();
    const cameFrom = new Map();
    const cost = new Map();
    cost.set(startIdx, 0);
    open.push(startIdx, 0);

    const hx = (i) => {
      const tx = i % W, ty = (i / W) | 0;
      const dx = Math.abs(tx - gtx), dy = Math.abs(ty - gty);
      return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };

    let guard = 0;
    while (open.size && guard++ < 4000) {
      const cur = open.pop();
      if (cur === goalIdx) break;
      const cx = cur % W, cy = (cur / W) | 0;
      const cg = cost.get(cur);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (!this.passable(nx, ny, hover)) continue;
          if (dx && dy && (!this.passable(cx + dx, cy, hover) || !this.passable(cx, cy + dy, hover))) continue;
          const ni = tileIndex(nx, ny);
          const ng = cg + (dx && dy ? Math.SQRT2 : 1);
          if (ng < (cost.has(ni) ? cost.get(ni) : Infinity)) {
            cost.set(ni, ng);
            cameFrom.set(ni, cur);
            open.push(ni, ng + hx(ni));
          }
        }
      }
    }

    if (!cameFrom.has(goalIdx)) return null;
    const out = [];
    let cur = goalIdx;
    while (cur !== startIdx) {
      out.push({ tx: cur % W, ty: (cur / W) | 0 });
      cur = cameFrom.get(cur);
      if (cur === undefined) return null;
    }
    out.reverse();
    return out;
  };

  Sim.prototype.setPathTo = function (u, x, y) {
    const hover = !!u.def.hover;
    const path = this.findPath(u.x, u.y, x, y, hover);
    if (!path) { u.path = null; return false; }
    u.path = path; u.pathIdx = 0;
    u.goalX = x; u.goalY = y;
    return true;
  };

  // ── команды игрока ───────────────────────────────────────────────────────
  Sim.prototype.issueOrder = function (team, ids, wx, wy, mode) {
    const list = this.units.filter((u) => u.team === team && ids.indexOf(u.id) >= 0 && u.alive);
    if (!list.length) return 0;
    let n = 0;
    for (const u of list) {
      u.target = null;
      if (u.def.role === 'worker' && mode !== 'attack') {
        u.order = { type: 'move', x: wx, y: wy };
      } else {
        u.order = { type: mode === 'attack' ? 'attackMove' : 'move', x: wx, y: wy };
      }
      // разносим точки приказа, чтобы толпа не слипалась в одну
      const angle = (n / Math.max(1, list.length)) * Math.PI * 2;
      const spread = list.length > 1 ? Math.min(46, 12 + list.length * 3) : 0;
      const tx = wx + Math.cos(angle) * spread;
      const ty = wy + Math.sin(angle) * spread;
      this.setPathTo(u, tx, ty);
      n++;
    }
    return n;
  };

  Sim.prototype.orderAttackTarget = function (team, ids, targetId) {
    const target = this.findById(targetId);
    if (!target) return;
    for (const u of this.units) {
      if (u.team !== team || ids.indexOf(u.id) < 0 || !u.alive) continue;
      if (u.def.role === 'worker') continue;
      u.target = target;
      u.order = { type: 'attack', targetId };
      u.path = null;
    }
  };

  Sim.prototype.orderHarvest = function (team, ids, tx, ty) {
    for (const u of this.units) {
      if (u.team !== team || ids.indexOf(u.id) < 0 || !u.alive) continue;
      if (u.def.role !== 'worker') continue;
      u.order = { type: 'harvest', tx, ty };
      u.target = null;
      u.path = null;
      u.repathIn = 0;
      this.setPathTo(u, tx * TS + TS / 2, ty * TS + TS / 2);
    }
  };

  Sim.prototype.setRally = function (team, buildingId, wx, wy) {
    const b = this.findById(buildingId);
    if (b && b.team === team) { b.rallyX = wx; b.rallyY = wy; }
  };

  Sim.prototype.trainUnit = function (team, buildingId, type, opts) {
    const free = !!(opts && opts.free);
    const b = this.findById(buildingId);
    const t = this.teams[team];
    if (!b || b.kind !== 'building' || b.team !== team) return { ok: false, reason: 'bad-building' };
    if (!b.built || !b.def.produces) return { ok: false, reason: 'not-factory' };
    const def = C.UNITS[type];
    if (!def) return { ok: false, reason: 'bad-unit' };
    if (def.tech && !t.researched.has(def.tech)) return { ok: false, reason: 'locked' };
    if (b.queue.length >= 5) return { ok: false, reason: 'queue-full' };
    const cost = free ? 0 : this.unitCost(team, type);
    if (!free && t.xenite < cost) return { ok: false, reason: 'no-money' };
    t.xenite -= cost;
    b.queue.push({ type, progress: 0, total: free ? 0.6 : this.buildTime(team, type) });
    return { ok: true };
  };

  Sim.prototype.placeBuilding = function (team, type, wx, wy, opts) {
    const free = !!(opts && opts.free);
    const def = C.BUILDINGS[type];
    const t = this.teams[team];
    if (!def) return { ok: false, reason: 'bad-type' };
    const tx = Math.floor(wx / TS), ty = Math.floor(wy / TS);
    if (tx < 1 || ty < 1 || tx >= W - 1 || ty >= H - 1) return { ok: false, reason: 'outside' };
    if (!this.passable(tx, ty, false) && this.tiles[tileIndex(tx, ty)] !== C.TILE.XENITE) {
      return { ok: false, reason: 'blocked' };
    }
    if (this.tiles[tileIndex(tx, ty)] === C.TILE.XENITE) return { ok: false, reason: 'blocked' };
    if (!this.withinBuildRadius(team, wx, wy)) return { ok: false, reason: 'radius' };
    const cost = free ? 0 : def.cost;
    if (!free && t.xenite < cost) return { ok: false, reason: 'no-money' };
    if (free) {
      this.addBuilding(team, type, wx, wy, true);
      return { ok: true };
    }
    t.xenite -= cost;
    t.buildQueue.push({ type, x: wx, y: wy, progress: 0, total: def.buildTime });
    return { ok: true, queued: true };
  };

  Sim.prototype.withinBuildRadius = function (team, wx, wy) {
    const R = C.BALANCE.buildRadius * TS;
    return this.buildings.some((b) => b.team === team && b.alive && dist(b.x, b.y, wx, wy) < R);
  };

  Sim.prototype.research = function (team, techId, opts) {
    const free = !!(opts && opts.free);
    const t = this.teams[team];
    const tech = C.TECHS.find((x) => x.id === techId);
    if (!tech) return { ok: false, reason: 'bad-tech' };
    if (t.researched.has(techId)) return { ok: false, reason: 'done' };
    if (t.techQueue.some((q) => q.id === techId)) return { ok: false, reason: 'queued' };
    for (const r of tech.requires) if (!t.researched.has(r)) return { ok: false, reason: 'requires' };
    const cost = free ? 0 : tech.cost;
    if (!free && t.xenite < cost) return { ok: false, reason: 'no-money' };
    t.xenite -= cost;
    t.techQueue.push({ id: techId, progress: 0, total: free ? 0.5 : tech.time });
    return { ok: true };
  };

  Sim.prototype.findById = function (id) {
    for (const b of this.buildings) if (b.id === id) return b;
    for (const u of this.units) if (u.id === id) return u;
    return null;
  };

  // ── урон ─────────────────────────────────────────────────────────────────
  Sim.prototype.damage = function (target, amount, attackerTeam) {
    if (!target || !target.alive) return;
    const armor = target.def.armor || 0;
    const dmg = Math.max(1, amount - armor * 2);
    target.hp -= dmg;
    target.hitFlash = 0.18;
    this.effects.push({ type: 'hit', x: target.x, y: target.y - target.radius, life: 0.6, max: 0.6, text: '-' + Math.round(dmg), team: attackerTeam });
    if (target.hp <= 0) this.kill(target);
  };

  Sim.prototype.kill = function (e) {
    if (!e.alive) return;
    e.alive = false;
    this.effects.push({ type: 'boom', x: e.x, y: e.y, life: 0.6, max: 0.6, big: e.kind === 'building' });
    if (e.kind === 'building') {
      this.markOccupied(e, 0);
      const drop = Math.min(this.teams[e.team].xenite, 0);
      void drop;
    }
    if (e.team === 'player') this.teams.player.lost++;
    if (e.team === 'enemy') this.teams.enemy.lost++;
    if (e.team === 'enemy' && e.type === 'commandCenter') this.finish('win');
    if (e.team === 'player' && e.type === 'commandCenter') this.finish('lose');
  };

  Sim.prototype.finish = function (result) {
    if (this.result !== 'playing') return;
    this.result = result;
    this.announce(result === 'win' ? 'victory' : 'defeat');
  };

  Sim.prototype.announce = function (key) {
    this.events.push({ type: 'announce', key, text: C.ANNOUNCER[key] || '' });
  };

  Sim.prototype.toast = function (text, kind) {
    this.events.push({ type: 'toast', text, kind: kind || 'info' });
  };

  // ── поиск цели ───────────────────────────────────────────────────────────
  Sim.prototype.nearestEnemy = function (u, maxRange) {
    let best = null, bestD = maxRange;
    for (const b of this.buildings) {
      if (b.team === u.team || !b.alive) continue;
      const d = dist(u.x, u.y, b.x, b.y) - b.radius;
      if (d < bestD) { bestD = d; best = b; }
    }
    for (const e of this.units) {
      if (e.team === u.team || !e.alive) continue;
      const d = dist(u.x, u.y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  };

  Sim.prototype.inRange = function (a, b) {
    const aa = a.def || {};
    const reach = (aa.range || 0) + (b.radius || 0);
    return dist(a.x, a.y, b.x, b.y) <= reach;
  };

  // ── движение юнита ───────────────────────────────────────────────────────
  Sim.prototype.moveUnit = function (u, dt, speedMul) {
    if (!u.path || u.pathIdx >= u.path.length) { u.moving = false; return true; }
    const node = u.path[u.pathIdx];
    const tx = node.tx * TS + TS / 2;
    const ty = node.ty * TS + TS / 2;
    const d = dist(u.x, u.y, tx, ty);
    if (d < 6) {
      u.pathIdx++;
      if (u.pathIdx >= u.path.length) { u.moving = false; u.path = null; return true; }
      return false;
    }
    const speed = u.def.speed * speedMul;
    const step = Math.min(d, speed * dt);
    u.x += ((tx - u.x) / d) * step;
    u.y += ((ty - u.y) / d) * step;
    u.facing = Math.atan2(ty - u.y, tx - u.x);
    u.moving = true;
    return false;
  };

  Sim.prototype.separate = function () {
    const us = this.units;
    for (let i = 0; i < us.length; i++) {
      const a = us[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < us.length; j++) {
        const b = us[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = a.radius + b.radius;
        if (d2 > min * min || d2 < 0.0001) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) * 0.5;
        const nx = dx / d, ny = dy / d;
        a.x -= nx * push; a.y -= ny * push;
        b.x += nx * push; b.y += ny * push;
      }
    }
  };

  Sim.prototype.keepInBounds = function (u) {
    u.x = clamp(u.x, u.radius, W * TS - u.radius);
    u.y = clamp(u.y, u.radius, H * TS - u.radius);
  };

  // ── буры ─────────────────────────────────────────────────────────────────
  Sim.prototype.updateHarvester = function (u, dt, mods) {
    const t = this.teams[u.team];
    const o = u.order;

    if (o.type === 'harvest') {
      if (u.carrying > 0) {
        const dep = this.nearestDeposit(u);
        if (!dep) { u.order = { type: 'idle' }; return; }
        if (dist(u.x, u.y, dep.x, dep.y) <= (dep.def.depositRange || C.BALANCE.depositRange)) {
          t.xenite += u.carrying;
          u.carrying = 0;
          u.harvestTimer = 0;
        } else if (!u.path) {
          this.setPathTo(u, dep.x, dep.y);
        } else {
          this.moveUnit(u, dt, 1);
        }
        return;
      }
      const ti = tileIndex(o.tx, o.ty);
      if (this.tiles[ti] !== C.TILE.XENITE || this.xeniteLeft[ti] <= 0) {
        const found = this.findNearestXenite(o.tx, o.ty);
        if (!found) { u.order = { type: 'idle' }; return; }
        o.tx = found.tx; o.ty = found.ty;
        u.path = null;
        this.setPathTo(u, o.tx * TS + TS / 2, o.ty * TS + TS / 2);
        return;
      }
      const px = o.tx * TS + TS / 2, py = o.ty * TS + TS / 2;
      if (dist(u.x, u.y, px, py) > TS * 0.95) {
        if (!u.path) this.setPathTo(u, px, py);
        else this.moveUnit(u, dt, 1);
        return;
      }
      u.path = null;
      u.harvestTimer += dt;
      const need = C.BALANCE.harvestTime;
      if (u.harvestTimer >= need) {
        u.harvestTimer = 0;
        const amount = Math.min(
          Math.round(C.BALANCE.harvestCarry * (1 + mods.harvest)),
          this.xeniteLeft[ti]
        );
        this.xeniteLeft[ti] -= amount;
        u.carrying = amount;
        if (this.xeniteLeft[ti] <= 0) {
          this.effects.push({ type: 'depleted', x: px, y: py, life: 1, max: 1 });
        }
      }
      return;
    }

    // простаивающий бур сам идёт добывать ближайший ксенит
    if (o.type === 'idle' && !u.carrying) {
      const found = this.findNearestXenite(Math.floor(u.x / TS), Math.floor(u.y / TS));
      if (found) {
        u.order = { type: 'harvest', tx: found.tx, ty: found.ty };
        this.setPathTo(u, found.tx * TS + TS / 2, found.ty * TS + TS / 2);
      }
    } else if (o.type === 'move') {
      if (u.path) {
        if (this.moveUnit(u, dt, 1)) u.order = { type: 'idle' };
      } else if (dist(u.x, u.y, o.x, o.y) > 18) {
        this.setPathTo(u, o.x, o.y);
      } else {
        u.order = { type: 'idle' };
      }
    }
  };

  Sim.prototype.nearestDeposit = function (u) {
    let best = null, bestD = Infinity;
    for (const b of this.buildings) {
      if (b.team !== u.team || !b.alive || !b.built || !b.def.deposit) continue;
      const d = dist(u.x, u.y, b.x, b.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  };

  Sim.prototype.findNearestXenite = function (ctx, cty) {
    let best = null, bestD = Infinity;
    for (let ty = 0; ty < H; ty++) {
      for (let tx = 0; tx < W; tx++) {
        const i = tileIndex(tx, ty);
        if (this.tiles[i] !== C.TILE.XENITE || this.xeniteLeft[i] <= 0) continue;
        const d = (tx - ctx) * (tx - ctx) + (ty - cty) * (ty - cty);
        if (d < bestD) { bestD = d; best = { tx, ty }; }
      }
    }
    return best;
  };

  // ── боевые юниты ─────────────────────────────────────────────────────────
  Sim.prototype.updateCombatUnit = function (u, dt, mods) {
    const speedMul = 1 + mods.speed;
    const dmgMul = 1 + mods.dmg;
    const o = u.order;

    if (u.target && (!u.target.alive || !this.inRange(u, u.target) && o.type === 'attack' && !u.path)) {
      // цель мертва или недостижима — переключаемся
      if (!u.target.alive) u.target = null;
    }
    if (u.target && !u.target.alive) u.target = null;

    // автоматический поиск цели (полуавтоматический бой)
    if (!u.target) {
      let range = u.def.sight * TS;
      if (o.type === 'attack' && o.targetId) {
        const tgt = this.findById(o.targetId);
        if (tgt && tgt.alive) { u.target = tgt; }
      }
      if (!u.target && (o.type === 'idle' || o.type === 'attackMove' || o.type === 'attack')) {
        const leash = o.type === 'idle' ? u.def.sight * TS * 0.8 : Infinity;
        const found = this.nearestEnemy(u, range);
        if (found) {
          if (o.type !== 'idle' || dist(u.x, u.y, u.homeX, u.homeY) < leash) u.target = found;
        }
      }
    }

    // стрельба
    u.cooldown = Math.max(0, u.cooldown - dt);
    if (u.target && u.target.alive && u.def.damage > 0) {
      if (this.inRange(u, u.target)) {
        u.path = null;
        u.facing = Math.atan2(u.target.y - u.y, u.target.x - u.x);
        if (u.cooldown <= 0) {
          u.cooldown = u.def.cooldown;
          u.muzzle = 0.12;
          this.projectiles.push({
            x: u.x, y: u.y - 6, tx: u.target.x, ty: u.target.y,
            life: 0.16, max: 0.16, team: u.team, splash: u.def.splash || 0,
            target: u.target, dmg: u.def.damage * dmgMul
          });
          if (u.def.splash) {
            this.effects.push({ type: 'boom', x: u.target.x, y: u.target.y, life: 0.4, max: 0.4 });
          }
        }
        return;
      }
      // подойти на дистанцию
      u.repathIn -= dt;
      if (u.repathIn <= 0 || !u.path) {
        u.repathIn = 0.6;
        this.setPathTo(u, u.target.x, u.target.y);
      }
    }

    // движение по приказу
    if (u.path) {
      const done = this.moveUnit(u, dt, speedMul);
      if (done) {
        if (o.type === 'move' || o.type === 'attackMove') {
          if (o.type === 'move') u.order = { type: 'idle', x: u.x, y: u.y };
          u.homeX = u.x; u.homeY = u.y;
        }
      }
    } else if (o.type === 'move' || o.type === 'attackMove') {
      if (dist(u.x, u.y, o.x, o.y) > 18) {
        this.setPathTo(u, o.x, o.y);
      } else if (o.type === 'move') {
        u.order = { type: 'idle' };
        u.homeX = u.x; u.homeY = u.y;
      }
    }
  };

  // ── постройки ────────────────────────────────────────────────────────────
  Sim.prototype.updateBuilding = function (b, dt, mods) {
    if (!b.alive) return;

    if (!b.built) {
      b.progress += dt / Math.max(1, b.total || 1);
      b.hp = Math.min(b.hpMax, Math.round(b.hpMax * (0.35 + 0.65 * b.progress)));
      if (b.progress >= 1) {
        b.built = true; b.progress = 1;
        if (b.team === 'player') this.announce('buildDone');
      }
      return;
    }

    // производство
    if (b.def.produces && b.queue.length) {
      const job = b.queue[0];
      job.progress += dt;
      if (job.progress >= job.total) {
        b.queue.shift();
        const u = this.addUnit(b.team, job.type, b.x, b.y + b.radius + 16);
        if (u) {
          const rx = b.rallyX !== undefined ? b.rallyX : b.x;
          const ry = b.rallyY !== undefined ? b.rallyY : b.y + 90;
          this.setPathTo(u, rx, ry);
          u.order = { type: 'move', x: rx, y: ry };
          if (b.team === 'player') this.announce('unitReady');
        }
      }
    }

    // турели стреляют
    b.cooldown = Math.max(0, b.cooldown - dt);
    if (b.def.damage > 0) {
      if (!b.target || !b.target.alive) {
        b.target = this.nearestEnemy(b, b.def.sight * TS);
      }
      if (b.target && b.target.alive) {
        if (this.inRange(b, b.target)) {
          b.facing = Math.atan2(b.target.y - b.y, b.target.x - b.x);
          if (b.cooldown <= 0) {
            b.cooldown = b.def.cooldown;
            b.muzzle = 0.12;
            this.projectiles.push({
              x: b.x, y: b.y - 10, tx: b.target.x, ty: b.target.y,
              life: 0.16, max: 0.16, team: b.team, splash: 0, target: b.target,
              dmg: b.def.damage * (1 + mods.dmg)
            });
          }
        } else {
          b.target = null;
        }
      }
    }
  };

  // ── снаряды ──────────────────────────────────────────────────────────────
  Sim.prototype.updateProjectiles = function (dt) {
    for (const p of this.projectiles) {
      p.life -= dt;
      if (p.life > 0) continue;
      const tgt = p.target;
      if (tgt && tgt.alive) {
        this.damage(tgt, p.dmg, p.team);
        if (p.splash > 0) {
          for (const e of this.units.concat(this.buildings)) {
            if (!e.alive || e === tgt || e.team === p.team) continue;
            if (dist(e.x, e.y, tgt.x, tgt.y) <= p.splash) this.damage(e, p.dmg * 0.45, p.team);
          }
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.life > 0);
  };

  // ── ИИ противника ────────────────────────────────────────────────────────
  Sim.prototype.updateEnemyAI = function (dt) {
    const ai = this.ai;
    ai.nextThink -= dt;
    if (ai.nextThink > 0) return;
    ai.nextThink = C.ENEMY_AI.thinkInterval;

    const t = this.teams.enemy;
    const cc = this.buildings.find((b) => b.team === 'enemy' && b.type === 'commandCenter' && b.alive);
    const factory = this.buildings.find((b) => b.team === 'enemy' && b.type === 'factory' && b.alive);
    if (!cc) return;

    // экономика
    const workers = this.units.filter((u) => u.team === 'enemy' && u.alive && u.def.role === 'worker');
    if (factory && workers.length < 3 && t.xenite >= 60) {
      this.trainUnit('enemy', factory.id, 'harvester');
    }

    // армия
    const army = this.units.filter((u) => u.team === 'enemy' && u.alive && u.def.role !== 'worker');
    if (factory && army.length < C.BALANCE.enemyMaxArmy && t.xenite >= 150 && factory.queue.length === 0) {
      const pick = army.length < 4 ? 'rifleman' : (Math.random() < 0.5 ? 'hammer' : 'rifleman');
      this.trainUnit('enemy', factory.id, pick);
    }

    // волны
    if (this.time >= ai.nextWave) {
      ai.waveIndex++;
      ai.nextWave = this.time + C.ENEMY_AI.waveInterval;
      const size = 2 + ai.waveIndex * C.ENEMY_AI.waveGrowth;
      const idle = this.units
        .filter((u) => u.team === 'enemy' && u.alive && u.def.role !== 'worker')
        .slice(0, size);
      const pcc = this.buildings.find((b) => b.team === 'player' && b.type === 'commandCenter' && b.alive);
      if (idle.length && pcc) {
        this.issueOrder('enemy', idle.map((u) => u.id), pcc.x, pcc.y, 'attack');
        ai.lastWaveSize = idle.length;
      }
      if (ai.waveIndex === 1) this.announce('waveIncoming');
    }
  };

  // ── туман войны ──────────────────────────────────────────────────────────
  Sim.prototype.recomputeVisibility = function () {
    this.visible.fill(0);
    const stamp = (x, y, rTiles) => {
      const cx = Math.floor(x / TS), cy = Math.floor(y / TS);
      const r = Math.ceil(rTiles);
      for (let ty = cy - r; ty <= cy + r; ty++) {
        for (let tx = cx - r; tx <= cx + r; tx++) {
          if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
          if (dist(tx, ty, cx, cy) > rTiles) continue;
          const i = tileIndex(tx, ty);
          this.visible[i] = 1;
          this.explored[i] = 1;
        }
      }
    };
    let bonus = 0;
    for (const b of this.buildings) {
      if (b.team !== 'player' || !b.alive) continue;
      if (b.def.visionBonus) bonus = Math.max(bonus, b.def.visionBonus);
      stamp(b.x, b.y, b.def.sight * (1 + bonus));
    }
    for (const u of this.units) {
      if (u.team !== 'player' || !u.alive) continue;
      stamp(u.x, u.y, u.def.sight);
    }
  };

  Sim.prototype.isVisible = function (x, y) {
    const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
    return this.visible[tileIndex(tx, ty)] === 1;
  };

  Sim.prototype.isExplored = function (x, y) {
    const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return false;
    return this.explored[tileIndex(tx, ty)] === 1;
  };

  // ── шаг симуляции ────────────────────────────────────────────────────────
  Sim.prototype.update = function (dt) {
    if (this.result !== 'playing') {
      this.projectiles.length = 0;
      return;
    }
    dt = Math.min(dt, 0.1);
    this.time += dt;

    const modsP = this.mods('player');
    const modsE = this.mods('enemy');

    // исследование
    for (const team of ['player', 'enemy']) {
      const t = this.teams[team];
      if (t.techQueue.length) {
        const job = t.techQueue[0];
        job.progress += dt;
        if (job.progress >= job.total) {
          t.techQueue.shift();
          t.researched.add(job.id);
          const tech = C.TECHS.find((x) => x.id === job.id);
          if (tech && tech.hpVehicle) {
            for (const u of this.units) {
              if (u.team === team && u.alive && u.def.role === 'vehicle') {
                u.hpMax = Math.round(u.hpMax * (1 + tech.hpVehicle));
                u.hp = Math.round(u.hp * (1 + tech.hpVehicle));
              }
            }
          }
          if (team === 'player') this.announce('techDone');
        }
      }
      // очередь постройки зданий: каркас растёт 0.75 с, затем включается обычная стройка
      if (t.buildQueue.length) {
        const job = t.buildQueue[0];
        job.progress += dt;
        if (job.progress >= job.total) {
          t.buildQueue.shift();
          const b = this.addBuilding(team, job.type, job.x, job.y, false);
          if (b) { b.total = 0.75; b.progress = 0; b.built = false; }
        }
      }
    }

    // юниты
    for (const u of this.units) {
      if (!u.alive) continue;
      u.hitFlash = Math.max(0, u.hitFlash - dt);
      u.muzzle = Math.max(0, u.muzzle - dt);
      const mods = u.team === 'player' ? modsP : modsE;
      if (u.def.role === 'worker') this.updateHarvester(u, dt, mods);
      else this.updateCombatUnit(u, dt, mods);
      this.keepInBounds(u);
    }
    this.separate();

    // здания
    for (const b of this.buildings) {
      if (!b.alive) continue;
      b.hitFlash = Math.max(0, b.hitFlash - dt);
      b.muzzle = Math.max(0, b.muzzle - dt);
      this.updateBuilding(b, dt, b.team === 'player' ? modsP : modsE);
    }

    this.updateProjectiles(dt);
    this.updateEnemyAI(dt);

    // эффекты
    for (const e of this.effects) e.life -= dt;
    this.effects = this.effects.filter((e) => e.life > 0);
    this.projectiles = this.projectiles.filter((p) => p.life > 0);

    if (Math.floor(this.time * 10) % 3 === 0) this.recomputeVisibility();

    this.units = this.units.filter((u) => u.alive);
    this.buildings = this.buildings.filter((b) => b.alive);
  };

  Sim.prototype.drainEvents = function () {
    const e = this.events;
    this.events = [];
    return e;
  };

  Sim.prototype.snapshot = function () {
    return {
      time: this.time,
      result: this.result,
      xenite: this.teams.player.xenite,
      enemyXenite: this.teams.enemy.xenite,
      units: this.units.length,
      enemyUnits: this.units.filter((u) => u.team === 'enemy').length,
      researched: [...this.teams.player.researched],
      lost: this.teams.player.lost,
      killed: this.teams.enemy.lost
    };
  };

  Sim.prototype.cheatResources = function (n) {
    this.teams.player.xenite += n;
  };

  // для тестов: мгновенно дать технологии
  Sim.prototype.grantTech = function (team, id) {
    this.teams[team].researched.add(id);
  };

  global.Sim = Sim;
  global.THANDOR_UTIL = { dist, clamp, W, H, TS };
})(typeof window !== 'undefined' ? window : globalThis);
