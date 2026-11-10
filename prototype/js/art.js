/* ==========================================================================
   THAN-DOR — графика: «индустриальный флэт»
   Гибридная камера: мир сверху, объекты с объёмом (передняя грань + тень).
   Здесь только рисование: никакой логики и никакого DOM.
   ========================================================================== */
(function (global) {
  'use strict';
  const C = global.NOVA;
  const P = C.PALETTE;
  const TS = C.BALANCE.tileSize;
  const W = C.BALANCE.worldW;
  const H = C.BALANCE.worldH;

  const Art = {};

  // ── утилиты ──────────────────────────────────────────────────────────────
  Art.hash = function (x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    return (((h ^ (h >> 16)) >>> 0) / 4294967295);
  };

  Art.roundRect = function (ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  };

  Art.poly = function (ctx, pts, fill, stroke, lw) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
  };

  Art.toScreen = function (cam, view, wx, wy) {
    return {
      x: (wx - cam.x) * cam.zoom + view.w / 2,
      y: (wy - cam.y) * cam.zoom + view.h / 2
    };
  };

  Art.toWorld = function (cam, view, sx, sy) {
    return {
      x: (sx - view.w / 2) / cam.zoom + cam.x,
      y: (sy - view.h / 2) / cam.zoom + cam.y
    };
  };

  // ── земля ────────────────────────────────────────────────────────────────
  // Грунт рисуется один раз в offscreen-канвас мира (тайл = 2 px), поэтому
  // нет «шахматки»: цвет получается непрерывным, а не по тайлам.
  Art.groundCanvas = null;
  Art.GROUND_RES = 2;

  Art.buildGround = function (sim) {
    const w = W, h = H, R = Art.GROUND_RES;
    const cv = Art.createCanvas ? Art.createCanvas(w * R, h * R) : null;
    if (!cv) return null;
    const c = cv.getContext('2d');
    const img = c.createImageData(w * R, h * R);
    const hsh = (x, y, s) => {
      const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const lerp = (a, b, t) => a + (b - a) * t;
    const hex = (s2) => [parseInt(s2.slice(1, 3), 16), parseInt(s2.slice(3, 5), 16), parseInt(s2.slice(5, 7), 16)];
    const A = hex(P.ground.a), B = hex(P.ground.c), D = hex(P.ground.dirt);
    const SANDS = hex(P.ground.sand), WAT = hex(P.ground.water), WDEEP = hex(P.ground.waterDeep);

    for (let py = 0; py < h * R; py++) {
      for (let px = 0; px < w * R; px++) {
        const tx = Math.floor(px / R), ty = Math.floor(py / R);
        const i = ty * W + tx;
        const t = sim.tiles[i];
        let r, g, b;

        if (t === C.TILE.WATER) {
          const k = hsh(px * 0.7, py * 0.7, 3);
          r = lerp(WAT[0], WDEEP[0], k); g = lerp(WAT[1], WDEEP[1], k); b = lerp(WAT[2], WDEEP[2], k);
        } else {
          // крупные пятна + мелкий шум
          const n1 = hsh(Math.floor(tx / 3), Math.floor(ty / 3), 1);
          const n2 = hsh(Math.floor(tx / 1.5), Math.floor(ty / 1.5), 2);
          const n3 = hsh(px, py, 4);
          const k = n1 * 0.5 + n2 * 0.35 + n3 * 0.15;
          r = lerp(A[0], B[0], k); g = lerp(A[1], B[1], k); b = lerp(A[2], B[2], k);
          // проплешины грязи
          const dk = hsh(Math.floor(tx / 5), Math.floor(ty / 4), 7);
          if (dk > 0.72) {
            const m = (dk - 0.72) / 0.28 * 0.55;
            r = lerp(r, D[0], m); g = lerp(g, D[1], m); b = lerp(b, D[2], m);
          }
          // редкие песчаные пятна
          const sk = hsh(Math.floor(tx / 6), Math.floor(ty / 6), 11);
          if (sk > 0.86) {
            const m = (sk - 0.86) / 0.14 * 0.30;
            r = lerp(r, SANDS[0], m); g = lerp(g, SANDS[1], m); b = lerp(b, SANDS[2], m);
          }
        }
        const o = (py * w * R + px) * 4;
        img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    return cv;
  };

  Art.drawGround = function (ctx, sim, cam, view) {
    if (!Art.groundCanvas) Art.groundCanvas = Art.buildGround(sim);
    const halfW = view.w / (2 * cam.zoom), halfH = view.h / (2 * cam.zoom);
    const x0 = Math.max(0, Math.floor((cam.x - halfW) / TS) - 1);
    const x1 = Math.min(W - 1, Math.ceil((cam.x + halfW) / TS) + 1);
    const y0 = Math.max(0, Math.floor((cam.y - halfH) / TS) - 1);
    const y1 = Math.min(H - 1, Math.ceil((cam.y + halfH) / TS) + 1);

    if (Art.groundCanvas) {
      const tl = Art.toScreen(cam, view, 0, 0);
      const sx = tl.x, sy = tl.y;
      const sw = W * TS * cam.zoom, sh = H * TS * cam.zoom;
      // рисуем только видимую часть
      const vx = Math.max(0, sx), vy = Math.max(0, sy);
      const vx2 = Math.min(view.w, sx + sw), vy2 = Math.min(view.h, sy + sh);
      if (vx2 > vx && vy2 > vy) {
        const k = Art.groundCanvas.width / sw;
        ctx.drawImage(Art.groundCanvas,
          (vx - sx) * k, (vy - sy) * k, (vx2 - vx) * k, (vy2 - vy) * k,
          vx, vy, vx2 - vx, vy2 - vy);
      }
    }

    // объекты поверх грунта
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const i = ty * W + tx;
        const t = sim.tiles[i];
        const n = Art.hash(tx, ty);
        const p = Art.toScreen(cam, view, tx * TS, ty * TS);
        const s = TS * cam.zoom;
        if (t === C.TILE.ROCK) Art.drawRock(ctx, cam, view, tx, ty, n);
        else if (t === C.TILE.XENITE) Art.drawXenite(ctx, cam, view, tx, ty, n, sim.xeniteLeft[i]);
        else if (t === C.TILE.WATER && cam.zoom > 0.6) {
          // блик на воде
          const gl = Math.sin(tx * 1.7 + ty * 2.3) * 0.5 + 0.5;
          if (gl > 0.82) {
            ctx.fillStyle = 'rgba(150,200,210,0.10)';
            ctx.fillRect(p.x + s * 0.2, p.y + s * 0.3, s * 0.6, s * 0.18);
          }
        }
      }
    }

    // сетка
    if (cam.zoom > 0.75) {
      ctx.strokeStyle = P.ground.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let tx = x0; tx <= x1 + 1; tx++) {
        const p = Art.toScreen(cam, view, tx * TS, 0);
        ctx.moveTo(Math.round(p.x) + 0.5, 0);
        ctx.lineTo(Math.round(p.x) + 0.5, view.h);
      }
      for (let ty = y0; ty <= y1 + 1; ty++) {
        const p = Art.toScreen(cam, view, 0, ty * TS);
        ctx.moveTo(0, Math.round(p.y) + 0.5);
        ctx.lineTo(view.w, Math.round(p.y) + 0.5);
      }
      ctx.stroke();
    }
  };

  Art.drawRock = function (ctx, cam, view, tx, ty, n) {
    const s = TS * cam.zoom;
    const p = Art.toScreen(cam, view, tx * TS, ty * TS);
    const cx = p.x + s / 2, cy = p.y + s / 2;
    const r = s * 0.42;
    // тень
    ctx.fillStyle = 'rgba(20,18,12,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.18, cy + r * 0.34, r * 0.95, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    // тело
    const pts = [];
    const sides = 5 + Math.floor(n * 3);
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + n * 3;
      const rr = r * (0.7 + Art.hash(tx + i, ty) * 0.45);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8 - r * 0.25]);
    }
    Art.poly(ctx, pts, 'rgba(52,46,38,0.55)', 'rgba(30,26,20,0.5)', 1);
    Art.poly(ctx, pts.map((q) => [cx + (q[0] - cx) * 0.72, cy + (q[1] - cy) * 0.72 - r * 0.16]),
      '#6d6355', '#3a332a', Math.max(1, 1.6 * cam.zoom));
  };

  Art.drawXenite = function (ctx, cam, view, tx, ty, n, left) {
    const s = TS * cam.zoom;
    const p = Art.toScreen(cam, view, tx * TS, ty * TS);
    const cx = p.x + s / 2, cy = p.y + s / 2;
    const deplete = left <= 0;
    const size = s * (deplete ? 0.10 : 0.17 + n * 0.07);

    // тёмная «порода» под кристаллами — чтобы залежь читалась как ксенит, а не как техника
    ctx.fillStyle = 'rgba(24,26,16,0.42)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + size * 0.45, s * 0.34, s * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    const crystals = deplete ? 1 : 4;
    for (let k = 0; k < crystals; k++) {
      const ox = (Art.hash(tx * 7 + k, ty * 3) - 0.5) * size * 2.2;
      const oy = (Art.hash(tx * 3, ty * 7 + k) - 0.5) * size * 1.5;
      const hsize = size * (deplete ? 0.45 : 0.62 + Art.hash(tx + k, ty + k) * 0.4);
      const pts = [
        [cx + ox, cy + oy - hsize * 1.5],
        [cx + ox + hsize * 0.62, cy + oy - hsize * 0.1],
        [cx + ox, cy + oy + hsize * 0.42],
        [cx + ox - hsize * 0.62, cy + oy - hsize * 0.1]
      ];
      Art.poly(ctx, pts, deplete ? '#6b5a30' : P.xenite.core, '#3b2c0c', Math.max(1, cam.zoom * 1.5));
      Art.poly(ctx, [
        [cx + ox, cy + oy - hsize * 1.5],
        [cx + ox + hsize * 0.62, cy + oy - hsize * 0.1],
        [cx + ox, cy + oy + hsize * 0.05]
      ], deplete ? '#857347' : P.xenite.light, null, 0);
    }
  };

  // ── туман войны ──────────────────────────────────────────────────────────
  Art.fogCanvas = null;
  Art.drawFog = function (ctx, sim, cam, view) {
    if (!P.fog) return;
    // маленький канвас 1 пиксель = 1 тайл, растягиваем со сглаживанием → мягкие края
    if (!Art.fogCanvas) {
      if (typeof document !== 'undefined') Art.fogCanvas = document.createElement('canvas');
      else if (Art.createCanvas) Art.fogCanvas = Art.createCanvas(1, 1);
    }
    const small = Art.fogCanvas;
    if (!small) return;
    small.width = W; small.height = H;
    const sctx = small.getContext('2d');
    sctx.clearRect(0, 0, W, H);
    const img = sctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const vis = sim.visible[i];
      const exp = sim.explored[i];
      const a = vis ? 0 : exp ? 150 : 255;
      img.data[i * 4] = 6;
      img.data[i * 4 + 1] = 8;
      img.data[i * 4 + 2] = 10;
      img.data[i * 4 + 3] = a;
    }
    sctx.putImageData(img, 0, 0);

    const tl = Art.toScreen(cam, view, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, tl.x, tl.y, W * TS * cam.zoom, H * TS * cam.zoom);
  };

  // ── здания ───────────────────────────────────────────────────────────────
  Art.drawBuilding = function (ctx, sim, cam, view, b, selected, time) {
    const s = cam.zoom;
    const p = Art.toScreen(cam, view, b.x, b.y);
    const col = b.team === 'player' ? P.player : P.enemy;
    const r = b.def.radius * s;
    const lift = 10 * s; // «объём»: поднимаем верхнюю грань

    ctx.save();
    // тень
    ctx.fillStyle = 'rgba(18,16,12,0.34)';
    ctx.beginPath();
    ctx.ellipse(p.x + r * 0.28, p.y + r * 0.30, r * 1.05, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    const hit = b.hitFlash > 0;
    const body = hit ? '#ffffff' : col.main;
    const dark = hit ? '#dddddd' : col.dark;
    const light = hit ? '#ffffff' : col.light;

    if (b.type === 'commandCenter') Art.cmdCenter(ctx, p, r, lift, body, dark, light, col);
    else if (b.type === 'factory') Art.factory(ctx, p, r, lift, body, dark, light, col);
    else if (b.type === 'turret') Art.turret(ctx, p, r, lift, body, dark, light, col, b.facing, b.muzzle);
    else if (b.type === 'radar') Art.radar(ctx, p, r, lift, body, dark, light, col, time);

    // каркас, если строится
    if (!b.built) {
      const pr = Math.max(0, Math.min(1, b.progress));
      ctx.fillStyle = 'rgba(10,12,10,0.55)';
      ctx.fillRect(p.x - r * 0.95, p.y - r * 0.75, r * 1.9, r * 1.5);
      // заливка снизу вверх
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x - r * 0.95, p.y + r * 0.75 - r * 1.5 * pr, r * 1.9, r * 1.5 * pr);
      ctx.clip();
      ctx.globalAlpha = 0.9;
      Art.roundRect(ctx, p.x - r * 0.8, p.y - r * 0.7, r * 1.6, r * 1.4, 3 * s);
      ctx.fillStyle = col.dark;
      ctx.fill();
      ctx.restore();
      // штриховка каркаса
      ctx.strokeStyle = 'rgba(232,192,32,0.55)';
      ctx.lineWidth = Math.max(1, 1.2 * s);
      ctx.strokeRect(p.x - r * 0.95, p.y - r * 0.75, r * 1.9, r * 1.5);
      // полоска прогресса
      const bw = r * 1.9;
      ctx.fillStyle = 'rgba(20,22,18,0.8)';
      ctx.fillRect(p.x - bw / 2, p.y - r * 1.15, bw, 5 * s);
      ctx.fillStyle = P.ui.amber;
      ctx.fillRect(p.x - bw / 2, p.y - r * 1.15, bw * pr, 5 * s);
    }

    // полоса HP
    if (selected || b.hp < b.hpMax) {
      const bw = r * 2.0;
      const frac = Math.max(0, b.hp / b.hpMax);
      ctx.fillStyle = 'rgba(12,14,10,0.75)';
      ctx.fillRect(p.x - bw / 2, p.y - r * 1.45, bw, Math.max(3, 4 * s));
      ctx.fillStyle = frac > 0.35 ? P.player.hp : P.ui.red;
      ctx.fillRect(p.x - bw / 2, p.y - r * 1.45, bw * frac, Math.max(3, 4 * s));
    }

    if (selected) {
      ctx.strokeStyle = P.ui.green;
      ctx.lineWidth = Math.max(1.5, 2 * s);
      const bw = r * 1.9, bh = r * 1.6;
      Art.corners(ctx, p.x - bw, p.y - bh - lift, bw * 2, bh * 2, Math.max(5, 8 * s));
    }
    ctx.restore();
  };

  Art.corners = function (ctx, x, y, w, h, len) {
    ctx.beginPath();
    ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
    ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
    ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
    ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
    ctx.stroke();
  };

  Art.cmdCenter = function (ctx, p, r, lift, body, dark, light, col) {
    // основание
    Art.poly(ctx, [
      [p.x - r, p.y + r * 0.5], [p.x + r, p.y + r * 0.5],
      [p.x + r * 0.92, p.y - r * 0.1 - lift], [p.x - r * 0.92, p.y - r * 0.1 - lift]
    ], dark, '#211d17', 1.5);
    // основной блок
    Art.poly(ctx, [
      [p.x - r * 0.82, p.y - r * 0.05 - lift], [p.x + r * 0.82, p.y - r * 0.05 - lift],
      [p.x + r * 0.82, p.y - r * 0.28 - lift * 1.6], [p.x - r * 0.82, p.y - r * 0.28 - lift * 1.6]
    ], body, '#191f22', 1.5);
    // верхняя площадка
    Art.poly(ctx, [
      [p.x - r * 0.72, p.y - r * 0.30 - lift * 1.6], [p.x + r * 0.72, p.y - r * 0.30 - lift * 1.6],
      [p.x + r * 0.58, p.y - r * 0.62 - lift * 2.1], [p.x - r * 0.58, p.y - r * 0.62 - lift * 2.1]
    ], light, '#191f22', 1.5);
    // антенна-тарелка
    ctx.strokeStyle = '#2a2420';
    ctx.lineWidth = Math.max(1, 1.4);
    ctx.beginPath();
    ctx.moveTo(p.x + r * 0.2, p.y - r * 0.6 - lift * 2);
    ctx.lineTo(p.x + r * 0.2, p.y - r * 1.15 - lift * 2);
    ctx.stroke();
    ctx.fillStyle = '#8d9095';
    ctx.beginPath();
    ctx.ellipse(p.x + r * 0.2, p.y - r * 1.15 - lift * 1.9, r * 0.2, r * 0.11, -0.5, 0, Math.PI * 2);
    ctx.fill();
    // полоса команды
    ctx.fillStyle = col.main;
    ctx.fillRect(p.x - r * 0.82, p.y - r * 0.2 - lift * 1.1, r * 1.64, Math.max(2, r * 0.09));
    // вентиляция
    ctx.strokeStyle = 'rgba(20,24,20,0.5)';
    ctx.lineWidth = 1;
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(p.x + i * r * 0.28, p.y - r * 0.4 - lift * 1.7);
      ctx.lineTo(p.x + i * r * 0.28, p.y - r * 0.24 - lift * 1.5);
      ctx.stroke();
    }
  };

  Art.factory = function (ctx, p, r, lift, body, dark, light, col) {
    Art.poly(ctx, [
      [p.x - r, p.y + r * 0.55], [p.x + r, p.y + r * 0.55],
      [p.x + r * 0.9, p.y - r * 0.25 - lift], [p.x - r * 0.9, p.y - r * 0.25 - lift]
    ], dark, '#211d17', 1.5);
    Art.poly(ctx, [
      [p.x - r * 0.9, p.y - r * 0.2 - lift], [p.x + r * 0.9, p.y - r * 0.2 - lift],
      [p.x + r * 0.72, p.y - r * 0.75 - lift * 2], [p.x - r * 0.72, p.y - r * 0.75 - lift * 2]
    ], body, '#191f22', 1.5);
    // труба
    Art.poly(ctx, [
      [p.x + r * 0.35, p.y - r * 0.72 - lift * 2], [p.x + r * 0.58, p.y - r * 0.72 - lift * 2],
      [p.x + r * 0.52, p.y - r * 1.25 - lift * 2], [p.x + r * 0.41, p.y - r * 1.25 - lift * 2]
    ], '#4a4440', '#201c18', 1.2);
    // ворота
    Art.poly(ctx, [
      [p.x - r * 0.55, p.y + r * 0.1 - lift], [p.x + r * 0.05, p.y + r * 0.1 - lift],
      [p.x + r * 0.05, p.y + r * 0.45], [p.x - r * 0.55, p.y + r * 0.45]
    ], '#20262a', '#151a1c', 1.2);
    // кран
    ctx.strokeStyle = '#6a6357';
    ctx.lineWidth = Math.max(1.2, r * 0.08);
    ctx.beginPath();
    ctx.moveTo(p.x - r * 0.2, p.y - r * 0.7 - lift * 2);
    ctx.lineTo(p.x - r * 0.85, p.y - r * 1.05 - lift * 2);
    ctx.stroke();
    ctx.fillStyle = col.main;
    ctx.fillRect(p.x - r * 0.9, p.y - r * 0.6 - lift * 1.9, r * 0.3, Math.max(2, r * 0.1));
  };

  Art.turret = function (ctx, p, r, lift, body, dark, light, col, facing, muzzle) {
    // база
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + r * 0.15, r * 0.95, r * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1c1813';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    // ствол
    const a = facing;
    ctx.save();
    ctx.translate(p.x, p.y - r * 0.2 - lift);
    ctx.rotate(a);
    ctx.fillStyle = '#3b3a35';
    ctx.fillRect(0, -r * 0.11, r * 1.25, r * 0.22);
    if (muzzle > 0) {
      ctx.fillStyle = P.fire.b;
      ctx.beginPath();
      ctx.arc(r * 1.3, 0, r * 0.26, 0, Math.PI * 2);
      ctx.fill();
    }
    // корпус башни
    Art.roundRect(ctx, -r * 0.55, -r * 0.45, r * 1.1, r * 0.9, r * 0.2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = '#161b1d';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = col.light;
    ctx.fillRect(-r * 0.2, -r * 0.1, r * 0.4, r * 0.2);
    ctx.restore();
  };

  Art.radar = function (ctx, p, r, lift, body, dark, light, col, time) {
    ctx.fillStyle = dark;
    Art.roundRect(ctx, p.x - r * 0.8, p.y - r * 0.1, r * 1.6, r * 0.75, r * 0.15);
    ctx.fill();
    ctx.strokeStyle = '#1a1f21';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.strokeStyle = '#5c5850';
    ctx.lineWidth = Math.max(1.2, r * 0.1);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - r * 0.1);
    ctx.lineTo(p.x, p.y - r * 1.1 - lift);
    ctx.stroke();
    // вращающаяся тарелка
    ctx.save();
    ctx.translate(p.x, p.y - r * 1.05 - lift);
    ctx.rotate(time * 1.2);
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.55, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1a1f21';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = col.main;
    ctx.fillRect(p.x - r * 0.8, p.y + r * 0.3, r * 1.6, Math.max(2, r * 0.1));
  };

  // ── юниты ────────────────────────────────────────────────────────────────
  Art.drawUnit = function (ctx, cam, view, u, selected, time) {
    const s = cam.zoom;
    const p = Art.toScreen(cam, view, u.x, u.y);
    const col = u.team === 'player' ? P.player : P.enemy;
    const r = u.radius * s;
    const hit = u.hitFlash > 0;
    const body = hit ? '#ffffff' : col.main;
    const dark = hit ? '#dedede' : col.dark;

    ctx.save();
    // подложка цвета команды — главный признак «свой/чужой» на маленьком экране
    ctx.fillStyle = u.team === 'player' ? 'rgba(74,107,138,0.34)' : 'rgba(163,74,58,0.34)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + r * 0.22, r * 1.15, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = u.team === 'player' ? 'rgba(123,163,196,0.55)' : 'rgba(205,122,99,0.6)';
    ctx.lineWidth = Math.max(1, 1.3 * s);
    ctx.stroke();
    // тень
    ctx.fillStyle = 'rgba(16,14,10,0.28)';
    ctx.beginPath();
    ctx.ellipse(p.x + r * 0.22, p.y + r * 0.34, r * 0.85, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(p.x, p.y);
    if (u.moving) ctx.rotate(u.facing + Math.PI / 2);

    const type = u.type;
    if (type === 'harvester') {
      // корпус-кювета
      Art.roundRect(ctx, -r * 0.85, -r * 0.95, r * 1.7, r * 1.9, r * 0.28);
      ctx.fillStyle = body; ctx.fill();
      ctx.strokeStyle = '#191d20'; ctx.lineWidth = Math.max(1, 1.3 * s); ctx.stroke();
      // бункер
      Art.roundRect(ctx, -r * 0.55, -r * 0.45, r * 1.1, r * 1.0, r * 0.12);
      ctx.fillStyle = u.carrying > 0 ? P.xenite.core : dark; ctx.fill();
      ctx.strokeStyle = '#191d20'; ctx.lineWidth = 1; ctx.stroke();
      // колёса
      ctx.fillStyle = '#2c2a24';
      ctx.fillRect(-r * 1.05, -r * 0.62, r * 0.28, r * 1.3);
      ctx.fillRect(r * 0.77, -r * 0.62, r * 0.28, r * 1.3);
      // бур
      ctx.fillStyle = '#8a8578';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.95); ctx.lineTo(r * 0.3, -r * 0.55); ctx.lineTo(-r * 0.3, -r * 0.55);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#2a2620'; ctx.stroke();
    } else if (type === 'rifleman') {
      // отделение: три крупные фигуры, у каждой светлый ранок и тёмный ствол
      for (let i = 0; i < 3; i++) {
        const ox = (i - 1) * r * 0.86;
        const oy = i === 1 ? -r * 0.6 : r * 0.3;
        ctx.save();
        ctx.translate(ox, oy);
        // корпус
        Art.roundRect(ctx, -r * 0.38, -r * 0.4, r * 0.76, r * 0.86, r * 0.2);
        ctx.fillStyle = i === 1 ? col.light : body;
        ctx.fill();
        ctx.strokeStyle = '#10141a';
        ctx.lineWidth = Math.max(1.1, 1.5 * s);
        ctx.stroke();
        // «ранец» — светлое пятно сверху
        ctx.fillStyle = u.team === 'player' ? '#a8ccе8' : '#f0b6a0';
        ctx.fillStyle = u.team === 'player' ? '#a8cce8' : '#f0b6a0';
        Art.roundRect(ctx, -r * 0.22, -r * 0.28, r * 0.44, r * 0.3, r * 0.08);
        ctx.fill();
        // ствол
        ctx.strokeStyle = '#0d1116';
        ctx.lineWidth = Math.max(1.4, 1.9 * s);
        ctx.beginPath(); ctx.moveTo(0, -r * 0.42); ctx.lineTo(0, -r * 1.02); ctx.stroke();
        if (i === 1 && u.muzzle > 0) {
          ctx.fillStyle = P.fire.b;
          ctx.beginPath(); ctx.arc(0, -r * 1.12, r * 0.3, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    } else if (type === 'hammer') {
      // гусеницы
      ctx.fillStyle = '#2b2a26';
      ctx.fillRect(-r * 1.0, -r * 0.9, r * 0.42, r * 1.85);
      ctx.fillRect(r * 0.58, -r * 0.9, r * 0.42, r * 1.85);
      // корпус
      Art.poly(ctx, [
        [-r * 0.62, -r * 0.85], [r * 0.62, -r * 0.85], [r * 0.72, r * 0.9], [-r * 0.72, r * 0.9]
      ], body, '#151a1d', Math.max(1, 1.4 * s));
      // башня
      ctx.fillStyle = col.light;
      ctx.beginPath(); ctx.arc(0, -r * 0.05, r * 0.44, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#151a1d'; ctx.lineWidth = Math.max(1, 1.2 * s); ctx.stroke();
      // ствол
      ctx.fillStyle = '#37352f';
      ctx.fillRect(-r * 0.12, -r * 1.35, r * 0.24, r * 1.3);
      if (u.muzzle > 0) {
        ctx.fillStyle = P.fire.b;
        ctx.beginPath(); ctx.arc(0, -r * 1.4, r * 0.32, 0, Math.PI * 2); ctx.fill();
      }
    } else if (type === 'groza') {
      Art.poly(ctx, [
        [-r * 0.7, -r * 0.6], [r * 0.7, -r * 0.6], [r * 0.85, r * 1.0], [-r * 0.85, r * 1.0]
      ], body, '#151a1d', Math.max(1, 1.4 * s));
      ctx.fillStyle = '#3a3830';
      ctx.fillRect(-r * 0.18, -r * 1.75, r * 0.36, r * 1.5);
      ctx.fillStyle = col.light;
      ctx.fillRect(-r * 0.6, -r * 0.1, r * 1.2, r * 0.22);
      // опоры
      ctx.strokeStyle = '#2b2a24'; ctx.lineWidth = Math.max(1, 1.3 * s);
      ctx.beginPath();
      ctx.moveTo(-r * 0.6, r * 0.95); ctx.lineTo(-r * 0.9, r * 1.35);
      ctx.moveTo(r * 0.6, r * 0.95); ctx.lineTo(r * 0.9, r * 1.35);
      ctx.stroke();
    } else if (type === 'osa') {
      const glow = 0.35 + Math.sin(time * 6 + u.id) * 0.12;
      ctx.fillStyle = 'rgba(120,220,230,' + glow.toFixed(2) + ')';
      ctx.beginPath(); ctx.ellipse(0, r * 0.55, r * 0.95, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
      Art.poly(ctx, [
        [0, -r * 1.25], [r * 0.62, -r * 0.15], [r * 0.42, r * 0.85], [-r * 0.42, r * 0.85], [-r * 0.62, -r * 0.15]
      ], body, '#151a1d', Math.max(1, 1.4 * s));
      ctx.fillStyle = col.light;
      Art.poly(ctx, [[0, -r * 0.85], [r * 0.3, -r * 0.1], [-r * 0.3, -r * 0.1]], col.light, null, 0);
      ctx.fillStyle = '#2d2b26';
      ctx.fillRect(-r * 0.1, -r * 1.5, r * 0.2, r * 0.6);
    }
    ctx.restore();

    // маркер выбранного
    if (selected) {
      ctx.strokeStyle = P.ui.green;
      ctx.lineWidth = Math.max(1.4, 1.8 * s);
      Art.corners(ctx, p.x - r * 1.35, p.y - r * 1.5, r * 2.7, r * 2.7, Math.max(4, 7 * s));
    }

    // HP
    if (u.hp < u.hpMax || selected) {
      const bw = r * 2.2;
      const frac = Math.max(0, u.hp / u.hpMax);
      ctx.fillStyle = 'rgba(12,14,10,0.72)';
      ctx.fillRect(p.x - bw / 2, p.y - r * 1.85, bw, Math.max(3, 3.5 * s));
      ctx.fillStyle = frac > 0.35 ? P.player.hp : P.ui.red;
      ctx.fillRect(p.x - bw / 2, p.y - r * 1.85, bw * frac, Math.max(3, 3.5 * s));
    }
    ctx.restore();
  };

  // ── снаряды и эффекты ────────────────────────────────────────────────────
  Art.drawProjectiles = function (ctx, sim, cam, view) {
    for (const p of sim.projectiles) {
      const a = Art.toScreen(cam, view, p.x, p.y);
      const b = Art.toScreen(cam, view, p.tx, p.ty);
      const k = 1 - p.life / p.max;
      const x = a.x + (b.x - a.x) * k;
      const y = a.y + (b.y - a.y) * k;
      ctx.strokeStyle = p.team === 'player' ? 'rgba(255,232,150,0.95)' : 'rgba(255,170,120,0.95)';
      ctx.lineWidth = Math.max(1.5, 2.2 * cam.zoom);
      ctx.beginPath();
      ctx.moveTo(x - (b.x - a.x) * 0.08, y - (b.y - a.y) * 0.08);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = P.fire.b;
      ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, 2 * cam.zoom), 0, Math.PI * 2); ctx.fill();
    }
  };

  Art.drawEffects = function (ctx, sim, cam, view) {
    for (const e of sim.effects) {
      const p = Art.toScreen(cam, view, e.x, e.y);
      const k = 1 - e.life / e.max;
      if (e.type === 'boom') {
        const r = (e.big ? 46 : 26) * cam.zoom * (0.45 + k * 0.9);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, 'rgba(255,240,180,' + (1 - k) + ')');
        g.addColorStop(0.35, 'rgba(255,160,40,' + (0.9 - k * 0.8) + ')');
        g.addColorStop(0.75, 'rgba(150,70,20,' + (0.5 - k * 0.45) + ')');
        g.addColorStop(1, 'rgba(40,30,24,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        // чёрные клубы дыма
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + e.x;
          const rr = r * (0.4 + k * 0.7);
          ctx.fillStyle = 'rgba(40,36,32,' + (0.35 * (1 - k)) + ')';
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr * 0.8, r * 0.34 * (1 - k * 0.5), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (e.type === 'hit') {
        ctx.fillStyle = 'rgba(255,220,140,' + (1 - k) + ')';
        ctx.font = 'bold ' + Math.round(11 * cam.zoom) + 'px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(e.text, p.x, p.y - k * 18);
      } else if (e.type === 'depleted') {
        ctx.strokeStyle = 'rgba(220,180,90,' + (1 - k) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(p.x, p.y, 14 * cam.zoom * (1 + k), 0, Math.PI * 2); ctx.stroke();
      }
    }
  };

  Art.drawSelectionLine = function (ctx, cam, view, u, order) {
    if (!order || order.type === 'idle') return;
    if (order.x === undefined || order.y === undefined) return;
    const a = Art.toScreen(cam, view, u.x, u.y);
    const b = Art.toScreen(cam, view, order.x, order.y);
    ctx.strokeStyle = 'rgba(125,220,60,0.35)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(125,220,60,0.6)';
    ctx.beginPath(); ctx.arc(b.x, b.y, 7, 0, Math.PI * 2); ctx.stroke();
  };

  global.Art = Art;
})(typeof window !== 'undefined' ? window : globalThis);
