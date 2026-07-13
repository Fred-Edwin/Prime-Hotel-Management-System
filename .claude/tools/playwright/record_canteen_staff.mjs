import { chromium } from "playwright";

const BASE = "https://prime-hotel.vercel.app";
const OUT_DIR = "/home/edwinfred/projects/prime-hotel/docs/demo/recordings/canteen-staff";

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  recordVideo: { dir: OUT_DIR, size: { width: 390, height: 844 } },
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
async function waitForApi(urlSubstring, action) {
  const [response] = await Promise.all([
    page.waitForResponse((res) => res.url().includes(urlSubstring) && res.status() < 400),
    action(),
  ]);
  await response.finished();
  await pause(600);
}

// 1. Login as Anne Gitonga (canteen)
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await pause(1000);
await page.locator("text=Select your name").click();
await pause(500);
await page.locator("li, [role='option']", { hasText: "Anne Gitonga" }).click();
await pause(500);
await page.locator('input[aria-label="PIN"]').fill("000000");
await page.waitForURL(/entry/, { timeout: 10000 });
await page.waitForResponse(
  (res) => res.url().includes("/api/stock-entries") && res.status() < 400,
  { timeout: 15000 },
);
await page.waitForSelector("text=Loading this week", { state: "detached", timeout: 15000 }).catch(() => {});
await pause(1500);
await checkpoint("canteen-entry-loaded");

// 2. Search bar to show a canteen_supplied item's read-only "Added stock (from restaurant)" field
const searchInput = page.locator('input[placeholder*="Search" i]').first();
if (await searchInput.count()) {
  await searchInput.fill("Nescafe");
  await pause(1000);
  await checkpoint("searched-nescafe");
  await searchInput.fill("");
  await pause(800);
}

// 3. Show a canteen_supplied item (Dasani / Soda) with read-only Added stock — do NOT tap it
const suppliedLabel = page.locator("text=Added stock (from restaurant)").first();
if (await suppliedLabel.count()) {
  await suppliedLabel.scrollIntoViewIfNeeded();
  await pause(800);
  await checkpoint("supplied-item-readonly");
}

// 4. Tap steppers only on canteen_independent items (Nescafe, Lollipop) --
// their "Added stock" field IS editable (not read-only), unlike canteen_supplied items.
async function tapEnabledStepper(locator, times) {
  const n = await locator.count();
  if (n === 0) return false;
  for (let i = 0; i < times; i++) {
    if (!(await locator.first().isEnabled().catch(() => false))) break;
    await locator.first().click();
    await pause(400);
  }
  return true;
}

// Search for Nescafe again, add stock then log a sale
if (await searchInput.count()) {
  await searchInput.fill("Nescafe");
  await pause(1000);
}
const nescafeAddedStepper = page
  .locator('button[aria-label*="Increase" i]:not([disabled])')
  .first();
await tapEnabledStepper(nescafeAddedStepper, 3);
await checkpoint("nescafe-added-stock");

const nescafeSoldStepper = page
  .locator('button[aria-label*="Increase" i]:not([disabled])')
  .nth(1);
await tapEnabledStepper(nescafeSoldStepper, 2);
await checkpoint("nescafe-quantity-sold");

if (await searchInput.count()) {
  await searchInput.fill("");
  await pause(500);
}

// 5. Search for Lollipop, tap its steppers too
if (await searchInput.count()) {
  await searchInput.fill("Lollipop");
  await pause(1000);
  const lollipopAdded = page.locator('button[aria-label*="Increase" i]:not([disabled])').first();
  await tapEnabledStepper(lollipopAdded, 2);
  const lollipopSold = page.locator('button[aria-label*="Increase" i]:not([disabled])').nth(1);
  await tapEnabledStepper(lollipopSold, 1);
  await pause(500);
  await checkpoint("lollipop-entered");
  await searchInput.fill("");
  await pause(500);
}

// 6. Till strip visible with running total
await checkpoint("till-strip-total");

// 7. Save
const saveBtn = page.locator("button", { hasText: "Save" }).first();
if (await saveBtn.count()) {
  await waitForApi("/api/stock-entries", () => saveBtn.click());
  await pause(1000);
  await checkpoint("saved-success-toast");
}

// 8. Log out
const logoutBtn = page.locator("button", { hasText: "Log out" }).first();
if (await logoutBtn.count()) {
  await logoutBtn.click();
  await pause(1500);
  await checkpoint("logged-out");
}

await context.close();
await browser.close();
console.log("Canteen staff recording complete. Video + checkpoints saved in", OUT_DIR);
