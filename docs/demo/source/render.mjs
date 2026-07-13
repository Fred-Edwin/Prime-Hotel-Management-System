// Deterministic frame renderer: node render.mjs [wide|tall]
// Seeks the film frame by frame and captures JPEGs for ffmpeg assembly.
import { chromium } from '/home/edwinfred/projects/prime-hotel/.claude/tools/playwright/node_modules/playwright/index.mjs';
import { fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const fmt = process.argv[2] || 'wide';
const tall = fmt === 'tall';
const [W, H] = tall ? [1080, 1920] : [1920, 1080];
const FPS = 60;

const outDir = path.join(here, 'frames', fmt);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', e => { console.error('PAGE ERROR:', e.message); process.exit(1); });
await page.goto(`file://${here}/index.html?freeze=1${tall ? '&fmt=tall' : ''}`);
await page.evaluate(() => window.__ready);
const duration = await page.evaluate(() => window.__DURATION);
const total = Math.round(duration * FPS);
console.log(`rendering ${fmt}: ${total} frames @ ${FPS}fps (${duration}s)`);

const t0 = Date.now();
for (let i = 0; i < total; i++) {
  await page.evaluate(t => window.__seek(t), i / FPS);
  await page.screenshot({
    path: path.join(outDir, `f${String(i).padStart(5, '0')}.jpg`),
    type: 'jpeg', quality: 92,
  });
  if (i % 300 === 0) {
    const rate = (i + 1) / ((Date.now() - t0) / 1000);
    console.log(`  ${i}/${total} (${rate.toFixed(1)} fps, eta ${((total - i) / rate / 60).toFixed(1)} min)`);
  }
}
console.log(`done ${fmt}: ${total} frames in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
await browser.close();
