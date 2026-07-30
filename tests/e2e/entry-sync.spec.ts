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

const paragraph = "Started the morning with coffee and a short review of the last few entries before opening the laptop. The pattern is obvious: I write better when I stop trying to summarize the whole week in one sitting.";
const documentText = `${paragraph}\n\nSecond paragraph about the afternoon.\n\nThird paragraph about the evening.\n`;
const syncDate = (browserName: string) => browserName === "webkit" ? "2097-03-02" : "2097-03-01";

test.beforeEach(async ({ page, browserName }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await seedEntry(page, syncDate(browserName), documentText);
});

test("keeps the cursor in place when a remote change is applied", async ({ page, browserName }) => {
  await clickAndFocus(page, page.locator(".cm-line").filter({ hasText: "Third paragraph about the evening." }).first());
  await page.keyboard.press("End");

  await page.request.put(`/api/entries?date=${syncDate(browserName)}`, {
    data: { content: documentText.replace("Started the morning", "Started the evening") },
  });
  await expect(page.locator(".cm-line").first()).toContainText("Started the evening");

  await page.keyboard.type("!");
  expect(await sourceValue(page)).toContain("Third paragraph about the evening.!");
});

test("keeps the cursor in place when reconnecting re-reads the saved entry", async ({ page, context, browserName }) => {
  // Saved files always end with a newline. The editor buffer does not while the
  // cursor sits at the end of the last line, so a re-read of an entry the user
  // just saved arrives as a change that is invisible on screen.
  const autosaved = page.waitForResponse((response) => response.url().includes(`/api/entries?date=${syncDate(browserName)}`) && response.request().method() === "PUT");
  await clickAndFocus(page, page.locator(".cm-line").last());
  await page.keyboard.type("Wrote it down.");
  await autosaved;
  await expect(page.locator(".save-control")).toHaveText("Saved");

  // Leaving and returning while offline is enough to forget what the server holds.
  await context.setOffline(true);
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.locator(".live-editor-host .cm-editor")).toBeVisible();
  await page.getByRole("button", { name: "Previous day" }).click();
  await expect(page.locator(".cm-line").filter({ hasText: "Wrote it down." }).first()).toBeVisible();

  await clickAndFocus(page, page.locator(".cm-line").filter({ hasText: "Wrote it down." }).first());
  await page.keyboard.press("End");
  const reread = page.waitForResponse((response) => response.url().includes(`/api/entries?date=${syncDate(browserName)}`) && response.request().method() === "GET");
  await context.setOffline(false);
  await reread;
  // The re-read is invisible on screen, so there is nothing to await but the
  // handler that used to rewrite the document behind the cursor.
  await page.waitForTimeout(400);

  await page.keyboard.type("!");
  expect(await sourceValue(page)).toContain("Wrote it down.!");
});

test("a save answered after moving on leaves the newly opened day alone", async ({ page, browserName }) => {
  const left = syncDate(browserName);
  // Hold the save for the day being left so that it is answered only once the
  // next day is open and settled.
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let holding = 0;
  await page.route(`**/api/entries?date=${left}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    holding += 1;
    await held;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) });
  });

  await clickAndFocus(page, page.locator(".cm-line").last());
  await page.keyboard.type("One more line before bed.");
  await expect.poll(() => holding).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.locator(".live-editor-host .cm-editor")).toBeVisible();
  await expect(page.locator(".save-control")).toHaveText("Saved");

  const answered = page.waitForResponse((response) => response.url().includes(`/api/entries?date=${left}`) && response.request().method() === "PUT" && response.status() === 503);
  release();
  await answered;
  await page.waitForTimeout(400);

  // The response describes the day that was left behind. Reading the open day
  // from the render the save started in would report its failure here instead.
  await expect(page.locator(".save-control")).toHaveText("Saved");
});
