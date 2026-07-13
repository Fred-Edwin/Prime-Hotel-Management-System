/* SCENE 3 — The till: a self-driving replica of /entry.
   Steppers tick, the running total rolls like an odometer, Save lands. */
'use strict';

(() => {

/* tap choreography (scene-local seconds) */
const ITEMS = [
  { name: 'African Tea', price: 30, avail: 46, taps: [2.0, 2.35, 2.7, 8.6, 8.85, 9.1, 9.35] },            // → 7
  { name: 'Soda 500ml', price: 60, avail: 38, taps: [3.5, 3.85, 9.7, 9.95] },                              // → 4
  { name: 'Mandazi',    price: 15, avail: 60, taps: [4.6, 4.9, 5.2, 5.5, 10.3, 10.5, 10.7, 10.9] },        // → 8
  { name: 'Chapati',    price: 25, avail: 80, taps: [6.3, 6.6, 6.9, 11.3, 11.55] },                        // → 5
  { name: 'Samosa',     price: 35, avail: 45, taps: [] },   // peeks under the till strip — implies scroll
];
const SAVE_T = 12.6;   // 24 items · KES 715
const RIPPLE_D = 0.5;

function buildEntryScreen(screen) {
  const top = el('div', 'appTop', screen);
  el('div', 'appLogo', top, 'Prime Hotel');
  el('span', 'locBadge', top, 'Restaurant');

  const band = el('div', 'screenTitleRow', screen);
  el('span', 'screenDate', band, '2026-07-12');
  el('div', 'screenTitle', band, "Today's Entry");

  const sb = el('div', 'searchBar', screen);
  icon('search', 15, sb); sb.appendChild(document.createTextNode('Search items…'));
  const chips = el('div', 'chipsRow', screen);
  ['All', 'Beverages', 'Snacks', 'Meals'].forEach((c, i) => el('span', 'chip' + (i === 0 ? ' on' : ''), chips, c));

  const rows = ITEMS.map(it => {
    const card = el('div', 'itemCard', screen);
    const topRow = el('div', 'itemTop', card);
    const left = el('div', '', topRow);
    const nm = el('div', 'itemName', left);
    el('span', 'itemDot', nm); nm.appendChild(document.createTextNode(it.name));
    const meta = el('div', 'itemMeta', left, '');
    const stp = el('div', 'stepper', topRow);
    el('div', 'stepBtn', stp, '−');
    const val = el('div', 'stepVal', stp, '0');
    const plus = el('div', 'stepBtn plus', stp, '+');
    const ripple = el('div', 'tapRipple', plus);
    const wl = el('div', 'wastageLink', card);
    icon('trash', 13, wl); wl.appendChild(document.createTextNode(' Log wastage'));
    return { it, card, meta, val, plus, ripple, lastShown: -1 };
  });

  const strip = el('div', 'tillStrip', screen);
  const sl = el('div', '', strip);
  const count = el('div', 'tillCount', sl, '0 items');
  const total = new Odometer(el('div', 'tillTotal', sl), { maxDigits: 4 });
  const save = el('div', 'saveBtn', strip, 'Save');
  const saveRipple = el('div', 'tapRipple', save);
  saveRipple.style.background = 'rgba(255,255,255,0.35)';

  const toast = el('div', 'toast', screen);
  el('span', 'tick', toast, '✓');
  el('span', '', toast, 'Saved — 24 items · KES 715');
  return { rows, count, total, save, saveRipple, toast };
}

function rippleAt(rippleEl, t, tapTimes) {
  let p = -1;
  for (const tap of tapTimes) { if (t >= tap && t < tap + RIPPLE_D) { p = (t - tap) / RIPPLE_D; break; } }
  if (p < 0) { rippleEl.style.opacity = 0; return; }
  rippleEl.style.opacity = 0.5 * (1 - p);
  setT(rippleEl, `translate(-50%,-50%) scale(${1 + p * 5})`);
}
const bumpAt = (t, taps) => {
  let b = 0;
  for (const tap of taps) { if (t >= tap && t < tap + 0.3) { const p = (t - tap) / 0.3; b = Math.max(b, Math.sin(p * Math.PI)); } }
  return b;
};

FILM.scene({
  name: 'till',
  start: 14.0, end: 30.6,

  build(root) {
    el('div', 'amb', root);
    el('div', 'vignette', root);
    const rig = el('div', 'rig', root);
    const phone = el('div', 'phone', rig);
    const screen = el('div', 'phoneScreen', phone);
    const ui = buildEntryScreen(screen);
    el('div', 'notch', phone);
    el('div', 'phoneGlare', phone);

    const capOver = el('div', 'capSmall', root, 'THE TILL');
    const capBar = el('div', 'capBar', root);
    const cap1 = el('div', 'cap', root, '');
    const cap2 = el('div', 'cap', root, '');
    return { rig, phone, ui, capOver, capBar, cap1, cap2 };
  },

  render(t, R) {
    const { W, H, tall } = FILM;

    /* ---- phone rig placement + float ---- */
    const enter = seg(t, 0.15, 1.5, E.outExpo);
    const exit = seg(t, 15.3, 1.2, E.inCubic);
    const scale = tall ? 1.12 : 1.0;
    const px = tall ? (W - 420 * scale) / 2 : W * 0.60;
    const py = tall ? H * 0.30 : (H - 880 * scale) / 2 + 10;
    const floatY = Math.sin(t * 0.85) * 7;
    const ry = mix(-14, -5 + Math.sin(t * 0.5) * 2.0, enter);
    const rx = mix(6, 2.2 + Math.cos(t * 0.42) * 1.2, enter);
    R.phone.style.left = px + 'px';
    R.phone.style.top = '0px';
    setT(R.phone, `translateY(${py + (1 - enter) * H * 0.55 + floatY - exit * 60}px) scale(${scale}) rotateY(${ry}deg) rotateX(${rx}deg)`);
    setO(R.phone, Math.min(enter * 2, 1) * (1 - exit));

    /* ---- steppers + ripples ---- */
    let items = 0, value = 0;
    for (const row of R.ui.rows) {
      const n = row.it.taps.filter(tap => t >= tap).length;
      if (row.lastShown !== n) { row.val.textContent = n; row.lastShown = n; }
      const b = bumpAt(t, row.it.taps);
      setT(row.val, `scale(${1 + b * 0.38})`);
      row.val.style.color = b > 0.02 ? 'var(--brand)' : 'var(--ink)';
      rippleAt(row.ripple, t, row.it.taps);
      const pressed = row.it.taps.some(tap => t >= tap && t < tap + 0.14);
      setT(row.plus, `scale(${pressed ? 0.88 : 1})`);
      row.plus.style.background = pressed ? '#E4DFEA' : 'var(--sunken)';
      row.meta.textContent = `KES ${row.it.price}.00 · Available: ${row.it.avail - n}`;
      items += n;
      for (const tap of row.it.taps) value += row.it.price * seg(t, tap, 0.5, E.outCubic);
    }
    R.ui.count.textContent = items + (items === 1 ? ' item' : ' items');
    R.ui.total.set(value);

    /* ---- save press + toast ---- */
    const savePressed = t >= SAVE_T && t < SAVE_T + 0.16;
    setT(R.ui.save, `scale(${savePressed ? 0.93 : 1})`);
    rippleAt(R.ui.saveRipple, t, [SAVE_T]);
    const toastIn = seg(t, SAVE_T + 0.35, 0.6, E.springSoft);
    const toastOut = seg(t, SAVE_T + 2.6, 0.5, E.inCubic);
    setO(R.ui.toast, toastIn * (1 - toastOut));
    setT(R.ui.toast, `translateY(${(1 - toastIn) * 46}px) scale(${0.96 + toastIn * 0.04})`);

    /* ---- captions (left column in wide; above phone in tall) ---- */
    const capX = tall ? W * 0.09 : W * 0.115;
    const capW = tall ? W * 0.82 : W * 0.36;
    const capY = tall ? H * 0.09 : H * 0.36;

    const oIn = seg(t, 1.7, 0.5, E.outCubic);
    R.capOver.style.left = capX + 'px'; R.capOver.style.top = capY + 'px';
    setO(R.capOver, oIn * (1 - exit));
    setT(R.capOver, `translateY(${(1 - oIn) * 14}px)`);
    R.capBar.style.left = capX + 'px'; R.capBar.style.top = (capY + 40) + 'px';
    R.capBar.style.width = oIn * 44 + 'px';
    setO(R.capBar, oIn * (1 - exit));

    for (const [cap, text, t0, dur, tOut] of [
      [R.cap1, 'Staff log the day in taps — not in a spreadsheet.', 2.0, 1.7, 11.4],
      [R.cap2, 'One Save. The whole day, recorded.', 12.3, 1.2, 99],
    ]) {
      cap.style.left = capX + 'px'; cap.style.top = (capY + 66) + 'px';
      cap.style.width = capW + 'px';
      cap.style.fontSize = (tall ? 44 : 47) + 'px';
      cap.style.lineHeight = '1.32';
      typeInto(cap, text, seg(t, t0, dur));
      setO(cap, seg(t, t0, 0.3) * (1 - seg(t, tOut, 0.6, E.inCubic)) * (1 - exit));
    }
  },
});

})();
