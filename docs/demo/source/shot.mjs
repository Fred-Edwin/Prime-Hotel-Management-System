// Grab a still of the film at time t: node shot.mjs <t> [tall] -> frames/still_<t>[_tall].png
import { chromium } from '/home/edwinfred/projects/prime-hotel/.claude/tools/playwright/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const t = parseFloat(process.argv[2] ?? '0');
const tall = process.argv[3] === 'tall';
const [W, H] = tall ? [1080, 1920] : [1920, 1080];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', e => console.error('PAGE ERROR:', e.message));
page.on('console', m => { if (m.type() === 'error') console.error('CONSOLE:', m.text()); });
await page.goto(`file://${here}/index.html?freeze=1${tall ? '&fmt=tall' : ''}`);
await page.evaluate(() => window.__ready);
await page.evaluate(tt => window.__seek(tt), t);
await page.waitForTimeout(80);
const out = path.join(here, 'frames', `still_${t}${tall ? '_tall' : ''}.png`);
await page.screenshot({ path: out });
console.log(out);
await browser.close();
