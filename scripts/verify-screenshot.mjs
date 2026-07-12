#!/usr/bin/env node
/**
 * Headless-browser verification helper for CLAUDE.md's "verify, don't
 * guess" rule — logs in as a real seeded roster account against a real
 * running dev server, navigates to a route, and captures a screenshot
 * plus the bounding box of any element(s) requested.
 *
 * Uses the Playwright install at .claude/tools/playwright (persistent,
 * gitignored node_modules — see .claude/skills/verify/SKILL.md for the
 * one-time setup). Not a project dependency; not imported by app code.
 *
 * Usage:
 *   node scripts/verify-screenshot.mjs --role sarah --route /entry
 *   node scripts/verify-screenshot.mjs --role anne --route /entry --box ".bottomDock"
 *   node scripts/verify-screenshot.mjs --role admin --route /dashboard --width 768 --height 1024
 *
 * Flags:
 *   --role     one of: admin | janiffer | sarah | mercy | anne (see ROSTER below)
 *   --route    path to navigate to after login, e.g. /entry
 *   --base     base URL, default http://localhost:3000
 *   --width    viewport width, default 390 (a real phone width)
 *   --height   viewport height, default 844
 *   --box      optional CSS selector — if given, prints its boundingBox()
 *              alongside the screenshot, for positioning/pinning claims
 *   --out      output PNG path, default ./verify-<role>-<route>.png
 *              (route slashes replaced with underscores)
 *   --wait     ms to wait after navigation before capturing, default 1200
 *              (lets client-side data fetching settle)
 *   --full     capture full scrollable page, not just the viewport
 *              (default: viewport only, matching what a user actually sees)
 */

import { chromium } from "../.claude/tools/playwright/node_modules/playwright/index.mjs";

// Mirrors scripts/seed-staff.ts's roster exactly. Keep in sync if that
// file's PINs/names ever change — these are dev-only seed credentials,
// never real secrets.
const ROSTER = {
  admin: { name: "WaPrecious", pin: "1234" },
  janiffer: { name: "Janiffer Maina", pin: "1111" }, // restaurant, store manager
  sarah: { name: "Sarah Makena", pin: "2222" }, // restaurant, cashier
  mercy: { name: "Mercy Wanjohi", pin: "3333" }, // restaurant, cashier
  anne: { name: "Anne Gitonga", pin: "4444" }, // canteen
};

function parseArgs(argv) {
  const args = { base: "http://localhost:3000", width: 390, height: 844, wait: 1200, full: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith("--")) continue;
    const name = key.slice(2);
    if (name === "full") {
      args.full = true;
      continue;
    }
    args[name] = argv[++i];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.role || !ROSTER[args.role]) {
    console.error(`--role is required and must be one of: ${Object.keys(ROSTER).join(", ")}`);
    process.exit(1);
  }
  if (!args.route) {
    console.error("--route is required, e.g. --route /entry");
    process.exit(1);
  }

  const { name, pin } = ROSTER[args.role];
  const width = Number(args.width);
  const height = Number(args.height);
  const outPath =
    args.out ?? `./verify-${args.role}-${args.route.replace(/\//g, "_") || "root"}.png`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });

  const loginRes = await page.request.post(`${args.base}/api/auth/login`, {
    data: { name, pin },
  });
  if (!loginRes.ok()) {
    console.error(`Login failed for ${name}: ${loginRes.status()} ${await loginRes.text()}`);
    await browser.close();
    process.exit(1);
  }
  console.log(`Logged in as ${name} (${args.role})`);

  await page.goto(`${args.base}${args.route}`);
  await page.waitForTimeout(Number(args.wait));

  if (args.box) {
    const el = await page.$(args.box);
    if (!el) {
      console.log(`No element matched selector "${args.box}"`);
    } else {
      const box = await el.boundingBox();
      console.log(`boundingBox(${args.box}):`, box, `| viewport: ${width}x${height}`);
    }
  }

  await page.screenshot({ path: outPath, fullPage: args.full });
  console.log(`Saved screenshot: ${outPath}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
