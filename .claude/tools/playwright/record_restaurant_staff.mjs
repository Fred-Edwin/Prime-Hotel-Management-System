import { chromium } from "playwright";

const BASE = "https://prime-hotel.vercel.app";
const OUT_DIR = "/home/edwinfred/projects/prime-hotel/docs/demo/recordings/restaurant-staff";

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

// 1. Login as Sarah
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await pause(1000);
await page.locator("text=Select your name").click();
await pause(500);
await page.locator("li, [role='option']", { hasText: "Sarah Makena" }).click();
await pause(500);
await page.locator('input[aria-label="PIN"]').fill("000000");
await page.waitForURL(/entry/, { timeout: 10000 });
await pause(1500);
await checkpoint("entry-loaded");

// 2. Category chips filter
const snacksChip = page.locator("button, [role='button']", { hasText: "Snacks" }).first();
if (await snacksChip.count()) {
  await snacksChip.click();
  await pause(1000);
  await checkpoint("filtered-snacks");
  const allChip = page.locator("button, [role='button']", { hasText: "All" }).first();
  if (await allChip.count()) {
    await allChip.click();
    await pause(1000);
  }
}

// 3. Search bar
const searchInput = page.locator('input[placeholder*="Search" i]').first();
if (await searchInput.count()) {
  await searchInput.fill("Tea");
  await pause(1000);
  await checkpoint("searched-tea");
  await searchInput.fill("");
  await pause(800);
}

// 4. Tap steppers on a couple of ENABLED items (till quantity sold) --
// some may already be disabled (at their remaining-stock cap), which is
// correct oversell-prevention behavior, not a bug -- skip those.
async function tapEnabledStepper(times) {
  const buttons = page.locator('button[aria-label*="Increase" i]:not([disabled])');
  const n = await buttons.count();
  if (n === 0) return false;
  for (let i = 0; i < times; i++) {
    if (!(await buttons.first().isEnabled())) break;
    await buttons.first().click();
    await pause(400);
  }
  return true;
}

const tappedFirst = await tapEnabledStepper(3);
if (tappedFirst) await checkpoint("stepper-tapped");

// Tap a second, different enabled item's stepper
const secondEnabled = page.locator('button[aria-label*="Increase" i]:not([disabled])').nth(1);
if (await secondEnabled.count()) {
  for (let i = 0; i < 2; i++) {
    if (!(await secondEnabled.isEnabled().catch(() => false))) break;
    await secondEnabled.click();
    await pause(400);
  }
}

// 5. Log wastage on one row
const wastageToggle = page.locator("button, [role='button']", { hasText: "Log wastage" }).first();
if (await wastageToggle.count()) {
  await wastageToggle.click();
  await pause(800);
  await checkpoint("wastage-expanded");
  const wastageIncrease = page.locator('button[aria-label*="Increase" i]:not([disabled])').last();
  if (await wastageIncrease.count()) {
    await wastageIncrease.click({ timeout: 5000 }).catch(() => {});
    await pause(500);
  }
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

// 8. Navigate to Expenses via bottom nav
const expensesNav = page.locator("a, button", { hasText: "Expenses" }).first();
if (await expensesNav.count()) {
  await expensesNav.click();
  await page.waitForURL(/expenses/, { timeout: 10000 });
  await pause(1500);
  await checkpoint("expenses-loaded");

  // Fill and submit an expense
  const amountInput = page.locator('input[type="number"]').first();
  if (await amountInput.count()) {
    await amountInput.fill("450");
    await pause(500);
    const noteInput = page.locator('input[placeholder*="note" i], input[placeholder*="KPLC" i]').first();
    if (await noteInput.count()) {
      await noteInput.fill("Charcoal restock");
      await pause(500);
    }
    await checkpoint("expense-filled");

    const addExpenseBtn = page.locator("button", { hasText: "Add expense" }).first();
    if (await addExpenseBtn.count()) {
      await waitForApi("/api/expenses", () => addExpenseBtn.click());
      await pause(1000);
      await checkpoint("expense-added");
    }
  }
}

// 9. Log out
const logoutBtn = page.locator("button", { hasText: "Log out" }).first();
if (await logoutBtn.count()) {
  await logoutBtn.click();
  await pause(1500);
  await checkpoint("logged-out");
}

await context.close();
await browser.close();
console.log("Restaurant staff recording complete. Video + checkpoints saved in", OUT_DIR);
