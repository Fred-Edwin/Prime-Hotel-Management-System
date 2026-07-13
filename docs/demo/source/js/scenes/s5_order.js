/* SCENE 5 — From WhatsApp chat to record-of-truth: a green chat
   bubble dissolves into a structured order card; the zone fee
   auto-fills with a tick. */
'use strict';

(() => {

const MORPH_T = 3.2;     // bubble → card
const FEE_T = 5.1;       // zone fee auto-fills
const TOTAL_T = 5.7;     // total rolls

FILM.scene({
  name: 'order',
  start: 46.0, end: 56.6,

  build(root) {
    el('div', 'amb', root);
    el('div', 'vignette', root);

    const bubble = el('div', 'waBubble', root);
    const meta = el('div', 'waMeta', bubble);
    el('span', '', meta, 'Sandra K.');
    el('span', 'waTime', meta, '12:41');
    el('div', '', bubble, '2 chapati na chai moja — deliver Kihumbuini please');

    const card = el('div', 'orderCard', root);
    const head = el('div', 'ocHead', card);
    el('div', 'ocName', head, 'Sandra K.');
    el('div', 'ocKind', head, 'Delivery');
    const zone = el('div', 'ocZone', card);
    const zn = el('div', 'ocZoneName', zone);
    icon('pin', 16, zn); zn.appendChild(document.createTextNode('Kihumbuini'));
    const feeWrap = el('div', 'ocFee', zone);
    const feeTick = el('span', 'tick', feeWrap, '✓');
    feeTick.style.marginRight = '7px'; feeTick.style.verticalAlign = '2px';
    feeTick.style.width = '17px'; feeTick.style.height = '17px'; feeTick.style.fontSize = '10px';
    const feeVal = el('span', '', feeWrap, 'KES 100');
    const lines = el('div', '', card); lines.style.marginTop = '10px';
    const l1 = el('div', 'ocLine', lines); el('span', '', l1, 'Chapati × 2'); el('b', '', l1, 'KES 50');
    const l2 = el('div', 'ocLine', lines); el('span', '', l2, 'African Tea × 1'); el('b', '', l2, 'KES 30');
    const tot = el('div', 'ocTotal', card);
    el('span', '', tot, 'Total');
    const totOdo = new Odometer(el('b', '', tot), { maxDigits: 3 });

    const capOver = el('div', 'capSmall', root, 'DELIVERY ORDERS');
    const capBar = el('div', 'capBar', root);
    const cap = el('div', 'cap', root, '');
    cap.style.textAlign = 'center';
    return { bubble, card, feeTick, feeVal, totOdo, l1, l2, capOver, capBar, cap };
  },

  render(t, R) {
    const { W, H, tall } = FILM;
    const cx = W / 2 - 230;
    const byC = tall ? H * 0.30 : H * 0.245;

    /* bubble: springs in, jitters alive, then morphs away */
    const bIn = seg(t, 0.35, 0.9, E.springSoft);
    const morph = seg(t, MORPH_T, 1.0, E.inOutCubic);
    R.bubble.style.left = cx + 'px';
    R.bubble.style.top = byC + 'px';
    const wob = Math.sin(t * 1.6) * 3;
    setT(R.bubble, `translateY(${(1 - bIn) * 60 + wob - morph * 30}px) scale(${mix(0.7, 1, bIn) * (1 - morph * 0.12)}) rotate(${morph * -3}deg)`);
    setO(R.bubble, bIn * (1 - seg(t, MORPH_T + 0.15, 0.5)));

    /* card: rises out of the bubble */
    const cIn = seg(t, MORPH_T + 0.35, 0.9, E.springSoft);
    R.card.style.left = cx + 'px';
    R.card.style.top = (byC + 30) + 'px';
    setT(R.card, `translateY(${(1 - cIn) * 90}px) scale(${mix(0.85, 1, cIn)})`);
    setO(R.card, cIn * (1 - seg(t, 9.5, 0.9, E.inCubic)));

    /* item lines cascade in */
    for (const [line, d] of [[R.l1, 0.25], [R.l2, 0.42]]) {
      const p = seg(t, MORPH_T + 0.5 + d, 0.5, E.outCubic);
      setO(line, p);
      setT(line, `translateX(${(1 - p) * 26}px)`);
    }

    /* fee auto-fill: tick pops, fee glows once */
    const feeIn = seg(t, FEE_T, 0.45, E.outBack);
    setO(R.feeTick, feeIn);
    setT(R.feeTick, `scale(${feeIn})`);
    const feeGlow = pulse(t, FEE_T, FEE_T + 0.9, 0.15, 0.6);
    R.feeVal.style.textShadow = `0 0 ${feeGlow * 14}px rgba(209,159,72,${feeGlow * 0.9})`;
    setO(R.feeVal, seg(t, FEE_T - 0.05, 0.3));

    /* total rolls up */
    R.totOdo.set(180 * seg(t, TOTAL_T, 0.8, E.outCubic));

    /* captions */
    const capY = tall ? H * 0.76 : H * 0.80;
    const oIn = seg(t, 5.9, 0.5, E.outCubic);
    R.capOver.style.left = '0px'; R.capOver.style.width = W + 'px';
    R.capOver.style.textAlign = 'center';
    R.capOver.style.top = (capY - 56) + 'px';
    setO(R.capOver, oIn * (1 - seg(t, 9.5, 0.9)));
    R.capBar.style.left = (W / 2 - 22) + 'px'; R.capBar.style.top = (capY - 14) + 'px';
    R.capBar.style.width = oIn * 44 + 'px';
    setO(R.capBar, oIn * (1 - seg(t, 9.5, 0.9)));
    R.cap.style.left = W * 0.06 + 'px'; R.cap.style.width = W * 0.88 + 'px';
    R.cap.style.top = capY + 'px';
    R.cap.style.fontSize = (tall ? 40 : 46) + 'px'; R.cap.style.lineHeight = '1.35';
    typeInto(R.cap, 'Out of the group chat. Into the day’s sales.', seg(t, 6.2, 1.5));
    setO(R.cap, seg(t, 6.2, 0.3) * (1 - seg(t, 9.5, 0.9, E.inCubic)));
  },
});

})();
