// Diegetic SFX track — synthesized sample-by-sample, no music.
// Every cue time is derived from the scene choreography. Output: audio.wav (48k stereo).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SR = 48000, DUR = 76, N = SR * DUR;
const L = new Float64Array(N), R = new Float64Array(N);

/* ---------- primitives ---------- */
let seed = 1234567;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };

function add(t0, dur, fn, pan = 0) {
  // fn(tau) -> sample; pan -1..1 (or function of tau)
  const s0 = Math.floor(t0 * SR), n = Math.floor(dur * SR);
  for (let i = 0; i < n; i++) {
    const idx = s0 + i; if (idx < 0 || idx >= N) continue;
    const tau = i / SR;
    const v = fn(tau);
    const p = typeof pan === 'function' ? pan(tau / dur) : pan;
    L[idx] += v * Math.min(1, 1 - p);
    R[idx] += v * Math.min(1, 1 + p);
  }
}

/* a fingertip on glass: tiny noise transient + damped sine body */
function tick(t, { f = 1750, amp = 0.14, decay = 70, pan = 0 } = {}) {
  add(t, 0.09, tau =>
    (Math.sin(2 * Math.PI * f * tau) * Math.exp(-tau * decay) * 0.8 +
     rnd() * Math.exp(-tau * 420) * 0.5) * amp, pan);
}
/* deeper press (Save button) */
function tapDeep(t, amp = 0.2) {
  add(t, 0.16, tau =>
    (Math.sin(2 * Math.PI * 210 * tau) * Math.exp(-tau * 34) +
     rnd() * Math.exp(-tau * 300) * 0.35) * amp);
}
/* warm bar chime, slightly detuned pair per note */
function chime(t, notes, amp = 0.14, decay = 3.2) {
  notes.forEach((f, k) => {
    add(t + k * 0.06, 1.8, tau =>
      (Math.sin(2 * Math.PI * f * tau) + 0.5 * Math.sin(2 * Math.PI * f * 1.003 * tau) +
       0.22 * Math.sin(2 * Math.PI * f * 2.01 * tau)) *
      Math.exp(-tau * decay) * amp / (1 + k * 0.4));
  });
}
/* filtered-noise whoosh; cutoff follows a hann-ish arc */
function whoosh(t, dur, amp = 0.11, pan = 0, bright = 0.35) {
  let lp = 0;
  add(t, dur, tau => {
    const env = Math.sin(Math.PI * Math.min(tau / dur, 1)) ** 1.6;
    const a = 0.02 + bright * env;
    lp += a * (rnd() - lp);
    return lp * env * amp * 3.2;
  }, pan);
}
/* short papery flick (highpassed noise burst) */
function flick(t, amp = 0.1) {
  let lp = 0;
  add(t, 0.13, tau => {
    const x = rnd();
    lp += 0.18 * (x - lp);
    return (x - lp) * Math.exp(-tau * 40) * amp;
  });
}
/* low soft boom */
function boom(t, amp = 0.22) {
  add(t, 1.6, tau =>
    Math.sin(2 * Math.PI * (58 - 16 * Math.min(tau * 2, 1)) * tau) * Math.exp(-tau * 3.4) * amp);
}
/* gentle riser: filtered noise swelling upward */
function riser(t, dur, amp = 0.09) {
  let lp = 0;
  add(t, dur, tau => {
    const p = tau / dur;
    const a = 0.01 + 0.3 * p * p;
    lp += a * (rnd() - lp);
    return lp * p * amp * 3.0;
  });
}
/* odometer ratchet: rapid faint ticks */
function ratchet(t, dur, rate = 26, amp = 0.05) {
  for (let k = 0; k * (1 / rate) < dur; k++) tick(t + k / rate, { f: 2600 + (k % 3) * 180, amp, decay: 190 });
}
/* bubble pop */
function pop(t, amp = 0.16) {
  add(t, 0.1, tau =>
    Math.sin(2 * Math.PI * (420 - 2300 * tau) * tau) * Math.exp(-tau * 60) * amp);
}
/* descending slide (carry-forward) */
function gliss(t, dur, f0 = 720, f1 = 340, amp = 0.11) {
  add(t, dur, tau => {
    const p = tau / dur;
    const f = f0 + (f1 - f0) * p;
    return Math.sin(2 * Math.PI * f * tau) * Math.sin(Math.PI * p) * amp * 0.8;
  });
}

/* ================= CUE SHEET ================= */
/* Scene 1 — the collapse */
whoosh(4.35, 1.9, 0.10, 0, 0.18);           // cells falling away (papery, dark)
flick(4.5, 0.07); flick(5.0, 0.06); flick(5.5, 0.05);
riser(7.65, 0.95, 0.11);                    // the golden cell escapes upward

