import { chromium } from "playwright";

const baseUrl = process.env.SMOKE_URL ?? "http://127.0.0.1:5173";

async function checkDashboard(page, viewportName) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill("therapist@demo.local");
  await page.getByLabel(/password/i).fill("demo-password");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.getByRole("button", { name: /live glove monitor/i }).click();
  await page.getByRole("button", { name: /start session/i }).click();
  await page.waitForTimeout(1500);

  await page.getByText(/current gesture/i).waitFor();
  await page.getByText(/thumb/i).waitFor();
  await page.getByText(/reps completed/i).waitFor();
  const bars = await page.locator(".finger-row").count();
  if (bars < 5) {
    throw new Error(`${viewportName} missing finger bend bars`);
  }

  await page.getByRole("button", { name: /rehab games/i }).click();
  await page.getByRole("heading", { name: /today.s rehab plan/i }).waitFor();
  const games = await page.locator(".assignment-card h3").allInnerTexts();
  if (games.length !== 4 || !games.includes("Ball Pickup") || !games.includes("Finger Tap Piano")) {
    throw new Error(`${viewportName} missing patient rehab games: ${games.join(", ")}`);
  }
}

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await checkDashboard(desktop, "desktop");
  await desktop.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await checkDashboard(mobile, "mobile");
  await mobile.close();

  console.log("Smoke checks passed");
} finally {
  await browser.close();
}
