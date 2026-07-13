/* ============================================================
   PRIME HOTEL — "The Numbers, Sorted."
   Deterministic film engine: the whole film is a pure function
   of time t. No CSS transitions/animations — every frame is
   computed, so headless frame capture is exact.
   ============================================================ */
'use strict';

/* ---------- easing ---------- */
const E = {
  linear: t => t,
  inQuad: t => t * t,
  outQuad: t => 1 - (1 - t) * (1 - t),
  inOutQuad: t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: t => 1 - Math.pow(1 - t, 3),
  inCubic: t => t * t * t,
  inOutCubic: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outQuint: t => 1 - Math.pow(1 - t, 5),
  outExpo: t => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: t => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  inOutExpo: t => t <= 0 ? 0 : t >= 1 ? 1 :
    t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2,
  outBack: t => { const c = 1.70158, c3 = c + 1; return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  outBackSoft: t => { const c = 0.9, c3 = c + 1; return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  // under-damped spring settling to 1 — the film's signature ease
  spring: t => 1 - Math.exp(-6.5 * t) * Math.cos(11 * t),
  springSoft: t => 1 - Math.exp(-5 * t) * Math.cos(7 * t),
  inBack: t => { const c = 1.70158; return (c + 1) * t * t * t - c * t * t; },
};

/* ---------- tiny math kit ---------- */
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, p) => a + (b - a) * p;
/* progress of t through [t0, t0+dur], eased */
const seg = (t, t0, dur, ease) => (ease || E.linear)(clamp01((t - t0) / dur));
/* rectangular window with eased in/out ramps — for opacity pulses */
function pulse(t, t0, t1, rampIn, rampOut, easeIn, easeOut) {
  if (t < t0 || t > t1) return 0;
  const a = seg(t, t0, rampIn, easeIn || E.outCubic);
  const b = 1 - seg(t, t1 - rampOut, rampOut, easeOut || E.inCubic);
  return Math.min(a, b);
}
/* deterministic pseudo-random (seeded) so scatter layouts never change between runs */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const fmtKES = n => 'KES ' + Math.round(n).toLocaleString('en-US');
const fmtNum = n => Math.round(n).toLocaleString('en-US');

/* ---------- DOM kit ---------- */
function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
const setT = (e, s) => { e.style.transform = s; };
const setO = (e, v) => { e.style.opacity = clamp01(v); };

/* inline SVG icons — headless Chromium has no emoji font */
const ICONS = {
  search: '<circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" stroke-width="1.7"/><line x1="10.4" y1="10.4" x2="14" y2="14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  trash: '<path d="M3.5 5h9M6.5 5V3.6h3V5M4.8 5l.6 8h5.2l.6-8" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
  pin: '<path d="M8 14s-4.6-4.5-4.6-7.6a4.6 4.6 0 1 1 9.2 0C12.6 9.5 8 14 8 14z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="6.3" r="1.7" fill="currentColor"/>',
};
function icon(name, size, parent) {
  const s = el('span', 'icn', parent);
  s.style.cssText = `display:inline-flex;width:${size}px;height:${size}px;vertical-align:-2px`;
  s.innerHTML = `<svg viewBox="0 0 16 16" width="${size}" height="${size}">${ICONS[name]}</svg>`;
  return s;
}

/* ---------- odometer: value-driven rolling digits ---------- */
/* Continuous mechanical odometer: digit i shows (value/10^i) mod 10,
   translated within a 0..9,0 glyph column. Leading digits fade in
   as the value grows past their place. */
class Odometer {
  constructor(parent, opts = {}) {
    this.root = el('div', 'odo ' + (opts.cls || ''), parent);
    this.prefix = opts.prefix !== undefined ? opts.prefix : 'KES ';
    this.maxDigits = opts.maxDigits || 5;
    this.commas = opts.commas !== false;
    this.pre = el('span', 'odoPrefix', this.root, this.prefix);
    this.slots = [];      // left→right digit slots (fixed count)
    this.commaEls = [];
    for (let i = this.maxDigits - 1; i >= 0; i--) {
      const slot = el('span', 'odoSlot', this.root);
      const col = el('span', 'odoCol', slot);
      for (let d = 0; d <= 10; d++) el('span', 'odoDigit', col, String(d % 10));
      this.slots.push({ slot, col, place: i });
      if (this.commas && i > 0 && i % 3 === 0) {
        this.commaEls.push({ e: el('span', 'odoComma', this.root, ','), place: i });
      }
    }
  }
  set(value) {
    value = Math.max(0, value);
    const digitsNeeded = Math.max(1, Math.floor(Math.log10(Math.max(1, value))) + 1);
    for (const s of this.slots) {
      const p = Math.pow(10, s.place);
      let shown;
      if (s.place === 0) {
        shown = value % 10;                       // ones roll continuously
      } else {                                    // higher digits roll only as the place below wraps
        const base = Math.floor(value / p) % 10;
        const lower = (value % p) / p;            // 0..1 through this place
        shown = base + clamp01((lower - 0.8) / 0.2);
      }
      const visible = s.place < digitsNeeded;
      s.slot.style.opacity = visible ? 1 : 0;
      s.slot.style.maxWidth = visible ? '1ch' : '0';
      s.col.style.transform = `translateY(${(-shown * 100 / 11).toFixed(3)}%)`;
    }
    for (const c of this.commaEls) {
      const on = c.place < digitsNeeded;
      c.e.style.opacity = on ? 1 : 0;
      c.e.style.maxWidth = on ? '0.6ch' : '0';
    }
  }
}

/* ---------- typewriter caption ---------- */
/* Renders caption text progressively; p in [0,1] reveals characters. */
function typeInto(node, text, p) {
  const n = Math.round(clamp01(p) * text.length);
  if (node.__shown !== n) { node.textContent = text.slice(0, n); node.__shown = n; }
}

/* ============================================================
   FILM core
   ============================================================ */
const FILM = {
  scenes: [],
  DURATION: 76,
  FPS: 60,
  W: 1920, H: 1080,
  tall: false,
  stage: null,

  scene(def) { this.scenes.push(def); },

  init() {
    const q = new URLSearchParams(location.search);
    this.tall = q.get('fmt') === 'tall';
    if (this.tall) { this.W = 1080; this.H = 1920; document.documentElement.classList.add('tall'); }
    this.stage = document.getElementById('stage');
    this.stage.style.width = this.W + 'px';
    this.stage.style.height = this.H + 'px';
    this.scenes.sort((a, b) => a.start - b.start);
    for (const s of this.scenes) {
      s.el = el('div', 'scene scene-' + s.name, this.stage);
      s.refs = s.build(s.el) || {};
      s.el.style.display = 'none';
    }
    this.fit();
    window.addEventListener('resize', () => this.fit());

    window.__seek = t => this.seek(t);
    window.__DURATION = this.DURATION;
    window.__ready = document.fonts.ready.then(() => { this.seek(this.t0()); return true; });

    if (q.has('t')) { this.seek(parseFloat(q.get('t'))); }
    else if (!q.has('freeze')) this.preview();
    else this.seek(0);
  },

  t0() {
    const q = new URLSearchParams(location.search);
    return q.has('t') ? parseFloat(q.get('t')) : 0;
  },

  fit() {
    const s = Math.min(window.innerWidth / this.W, window.innerHeight / this.H);
    this.stage.style.transform = `translate(-50%,-50%) scale(${s})`;
  },

  seek(t) {
    t = clamp(t, 0, this.DURATION);
    this.t = t;
    for (const s of this.scenes) {
      const active = t >= s.start && t < s.end;
      if (active) {
        if (s.el.style.display === 'none') s.el.style.display = 'block';
        s.render(t - s.start, s.refs, s.end - s.start);
      } else if (s.el.style.display !== 'none') s.el.style.display = 'none';
    }
    const hud = document.getElementById('hud');
    if (hud) hud.textContent = t.toFixed(2) + 's';
  },

  preview() {
    let playing = true, t = 0, last = performance.now();
    const hud = el('div', '', document.body); hud.id = 'hud';
    const tick = now => {
      const dt = (now - last) / 1000; last = now;
      if (playing) { t += dt; if (t >= this.DURATION) t = 0; this.seek(t); }
      requestAnimationFrame(tick);
    };
    window.addEventListener('keydown', e => {
      if (e.key === ' ') playing = !playing;
      if (e.key === 'ArrowRight') { t = Math.min(this.DURATION, t + (e.shiftKey ? 5 : 1)); this.seek(t); }
      if (e.key === 'ArrowLeft') { t = Math.max(0, t - (e.shiftKey ? 5 : 1)); this.seek(t); }
    });
    requestAnimationFrame(tick);
  },
};

window.addEventListener('DOMContentLoaded', () => FILM.init());