/* Scene 2 — brand reveal (starts 8.2) */
riser(9.2, 0.95, 0.08);                     // underline draws
boom(9.45, 0.22);                           // lockup downbeat
chime(10.7, [659.25], 0.06, 4.5);           // faint sparkle as subtitle lands

/* Scene 3 — the till (starts 14.0) */
const TAPS = {
  tea: [2.0, 2.35, 2.7, 8.6, 8.85, 9.1, 9.35],
  soda: [3.5, 3.85, 9.7, 9.95],
  mandazi: [4.6, 4.9, 5.2, 5.5, 10.3, 10.5, 10.7, 10.9],
  chapati: [6.3, 6.6, 6.9, 11.3, 11.55],
};
for (const arr of Object.values(TAPS))
  for (const tt of arr) tick(14 + tt, { f: 1680 + (tt * 997 % 5) * 60, amp: 0.13, pan: 0.25 });
tapDeep(14 + 12.6, 0.2);                    // Save
chime(14 + 12.95, [783.99, 987.77], 0.13);  // success toast (G5 → B5)

/* Scene 4 — split phones (starts 30.0) */
for (const [i, dt] of [1.9, 4.1, 6.3].entries()) {
  flick(30 + dt, 0.11);                                        // day page-flick
  whoosh(30 + dt + 0.55, 0.95, 0.11, p => -0.5 + p, 0.4);      // chip flies L→R
  tick(30 + dt + 1.42, { f: 2300, amp: 0.1, pan: 0.45 });      // landing
  ratchet(30 + dt + 1.45, 0.4, 30, 0.035);                     // sum rolls
}
gliss(30 + 11.9, 0.95);                      // closing slides down…
chime(30 + 12.85, [659.25, 830.61], 0.13);   // …becomes tomorrow's opening
/* Scene 5 — WhatsApp → order (starts 46.0) */
pop(46 + 0.5, 0.15);                         // bubble arrives
whoosh(46 + 3.25, 1.0, 0.11, 0, 0.3);        // morph
tick(46 + 3.95, { f: 1500, amp: 0.08 });     // line 1
tick(46 + 4.15, { f: 1560, amp: 0.08 });     // line 2
tick(46 + 5.1, { f: 2200, amp: 0.11 });      // fee tick
chime(46 + 5.15, [1174.66], 0.08, 4.2);      // fee auto-fill ding
ratchet(46 + 5.7, 0.8, 28, 0.04);            // total rolls

/* Scene 6 — dashboard (starts 56.0) */
boom(56.35, 0.2);                            // hero ignites
riser(57.2, 1.8, 0.07);
ratchet(57.25, 1.7, 22, 0.032);              // profit counts up
for (const st of [5.2, 8.4]) {
  tick(56 + st, { f: 950, amp: 0.12, decay: 55 });   // toggle thock
  whoosh(56 + st + 0.02, 0.5, 0.06, 0, 0.5);
  ratchet(56 + st + 0.15, 0.8, 24, 0.03);            // figures re-roll
}
tick(56 + 4.7, { f: 1380, amp: 0.05 });      // low-stock blip
tick(56 + 4.82, { f: 1380, amp: 0.04 });

/* Scene 7 — outro (starts 70.0) */
riser(70.9, 0.8, 0.06);                      // underline draw
chime(71.7, [523.25, 659.25, 783.99], 0.11, 2.6);  // final resolve (C–E–G)

/* ---------- master: soft-knee limit + fades ---------- */
for (let i = 0; i < N; i++) {
  const t = i / SR;
  let g = 1;
  if (t > DUR - 1.2) g = (DUR - t) / 1.2;           // tail fade
  for (const C of [L, R]) {
    let v = C[i] * 1.15 * g;
    C[i] = Math.tanh(v * 1.4) / 1.4;                 // gentle saturation limiter
  }
}

/* ---------- write WAV (16-bit PCM stereo) ---------- */
const bytes = 44 + N * 4;
const buf = Buffer.alloc(bytes);
buf.write('RIFF', 0); buf.writeUInt32LE(bytes - 8, 4); buf.write('WAVE', 8);
buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28);
buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[i] * 32767))), 44 + i * 4);
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[i] * 32767))), 46 + i * 4);
}
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), 'audio', 'sfx.wav');
fs.writeFileSync(out, buf);
console.log('wrote', out, (bytes / 1e6).toFixed(1), 'MB');
