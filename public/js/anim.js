/* FX engine: FLIP card flight, particle bursts, banners, shake, tiny synth. */
(function (w) {
  'use strict';

  const ghostLayer = document.getElementById('ghosts');
  const fxCanvas = document.getElementById('fx');
  const sandCanvas = document.getElementById('sand');
  const fxCtx = fxCanvas.getContext('2d');
  const sandCtx = sandCanvas.getContext('2d');

  const reduce = w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const T = (ms) => (reduce ? Math.min(ms, 90) : ms);
  const sleep = (ms) => new Promise((r) => setTimeout(r, T(ms)));
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* ------------------------------------------------------------- canvases */
  let dpr = 1;
  function sizeCanvases() {
    dpr = Math.min(2, w.devicePixelRatio || 1);
    for (const c of [fxCanvas, sandCanvas]) {
      c.width = Math.floor(innerWidth * dpr);
      c.height = Math.floor(innerHeight * dpr);
      c.style.width = innerWidth + 'px';
      c.style.height = innerHeight + 'px';
    }
    fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sandCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seedSand();
  }
  addEventListener('resize', sizeCanvases);

  /* -------------------------------------------------- ambient sand drift */
  let sand = [];
  function seedSand() {
    const n = reduce ? 0 : Math.round(innerWidth * innerHeight / 14000);
    sand = Array.from({ length: n }, () => ({
      x: Math.random() * innerWidth, y: Math.random() * innerHeight,
      r: rnd(0.4, 1.9), s: rnd(6, 34), o: rnd(0.06, 0.34), ph: Math.random() * 6.3,
    }));
  }
  function drawSand(dt, t) {
    sandCtx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of sand) {
      p.x += p.s * dt;
      p.y += Math.sin(t / 900 + p.ph) * 7 * dt;
      if (p.x > innerWidth + 4) { p.x = -4; p.y = Math.random() * innerHeight; }
      sandCtx.globalAlpha = p.o;
      sandCtx.fillStyle = '#ffd89a';
      sandCtx.beginPath();
      sandCtx.arc(p.x, p.y, p.r, 0, 6.2832);
      sandCtx.fill();
    }
    sandCtx.globalAlpha = 1;
  }

  /* ---------------------------------------------------------- particles */
  const parts = [];
  const GRAV = 1500;

  function spawn(p) { if (!reduce) parts.push(p); }

  function drawParts(dt) {
    fxCtx.clearRect(0, 0, innerWidth, innerHeight);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }

      if (p.kind === 'homing') {
        // steer toward a target, used for coins flying into the token tray
        const k = 1 - p.life / p.max;
        const ex = p.tx - p.x, ey = p.ty - p.y;
        p.vx += ex * 9 * dt; p.vy += ey * 9 * dt;
        p.vx *= 0.93; p.vy *= 0.93;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.rot += p.spin * dt;
        const a = k < 0.85 ? 1 : (1 - k) / 0.15;
        coin(p.x, p.y, p.r, p.rot, a, p.col);
        continue;
      }

      p.vy += (p.g === undefined ? GRAV : p.g) * dt;
      p.vx *= p.drag || 0.995;
      p.vy *= p.drag || 0.995;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot = (p.rot || 0) + (p.spin || 0) * dt;
      const a = Math.max(0, Math.min(1, p.life / (p.fade || p.max)));

      if (p.kind === 'coin') coin(p.x, p.y, p.r, p.rot, a, p.col);
      else if (p.kind === 'confetti') {
        fxCtx.save();
        fxCtx.globalAlpha = a;
        fxCtx.translate(p.x, p.y);
        fxCtx.rotate(p.rot);
        fxCtx.fillStyle = p.col;
        fxCtx.fillRect(-p.r, -p.r * 0.45, p.r * 2, p.r * 0.9);
        fxCtx.restore();
      } else if (p.kind === 'glyph') {
        fxCtx.save();
        fxCtx.globalAlpha = a;
        fxCtx.translate(p.x, p.y);
        fxCtx.rotate(p.rot);
        fxCtx.font = `${p.r * 2}px serif`;
        fxCtx.textAlign = 'center';
        fxCtx.textBaseline = 'middle';
        fxCtx.fillText(p.ch, 0, 0);
        fxCtx.restore();
      } else if (p.kind === 'ring') {
        fxCtx.save();
        const k = 1 - p.life / p.max;
        fxCtx.globalAlpha = a * 0.75;
        fxCtx.strokeStyle = p.col;
        fxCtx.lineWidth = Math.max(0.6, 5 * (1 - k));
        fxCtx.beginPath();
        fxCtx.arc(p.x, p.y, p.r + k * p.grow, 0, 6.2832);
        fxCtx.stroke();
        fxCtx.restore();
      } else {
        fxCtx.globalAlpha = a;
        fxCtx.fillStyle = p.col;
        fxCtx.beginPath();
        fxCtx.arc(p.x, p.y, p.r, 0, 6.2832);
        fxCtx.fill();
      }
    }
    fxCtx.globalAlpha = 1;
  }

  function coin(x, y, r, rot, a, col) {
    const sq = Math.abs(Math.cos(rot));
    fxCtx.save();
    fxCtx.globalAlpha = a;
    fxCtx.translate(x, y);
    fxCtx.scale(Math.max(0.12, sq), 1);
    const g = fxCtx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, '#fff3c4');
    g.addColorStop(0.5, col || '#f0b429');
    g.addColorStop(1, '#8a5c05');
    fxCtx.fillStyle = g;
    fxCtx.beginPath();
    fxCtx.arc(0, 0, r, 0, 6.2832);
    fxCtx.fill();
    fxCtx.strokeStyle = 'rgba(255,240,190,.9)';
    fxCtx.lineWidth = 1;
    fxCtx.stroke();
    fxCtx.restore();
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    drawSand(dt, now);
    drawParts(dt);
    requestAnimationFrame(loop);
  }

  /* -------------------------------------------------------------- bursts */
  const centre = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  function burst(x, y, opts = {}) {
    const n = opts.n || 26;
    const col = opts.col || '#ffd166';
    for (let i = 0; i < n; i++) {
      const a = rnd(0, 6.2832), v = rnd(opts.vmin || 120, opts.vmax || 520);
      spawn({
        kind: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 90,
        r: rnd(1.4, 4.2), col: Array.isArray(col) ? col[(Math.random() * col.length) | 0] : col,
        life: rnd(0.4, 0.95), max: 0.95, g: opts.g,
      });
    }
    spawn({ kind: 'ring', x, y, vx: 0, vy: 0, r: 8, grow: opts.ring || 90, col: opts.ringCol || '#ffe9a8', life: 0.45, max: 0.45, g: 0, drag: 1 });
  }

  function coinsTo(fromRect, toRect, n = 10, col) {
    const a = centre(fromRect), b = centre(toRect);
    for (let i = 0; i < n; i++) {
      spawn({
        kind: 'homing', x: a.x + rnd(-24, 24), y: a.y + rnd(-18, 18),
        tx: b.x + rnd(-14, 14), ty: b.y + rnd(-10, 10),
        vx: rnd(-260, 260), vy: rnd(-520, -180),
        r: rnd(6, 11), rot: rnd(0, 6), spin: rnd(-14, 14),
        col: col || '#f0b429', life: 0.95, max: 0.95,
      });
    }
  }

  function confetti(n = 160) {
    const cols = ['#e0489b', '#f0b429', '#2bb7d6', '#7ad97a', '#ff6b6b', '#ffe9a8', '#b48cff'];
    for (let i = 0; i < n; i++) {
      spawn({
        kind: 'confetti', x: rnd(0, innerWidth), y: rnd(-innerHeight * 0.4, -10),
        vx: rnd(-90, 90), vy: rnd(60, 260), r: rnd(4, 10),
        rot: rnd(0, 6), spin: rnd(-9, 9), drag: 0.999,
        col: cols[(Math.random() * cols.length) | 0], life: rnd(2.4, 4.4), max: 4.4, fade: 1.1, g: 420,
      });
    }
  }

  function fireworks(n = 6) {
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        const x = rnd(innerWidth * 0.12, innerWidth * 0.88);
        const y = rnd(innerHeight * 0.12, innerHeight * 0.5);
        burst(x, y, { n: 60, vmin: 200, vmax: 700, ring: 160, col: ['#ffd166', '#e0489b', '#2bb7d6', '#fff'] });
        blip(520 + i * 70, 0.16, 'sine');
      }, i * 260);
    }
  }

  // Camels crossing the screen with a dust trail — fired when a herd is claimed.
  function stampede(dir = 1) {
    if (reduce) return;
    const y0 = innerHeight * 0.58;
    for (let i = 0; i < 7; i++) {
      const y = y0 + rnd(-40, 46);
      const x = dir > 0 ? -70 - i * 90 : innerWidth + 70 + i * 90;
      spawn({
        kind: 'glyph', ch: '🐪', x, y, vx: dir * rnd(760, 1050), vy: rnd(-40, 20),
        r: rnd(16, 26), rot: 0, spin: rnd(-0.5, 0.5), g: 0, drag: 1,
        life: rnd(1.5, 2.1), max: 2.1, fade: 0.5,
      });
      for (let k = 0; k < 10; k++) {
        spawn({
          kind: 'dot', x: x + rnd(-40, 40), y: y + rnd(6, 30), vx: dir * rnd(60, 260), vy: rnd(-120, -10),
          r: rnd(3, 9), col: 'rgba(214,178,122,.55)', life: rnd(0.5, 1.2), max: 1.2, g: -30, drag: 0.98,
        });
      }
    }
  }

  /* ------------------------------------------------------- ghost flights */
  function snapshot(root = document) {
    const m = new Map();
    root.querySelectorAll('[data-rect]').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width || r.height) m.set(el.dataset.rect, r);
    });
    return m;
  }

  function rectOf(sel) {
    const el = typeof sel === 'string' ? document.querySelector(sel) : sel;
    return el ? el.getBoundingClientRect() : null;
  }

  // Animate a clone of `html` from one rect to another. Resolves when it lands.
  function fly(o) {
    return new Promise((resolve) => {
      const from = o.from, to = o.to;
      if (!from || !to) return resolve();
      const g = document.createElement('div');
      g.className = 'ghost ' + (o.cls || '');
      g.style.left = from.left + 'px';
      g.style.top = from.top + 'px';
      g.style.width = from.width + 'px';
      g.style.height = from.height + 'px';
      g.innerHTML = o.html || '';
      ghostLayer.appendChild(g);

      const dx = to.left - from.left;
      const dy = to.top - from.top;
      const s = to.width && from.width ? to.width / from.width : 1;
      const arc = o.arc === undefined ? -Math.min(160, 60 + Math.abs(dx) * 0.12) : o.arc;
      const mx = dx * 0.5 + (o.sway || 0);
      const my = dy * 0.5 + arc;
      const spin = o.spin || 0;
      const dur = T(o.dur || 520);

      if (o.trail && !reduce) {
        for (let i = 1; i <= 3; i++) {
          setTimeout(() => {
            const t = document.createElement('div');
            t.className = 'ghost trailghost';
            const k = i / 4;
            t.style.left = (from.left + dx * k) + 'px';
            t.style.top = (from.top + dy * k + arc * Math.sin(Math.PI * k)) + 'px';
            t.style.width = from.width + 'px';
            t.style.height = from.height + 'px';
            t.innerHTML = o.html || '';
            ghostLayer.appendChild(t);
            t.animate([{ opacity: 0.4, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.8)' }],
              { duration: T(280), easing: 'ease-out' }).onfinish = () => t.remove();
          }, (dur * i) / 5);
        }
      }

      const frames = [
        { transform: 'translate3d(0,0,0) scale(1) rotate(0deg)', offset: 0 },
        { transform: `translate3d(${mx}px,${my}px,0) scale(${1 + (s - 1) * 0.35 + 0.14}) rotate(${spin * 0.55}deg)`, offset: 0.55 },
        { transform: `translate3d(${dx}px,${dy}px,0) scale(${s}) rotate(${spin}deg)`, offset: 1 },
      ];
      if (o.flip) {
        frames[0].transform += ' rotateY(180deg)';
        frames[1].transform += ' rotateY(96deg)';
        frames[2].transform += ' rotateY(0deg)';
      }
      const delay = T(o.delay || 0);
      let anim = null;
      try {
        anim = g.animate(frames, {
          duration: dur,
          easing: o.ease || 'cubic-bezier(.26,.9,.24,1)',
          delay,
          fill: 'forwards',
        });
      } catch (e) { /* bad keyframe: fall through to the watchdog below */ }

      // A card must never be able to strand the animation queue. The browser
      // pauses WAAPI while a tab is hidden, so onfinish alone is not enough:
      // finish() is idempotent and a timer guarantees it runs.
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (o.land !== false) {
          const c = centre(to);
          burst(c.x, c.y, { n: o.landN || 10, vmin: 60, vmax: 220, ring: 44, col: o.landCol || '#ffe9a8' });
        }
        g.style.opacity = '0';
        g.style.transition = 'opacity .09s';
        setTimeout(() => g.remove(), 140);
        resolve();
      };
      if (anim) { anim.onfinish = finish; anim.oncancel = finish; }
      setTimeout(finish, dur + delay + 400);
    });
  }

  // Belt and braces: drop anything the queue left behind.
  function purgeGhosts() {
    while (ghostLayer.firstChild) ghostLayer.firstChild.remove();
  }

  /* --------------------------------------------------------------- chrome */
  function shake(power = 1) {
    if (reduce) return;
    const el = document.getElementById('table');
    if (!el) return;
    const k = Math.min(3, power);
    el.animate([
      { transform: 'translate(0,0)' },
      { transform: `translate(${-7 * k}px,${4 * k}px) rotate(${-0.35 * k}deg)` },
      { transform: `translate(${6 * k}px,${-5 * k}px) rotate(${0.3 * k}deg)` },
      { transform: `translate(${-4 * k}px,${2 * k}px)` },
      { transform: 'translate(0,0)' },
    ], { duration: T(300 + 60 * k), easing: 'ease-out' });
  }

  function flash(col = 'rgba(255,220,140,.35)', dur = 420) {
    if (reduce) return;
    const d = document.createElement('div');
    d.className = 'screenflash';
    d.style.background = col;
    document.body.appendChild(d);
    d.animate([{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 0 }],
      { duration: T(dur), easing: 'ease-out' }).onfinish = () => d.remove();
  }

  function banner(text, cls = '') {
    const el = document.getElementById('turnBanner');
    if (!el) return Promise.resolve();
    el.className = 'turnbanner ' + cls;
    el.querySelector('span').textContent = text;
    el.classList.add('go');
    return new Promise((r) => setTimeout(() => { el.classList.remove('go'); r(); }, T(1150)));
  }

  function toast(text, cls = '') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = text;
    el.className = 'toast show ' + cls;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = 'toast'; }, 2300);
  }

  function ticker(text) {
    const el = document.getElementById('ticker');
    if (!el) return;
    const line = document.createElement('div');
    line.className = 'tline';
    line.textContent = text;
    el.prepend(line);
    while (el.children.length > 5) el.lastChild.remove();
    requestAnimationFrame(() => line.classList.add('in'));
  }

  function pop(el, k = 1.18) {
    if (!el || reduce) return;
    el.animate([{ transform: 'scale(1)' }, { transform: `scale(${k})` }, { transform: 'scale(1)' }],
      { duration: T(340), easing: 'cubic-bezier(.3,1.6,.4,1)' });
  }

  function countUp(el, from, to, dur = 620) {
    if (!el) return;
    if (reduce || from === to) { el.textContent = to; return; }
    const t0 = performance.now();
    (function step(now) {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
      else el.textContent = to;
    })(t0);
  }

  /* ---------------------------------------------------------------- audio */
  let ac = null, muted = false;
  function ensureAudio() {
    if (muted) return null;
    if (!ac) { try { ac = new (w.AudioContext || w.webkitAudioContext)(); } catch (e) { return null; } }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function blip(freq = 440, dur = 0.09, type = 'triangle', gain = 0.05) {
    const c = ensureAudio();
    if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    g.gain.setValueAtTime(0, c.currentTime);
    g.gain.linearRampToValueAtTime(gain, c.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + dur + 0.02);
  }
  const SFX = {
    card: () => blip(rnd(300, 380), 0.07, 'triangle', 0.035),
    take: () => { blip(520, 0.07); setTimeout(() => blip(700, 0.07), 60); },
    camel: () => { blip(180, 0.16, 'sawtooth', 0.04); setTimeout(() => blip(240, 0.2, 'sawtooth', 0.03), 90); },
    coin: () => { blip(880, 0.06, 'square', 0.03); setTimeout(() => blip(1180, 0.09, 'square', 0.025), 70); },
    bonus: () => [0, 90, 180, 300].forEach((d, i) => setTimeout(() => blip([784, 988, 1175, 1568][i], 0.14, 'sine', 0.04), d)),
    turn: () => { blip(440, 0.1, 'sine'); setTimeout(() => blip(660, 0.12, 'sine'), 90); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.24, 'sine', 0.05), i * 130)),
    lose: () => [440, 392, 311].forEach((f, i) => setTimeout(() => blip(f, 0.3, 'sine', 0.045), i * 160)),
    err: () => blip(150, 0.14, 'sawtooth', 0.04),
  };
  function setMuted(v) { muted = v; }
  function isMuted() { return muted; }

  sizeCanvases();
  requestAnimationFrame(loop);

  w.FX = {
    snapshot, rectOf, fly, purgeGhosts, burst, coinsTo, confetti, fireworks, stampede,
    shake, flash, banner, toast, ticker, pop, countUp, sleep, centre,
    SFX, setMuted, isMuted, reduce, spawn,
    get hidden() { return document.visibilityState === 'hidden'; },
  };
})(window);
