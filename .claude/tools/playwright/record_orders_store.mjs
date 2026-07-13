import { chromium } from "playwright";

const BASE = "https://prime-hotel.vercel.app";
const OUT_DIR = "/home/edwinfred/projects/prime-hotel/docs/demo/recordings/orders-store";

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
async function waitForLoaded(loadingText) {
  await page.waitForSelector(`text=${loadingText}`, { state: "detached", timeout: 15000 }).catch(() => {});
}

// ===================== PART A: Orders (Sarah Makena) =====================

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await pause(1000);
await page.locator("text=Select your name").click();
await pause(500);
await page.locator("li, [role='option']", { hasText: "Sarah Makena" }).click();
await pause(500);
await page.locator('input[aria-label="PIN"]').fill("000000");
await page.waitForURL(/entry/, { timeout: 10000 });
await pause(1000);

// Navigate to Orders
const ordersNav = page.locator("a, button", { hasText: "Orders" }).first();
await ordersNav.click();
await page.waitForURL(/orders/, { timeout: 10000 });
await waitForLoaded("Loading orders");
await pause(1200);
await checkpoint("orders-loaded");

// Order 1: Delivery order
const customerNameInput = page.locator('input[placeholder*="Mary Wambui" i], input#customerName, input').first();
await customerNameInput.fill("Grace Wanjiru");
await pause(500);

const deliveryChip = page.locator("button, [role='button']", { hasText: "Delivery" }).first();
await deliveryChip.click();
await pause(800);
await checkpoint("delivery-selected");

const zoneSelect = page.locator("select").first();
if (await zoneSelect.count()) {
  await zoneSelect.selectOption({ label: "Kamakwa" });
  await pause(800);
  await checkpoint("zone-fee-autofilled");
}

// Search and add items
const searchInput = page.locator('input[placeholder*="Search items to add" i]').first();
await searchInput.fill("Tea");
await pause(800);
const addStepper1 = page.locator('button[aria-label*="Increase" i]:not([disabled])').first();
if (await addStepper1.count()) {
  await addStepper1.click();
  await pause(400);
}
await searchInput.fill("");
await pause(500);

await searchInput.fill("Samosa");
await pause(800);
const addStepper2 = page.locator('button[aria-label*="Increase" i]:not([disabled])').first();
if (await addStepper2.count()) {
  await addStepper2.click();
  await pause(400);
}
await searchInput.fill("");
await pause(800);
await checkpoint("delivery-order-cart-filled");

const saveOrderBtn = page.locator("button", { hasText: "Save order" }).first();
if (await saveOrderBtn.count()) {
  await waitForApi("/api/orders", () => saveOrderBtn.click());
  await pause(1000);
  await checkpoint("delivery-order-saved");
}

// Order 2: Pickup order
await customerNameInput.fill("James Kariuki");
await pause(500);
const pickupChip = page.locator("button, [role='button']", { hasText: "Pickup" }).first();
await pickupChip.click();
await pause(500);

await searchInput.fill("Black Tea");
await pause(800);
const addStepper3 = page.locator('button[aria-label*="Increase" i]:not([disabled])').first();
if (await addStepper3.count()) {
  await addStepper3.click({ timeout: 5000 }).catch(() => {});
  await pause(400);
}
await searchInput.fill("");
await pause(800);
await checkpoint("pickup-order-cart-filled");

const pickupSaveEnabled = await saveOrderBtn.isEnabled().catch(() => false);
if (pickupSaveEnabled) {
  await waitForApi("/api/orders", () => saveOrderBtn.click());
  await pause(1000);
  await checkpoint("pickup-order-saved");
} else {
  console.warn("Pickup order Save button disabled -- cart may be empty, skipping save+checkpoint.");
}

// Log out Sarah
const logoutBtn1 = page.locator("button", { hasText: "Log out" }).first();
if (await logoutBtn1.count()) {
  await logoutBtn1.click();
  await pause(1500);
}

// ===================== PART B: Store manager (Janiffer Maina) =====================

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await pause(1000);
await page.locator("text=Select your name").click();
await pause(500);
await page.locator("li, [role='option']", { hasText: "Janiffer Maina" }).click();
await pause(500);
await page.locator('input[aria-label="PIN"]').fill("000000");
await page.waitForURL(/entry/, { timeout: 10000 });
await pause(1000);

const storeNav = page.locator("a, button", { hasText: "Store" }).first();
if (await storeNav.count()) {
  await storeNav.click();
  await page.waitForURL(/store/, { timeout: 10000 });
} else {
  await page.goto(`${BASE}/store`, { waitUntil: "networkidle" });
}
await waitForLoaded("Loading");
await pause(1200);
await checkpoint("store-loaded");

const storeSearchInput = page.locator('input[placeholder*="Search ingredients" i]').first();
if (await storeSearchInput.count()) {
  await storeSearchInput.fill("Rice");
  await pause(800);
  await checkpoint("searched-rice");
}

// Tap "Received" stepper (first stepper group) then "Used in cooking" (second)
const receivedStepper = page.locator('button[aria-label*="received" i][aria-label*="Increase" i]').first();
if (await receivedStepper.count()) {
  for (let i = 0; i < 3; i++) {
    if (!(await receivedStepper.isEnabled().catch(() => false))) break;
    await receivedStepper.click();
    await pause(400);
  }
  await checkpoint("ingredient-received");
}

const usedStepper = page.locator('button[aria-label*="Increase" i]:not([aria-label*="received" i]):not([disabled])').first();
if (await usedStepper.count()) {
  for (let i = 0; i < 2; i++) {
    if (!(await usedStepper.isEnabled().catch(() => false))) break;
    await usedStepper.click();
    await pause(400);
  }
  await checkpoint("ingredient-used");
}

if (await storeSearchInput.count()) {
  await storeSearchInput.fill("");
  await pause(500);
}

await checkpoint("store-till-strip-total");

const storeSaveBtn = page.locator("button", { hasText: "Save" }).first();
if (await storeSaveBtn.count()) {
  await waitForApi("/api/ingredient-entries", () => storeSaveBtn.click());
  await pause(1000);
  await checkpoint("store-saved-success");
}

const logoutBtn2 = page.locator("button", { hasText: "Log out" }).first();
if (await logoutBtn2.count()) {
  await logoutBtn2.click();
  await pause(1500);
  await checkpoint("logged-out");
}

await context.close();
await browser.close();
console.log("Orders + store manager recording complete. Video + checkpoints saved in", OUT_DIR);
