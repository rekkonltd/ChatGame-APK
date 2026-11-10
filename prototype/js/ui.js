/* ==========================================================================
   THAN-DOR — интерфейс: стальная консоль, перевёрстанная под палец
   Единственное место, где есть DOM. Всё рисуется на канвасе, чтобы прототип
   в браузере и в Godot-версии выглядели одинаково.
   ========================================================================== */
(function (global) {
  'use strict';
  const C = global.NOVA;
  const P = C.PALETTE;
  const A = global.Art;
  const UI = {};

  const FONT = '"Barlow Condensed", "Roboto Condensed", system-ui, sans-serif';

  // ── примитивы консоли ────────────────────────────────────────────────────
  UI.panel = function (ctx, x, y, w, h, opts) {
    const o = opts || {};
    ctx.save();
    // тень панели
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    A.roundRect(ctx, x + 2, y + 3, w, h, o.r || 4);
    ctx.fill();
    // тело
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, o.top || '#41474e');
    g.addColorStop(1, o.bottom || '#2c3035');
    A.roundRect(ctx, x, y, w, h, o.r || 4);
    ctx.fillStyle = g;
    ctx.fill();
    // фаски
    ctx.lineWidth = 1;
    A.roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, o.r || 4);
    ctx.strokeStyle = P.ui.bevelLight;
    ctx.stroke();
    A.roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(1, (o.r || 4) - 1));
    ctx.strokeStyle = P.ui.bevelDark;
    ctx.stroke();
    // миллиметровая сетка
    if (o.grid !== false) {
      ctx.save();
      A.roundRect(ctx, x + 2, y + 2, w - 4, h - 4, Math.max(1, (o.r || 4) - 1));
      ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.035)';
      ctx.lineWidth = 1;
      for (let gx = x + 2; gx < x + w; gx += 8) {
        ctx.beginPath(); ctx.moveTo(gx + 0.5, y); ctx.lineTo(gx + 0.5, y + h); ctx.stroke();
      }
      for (let gy = y + 2; gy < y + h; gy += 8) {
        ctx.beginPath(); ctx.moveTo(x, gy + 0.5); ctx.lineTo(x + w, gy + 0.5); ctx.stroke();
      }
      ctx.restore();
    }
    // винты по углам
    if (o.screws !== false) {
      const ins = 6;
      for (const [sx, sy] of [[x + ins, y + ins], [x + w - ins, y + ins], [x + ins, y + h - ins], [x + w - ins, y + h - ins]]) {
        ctx.fillStyle = '#1c2024';
        ctx.beginPath(); ctx.arc(sx, sy, 2.2, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#6a7078'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx - 1.4, sy); ctx.lineTo(sx + 1.4, sy); ctx.stroke();
      }
    }
    ctx.restore();
  };

  UI.inset = function (ctx, x, y, w, h, r) {
    A.roundRect(ctx, x, y, w, h, r || 3);
    ctx.fillStyle = '#1b1f23';
    ctx.fill();
    ctx.strokeStyle = '#15181b';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    A.roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(1, (r || 3) - 1));
    ctx.strokeStyle = 'rgba(120,128,138,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  UI.text = function (ctx, str, x, y, size, color, align, weight) {
    ctx.font = (weight || 600) + ' ' + size + 'px ' + FONT;
    ctx.fillStyle = color || P.ui.text;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(str, x, y);
  };

  // ── кнопка-плитка ────────────────────────────────────────────────────────
  UI.tile = function (ctx, r, state, draw) {
    const { x, y, w, h } = r;
    const disabled = !!state.disabled;
    const locked = !!state.locked;
    const active = !!state.active;
    const pressed = !!state.pressed;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    A.roundRect(ctx, x + 1.5, y + 2.5, w, h, 3);
    ctx.fill();

    const g = ctx.createLinearGradient(0, y, 0, y + h);
    if (active) { g.addColorStop(0, '#4d5b52'); g.addColorStop(1, '#333d36'); }
    else if (disabled || locked) { g.addColorStop(0, '#2a2e33'); g.addColorStop(1, '#202327'); }
    else { g.addColorStop(0, pressed ? '#343a40' : '#4a5058'); g.addColorStop(1, pressed ? '#282c31' : '#363b41'); }

    A.roundRect(ctx, x, y, w, h, 3);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = disabled || locked ? '#3c4147' : P.ui.bevelLight;
    ctx.lineWidth = 1;
    ctx.stroke();
    A.roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.stroke();

    if (draw) draw(ctx, r, disabled || locked);
    ctx.restore();
  };

  // ── иконки юнитов (плоские силуэты в духе игры) ──────────────────────────
  UI.icon = function (ctx, type, cx, cy, size, team, dim) {
    const col = team === 'enemy' ? P.enemy : P.player;
    ctx.save();
    ctx.translate(cx, cy);
    const r = size / 2;
    ctx.globalAlpha = dim ? 0.42 : 1;
    const body = dim ? '#5b6167' : col.main;
    const dark = dim ? '#42474c' : col.dark;
    const light = dim ? '#6b7178' : col.light;

    if (type === 'harvester') {
      A.roundRect(ctx, -r * 0.7, -r * 0.78, r * 1.4, r * 1.56, r * 0.2);
      ctx.fillStyle = body; ctx.fill(); ctx.strokeStyle = '#1a1e21'; ctx.lineWidth = 1.2; ctx.stroke();
      A.roundRect(ctx, -r * 0.42, -r * 0.34, r * 0.84, r * 0.8, r * 0.1);
      ctx.fillStyle = P.xenite.core; ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2c2a24';
      ctx.fillRect(-r * 0.86, -r * 0.5, r * 0.22, r * 1.05);
      ctx.fillRect(r * 0.64, -r * 0.5, r * 0.22, r * 1.05);
    } else if (type === 'rifleman') {
      for (let i = 0; i < 3; i++) {
        const ox = (i - 1) * r * 0.56, oy = i === 1 ? -r * 0.4 : r * 0.2;
        A.roundRect(ctx, ox - r * 0.22, oy - r * 0.26, r * 0.44, r * 0.56, r * 0.12);
        ctx.fillStyle = i === 1 ? body : dark; ctx.fill();
        ctx.strokeStyle = '#1a1e21'; ctx.lineWidth = 1; ctx.stroke();
        ctx.strokeStyle = '#20241f'; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(ox, oy - r * 0.26); ctx.lineTo(ox, oy - r * 0.66); ctx.stroke();
      }
    } else if (type === 'hammer') {
      ctx.fillStyle = '#2b2a26';
      ctx.fillRect(-r * 0.82, -r * 0.72, r * 0.34, r * 1.5);
      ctx.fillRect(r * 0.48, -r * 0.72, r * 0.34, r * 1.5);
      A.poly(ctx, [[-r * 0.5, -r * 0.68], [r * 0.5, -r * 0.68], [r * 0.58, r * 0.74], [-r * 0.58, r * 0.74]], body, '#151a1d', 1.3);
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.arc(0, -r * 0.04, r * 0.34, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#37352f';
      ctx.fillRect(-r * 0.09, -r * 1.1, r * 0.18, r * 1.05);
    } else if (type === 'groza') {
      A.poly(ctx, [[-r * 0.56, -r * 0.48], [r * 0.56, -r * 0.48], [r * 0.68, r * 0.8], [-r * 0.68, r * 0.8]], body, '#151a1d', 1.3);
      ctx.fillStyle = '#3a3830';
      ctx.fillRect(-r * 0.15, -r * 1.4, r * 0.3, r * 1.2);
      ctx.fillStyle = light;
      ctx.fillRect(-r * 0.48, -r * 0.08, r * 0.96, r * 0.18);
      ctx.strokeStyle = '#2b2a24'; ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(-r * 0.48, r * 0.76); ctx.lineTo(-r * 0.72, r * 1.1);
      ctx.moveTo(r * 0.48, r * 0.76); ctx.lineTo(r * 0.72, r * 1.1);
      ctx.stroke();
    } else if (type === 'osa') {
      A.poly(ctx, [[0, -r * 1.0], [r * 0.5, -r * 0.12], [r * 0.34, r * 0.7], [-r * 0.34, r * 0.7], [-r * 0.5, -r * 0.12]], body, '#151a1d', 1.3);
      ctx.fillStyle = 'rgba(120,220,230,0.35)';
      ctx.beginPath(); ctx.ellipse(0, r * 0.45, r * 0.7, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
      A.poly(ctx, [[0, -r * 0.66], [r * 0.24, -r * 0.08], [-r * 0.24, -r * 0.08]], light, null, 0);
    } else if (type === 'factory') {
      A.poly(ctx, [[-r * 0.8, r * 0.5], [r * 0.8, r * 0.5], [r * 0.7, -r * 0.3], [-r * 0.7, -r * 0.3]], body, '#151a1d', 1.3);
      ctx.fillStyle = '#4a4440';
      ctx.fillRect(r * 0.3, -r * 0.95, r * 0.2, r * 0.68);
      ctx.fillStyle = '#20262a';
      ctx.fillRect(-r * 0.5, r * 0.0, r * 0.5, r * 0.35);
      ctx.strokeStyle = '#6a6357'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-r * 0.16, -r * 0.28); ctx.lineTo(-r * 0.72, -r * 0.62); ctx.stroke();
    } else if (type === 'turret') {
      ctx.fillStyle = dark;
      ctx.beginPath(); ctx.ellipse(0, r * 0.14, r * 0.76, r * 0.46, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#1a1e21'; ctx.lineWidth = 1.2; ctx.stroke();
      A.roundRect(ctx, -r * 0.42, -r * 0.36, r * 0.84, r * 0.72, r * 0.16);
      ctx.fillStyle = body; ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#3b3a35';
      ctx.fillRect(0, -r * 0.09, r * 1.02, r * 0.18);
    } else if (type === 'radar') {
      A.roundRect(ctx, -r * 0.66, 0, r * 1.32, r * 0.6, r * 0.14);
      ctx.fillStyle = dark; ctx.fill(); ctx.strokeStyle = '#1a1e21'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.strokeStyle = '#5c5850'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 0.7); ctx.stroke();
      ctx.fillStyle = light;
      ctx.beginPath(); ctx.ellipse(0, -r * 0.72, r * 0.5, r * 0.2, -0.5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#1a1e21'; ctx.lineWidth = 1; ctx.stroke();
    } else if (type === 'commandCenter') {
      A.poly(ctx, [[-r * 0.8, r * 0.55], [r * 0.8, r * 0.55], [r * 0.74, -r * 0.2], [-r * 0.74, -r * 0.2]], dark, '#151a1d', 1.3);
      A.poly(ctx, [[-r * 0.66, -r * 0.18], [r * 0.66, -r * 0.18], [r * 0.5, -r * 0.62], [-r * 0.5, -r * 0.62]], body, '#151a1d', 1.3);
      ctx.strokeStyle = '#2a2420'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(r * 0.16, -r * 0.6); ctx.lineTo(r * 0.16, -r * 1.0); ctx.stroke();
      ctx.fillStyle = '#8d9095';
      ctx.beginPath(); ctx.ellipse(r * 0.16, -r * 1.0, r * 0.17, r * 0.09, -0.5, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'tech') {
      // шестерёнка-схема
      ctx.strokeStyle = dim ? '#5b6167' : P.ui.amber;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.42, Math.sin(a) * r * 0.42);
        ctx.lineTo(Math.cos(a) * r * 0.66, Math.sin(a) * r * 0.66);
        ctx.stroke();
      }
      ctx.beginPath(); ctx.arc(0, 0, r * 0.14, 0, Math.PI * 2); ctx.stroke();
    } else if (type === 'army') {
      // скрещённые шевроны
      ctx.strokeStyle = dim ? '#5b6167' : P.ui.green;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-r * 0.55, r * 0.4); ctx.lineTo(0, -r * 0.45); ctx.lineTo(r * 0.55, r * 0.4);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, r * 0.75); ctx.lineTo(0, r * 0.1); ctx.lineTo(r * 0.4, r * 0.75);
      ctx.stroke();
    }
    ctx.restore();
  };

  // ── мини-превью «чертёж» для карточки выбранного ──────────────────────────
  UI.blueprint = function (ctx, type, x, y, w, h, team) {
    ctx.save();
    UI.inset(ctx, x, y, w, h, 3);
    ctx.save();
    A.roundRect(ctx, x, y, w, h, 3);
    ctx.clip();
    // сетка чертежа
    ctx.strokeStyle = 'rgba(120,170,190,0.11)';
    ctx.lineWidth = 1;
    for (let gx = x + 4; gx < x + w; gx += 9) {
      ctx.beginPath(); ctx.moveTo(gx + 0.5, y); ctx.lineTo(gx + 0.5, y + h); ctx.stroke();
    }
    for (let gy = y + 4; gy < y + h; gy += 9) {
      ctx.beginPath(); ctx.moveTo(x, gy + 0.5); ctx.lineTo(x + w, gy + 0.5); ctx.stroke();
    }
    UI.icon(ctx, type, x + w / 2, y + h / 2 + 1, Math.min(w, h) * 0.78, team || 'player', false);
    ctx.restore();
    ctx.restore();
  };

  // ── полоса ресурса ───────────────────────────────────────────────────────
  UI.bar = function (ctx, x, y, w, h, frac, color, back) {
    ctx.fillStyle = back || '#171a1d';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(0, Math.min(1, frac)) * w, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  };

  // ── экранное меню / результат ────────────────────────────────────────────
  UI.printLayout = function (ctx, view) {
    const L = {
      status: { x: 0, y: 0, w: view.w, h: 50 },
      card: { x: 0, y: view.h - 292, w: view.w, h: 96 },
      tabs: { x: 0, y: view.h - 196, w: view.w, h: 34 },
      grid: { x: 0, y: view.h - 162, w: view.w, h: 108 },
      actions: { x: 0, y: view.h - 52, w: view.w, h: 52 },
      field: { x: 0, y: 50, w: view.w, h: view.h - 342 }
    };
    return L;
  };

  global.UI = UI;
})(typeof window !== 'undefined' ? window : globalThis);
