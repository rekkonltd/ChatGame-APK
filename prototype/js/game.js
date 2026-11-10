/* ==========================================================================
   THAN-DOR — игровой слой: камера, ввод, HUD, техдерево, экран результата
   ========================================================================== */
(function (global) {
  'use strict';
  const C = global.NOVA;
  const P = C.PALETTE;
  const A = global.Art;
  const UI = global.UI;
  const TS = C.BALANCE.tileSize;

  const TABS = [
    { id: 'units', label: 'ВОЙСКА' },
    { id: 'base', label: 'БАЗА' },
    { id: 'tech', label: 'ТЕХ' }
  ];

  function Game(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = opts || {};
    this.sim = new global.Sim();
    this.cam = { x: C.LEVEL.playerHC.tx * TS, y: C.LEVEL.playerHC.ty * TS, zoom: 1.15 };
    this.selection = null;
    this.selectedType = null;
    this.tab = 'units';
    this.techOpen = false;
    this.attackMode = false;
    this.placeMode = null;
    this.pointer = { down: false, dragged: false, x: 0, y: 0, lastX: 0, lastY: 0, startX: 0, startY: 0 };
    this.presses = {};
    this.lastTapTime = 0;
    this.lastTapId = null;
    this.toasts = [];
    this.announce = null;
    this.time = 0;
    this.hoverTile = null;
    this.layout = null;
    this.selectionBox = null;
    this.acc = 0;
    this.lastFrame = 0;
    this.paused = false;
    this.audio = { enabled: false };
    this.camLocked = true;
  }

  Game.prototype.viewSize = function () {
    return { w: this.canvas.clientWidth || this.canvas.width, h: this.canvas.clientHeight || this.canvas.height };
  };

  // ── камера ───────────────────────────────────────────────────────────────
  Game.prototype.clampCam = function () {
    const v = this.viewSize();
    const halfW = v.w / (2 * this.cam.zoom), halfH = Math.min(300, v.h / (2 * this.cam.zoom));
    this.cam.x = Math.max(halfW * 0.2, Math.min(C.BALANCE.worldW * TS - halfW * 0.2, this.cam.x));
    this.cam.y = Math.max(halfH * 0.2, Math.min(C.BALANCE.worldH * TS - halfH * 0.2, this.cam.y));
  };

  Game.prototype.focusOn = function (x, y) {
    this.cam.x = x; this.cam.y = y;
    this.clampCam();
  };

  // ── ввод ─────────────────────────────────────────────────────────────────
  Game.prototype.bindInput = function () {
    const el = this.canvas;
    const pos = (e) => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    el.addEventListener('pointerdown', (e) => {
      // setPointerCapture есть не во всех WebView — без него игра должна работать
      if (el.setPointerCapture && e.pointerId !== undefined) {
        try { el.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
      }
      const p = pos(e);
      this.pointer.down = true;
      this.pointer.dragged = false;
      this.pointer.x = this.pointer.lastX = this.pointer.startX = p.x;
      this.pointer.y = this.pointer.lastY = this.pointer.startY = p.y;
      this.pointer.time = performance.now();
      this.onPress(p.x, p.y);
    });

    el.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (this.pointer.down) {
        const dx = p.x - this.pointer.lastX, dy = p.y - this.pointer.lastY;
        if (Math.abs(p.x - this.pointer.startX) + Math.abs(p.y - this.pointer.startY) > 8) {
          this.pointer.dragged = true;
          this.presses = {};
        }
        if (this.pointer.dragged && !this.inHUD(p.y)) {
          this.cam.x -= dx / this.cam.zoom;
          this.cam.y -= dy / this.cam.zoom;
          this.clampCam();
        }
        this.pointer.lastX = p.x;
        this.pointer.lastY = p.y;
      }
    });

    const end = (e) => {
      if (el.releasePointerCapture && e.pointerId !== undefined) {
        try { el.releasePointerCapture(e.pointerId); } catch (err) { /* не критично */ }
      }
      // страховка: если down пришёл на canvas, а up потерялся — pointerdown
      // на документе (например, в старом WebView) вызовет onPress, но не onTap
      const p = pos(e);
      if (this.pointer.down && !this.pointer.dragged) this.onTap(p.x, p.y);
      this.pointer.down = false;
      this.presses = {};
      this.pointer.dragged = false;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', () => { this.pointer.down = false; this.presses = {}; });

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cam.zoom = Math.max(0.55, Math.min(1.5, this.cam.zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
      this.clampCam();
    }, { passive: false });

    // пинч
    this.touchDist = 0;
    el.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (this.touchDist) {
          this.cam.zoom = Math.max(0.55, Math.min(1.5, this.cam.zoom * (d / this.touchDist)));
          this.clampCam();
        }
        this.touchDist = d;
        this.pointer.dragged = true;
      }
    }, { passive: true });
    el.addEventListener('touchend', () => { this.touchDist = 0; });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.techOpen = false; this.attackMode = false; this.selection = null; }
      if (e.key === ' ') { e.preventDefault(); this.selectAllArmy(); }
      if (e.key === 'r') { this.sim = new global.Sim(); this.focusOn(C.LEVEL.playerHC.tx * TS, C.LEVEL.playerHC.ty * TS); }
    });
  };

  Game.prototype.inHUD = function (y) {
    const L = this.layout;
    return L ? y >= L.card.y : false;
  };

  Game.prototype.onPress = function (x, y) {
    this.presses = { x, y };
  };

  Game.prototype.onTap = function (x, y) {
    const L = this.layout;
    if (!L) return;
    this.lastTapTime = performance.now();

    // экран результата
    if (this.sim.result !== 'playing') {
      const panelH = 266;
      const py = L.field.y + Math.max(6, (L.field.h - panelH) / 2 - 20);
      if (x > 40 && x < L.field.w - 40 && y > py + panelH - 52 && y < py + panelH - 12) this.restart();
      return;
    }

    // техдерево открыто
    if (this.techOpen) {
      const node = this.techHitTest(x, y);
      if (node) { this.tryResearch(node.id); return; }
      // кнопка «ЗАКРЫТЬ» — ровно там, где нарисована
      if (x > L.field.w - 118 && y >= L.field.y && y <= L.field.y + 46) {
        this.techOpen = false;
        return;
      }
      this.techOpen = false;
      // тап по нижней панели закрывает техдерево и сразу переключает вкладку
      if (y <= L.field.y + L.field.h) return;
    }

    // верхний статус-бар: пауза
    if (y < L.status.h) {
      if (x > L.status.w - 46 && y < 40) this.paused = !this.paused;
      return;
    }

    // вкладки
    if (y >= L.tabs.y && y <= L.tabs.y + L.tabs.h) {
      const idx = Math.floor(x / (L.tabs.w / TABS.length));
      const t = TABS[Math.max(0, Math.min(TABS.length - 1, idx))];
      if (t.id === 'tech') this.techOpen = true; else { this.tab = t.id; }
      return;
    }

    // плитки
    if (y >= L.grid.y && y <= L.grid.y + L.grid.h) {
      const tile = this.tileHitTest(x, y);
      if (tile) this.onTile(tile);
      return;
    }

    // главные действия
    if (y >= L.actions.y) {
      if (x < L.actions.w / 2) this.selectAllArmy();
      else this.attackMode = !this.attackMode;
      return;
    }

    // карточка
    if (y >= L.card.y && y < L.tabs.y) {
      const sel = this.selectedEntity();
      if (sel && sel.kind === 'building' && sel.def.produces) {
        if (x > L.card.w - 104) this.sim.setRally(sel.team, sel.id, this.cam.x, this.cam.y + 120);
      }
      return;
    }

    // ── поле ──
    if (y >= L.field.y && y < L.field.y + L.field.h) {
      // миникарта
      if (this.minimapRect && this.inRect(x, y, this.minimapRect)) {
        const m = this.minimapRect;
        const wx = ((x - m.x) / m.w) * C.BALANCE.worldW * TS;
        const wy = ((y - m.y) / m.h) * C.BALANCE.worldH * TS;
        this.focusOn(wx, wy);
        this.minimapExpanded = !this.minimapExpanded;
        return;
      }
      this.onFieldTap(x, y);
    }
  };

  Game.prototype.inRect = function (x, y, r) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  };

  // Экранная точка → мировые координаты.
  // Важно: игровое поле начинается ниже статус-бара и имеет свою высоту,
  // поэтому переводим через прямоугольник поля, а не через весь экран.
  Game.prototype.worldAt = function (x, y) {
    const v = this.viewSize();
    const L = this.layout || UI.printLayout(this.ctx, v);
    return A.toWorld(this.cam, { w: v.w, h: L.field.h }, x, y - L.field.y);
  };

  Game.prototype.entityAt = function (wx, wy) {
    let best = null, bestD = Infinity;
    const slop = 18 / this.cam.zoom;
    for (const u of this.sim.units) {
      if (!u.alive) continue;
      if (u.team !== 'player' && !this.sim.isVisible(u.x, u.y)) continue;
      const d = Math.hypot(u.x - wx, u.y - wy);
      if (d < u.radius + slop && d < bestD) { bestD = d; best = u; }
    }
    for (const b of this.sim.buildings) {
      if (!b.alive) continue;
      if (b.team !== 'player' && !this.sim.isExplored(b.x, b.y)) continue;
      const d = Math.hypot(b.x - wx, b.y - wy);
      if (d < b.radius + slop * 0.6 && d < bestD) { bestD = d; best = b; }
    }
    return best;
  };

  Game.prototype.onFieldTap = function (x, y) {
    const w = this.worldAt(x, y);
    const e = this.entityAt(w.x, w.y);

    if (e) {
      if (e.team === 'player') {
        const now = performance.now();
        if (this.lastTapId === e.id && now - this.lastTapTime < 400) {
          this.selectAllOfType(e.type);
        } else {
          this.selection = e.id;
          this.selectedType = e.type;
          if (this.multiSelection && this.multiSelection.indexOf(e.id) < 0) this.multiSelection = null;
        }
        this.lastTapId = e.id;
        return;
      }
      // враг: приказ атаковать, если есть выделенные бойцы
      if (this.selection) {
        const ids = this.selectionIds();
        if (ids.length) {
          this.sim.orderAttackTarget('player', ids, e.id);
          if (this.opts.onOrder) this.opts.onOrder('attack');
          this.flash('Приказ: атаковать');
          return;
        }
      }
      this.selection = e.id;
      this.selectedType = e.type;
      return;
    }

    // пустая земля: сначала проверяем, не тапнули ли по залежи ксенита
    const ids = this.activeIds();
    const selected = this.sim.findById(this.selection);
    const tx = Math.floor(w.x / TS), ty = Math.floor(w.y / TS);
    const tileIdx = ty * C.BALANCE.worldW + tx;
    const onXenite = tx >= 0 && ty >= 0 && tx < C.BALANCE.worldW && ty < C.BALANCE.worldH &&
      this.sim.tiles[tileIdx] === C.TILE.XENITE;

    if (ids.length && onXenite) {
      // сборщикам — добыча, остальным — просто идти к залежи
      const workers = ids.filter((id) => {
        const u = this.sim.findById(id);
        return u && u.kind === 'unit' && u.def.role === 'worker';
      });
      if (workers.length) {
        this.sim.orderHarvest('player', workers, tx, ty);
        if (this.opts.onOrder) this.opts.onOrder('harvest');
        this.flash('Добыча ксенита');
        this.pressEffect(x, y);
        return;
      }
    }

    if (ids.length) {
      const mode = this.attackMode ? 'attack' : 'move';
      this.sim.issueOrder('player', ids, w.x, w.y, mode);
      if (this.opts.onOrder) this.opts.onOrder(mode);
      this.pressEffect(x, y);
      this.attackMode = false;
      return;
    }

    // тап по пустой карте без выделения — просто снять фокус
    void selected;
    this.selection = null;
    this.selectedType = null;
  };

  Game.prototype.selectionIds = function () {
    if (!this.selection) return [];
    const sel = this.sim.findById(this.selection);
    if (!sel) return [];
    if (sel.kind === 'unit') {
      // выделяем всех рядом той же группы? нет: только выбранного
      return [sel.id];
    }
    return [sel.id];
  };

  Game.prototype.selectedEntity = function () {
    return this.selection ? this.sim.findById(this.selection) : null;
  };

  Game.prototype.selectAllArmy = function () {
    const army = this.sim.units.filter((u) => u.team === 'player' && u.alive && u.def.role !== 'worker');
    if (!army.length) { this.flash('Армии нет'); return; }
    this.multiSelection = army.map((u) => u.id);
    this.selection = army[0].id;
    this.selectedType = 'army-group';
    this.flash('Выбрана армия: ' + army.length);
  };

  Game.prototype.selectAllOfType = function (type) {
    const list = this.sim.units.filter((u) => u.team === 'player' && u.alive && u.type === type);
    if (!list.length) return;
    this.multiSelection = list.map((u) => u.id);
    this.selection = list[0].id;
    this.selectedType = 'group-' + type;
    this.flash('Выбрано: ' + list.length + ' × ' + (C.UNITS[type] ? C.UNITS[type].name : ''));
  };

  Game.prototype.activeIds = function () {
    if (this.multiSelection) {
      const alive = this.multiSelection.filter((id) => {
        const e = this.sim.findById(id);
        return e && e.alive;
      });
      if (alive.length) return alive;
      this.multiSelection = null;
    }
    return this.selection ? [this.selection] : [];
  };

  Game.prototype.tryResearch = function (id) {
    const r = this.sim.research('player', id);
    if (r.ok) this.flash('Исследование начато: ' + C.TECHS.find((t) => t.id === id).name, 'ok');
    else this.reportFail(r.reason);
  };

  Game.prototype.reportFail = function (reason) {
    const map = {
      'no-money': 'Недостаточно ресурсов',
      'locked': 'Нужна технология',
      'requires': 'Сначала изучите предыдущее',
      'queue-full': 'Очередь заполнена',
      'blocked': 'Место занято',
      'radius': 'Слишком далеко от базы',
      'done': 'Уже изучено',
      'queued': 'Уже в работе'
    };
    this.flash(map[reason] || 'Невозможно', 'warn');
  };

  Game.prototype.flash = function (text, kind) {
    this.toasts.push({ text, kind: kind || 'info', life: 1.8, max: 1.8 });
    if (this.toasts.length > 3) this.toasts.shift();
  };

  Game.prototype.pressEffect = function (x, y) {
    this.ring = { x, y, life: 0.45, max: 0.45 };
  };

  Game.prototype.restart = function () {
    this.sim = new global.Sim();
    this.selection = null;
    this.multiSelection = null;
    this.selectedType = null;
    this.techOpen = false;
    this.attackMode = false;
    this.toasts = [];
    this.announce = null;
    this.focusOn(C.LEVEL.playerHC.tx * TS, C.LEVEL.playerHC.ty * TS);
  };

  // ── плитки нижней панели ─────────────────────────────────────────────────
  Game.prototype.tilesForTab = function () {
    if (this.tab === 'units') return ['rifleman', 'hammer', 'groza', 'osa', 'harvester'];
    if (this.tab === 'base') return ['factory', 'turret', 'radar'];
    return [];
  };

  Game.prototype.tileRects = function () {
    const L = this.layout;
    const list = this.tilesForTab();
    const cols = 3, gap = 6, pad = 8;
    const w = (L.grid.w - pad * 2 - gap * (cols - 1)) / cols;
    const h = (L.grid.h - gap - 6) / 2;
    return list.map((type, i) => {
      const cx = i % cols, cy = Math.floor(i / cols);
      return { type, x: pad + cx * (w + gap), y: L.grid.y + 3 + cy * (h + gap), w, h };
    });
  };

  Game.prototype.tileHitTest = function (x, y) {
    for (const r of this.tileRects()) if (this.inRect(x, y, r)) return r;
    return null;
  };

  Game.prototype.placeFree = function (type) {
    const def = C.BUILDINGS[type];
    const cc = this.sim.buildings.find((b) => b.team === 'player' && b.alive);
    if (!cc) return null;
    const step = TS;
    for (let ring = 1; ring <= 8; ring++) {
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2 + ring;
        const x = cc.x + Math.cos(ang) * ring * step;
        const y = cc.y + Math.sin(ang) * ring * step;
        const tx = Math.floor(x / TS), ty = Math.floor(y / TS);
        if (tx < 1 || ty < 1 || tx >= C.BALANCE.worldW - 1 || ty >= C.BALANCE.worldH - 1) continue;
        const i = ty * C.BALANCE.worldW + tx;
        if (this.sim.tiles[i] !== C.TILE.GROUND) continue;
        if (this.sim.occupied[i]) continue;
        if (!this.sim.withinBuildRadius('player', x, y)) continue;
        return { x, y };
      }
    }
    return null;
  };

  Game.prototype.onTile = function (rect) {
    const type = rect.type;
    const def = C.UNITS[type] || C.BUILDINGS[type];
    if (C.UNITS[type]) {
      if (def.tech && !this.sim.hasTech('player', def.tech)) { this.reportFail('locked'); return; }
      const factory = this.sim.buildings.find((b) => b.team === 'player' && b.def.produces && b.built);
      if (!factory) { this.flash('Нужен завод', 'warn'); return; }
      const r = this.sim.trainUnit('player', factory.id, type);
      if (!r.ok) this.reportFail(r.reason);
      else this.flash('Заказ: ' + def.name, 'ok');
    } else {
      const spot = this.placeFree(type);
      if (!spot) { this.flash('Нет места рядом с базой', 'warn'); return; }
      const r = this.sim.placeBuilding('player', type, spot.x, spot.y);
      if (!r.ok) this.reportFail(r.reason);
      else this.flash('Постройка: ' + def.name, 'ok');
    }
  };

  Game.prototype.tileState = function (type) {
    const def = C.UNITS[type] || C.BUILDINGS[type];
    const t = this.sim.teams.player;
    if (C.UNITS[type]) {
      if (def.tech && !this.sim.hasTech('player', def.tech)) return { locked: true, cost: def.cost };
      const cost = this.sim.unitCost('player', type);
      return { disabled: t.xenite < cost, cost };
    }
    return { disabled: t.xenite < def.cost, cost: def.cost };
  };

  // ── техдерево ────────────────────────────────────────────────────────────
  Game.prototype.techNodes = function () {
    const L = this.layout;
    const top = L.field.y + 84;
    const bottomPad = 34;
    const h = L.field.h - 84 - bottomPad;
    const colW = (L.field.w - 44) / 2;
    const tiers = 5;
    const rowH = Math.min(62, (h - 20) / tiers);
    return C.TECHS.map((t) => {
      const col = t.branch === 'army' ? 0 : 1;
      const row = t.tier - 1;
      return {
        id: t.id, tech: t,
        x: 16 + col * (colW + 12),
        y: top + row * rowH + 4,
        w: colW, h: 50
      };
    });
  };

  Game.prototype.techHitTest = function (x, y) {
    for (const n of this.techNodes()) {
      if (x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) return n;
    }
    return null;
  };

  // ── обновление ───────────────────────────────────────────────────────────
  Game.prototype.update = function (dt) {
    this.time += dt;
    if (!this.paused && this.sim.result === 'playing') {
      this.acc += dt;
      const step = 1 / 20;
      let guard = 0;
      while (this.acc >= step && guard++ < 5) { this.sim.update(step); this.acc -= step; }
    }

    // события симуляции → тосты и анонсер
    const evs = this.sim.drainEvents();
    for (const e of evs) {
      if (e.type === 'toast') this.flash(e.text);
      else if (e.type === 'announce') {
        this.announce = { text: e.text, life: 2.6 };
        if (this.opts.onAnnounce) this.opts.onAnnounce(e.text);
      }
    }

    for (const t of this.toasts) t.life -= dt;
    this.toasts = this.toasts.filter((t) => t.life > 0);
    if (this.announce) {
      this.announce.life -= dt;
      if (this.announce.life <= 0) this.announce = null;
    }
    if (this.ring) { this.ring.life -= dt; if (this.ring.life <= 0) this.ring = null; }

    // камера следит за выделенным, пока игрок не потянул карту
    if (this.camLocked && !this.pointer.dragged) {
      const sel = this.selectedEntity();
      if (sel) {
        this.cam.x += (sel.x - this.cam.x) * Math.min(1, dt * 3);
        this.cam.y += (sel.y - this.cam.y) * Math.min(1, dt * 3);
        this.clampCam();
      }
    }
  };

  // ── отрисовка ────────────────────────────────────────────────────────────
  Game.prototype.draw = function (canvasOnly) {
    const ctx = this.ctx;
    const v = this.viewSize();
    this.layout = UI.printLayout(ctx, v);
    const L = this.layout;
    const cam = this.cam;

    ctx.save();
    ctx.fillStyle = '#10130f';
    ctx.fillRect(0, 0, v.w, v.h);

    // игровое поле
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.field.x, L.field.y, L.field.w, L.field.h);
    ctx.clip();
    ctx.translate(0, L.field.y);

    A.drawGround(ctx, this.sim, cam, { w: v.w, h: L.field.h });

    // приказы выделенных
    if (this.selection) {
      for (const id of this.activeIds()) {
        const u = this.sim.findById(id);
        if (u && u.kind === 'unit' && u.order && u.order.type !== 'idle') {
          A.drawSelectionLine(ctx, cam, { w: v.w, h: L.field.h }, u, u.path && u.path.length ? {
            type: u.order.type,
            x: u.path[u.path.length - 1].tx * TS + TS / 2,
            y: u.path[u.path.length - 1].ty * TS + TS / 2
          } : u.order);
        }
      }
    }

    // здания
    for (const b of this.sim.buildings) {
      if (!b.alive) continue;
      if (b.team === 'enemy' && !this.sim.isExplored(b.x, b.y)) continue;
      const selected = this.activeIds().indexOf(b.id) >= 0;
      A.drawBuilding(ctx, this.sim, cam, { w: v.w, h: L.field.h }, b, selected, this.time);
    }

    // юниты
    for (const u of this.sim.units) {
      if (!u.alive) continue;
      if (u.team === 'enemy' && !this.sim.isVisible(u.x, u.y)) continue;
      const selected = this.activeIds().indexOf(u.id) >= 0;
      A.drawUnit(ctx, cam, { w: v.w, h: L.field.h }, u, selected, this.time);
    }

    A.drawProjectiles(ctx, this.sim, cam, { w: v.w, h: L.field.h });
    A.drawEffects(ctx, this.sim, cam, { w: v.w, h: L.field.h });
    A.drawFog(ctx, this.sim, cam, { w: v.w, h: L.field.h });

    // кольцо нажатия
    if (this.ring) {
      const k = 1 - this.ring.life / this.ring.max;
      ctx.strokeStyle = 'rgba(125,220,60,' + (1 - k).toFixed(2) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.ring.x, this.ring.y - L.field.y, 8 + k * 22, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();
    ctx.restore();

    // HUD
    this.drawStatusBar(ctx, v, L);
    this.drawMinimap(ctx, v, L);
    this.drawCard(ctx, v, L);
    this.drawTabs(ctx, v, L);
    this.drawTiles(ctx, v, L);
    this.drawActions(ctx, v, L);
    this.drawToasts(ctx, v, L);
    if (this.techOpen) this.drawTech(ctx, v, L);
    if (this.sim.result !== 'playing') this.drawResult(ctx, v, L);
    if (this.paused && this.sim.result === 'playing') this.drawPaused(ctx, v, L);
  };

  Game.prototype.drawStatusBar = function (ctx, v, L) {
    UI.panel(ctx, 0, 0, v.w, L.status.h, { r: 0, grid: false, screws: false });
    const cy = L.status.h - 14;

    // ксенит
    UI.icon(ctx, 'harvester', 20, cy + 1, 22, 'player');
    ctx.font = '800 20px "Barlow Condensed", system-ui, sans-serif';
    ctx.fillStyle = P.xenite.light;
    ctx.textAlign = 'left';
    ctx.fillText(String(Math.floor(this.sim.teams.player.xenite)), 32, cy + 7);

    // армия
    const army = this.sim.units.filter((u) => u.team === 'player' && u.def.role !== 'worker').length;
    const ax = 96;
    UI.text(ctx, 'АРМИЯ', ax, cy - 9, 9, P.ui.textDim, 'left', 600);
    UI.bar(ctx, ax, cy - 3, 44, 6, army / C.BALANCE.maxArmy, P.ui.green);
    UI.text(ctx, army + '/' + C.BALANCE.maxArmy, ax + 48, cy + 6, 11, '#c9c4b6', 'left', 700);

    // таймер по центру
    const t = Math.floor(this.sim.time);
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    UI.text(ctx, mm + ':' + ss, v.w - 74, cy + 6, 15, '#c9c4b6', 'right', 700);

    // пауза
    const px = v.w - 40;
    UI.tile(ctx, { x: px, y: 11, w: 30, h: 28 }, {}, () => {
      ctx.fillStyle = P.ui.text;
      if (this.paused) {
        A.poly(ctx, [[px + 11, 16], [px + 21, 25], [px + 11, 34]], P.ui.text, null, 0);
      } else {
        ctx.fillRect(px + 10, 17, 4, 16);
        ctx.fillRect(px + 18, 17, 4, 16);
      }
    });
  };

  Game.prototype.drawMinimap = function (ctx, v, L) {
    const small = L.field.w * 0.26;
    const w = this.minimapExpanded ? Math.min(L.field.w * 0.62, small * 2.2) : small;
    const h = w;
    const x = L.field.w - w - 8;
    const y = L.field.y + 8;
    this.minimapRect = { x, y, w, h };

    UI.panel(ctx, x, y, w, h, { r: 3 });
    const px = x + 5, py = y + 5, pw = w - 10, ph = h - 10;
    UI.inset(ctx, px, py, pw, ph, 2);
    const sx = pw / (C.BALANCE.worldW * TS), sy = ph / (C.BALANCE.worldH * TS);

    // земля
    for (let ty = 0; ty < C.BALANCE.worldH; ty += 2) {
      for (let tx = 0; tx < C.BALANCE.worldW; tx += 2) {
        const i = ty * C.BALANCE.worldW + tx;
        if (!this.sim.explored[i]) continue;
        const t = this.sim.tiles[i];
        let c = '#3a4230';
        if (t === C.TILE.XENITE) c = '#c9a13a';
        else if (t === C.TILE.ROCK) c = '#4a4640';
        else if (t === C.TILE.WATER) c = '#28424c';
        ctx.fillStyle = c;
        ctx.fillRect(px + tx * TS * sx, py + ty * TS * sy, 2 * TS * sx + 0.6, 2 * TS * sy + 0.6);
      }
    }
    // здания и юниты
    for (const b of this.sim.buildings) {
      if (!b.alive) continue;
      if (b.team === 'enemy' && !this.sim.isExplored(b.x, b.y)) continue;
      ctx.fillStyle = b.team === 'player' ? '#7fb3dd' : '#d0664f';
      const s = Math.max(2.5, b.radius * sx * 1.6);
      ctx.fillRect(px + b.x * sx - s / 2, py + b.y * sy - s / 2, s, s);
    }
    for (const u of this.sim.units) {
      if (!u.alive) continue;
      if (u.team === 'enemy' && !this.sim.isVisible(u.x, u.y)) continue;
      ctx.fillStyle = u.team === 'player' ? '#a9d4f5' : '#ff9b84';
      ctx.fillRect(px + u.x * sx - 1, py + u.y * sy - 1, 2.4, 2.4);
    }
    // рамка камеры
    const cw = (v.w / this.cam.zoom) * sx, ch = (L.field.h / this.cam.zoom) * sy;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + this.cam.x * sx - cw / 2, py + this.cam.y * sy - ch / 2, cw, ch);
    UI.text(ctx, this.minimapExpanded ? '▾' : '▴', x + w - 12, y + 14, 10, P.ui.textDim, 'center', 700);
  };

  Game.prototype.drawCard = function (ctx, v, L) {
    UI.panel(ctx, 0, L.card.y, v.w, L.card.h, { r: 0, screws: false });
    const sel = this.selectedEntity();
    const ids = this.activeIds();

    if (!sel || !ids.length) {
      // подсказка вместо пустоты
      UI.text(ctx, 'ВЫБЕРИТЕ ЮНИТ ИЛИ ЗДАНИЕ', v.w / 2, L.card.y + 44, 14, P.ui.textDim, 'center', 700);
      UI.text(ctx, 'тап по карте — выбор · тап по земле — приказ', v.w / 2, L.card.y + 64, 11, 'rgba(142,140,130,0.8)', 'center', 500);
      return;
    }

    const many = ids.length > 1;
    const type = many ? (sel.def.role === 'worker' ? 'harvester' : sel.type) : sel.type;
    UI.blueprint(ctx, type, 8, L.card.y + 8, 78, L.card.h - 16, 'player');

    const name = many ? ids.length + ' ед. · ' + (sel.def.role === 'worker' ? 'Сборщики' : 'Войска') : sel.def.name;
    UI.text(ctx, name.toUpperCase(), 96, L.card.y + 24, 16, P.ui.text, 'left', 700);

    const cur = many ? ids.reduce((a, id) => a + (this.sim.findById(id) ? this.sim.findById(id).hp : 0), 0) : sel.hp;
    const max = many ? ids.reduce((a, id) => a + (this.sim.findById(id) ? this.sim.findById(id).hpMax : 0), 0) : sel.hpMax;
    UI.text(ctx, 'HP ' + Math.round(cur) + '/' + Math.round(max), 96, L.card.y + 42, 11, P.ui.dim || P.ui.textDim, 'left', 600);
    UI.bar(ctx, 96, L.card.y + 48, 150, 7, cur / Math.max(1, max), P.player.hp);

    if (sel.kind === 'building' && sel.def.produces) {
      const q = sel.queue.length;
      UI.text(ctx, q ? 'ОЧЕРЕДЬ: ' + q : 'ПРОСТАИВАЕТ', 96, L.card.y + 72, 11, q ? P.ui.amber : P.ui.textDim, 'left', 600);
      if (sel.queue.length) {
        const job = sel.queue[0];
        UI.bar(ctx, 96, L.card.y + 76, 150, 4, job.progress / job.total, P.ui.amber);
      }
      UI.tile(ctx, { x: L.card.w - 96, y: L.card.y + 26, w: 84, h: 40 }, {}, () => {
        UI.text(ctx, 'СБОР', L.card.w - 54, L.card.y + 43, 11, P.ui.text, 'center', 700);
        UI.text(ctx, 'точка', L.card.w - 54, L.card.y + 56, 9, P.ui.textDim, 'center', 500);
      });
    } else if (sel.kind === 'unit' && sel.def.role === 'worker') {
      UI.text(ctx, 'ВЕЗЁТ: ' + sel.carrying, 96, L.card.y + 72, 11, P.ui.xenite || P.ui.amber, 'left', 600);
    } else if (sel.kind === 'unit') {
      const dmg = Math.round(sel.def.damage * (1 + this.sim.mods('player').dmg));
      UI.text(ctx, 'УРОН ' + dmg + ' · РАДИУС ' + sel.def.range, 96, L.card.y + 72, 11, P.ui.textDim, 'left', 600);
    }

    // кнопка «все такие же»
    if (sel.kind === 'unit' && !many) {
      UI.tile(ctx, { x: L.card.w - 96, y: L.card.y + 26, w: 84, h: 40 }, {}, () => {
        UI.text(ctx, 'ВСЕ', L.card.w - 54, L.card.y + 43, 11, P.ui.text, 'center', 700);
        UI.text(ctx, 'такие', L.card.w - 54, L.card.y + 56, 9, P.ui.textDim, 'center', 500);
      });
    }
  };

  Game.prototype.drawTabs = function (ctx, v, L) {
    const w = L.tabs.w / TABS.length;
    for (let i = 0; i < TABS.length; i++) {
      const t = TABS[i];
      const active = (t.id === this.tab && !this.techOpen) || (t.id === 'tech' && this.techOpen);
      const x = i * w;
      ctx.fillStyle = active ? '#4b525a' : '#2b2f34';
      ctx.fillRect(x, L.tabs.y, w - 1, L.tabs.h);
      ctx.strokeStyle = active ? P.ui.amber : 'rgba(0,0,0,0.5)';
      ctx.lineWidth = active ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x + 4, L.tabs.y + L.tabs.h + 0.5);
      ctx.lineTo(x + w - 5, L.tabs.y + L.tabs.h + 0.5);
      if (active) { ctx.moveTo(x + 4, L.tabs.y + 1); ctx.lineTo(x + w - 5, L.tabs.y + 1); }
      ctx.stroke();
      UI.text(ctx, t.label, x + w / 2, L.tabs.y + 22, 12, active ? P.ui.text : P.ui.textDim, 'center', 700);
    }
  };

  Game.prototype.drawTiles = function (ctx, v, L) {
    if (this.tab === 'tech' && !this.techOpen) return;
    for (const r of this.tileRects()) {
      const def = C.UNITS[r.type] || C.BUILDINGS[r.type];
      const st = this.tileState(r.type);
      const producing = this.sim.teams.player.techQueue.length > 0;
      UI.tile(ctx, r, st, (c) => {
        UI.icon(c, r.type, r.x + r.w / 2, r.y + r.h * 0.42, Math.min(r.w, r.h) * 0.62, 'player', st.disabled || st.locked);
        c.font = '600 11px ' + '"Barlow Condensed", system-ui, sans-serif';
        c.fillStyle = st.locked ? '#7a7d80' : (st.disabled ? '#8a8578' : '#d9d3c4');
        c.textAlign = 'center';
        c.fillText(def.name, r.x + r.w / 2, r.y + r.h - 14);
        c.font = '700 11px "Barlow Condensed", system-ui, sans-serif';
        c.fillStyle = st.locked ? '#7a7d80' : (st.disabled ? '#b06a4a' : P.xenite.core);
        c.fillText(st.locked ? 'ЗАКРЫТО' : st.cost + ' КС', r.x + r.w / 2, r.y + r.h - 3);
        if (st.locked) {
          c.fillStyle = 'rgba(12,14,12,0.55)';
          A.roundRect(c, r.x + 1, r.y + 1, r.w - 2, r.h - 2, 2);
          c.fill();
          // иконка замка
          c.strokeStyle = '#9a978c';
          c.lineWidth = 1.4;
          c.beginPath();
          c.arc(r.x + r.w - 14, r.y + 12, 3.2, Math.PI, 0);
          c.stroke();
          c.fillStyle = '#9a978c';
          c.fillRect(r.x + r.w - 18, r.y + 12, 8, 6);
        }
      });
    }
  };

  Game.prototype.drawActions = function (ctx, v, L) {
    const w = (L.actions.w - 16) / 2;
    UI.tile(ctx, { x: 8, y: L.actions.y + 4, w, h: 42 }, {}, () => {
      UI.icon(ctx, 'army', 32, L.actions.y + 25, 24, 'player');
      UI.text(ctx, 'ВСЕ ВОЙСКА', 52, L.actions.y + 30, 13, P.ui.text, 'left', 700);
    });
    UI.tile(ctx, { x: 8 + w + 0, y: L.actions.y + 4, w, h: 42 }, { active: this.attackMode }, () => {
      if (this.attackMode) {
        ctx.fillStyle = P.ui.amber;
        ctx.fillRect(8 + w, L.actions.y + 4, w, 42);
      }
      UI.text(ctx, this.attackMode ? 'ВЫБЕРИТЕ ЦЕЛЬ' : 'АТАКА', 8 + w + w / 2, L.actions.y + 30, 14,
        this.attackMode ? '#241f14' : P.ui.text, 'center', 800);
    });
  };

  Game.prototype.drawToasts = function (ctx, v, L) {
    let y = L.field.y + 46;
    for (const t of this.toasts) {
      ctx.globalAlpha = Math.min(1, t.life / 0.5);
      ctx.font = '600 12px "Barlow Condensed", system-ui, sans-serif';
      const w = Math.min(L.field.w - 24, Math.max(140, ctx.measureText(t.text).width + 28));
      const x = v.w / 2 - w / 2;
      ctx.fillStyle = t.kind === 'warn' ? 'rgba(70,30,22,0.92)' : 'rgba(24,28,32,0.92)';
      A.roundRect(ctx, x, y, w, 30, 3);
      ctx.fill();
      ctx.strokeStyle = t.kind === 'warn' ? '#a4543c' : '#5c646c';
      ctx.lineWidth = 1;
      ctx.stroke();
      UI.text(ctx, t.text, v.w / 2, y + 20, 12, t.kind === 'warn' ? '#f0c0a8' : P.ui.text, 'center', 600);
      y += 36;
      ctx.globalAlpha = 1;
    }

    if (this.announce) {
      const a = this.announce;
      ctx.globalAlpha = Math.min(1, a.life / 0.6);
      const w = Math.min(v.w - 40, 320);
      const x = v.w / 2 - w / 2;
      const y2 = L.field.y + L.field.h - 92;
      ctx.fillStyle = 'rgba(14,16,18,0.88)';
      A.roundRect(ctx, x, y2, w, 44, 3);
      ctx.fill();
      ctx.strokeStyle = P.ui.amber;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = P.ui.amber;
      ctx.fillRect(x + 8, y2 + 10, 3, 24);
      UI.text(ctx, a.text, v.w / 2 + 6, y2 + 27, 14, '#efe7d2', 'center', 700);
      ctx.globalAlpha = 1;
    }
  };

  Game.prototype.drawTech = function (ctx, v, L) {
    ctx.fillStyle = 'rgba(6,8,10,0.94)';
    ctx.fillRect(0, L.field.y, v.w, L.field.h);
    // шапка
    UI.text(ctx, 'ТЕХНОЛОГИИ', 20, L.field.y + 32, 18, P.ui.text, 'left', 800);
    UI.text(ctx, 'ИССЛЕДОВАНИЕ: ' + (this.sim.teams.player.techQueue.length
      ? C.TECHS.find((t) => t.id === this.sim.teams.player.techQueue[0].id).name +
        ' ' + Math.round(this.sim.teams.player.techQueue[0].progress / this.sim.teams.player.techQueue[0].total * 100) + '%'
      : 'свободно'), 20, L.field.y + 50, 11, P.ui.textDim, 'left', 600);

    // ветки-подписи
    const colW = (L.field.w - 60) / 2;
    UI.text(ctx, 'АРМИЯ', 16 + colW / 2, L.field.y + 76, 12, '#e07a5f', 'center', 800);
    UI.text(ctx, 'ЭКОНОМИКА', 16 + colW + 12 + colW / 2, L.field.y + 76, 12, P.ui.green, 'center', 800);

    // связи
    const nodes = this.techNodes();
    ctx.strokeStyle = 'rgba(140,150,160,0.35)';
    ctx.lineWidth = 2;
    for (const n of nodes) {
      for (const req of n.tech.requires) {
        const parent = nodes.find((m) => m.id === req);
        if (!parent) continue;
        ctx.beginPath();
        ctx.moveTo(parent.x + parent.w / 2, parent.y + parent.h);
        ctx.lineTo(n.x + n.w / 2, n.y);
        ctx.stroke();
      }
    }

    for (const n of nodes) {
      const t = n.tech;
      const st = this.sim.teams.player;
      const done = st.researched.has(t.id);
      const queued = st.techQueue.some((q) => q.id === t.id);
      const canReq = t.requires.every((r) => st.researched.has(r));
      const canMoney = st.xenite >= t.cost;
      const locked = !done && !queued && (!canReq || !canMoney);
      const active = queued;

      const g = ctx.createLinearGradient(0, n.y, 0, n.y + n.h);
      if (done) { g.addColorStop(0, '#33422f'); g.addColorStop(1, '#26301f'); }
      else if (active) { g.addColorStop(0, '#4a4230'); g.addColorStop(1, '#332e22'); }
      else if (canReq && canMoney) { g.addColorStop(0, '#434a52'); g.addColorStop(1, '#2e343a'); }
      else { g.addColorStop(0, '#2a2e33'); g.addColorStop(1, '#212427'); }
      A.roundRect(ctx, n.x, n.y, n.w, n.h, 3);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = done ? '#6f9b52' : active ? P.ui.amber : '#4a5058';
      ctx.lineWidth = done || active ? 1.6 : 1;
      ctx.stroke();

      UI.text(ctx, t.name, n.x + 8, n.y + 18, 12, done ? '#a8c48f' : P.ui.text, 'left', 700);
      const status = done ? 'ИЗУЧЕНО' : active ? 'В РАБОТЕ' : locked
        ? (!canReq ? 'НУЖНА ' + t.requires.join('/') : 'НЕТ КС') : t.cost + ' КС · ' + t.time + 'с';
      if (!done && !active) {
        UI.icon(ctx, 'tech', n.x + n.w - 13, n.y + 12, 13, 'player', !!locked);
      }
      // эффект в одну строку, обрезаем по ширине
      ctx.save();
      ctx.beginPath();
      ctx.rect(n.x + 6, n.y + 22, n.w - 12, n.h - 12);
      ctx.clip();
      UI.text(ctx, t.effect, n.x + 8, n.y + 32, 9, done ? '#8fa87c' : '#a3a29a', 'left', 500);
      ctx.restore();
      UI.text(ctx, status, n.x + n.w - 8, n.y + n.h - 6, 8.5,
        done ? '#7ddc3c' : active ? P.ui.amber : '#8a887e', 'right', 700);
    }

    // кнопка «закрыть»
    UI.tile(ctx, { x: v.w - 108, y: L.field.y + 12, w: 96, h: 30 }, {}, () => {
      UI.text(ctx, 'ЗАКРЫТЬ', v.w - 60, L.field.y + 32, 11, P.ui.text, 'center', 700);
    });
    UI.text(ctx, 'тап по технологии — изучить', v.w / 2, L.field.y + L.field.h - 24, 10, P.ui.textDim, 'center', 500);
  };

  Game.prototype.drawResult = function (ctx, v, L) {
    ctx.fillStyle = 'rgba(6,8,10,0.9)';
    ctx.fillRect(0, 0, v.w, v.h);
    const win = this.sim.result === 'win';
    const cx = v.w / 2;
    const panelH = 266;
    const py = L.field.y + Math.max(6, (L.field.h - panelH) / 2 - 20);
    UI.panel(ctx, 24, py, v.w - 48, panelH, { r: 4 });

    UI.text(ctx, win ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ', cx, py + 56, 36,
      win ? P.ui.green : P.ui.red, 'center', 800);
    UI.text(ctx, win ? 'Командный центр Голратов уничтожен' : 'Наш командный центр потерян',
      cx, py + 84, 12, P.ui.text, 'center', 600);

    // разделитель
    ctx.strokeStyle = 'rgba(120,128,138,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(44, py + 98); ctx.lineTo(v.w - 44, py + 98); ctx.stroke();

    const t = Math.floor(this.sim.time);
    const rows = [
      ['Время боя', String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0')],
      ['Уничтожено врагов', String(this.sim.teams.enemy.lost)],
      ['Технологий изучено', String(this.sim.teams.player.researched.size) + ' / ' + C.TECHS.length],
      ['Потеряно единиц', String(this.sim.teams.player.lost)]
    ];
    let y = py + 122;
    for (const r of rows) {
      UI.text(ctx, r[0], 44, y, 12, P.ui.textDim, 'left', 600);
      UI.text(ctx, r[1], v.w - 44, y, 12, P.ui.text, 'right', 700);
      y += 22;
    }

    // звёзды
    const stars = this.sim.result === 'win'
      ? (this.sim.time < 300 && this.sim.teams.player.lost < 4 ? 3
        : this.sim.time < 420 && this.sim.teams.player.lost < 8 ? 2 : 1)
      : 0;
    if (win) {
      for (let i = 0; i < 3; i++) {
        const sx = cx - 28 + i * 28;
        const on = i < stars;
        ctx.save();
        ctx.translate(sx, py + 212);
        ctx.fillStyle = on ? P.ui.amber : 'rgba(120,128,138,0.25)';
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
          const rr = k % 2 ? 4 : 9;
          const px = Math.cos(a) * rr, py2 = Math.sin(a) * rr;
          if (k === 0) ctx.moveTo(px, py2); else ctx.lineTo(px, py2);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    UI.tile(ctx, { x: 40, y: py + panelH - 52, w: v.w - 80, h: 40 }, {}, () => {
      UI.text(ctx, 'ИГРАТЬ СНОВА', cx, py + panelH - 26, 14, P.ui.text, 'center', 800);
    });
  };

  Game.prototype.drawPaused = function (ctx, v, L) {
    ctx.fillStyle = 'rgba(6,8,10,0.72)';
    ctx.fillRect(0, 0, v.w, v.h);
    UI.text(ctx, 'ПАУЗА', v.w / 2, v.h / 2 - 10, 30, P.ui.text, 'center', 800);
    UI.text(ctx, 'нажмите ⏸ чтобы продолжить', v.w / 2, v.h / 2 + 18, 12, P.ui.textDim, 'center', 500);
  };

  global.Game = Game;
})(typeof window !== 'undefined' ? window : globalThis);
