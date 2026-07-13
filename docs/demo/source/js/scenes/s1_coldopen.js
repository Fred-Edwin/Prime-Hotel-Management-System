/* SCENE 1 — Cold open: the Excel grid trembles, then collapses.
   One golden cell — yesterday's closing stock — refuses to fall. */
'use strict';

FILM.scene({
  name: 'coldopen',
  start: 0, end: 8.6,

  build(root) {
    const wrap = el('div', 'xlWrap', root);
    const grid = el('div', 'xlGrid', wrap);

    const cols = [
      { w: 250, k: 'name' }, { w: 160, k: 'open' }, { w: 160, k: 'added' },
      { w: 160, k: 'sold' }, { w: 170, k: 'close' },
    ];
    const rows = [
      ['ITEM', 'OPENING', 'ADDED', 'SOLD', 'CLOSING'],
      ['African Tea', '18', '40', '46', '12'],
      ['Soda 500ml', '31', '24', '38', '17'],
      ['Mandazi', '22', '60', '71', '11'],
      ['Samosa', '9', '45', '50', '4'],
      ['Chapati', '26', '80', '72', '34'],
      ['Pilau', '6', '30', '31', '5'],
      ['Ugali Beef', '4', '25', '27', '2'],
    ];
    const RH = 56;
    const gw = cols.reduce((a, c) => a + c.w, 0);
    const gh = rows.length * RH;
    grid.style.width = gw + 'px';
    grid.style.height = gh + 'px';

    const rnd = prng(20260712);
    const cells = [];
    let x;
    rows.forEach((row, r) => {
      x = 0;
      row.forEach((txt, c) => {
        const isGold = (r === 5 && c === 4);           // Chapati closing = 34
        const cell = el('div', 'xlCell' + (r === 0 ? ' hdr' : '') + (isGold ? ' goldCell' : ''), grid, txt);
        cell.style.left = x + 'px';
        cell.style.top = r * RH + 'px';
        cell.style.width = cols[c].w + 'px';
        cell.style.height = RH + 'px';
        if (c > 0) { cell.style.justifyContent = 'flex-end'; }
        cells.push({
          e: cell, gold: isGold, r, c,
          delay: rnd() * 0.9 + (r * 0.06),             // upper rows linger slightly less
          spin: (rnd() - 0.5) * 340,
          driftX: (rnd() - 0.5) * 520,
          phase: rnd() * Math.PI * 2,
          speed: 7 + rnd() * 6,
        });
        x += cols[c].w;
      });
    });

    const cap = el('div', 's1cap', root, '');
    const capText = 'Every day, the counting starts over.';
    return { wrap, grid, cells, cap, capText, gw, gh };
  },

  render(t, R) {
    const { W, H, tall } = FILM;
    const gs = tall ? 0.86 : 1;
    // grid block placement (centered, slightly above middle)
    R.wrap.style.transform = '';
    R.grid.style.transform = '';
    R.grid.style.position = 'absolute';
    R.grid.style.left = (W - R.gw * gs) / 2 + 'px';
    R.grid.style.top = (tall ? H * 0.30 : H * 0.24) - 0 + 'px';

    const appear = seg(t, 0.3, 1.4, E.outCubic);          // grid fades in
    const trembleAmp = seg(t, 2.3, 1.9, E.inQuad) * 3.4;  // unrest builds
    const collapseT0 = 4.15;

    for (const c of R.cells) {
      const e = c.e;
      // entrance: row-staggered fade
      const rowIn = seg(t, 0.25 + c.r * 0.12, 0.8, E.outCubic);
      let op = Math.min(appear, rowIn);
      let tx = 0, ty = 0, rot = 0;

      if (!c.gold) {
        // tremble
        if (t > 2.3 && t < collapseT0 + c.delay) {
          tx += Math.sin(t * c.speed + c.phase) * trembleAmp;
          ty += Math.cos(t * (c.speed * 0.83) + c.phase * 1.7) * trembleAmp * 0.6;
        }
        // collapse: gravity fall + spin + drift
        const f = seg(t, collapseT0 + c.delay, 2.0, E.inCubic);
        if (f > 0) {
          ty += f * (H * 1.15);
          tx += E.outQuad(f) * c.driftX;
          rot = f * c.spin;
          op *= 1 - seg(t, collapseT0 + c.delay + 1.5, 0.5);
        }
      } else {
        // the survivor: a slow confident pulse once alone
        const alone = seg(t, 5.6, 1.2, E.outCubic);
        const pulseS = 1 + alone * 0.06 * (1 + Math.sin((t - 5.6) * 2.2)) * 0.5;
        // final exit: streaks upward at scene end
        const fly = seg(t, 7.7, 0.8, E.inExpo);
        ty -= fly * (H * 0.95);
        const sc = (pulseS + fly * 0.35) * gs;
        setT(e, `translate(${tx}px, ${ty}px) scale(${sc})`);
        setO(e, op);
        continue;
      }
      setT(e, `translate(${tx * gs}px, ${ty}px) rotate(${rot}deg) scale(${gs})`);
      setO(e, op);
    }

    // caption
    const capIn = seg(t, 4.9, 0.25, E.outCubic);
    typeInto(R.cap, R.capText, seg(t, 4.9, 1.5));
    R.cap.style.fontSize = (tall ? 54 : 58) + 'px';
    R.cap.style.top = (tall ? H * 0.62 : H * 0.60) + 'px';
    R.cap.style.width = W + 'px';
    R.cap.style.left = '0';
    setO(R.cap, capIn * (1 - seg(t, 7.9, 0.6, E.inCubic)));
    setT(R.cap, `translateY(${(1 - capIn) * 18}px)`);

    // whole scene fades under scene 2's wash at the very end
    setO(R.wrap, 1 - seg(t, 8.15, 0.45));
  },
});
