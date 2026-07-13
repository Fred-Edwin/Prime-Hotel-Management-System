/* SCENE 6 — The payoff: the admin dashboard ignites. NET PROFIT
   counts up in gold; the period toggle sweeps Today → Week → Month
   and every figure re-rolls; location bars grow; low stock pulses. */
'use strict';

(() => {

const PERIODS = [
  { name: 'Today', profit: 3820, sales: 12450, cost: 6890, exp: 1500, waste: 240, rest: 0.68, cant: 0.32, rv: 2610, cv: 1210 },
  { name: 'Week', profit: 25240, sales: 86300, cost: 47150, exp: 12400, waste: 1510, rest: 0.72, cant: 0.28, rv: 18170, cv: 7070 },
  { name: 'Month', profit: 101100, sales: 342800, cost: 187600, exp: 48200, waste: 5900, rest: 0.70, cant: 0.30, rv: 70770, cv: 30330 },
];
const SWEEP1 = 5.2, SWEEP2 = 8.4;   // toggle sweep times
const OPTW = 132;

/* interpolated period values at time t */
function periodMix(t) {
  const p1 = seg(t, SWEEP1, 0.9, E.inOutCubic);
  const p2 = seg(t, SWEEP2, 0.9, E.inOutCubic);
  const out = {};
  for (const k of ['profit', 'sales', 'cost', 'exp', 'waste', 'rest', 'cant', 'rv', 'cv']) {
    out[k] = mix(mix(PERIODS[0][k], PERIODS[1][k], p1), PERIODS[2][k], p2);
  }
  out.idx = p1 + p2;
  return out;
}

FILM.scene({
  name: 'dash',
  start: 56.0, end: 70.6,

  build(root) {
    el('div', 'amb', root);
    el('div', 'vignette', root);

    const hero = el('div', 'dashHero', root);
    el('div', 'dashTitle', hero, 'Dashboard');
    const tog = el('div', 'perToggle', hero);
    const thumb = el('div', 'perThumb', tog);
    const opts = PERIODS.map(p => {
      const o = el('div', 'perOpt', tog, p.name);
      o.style.width = OPTW + 'px'; o.style.textAlign = 'center';
      return o;
    });
    el('div', 'heroOverline', hero, 'Net Profit');
    const profit = new Odometer(el('div', 'heroFigure', hero), { maxDigits: 6 });
    const note = el('div', 'heroNote', hero, 'Sales − cost of goods − expenses − wastage');
    const grid = el('div', 'mGrid', hero);
    const metric = (lbl, digits) => {
      const c = el('div', 'mCell', grid);
      el('div', 'overGold', c, lbl);
      return new Odometer(el('div', 'fig', c), { maxDigits: digits });
    };
    const mSales = metric('Total Sales', 6);
    const mCost = metric('Total Cost', 6);
    const mExp = metric('Expenses', 6);
    const mWaste = metric('Wastage', 6);

    const loc = el('div', 'locPanel', root);
    el('div', 'locTitle', loc, 'Per location');
    const mkRow = (name, color) => {
      const r = el('div', 'locRow', loc);
      el('div', 'locName', r, name);
      const track = el('div', 'locBarTrack', r);
      const fill = el('div', 'locBarFill', track);
      fill.style.background = color;
      const val = el('div', 'locVal', r, '');
      return { fill, val };
    };
    const rowR = mkRow('Restaurant', 'linear-gradient(90deg,#D19F48,#EABF63)');
    const rowC = mkRow('Canteen', 'linear-gradient(90deg,#6C4A8C,#9B78BF)');
    const low = el('div', 'lowRow', loc);
    const lowL = el('div', '', low);
    el('div', 'lowName', lowL, 'Samosa');
    el('span', 'lowSub', lowL, 'Restaurant · low stock');
    const lowB = el('div', 'lowBadge', low);
    const lowDot = el('span', 'lowDot', lowB);
    el('span', '', lowB, '3 left');

    const cap = el('div', 'cap', root, '');
    cap.style.textAlign = 'center';
    return { hero, thumb, opts, profit, mSales, mCost, mExp, mWaste, loc, rowR, rowC, lowB, lowDot, cap };
  },

  render(t, R) {
    const { W, H, tall } = FILM;

    /* layout */
    const heroW = tall ? W * 0.86 : 830;
    const heroX = tall ? W * 0.07 : W * 0.10;
    const heroY = tall ? H * 0.10 : H * 0.115;
    const locW = tall ? W * 0.86 : 590;
    const locX = tall ? W * 0.07 : heroX + heroW + 70;
    const locY = tall ? H * 0.475 : H * 0.24;
    R.hero.style.width = heroW + 'px';
    R.hero.style.left = heroX + 'px'; R.hero.style.top = heroY + 'px';
    R.loc.style.width = locW + 'px';
    R.loc.style.left = locX + 'px'; R.loc.style.top = locY + 'px';

    const exit = seg(t, 13.4, 1.1, E.inCubic);

    /* hero ignition */
    const hIn = seg(t, 0.25, 1.1, E.outExpo);
    setT(R.hero, `translateY(${(1 - hIn) * 70}px) scale(${mix(0.95, 1, hIn)})`);
    setO(R.hero, hIn * (1 - exit));

    /* period values (first count-up, then sweeps) */
    const boot = seg(t, 1.2, 1.8, E.outExpo);       // initial count-up
    const pv = periodMix(t);
    R.profit.set(pv.profit * boot);
    R.mSales.set(pv.sales * seg(t, 1.5, 1.7, E.outExpo));
    R.mCost.set(pv.cost * seg(t, 1.7, 1.7, E.outExpo));
    R.mExp.set(pv.exp * seg(t, 1.9, 1.7, E.outExpo));
    R.mWaste.set(pv.waste * seg(t, 2.1, 1.7, E.outExpo));

    /* toggle thumb sweep */
    R.thumb.style.width = OPTW + 'px';
    setT(R.thumb, `translateX(${pv.idx * OPTW}px)`);
    R.opts.forEach((o, i) => o.classList.toggle('lit', Math.round(pv.idx) === i));

    /* location panel */
    const lIn = seg(t, 3.4, 0.9, E.outExpo);
    setT(R.loc, `translateY(${(1 - lIn) * 80}px)`);
    setO(R.loc, lIn * (1 - exit));
    const barBoot = seg(t, 3.9, 1.0, E.outExpo);
    R.rowR.fill.style.width = (pv.rest * 100 * barBoot) + '%';
    R.rowC.fill.style.width = (pv.cant * 100 * barBoot) + '%';
    R.rowR.val.textContent = fmtKES(pv.rv * barBoot);
    R.rowC.val.textContent = fmtKES(pv.cv * barBoot);

    /* low stock pulse */
    const beat = (Math.sin(t * 4.2) + 1) / 2;
    const lowOn = seg(t, 4.6, 0.5);
    R.lowB.style.opacity = lowOn;
    R.lowDot.style.boxShadow = `0 0 ${4 + beat * 10}px rgba(193,127,30,${0.4 + beat * 0.5})`;

    /* caption */
    const capY = tall ? H * 0.87 : H * 0.865;
    R.cap.style.left = W * 0.05 + 'px'; R.cap.style.width = W * 0.90 + 'px';
    R.cap.style.top = capY + 'px';
    R.cap.style.fontSize = (tall ? 40 : 46) + 'px'; R.cap.style.lineHeight = '1.35';
    typeInto(R.cap, 'Profit. On demand. Not once a month in Excel.', seg(t, 10.0, 1.6));
    setO(R.cap, seg(t, 10.0, 0.3) * (1 - exit));
  },
});

})();
