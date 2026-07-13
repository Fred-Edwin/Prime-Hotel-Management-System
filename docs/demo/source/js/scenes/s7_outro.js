/* SCENE 7 — Outro: everything falls away to aubergine.
   Logo, gold underline, one quiet closing line — then black. */
'use strict';

FILM.scene({
  name: 'outro',
  start: 70.0, end: 76.0,

  build(root) {
    el('div', 'amb', root);
    el('div', 'vignette', root);
    const name = el('div', 'brandName', root, 'Prime Hotel');
    const under = el('div', 'brandUnder', root);
    const line = el('div', 'outroLine', root, '');
    const foot = el('div', 'outroFoot', root, 'Built for Prime Hotel · Runs at zero monthly cost');
    const black = el('div', '', root);
    black.style.cssText = 'position:absolute;inset:0;background:#000;pointer-events:none';
    return { name, under, line, foot, black };
  },

  render(t, R) {
    const { W, H, tall } = FILM;
    const size = tall ? 76 : 92;
    const nameY = tall ? H * 0.40 : H * 0.375;
    const underW = tall ? 420 : 500;

    const nIn = seg(t, 0.35, 1.0, E.outExpo);
    R.name.style.fontSize = size + 'px';
    R.name.style.top = nameY + 'px';
    setT(R.name, `translate(-50%, ${(1 - nIn) * 34}px)`);
    setO(R.name, nIn);

    const draw = seg(t, 0.9, 0.8, E.inOutCubic);
    R.under.style.left = (W / 2 - underW / 2) + 'px';
    R.under.style.top = (nameY + size * 1.24) + 'px';
    R.under.style.width = draw * underW + 'px';
    R.under.style.height = '4px';
    setO(R.under, draw > 0 ? 1 : 0);

    const lIn = seg(t, 1.55, 0.4, E.outCubic);
    R.line.style.top = (nameY + size * 1.24 + 42) + 'px';
    R.line.style.fontSize = (tall ? 34 : 38) + 'px';
    typeInto(R.line, 'Your business, counted for you.', seg(t, 1.55, 1.3));
    setT(R.line, `translate(-50%, ${(1 - lIn) * 12}px)`);
    setO(R.line, lIn);

    const fIn = seg(t, 3.1, 0.7, E.outCubic);
    R.foot.style.top = (tall ? H * 0.88 : H * 0.86) + 'px';
    setT(R.foot, 'translateX(-50%)');
    setO(R.foot, fIn * 0.9);

    /* fade to black */
    setO(R.black, seg(t, 5.0, 0.9, E.inOutCubic));
  },
});
