/* ==========================================================================
   THAN-DOR — точка входа: масштабирование канваса, цикл кадров, звук
   ========================================================================== */
(function () {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const VW = 390, VH = 844;

  // ── разрешение: рисуем в CSS-пикселях телефона с учётом DPR ───────────────
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const w = Math.max(320, Math.round(rect.width));
    const h = Math.max(480, Math.round(rect.height));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  // логический размер канваса = CSS-размер, поэтому дальше работаем в CSS-px
  const game = new window.Game(canvas, { onAnnounce: () => {} });
  game.viewSize = function () {
    const r = canvas.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };
  game.resize = resize;

  window.__game = game;      // для отладки и автотестов
  game.bindInput();
  game.focusOn(window.NOVA.LEVEL.playerHC.tx * 48, window.NOVA.LEVEL.playerHC.ty * 48);

  // ── звук: записанные реплики + синтезированные сигналы ──────────────────
  const VOICE_DIR = 'audio/';
  const clips = {
    start: '01-announcer-start',
    wave: '02-announcer-wave',
    base: '03-announcer-base',
    victory: '04-announcer-victory',
    yes: '05-unit-yes',
    attack: '06-unit-attack',
    harvest: '07-unit-harvest',
    underfire: '08-unit-underfire'
  };
  const buffers = {};
  const audioCtxState = { ctx: null, muted: false, voicesOn: true };

  function audio() {
    if (!audioCtxState.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      audioCtxState.ctx = new AC();
    }
    if (audioCtxState.ctx.state === 'suspended') audioCtxState.ctx.resume();
    return audioCtxState.ctx;
  }

  // на мобиле AudioContext нельзя запускать до касания — ждём первого жеста
  let unlocked = false;
  let clipsLoaded = false;
  function loadClip(key) {
    const file = clips[key];
    if (!file) return;
    fetch(VOICE_DIR + file + '.mp3')
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((ab) => {
        if (!ab) return;
        const a = audio();
        if (!a) return;
        try {
          a.decodeAudioData(ab, (buf) => { buffers[key] = buf; }, () => {});
        } catch (e) { /* старый WebView без промисов — молчим */ }
      })
      .catch(() => {});
  }
  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    const a = audio();
    if (a && a.state === 'suspended') a.resume();
    if (!clipsLoaded) {
      clipsLoaded = true;
      Object.keys(clips).forEach((k) => { if (!buffers[k]) loadClip(k); });
    }
  }
  ['pointerdown', 'touchstart', 'click'].forEach((ev) =>
    window.addEventListener(ev, unlockAudio, { passive: true }));

  // реплики грузятся по первому касанию — иначе мобильный браузер блокирует звук

  let lastVoiceAt = 0;
  function playVoice(key, minGap) {
    if (!audioCtxState.voicesOn || audioCtxState.muted) return;
    const buf = buffers[key];
    if (!buf || !buf.duration) return;
    const now = performance.now();
    if (now - lastVoiceAt < (minGap === undefined ? 1200 : minGap)) return;
    lastVoiceAt = now;
    const a = audio();
    const src = a.createBufferSource();
    const g = a.createGain();
    src.buffer = buf;
    g.gain.value = 0.9;
    src.connect(g).connect(a.destination);
    src.start();
  }

  function beep(freq, dur, type, gain) {
    const a = audio();
    if (!a || audioCtxState.muted) return;
    const o = a.createOscillator();
    const g = a.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    g.gain.value = 0.0001;
    o.connect(g).connect(a.destination);
    const t = a.currentTime;
    g.gain.exponentialRampToValueAtTime(gain || 0.045, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // анонсер по событиям
  const announceMap = {
    'Высадка завершена. Начинаем операцию': 'start',
    'Обнаружено движение противника': 'wave',
    'База атакована': 'base',
    'Голраты отступают. Победа за нами': 'victory'
  };
  game.opts.onAnnounce = function (text) {
    const key = announceMap[text];
    if (key) playVoice(key, 500);
    beep(360, 0.1, 'sine', 0.04);
  };

  // реплики юнитов на приказ
  game.opts.onOrder = function (mode) {
    if (mode === 'attack') playVoice('attack', 1500);
    else if (mode === 'harvest') playVoice('harvest', 1800);
    else playVoice('yes', 1400);
  };

  const origFlash = game.flash.bind(game);
  game.flash = function (text, kind) {
    origFlash(text, kind);
    if (kind === 'warn') beep(180, 0.1, 'square', 0.04);
    else beep(900, 0.04, 'triangle', 0.02);
  };

  // кнопка «звук» — клавиша M
  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M' || e.key === 'ь') {
      audioCtxState.muted = !audioCtxState.muted;
      game.flash(audioCtxState.muted ? 'Звук выключен' : 'Звук включён');
    }
  });

  // ── цикл кадров ──────────────────────────────────────────────────────────
  let last = performance.now();
  const turbo = document.getElementById('turbo');
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0.016;        // первый кадр и защита от NaN
    if (dt > 0.25) dt = 0.25;
    if (turbo && turbo.checked) dt *= 4;
    try {
      game.update(dt);
      game.draw();
    } catch (err) {
      // одна ошибка отрисовки не должна навсегда остановить игру
      if (!window.__lastRenderError) {
        window.__lastRenderError = err;
        if (window.console) console.error('render error:', err);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // автосброс к базе, если игрок не двигал камеру
  setTimeout(() => { game.flash('Высадка завершена. Стройте армию'); }, 800);
})();
