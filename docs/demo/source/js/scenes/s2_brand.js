/* SCENE 2 — Brand reveal: the surviving golden number streaks up,
   drags an aubergine wash across, and re-forms as the gold underline
   beneath PRIME HOTEL. */
'use strict';

FILM.scene({
  name: 'brand',
  start: 8.2, end: 14.6,

  build(root) {
    const wash = el('div', 'amb', root);
    el('div', 'vignette', root);
    const orb = el('div', 'orb', root);

    const nameWrap = el('div', 'brandName', root);
    const word = 'Prime Hotel';
    const letters = [];
    for (const ch of word) {
      const m = el('span', '', nameWrap);
      m.style.display = 'inline-block';
      m.style.overflow = 'hidden';
      m.style.verticalAlign = 'bottom';
      const inner = el('span', '', m, ch === ' ' ? ' ' : ch);
      inner.style.display = 'inline-block';
      letters.push(inner);
    }
    const under = el('div', 'brandUnder', root);
    const sub = el('div', 'brandSub', root, 'MANAGEMENT SYSTEM');
    return { wash, orb, nameWrap, letters, under, sub };
  },

  render(t, R) {
    const { W, H, tall } = FILM;
    const cx = W / 2;
    const nameSize = tall ? 100 : 128;
    const nameY = tall ? H * 0.40 : H * 0.385;    // top of name block
    const underY = nameY + nameSize * 1.22;
    const underW = tall ? 560 : 700;

    // aubergine wash sweeps up with the orb
    setO(R.wash, seg(t, 0.0, 1.1, E.outCubic));

    // orb: rises from below (continuation of s1's flying cell), settles at
    // left end of underline, then "draws" the line and dissolves into it.
    const rise = seg(t, 0.05, 0.95, E.outExpo);
    const drawP = seg(t, 1.05, 0.9, E.inOutCubic);
    const orbX = mix(cx, cx - underW / 2 + drawP * underW, seg(t, 0.75, 0.4, E.inOutQuad));
    const orbY = mix(H + 60, underY + 2.5, rise);
    setT(R.orb, `translate(${orbX - 7}px, ${orbY - 7}px) scale(${1 + (1 - rise) * 1.6})`);
    setO(R.orb, (t < 0.02 ? 0 : 1) * (1 - seg(t, 1.95, 0.35)));

    // underline draws behind the orb
    R.under.style.left = (cx - underW / 2) + 'px';
    R.under.style.top = underY + 'px';
    R.under.style.width = Math.max(0, drawP * underW) + 'px';
    setO(R.under, drawP > 0 ? 1 : 0);

    // letters rise out of the baseline, staggered from center outward
    R.nameWrap.style.fontSize = nameSize + 'px';
    R.nameWrap.style.top = nameY + 'px';
    R.nameWrap.style.transform = 'translateX(-50%)';
    const n = R.letters.length;
    R.letters.forEach((L, i) => {
      const fromCenter = Math.abs(i - (n - 1) / 2);
      const p = seg(t, 1.15 + fromCenter * 0.075, 0.75, E.outQuint);
      setT(L, `translateY(${(1 - p) * 108}%)`);
      setO(L, p);
    });

    // subtitle
    const sp = seg(t, 2.45, 0.8, E.outCubic);
    R.sub.style.top = (underY + 34) + 'px';
    R.sub.style.fontSize = (tall ? 21 : 24) + 'px';
    setT(R.sub, `translate(-50%, ${(1 - sp) * 14}px)`);
    setO(R.sub, sp);

    // gentle full-lockup breath, then exit: scale up + fade for scene 3
    const breathe = 1 + Math.sin(t * 0.9) * 0.004;
    const out = seg(t, 5.6, 0.75, E.inCubic);
    root0(R).style.transform = `scale(${(breathe + out * 0.06)})`;
    root0(R).style.transformOrigin = '50% 45%';
    setO(root0(R), 1 - out);
  },
});

/* helper: scene root is the parent of the wash */
function root0(R) { return R.wash.parentElement; }
