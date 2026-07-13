import { chromium } from "playwright";

const BASE = "https://prime-hotel.vercel.app";
const OUT_DIR = "/home/edwinfred/projects/prime-hotel/docs/demo/recordings/admin";

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();

let shotIdx = 0;
async function pause(ms = 1200) {
  await page.waitForTimeout(ms);
}
async function checkpoint(label) {
  shotIdx += 1;
  await page.screenshot({ path: `${OUT_DIR}/checkpoint-${String(shotIdx).padStart(2, "0")}-${label}.png` });
}

// 1. Login
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await pause(1000);
await checkpoint("login-page");
await page.locator("text=Select your name").click();
await pause(500);
await page.locator("li, [role='option']", { hasText: "WaPrecious" }).click();
await pause(500);
await page.locator('input[aria-label="PIN"]').fill("000000");
await pause(1500);

// 2. Dashboard: period toggle
await page.waitForURL(/dashboard/, { timeout: 10000 });
await pause(1500);
await checkpoint("dashboard-today");
for (const label of ["Week", "Month"]) {
  const btn = page.locator("button, [role='tab']", { hasText: label }).first();
  if (await btn.count()) {
    const [response] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/dashboard/summary") && res.status() === 200),
      btn.click(),
    ]);
    await response.finished();
    await pause(800); // let React re-render after the fetch resolves
    await checkpoint(`dashboard-${label.toLowerCase()}`);
  }
}

// 3. Scroll through dashboard (metrics, trend, comparison, low-stock)
await page.mouse.wheel(0, 400);
await pause(1000);
await checkpoint("dashboard-scrolled");

// 4. Ledger
await page.goto(`${BASE}/dashboard/ledger`, { waitUntil: "networkidle" });
await pause(1500);
await checkpoint("ledger");
await page.mouse.wheel(0, 400);
await pause(1500);
await checkpoint("ledger-scrolled");

// 5. Items catalog
await page.goto(`${BASE}/items`, { waitUntil: "networkidle" });
await pause(1500);
await checkpoint("items-list");
const addItemBtn = page.locator("button", { hasText: "Add item" }).first();
if (await addItemBtn.count()) {
  await addItemBtn.click();
  await pause(1500);
  await checkpoint("items-add-modal");
  const cancelBtn = page.locator("button", { hasText: "Cancel" }).first();
  if (await cancelBtn.count()) await cancelBtn.click();
  await pause(1000);
}

// 6. Ingredients
await page.goto(`${BASE}/ingredients`, { waitUntil: "networkidle" });
await pause(1500);
await checkpoint("ingredients-list");

// 7. Delivery Locations
await page.goto(`${BASE}/delivery-locations`, { waitUntil: "networkidle" });
await pause(1500);
await checkpoint("delivery-locations");

// 8. Staff
await page.goto(`${BASE}/staff`, { waitUntil: "networkidle" });
await pause(1500);
await checkpoint("staff-list");

// 9. Log out
const logoutBtn = page.locator("button", { hasText: "Log out" }).first();
if (await logoutBtn.count()) {
  await logoutBtn.click();
  await pause(1500);
  await checkpoint("logged-out");
}

await context.close();
await browser.close();
console.log("Admin recording complete. Video + checkpoints saved in", OUT_DIR);
