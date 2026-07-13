/* SCENE 4 — The centerpiece: two phones, two cadences, one truth.
   Daily "sent to canteen" figures fly across as golden chips and SUM
   into the canteen's weekly opening; then closing stock becomes
   tomorrow's opening. */
'use strict';

(() => {

const DAYS = [
  { t: 1.9, label: 'MON · 6 JUL', chapati: 20, mandazi: 30, tea: 12 },
  { t: 4.1, label: 'TUE · 7 JUL', chapati: 24, mandazi: 28, tea: 15 },
  { t: 6.3, label: 'WED · 8 JUL', chapati: 26, mandazi: 32, tea: 10 },
];
const FLY = 0.55;      // chip departs this long after its day starts
const FLY_D = 0.95;    // flight duration
const CARRY_T = 11.0;  // carry-forward beat

function miniPhone(rig, badge) {
  const phone = el('div', 'phone', rig);
  const screen = el('div', 'phoneScreen', phone);
  const top = el('div', 'appTop', screen);
  el('div', 'appLogo', top, 'Prime Hotel');
  el('span', 'locBadge', top, badge);
  const body = el('div', '', screen);
  el('div', 'notch', phone);
  el('div', 'phoneGlare', phone);
  return { phone, screen: body };
}

FILM.scene({
  name: 'split',
  start: 30.0, end: 46.6,

  build(root) {
    el('div', 'amb', root);
    el('div', 'vignette', root);
    const rig = el('div', 'rig', root);

    /* left: restaurant daily */
    const L = miniPhone(rig, 'Restaurant');
    const lBand = el('div', 'screenTitleRow', L.screen);
    el('div', 'overlineLbl', lBand, 'KITCHEN OUTPUT · DAILY');
    el('div', 'screenTitle', lBand, 'Sent to canteen');
    const dayFlag = el('div', '', L.screen);
    dayFlag.style.cssText = 'margin:12px 16px 10px;font:700 13px var(--f-data);letter-spacing:2px;color:var(--gold-deep)';
    const sentRows = {};
    for (const [key, name] of [['chapati', 'Chapati'], ['mandazi', 'Mandazi'], ['tea', 'African Tea']]) {
      const r = el('div', 'sentRow', L.screen);
      el('span', 'sentName', r, name);
      sentRows[key] = el('span', 'sentQty', r, '0');
    }
    /* carry-forward cards */
    const closeCard = el('div', 'openRow', L.screen);
    closeCard.style.marginTop = '18px';
    const ccL = el('div', '', closeCard);
    el('div', 'openLbl', ccL, "Today's closing");
    el('span', 'openSub', ccL, 'Chapati · Fri 12 Jul');
    el('div', 'openVal', closeCard, '34');
    const openCard = el('div', 'openRow', L.screen);
    const ocL = el('div', '', openCard);
    el('div', 'openLbl', ocL, "Tomorrow's opening");
    const openAuto = el('span', 'autoBadge', ocL, 'NEVER RETYPED');
    const openVal = el('div', 'openVal', openCard, '—');
    const ghost = el('div', 'goldChip', root, '34');

    /* right: canteen weekly */
    const R2 = miniPhone(rig, 'Canteen');
    const rBand = el('div', 'weekBand', R2.screen);
    el('div', 'overlineLbl', rBand, 'WEEKLY RECONCILIATION');
    el('div', 'screenTitle', rBand, 'Canteen Entry');
    const wk = el('div', '', rBand, 'Week of 6 Jul – 12 Jul');
    wk.style.cssText = 'font:400 12px var(--f-data);color:var(--ink-3);margin-top:3px';
    const opnRow = el('div', 'openRow', R2.screen);
    opnRow.style.marginTop = '16px';
    const oL = el('div', '', opnRow);
    el('div', 'openLbl', oL, 'Chapati');
    el('span', 'openSub', oL, 'Added from restaurant this week');
    const autoB = el('span', 'autoBadge', oL, 'AUTO-SUMMED');
    const weekOdo = new Odometer(el('div', 'openVal', opnRow), { prefix: '', maxDigits: 2, commas: false });
    const hintRow = el('div', 'openRow', R2.screen);
    const hL = el('div', '', hintRow);
    el('div', 'openLbl', hL, 'Mandazi');
    el('span', 'openSub', hL, 'Added from restaurant this week');
    const mandOdo = new Odometer(el('div', 'openVal', hintRow), { prefix: '', maxDigits: 2, commas: false });

    /* flying chips + labels + captions */
    const chips = DAYS.map(d => el('div', 'goldChip', root, `Chapati × ${d.chapati}`));
    const labL = el('div', 'miniLabel', root); labL.innerHTML = 'RESTAURANT<small>sends daily</small>';
    const labR = el('div', 'miniLabel', root); labR.innerHTML = 'CANTEEN<small>counts weekly</small>';
    const cap1 = el('div', 'cap', root, ''); const cap2 = el('div', 'cap', root, '');
    cap1.style.textAlign = 'center'; cap2.style.textAlign = 'center';

    return {
      Lphone: L.phone, Rphone: R2.phone, dayFlag, sentRows,
      closeCard, openCard, openVal, openAuto, ghost, weekOdo, mandOdo, autoB,
      chips, labL, labR, cap1, cap2,
    };
  },

  render(t, R) {
    const { W, H, tall } = FILM;
    const s = tall ? 0.78 : 0.80;
    const pw = 420 * s, ph = 880 * s;
    const gap = tall ? 44 : 170;
    const lX = W / 2 - gap / 2 - pw, rX = W / 2 + gap / 2;
    const pY = tall ? H * 0.235 : H * 0.135;

    const enter = seg(t, 0.1, 1.3, E.outExpo);
    const exit = seg(t, 15.4, 1.1, E.inCubic);
    const fl = Math.sin(t * 0.8) * 5;

    /* carry beat spotlight: right phone dims while the left demonstrates */
    const spot = seg(t, CARRY_T - 0.6, 0.8, E.inOutCubic) * (1 - seg(t, 15.2, 0.8));
    R.Lphone.style.left = '0px'; R.Lphone.style.top = '0px';
    R.Rphone.style.left = '0px'; R.Rphone.style.top = '0px';
    R.Lphone.style.transformOrigin = '0 0';
    R.Rphone.style.transformOrigin = '0 0';
    setT(R.Lphone, `translate(${lX + (1 - enter) * -W * 0.4}px, ${pY + fl}px) scale(${s}) rotateY(${3}deg)`);
    setT(R.Rphone, `translate(${rX + (1 - enter) * W * 0.4}px, ${pY - fl}px) scale(${s}) rotateY(${-3}deg)`);
    setO(R.Lphone, enter * (1 - exit));
    setO(R.Rphone, enter * (1 - exit) * (1 - spot * 0.55));

    /* labels above phones */
    for (const [lab, x, dim] of [[R.labL, lX + pw / 2, 0], [R.labR, rX + pw / 2, 1]]) {
      const p = seg(t, 0.7, 0.7, E.outCubic);
      lab.style.left = (x - 200) + 'px'; lab.style.width = '400px';
      lab.style.top = (pY - (tall ? 96 : 96)) + 'px';
      setO(lab, p * (1 - dim * spot * 0.55) * (1 - exit));
      setT(lab, `translateY(${(1 - p) * 16}px)`);
    }

    /* day flag + per-day sent quantities */
    let day = null, dayP = 0;
    for (const d of DAYS) if (t >= d.t) { day = d; dayP = t - d.t; }
    R.dayFlag.textContent = day ? day.label : ' ';
    const flip = day ? seg(dayP, 0, 0.35, E.outCubic) : 0;
    setO(R.dayFlag, day ? flip : 0);
    if (day) {
      R.sentRows.chapati.textContent = Math.round(day.chapati * seg(dayP, 0.1, 0.4, E.outCubic));
      R.sentRows.mandazi.textContent = Math.round(day.mandazi * seg(dayP, 0.18, 0.4, E.outCubic));
      R.sentRows.tea.textContent = Math.round(day.tea * seg(dayP, 0.26, 0.4, E.outCubic));
    } else { R.sentRows.chapati.textContent = R.sentRows.mandazi.textContent = R.sentRows.tea.textContent = '0'; }

    /* flying golden chips: left Chapati row → right Chapati opening row */
    const startX = lX + pw * 0.66, startY = pY + ph * 0.315;
    const endX = rX + pw * 0.55, endY = pY + ph * 0.345;
    R.chips.forEach((chip, i) => {
      const d = DAYS[i];
      const p = seg(t, d.t + FLY, FLY_D, E.inOutCubic);
      const visible = t >= d.t + FLY && p < 1;
      if (!visible) { chip.style.opacity = 0; return; }
      const cx = mix(startX, endX, p);
      const arc = -Math.sin(p * Math.PI) * (tall ? 80 : 150);
      const cy = mix(startY, endY, p) + arc;
      chip.style.left = '0px'; chip.style.top = '0px';
      setT(chip, `translate(${cx}px, ${cy}px) scale(${0.9 + Math.sin(p * Math.PI) * 0.35}) rotate(${(p - 0.5) * 10}deg)`);
      setO(chip, Math.min(p * 6, 1) * (1 - seg(p, 0.93, 0.07)));
    });

    /* canteen weekly sums roll as chips land */
    let sum = 0, msum = 0;
    DAYS.forEach(d => {
      sum += d.chapati * seg(t, d.t + FLY + FLY_D - 0.15, 0.45, E.outCubic);
      msum += d.mandazi * seg(t, d.t + FLY + FLY_D + 0.05, 0.45, E.outCubic);
    });
    R.weekOdo.set(sum);
    R.mandOdo.set(msum);
    const landPulse = DAYS.reduce((a, d) => Math.max(a, pulse(t, d.t + FLY + FLY_D - 0.1, d.t + FLY + FLY_D + 0.5, 0.1, 0.4)), 0);
    R.autoB.style.boxShadow = `0 0 ${landPulse * 18}px rgba(234,191,99,${landPulse * 0.8})`;

    /* carry-forward beat on the left phone */
    const showCards = seg(t, CARRY_T - 0.7, 0.6, E.outCubic);
    R.closeCard.style.opacity = showCards;
    R.openCard.style.opacity = showCards;
    setT(R.closeCard, `translateY(${(1 - showCards) * 22}px)`);
    setT(R.openCard, `translateY(${(1 - showCards) * 30}px)`);
    const slide = seg(t, CARRY_T + 0.9, 0.9, E.inOutCubic);
    const gx = lX + pw * 0.74, gy0 = pY + ph * 0.53, gy1 = pY + ph * 0.645;
    if (slide > 0 && slide < 1) {
      R.ghost.style.left = '0px'; R.ghost.style.top = '0px';
      setT(R.ghost, `translate(${gx}px, ${mix(gy0, gy1, slide)}px) scale(${1 + Math.sin(slide * Math.PI) * 0.25})`);
      setO(R.ghost, 1);
    } else setO(R.ghost, 0);
    R.openVal.textContent = slide >= 1 ? '34' : '—';
    R.openVal.style.color = slide >= 1 ? 'var(--gold-deep)' : 'var(--ink-3)';
    const oPulse = pulse(t, CARRY_T + 1.75, CARRY_T + 2.6, 0.12, 0.6);
    R.openCard.style.boxShadow = `0 1px 2px rgba(26,22,32,0.06), 0 0 ${oPulse * 26}px rgba(234,191,99,${oPulse * 0.55})`;
    R.openAuto.style.opacity = slide >= 1 ? 1 : 0.35;

    /* captions — bottom center */
    const capY = tall ? H * 0.755 : H * 0.845;
    for (const [cap, text, t0, dur, tOut, size] of [
      [R.cap1, 'The restaurant sends daily. The canteen counts weekly.\nThe system does the math in between.', 2.3, 2.2, 9.6, tall ? 34 : 44],
      [R.cap2, 'Nobody retypes a number\nthe system already knows.', CARRY_T + 0.4, 1.6, 99, tall ? 34 : 44],
    ]) {
      cap.style.left = W * 0.05 + 'px'; cap.style.width = W * 0.90 + 'px';
      cap.style.top = capY + 'px';
      cap.style.fontSize = size + 'px'; cap.style.lineHeight = '1.35'; cap.style.whiteSpace = 'pre-line';
      typeInto(cap, text, seg(t, t0, dur));
      setO(cap, seg(t, t0, 0.3) * (1 - seg(t, tOut, 0.6, E.inCubic)) * (1 - exit));
    }
  },
});

})();
