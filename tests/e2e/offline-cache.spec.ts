import { expect, test, type Locator, type Page } from "@playwright/test";
import { authenticate, seedEntry, sourceValue } from "./editor-fixtures";

// A click dispatched before the surrounding layout settles takes no focus, and
// the typing that follows would go nowhere instead of reaching the entry, so the
// click is retried until the editor reports focus.
async function clickAndFocus(page: Page, target: Locator) {
  await expect(async () => {
    await target.click();
    await expect(page.locator(".live-editor-host .cm-editor")).toHaveClass(/cm-focused/, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

const paragraph = "Started the morning with coffee and a short review of the last few entries before opening the laptop.";
const documentText = `${paragraph}\n\nSecond paragraph about the afternoon.\n`;
const cacheDate = (browserName: string) => browserName === "webkit" ? "2095-09-02" : "2095-09-01";

test("keeps new writing when a failed request is answered from the offline cache", async ({ page, browserName }) => {
  const date = cacheDate(browserName);
  await authenticate(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await seedEntry(page, date, documentText);

  const autosaved = page.waitForResponse((response) => response.url().includes(`/api/entries?date=${date}`) && response.request().method() === "PUT");
  await clickAndFocus(page, page.locator(".cm-line").last());
  await page.keyboard.type("Then the afternoon got away from me.");
  await autosaved;
  await expect(page.locator(".save-control")).toHaveText("Saved");

  // The service worker answers a failed read with the copy it stored on an
  // earlier visit, marked so the app can tell it apart from a fresh answer.
  await page.route(`**/api/entries?date=${date}`, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      headers: { "Content-Type": "application/json", "X-Paralog-Offline": "1" },
      body: JSON.stringify({ date, content: documentText, exists: true, previousYears: [], memories: [], template: "" }),
    });
  });

  const refreshed = page.waitForResponse((response) => response.url().includes(`/api/entries?date=${date}`) && response.headers()["x-paralog-offline"] === "1");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await page.waitForTimeout(400);

  expect(await sourceValue(page)).toContain("Then the afternoon got away from me.");
});
