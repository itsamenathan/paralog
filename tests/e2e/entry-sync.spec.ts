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

test("writing saved offline does not replace a newer save from another device", async ({ page, context, browserName }) => {
  const date = syncDate(browserName);
  await clickAndFocus(page, page.locator(".cm-line").last());
  await context.setOffline(true);
  await page.keyboard.type("Written on the train.");
  await expect(page.locator(".save-control")).toHaveText("Saved offline");

  // Another device saves on top of the copy it last read.
  const elsewhere = documentText.replace("Third paragraph", "Edited elsewhere: third paragraph");
  const { version } = await (await page.request.get(`/api/entries?date=${date}`)).json();
  expect((await page.request.put(`/api/entries?date=${date}`, { data: { content: elsewhere, baseVersion: version } })).ok()).toBeTruthy();

  await context.setOffline(false);
  await expect(page.locator(".sync-conflict")).toBeVisible();
  // Reconnecting asks before anything is written over the other device's save.
  await page.waitForTimeout(1_500);
  expect((await (await page.request.get(`/api/entries?date=${date}`)).json()).content).toBe(elsewhere);

  await page.getByRole("button", { name: "Keep mine" }).click();
  await expect(page.locator(".sync-conflict")).toBeHidden();
  await expect(page.locator(".save-control")).toHaveText("Saved");
  expect((await (await page.request.get(`/api/entries?date=${date}`)).json()).content).toContain("Written on the train.");
});

test("a save made on top of an outdated copy is refused", async ({ page, browserName }) => {
  const date = syncDate(browserName);
  const { version } = await (await page.request.get(`/api/entries?date=${date}`)).json();
  const first = await page.request.put(`/api/entries?date=${date}`, { data: { content: "First device.", baseVersion: version } });
  expect(first.ok()).toBeTruthy();
  const stale = await page.request.put(`/api/entries?date=${date}`, { data: { content: "Second device.", baseVersion: version } });
  expect(stale.status()).toBe(409);
  expect((await stale.json()).entry.content).toBe("First device.\n");
  // Retrying a save that already landed is not a conflict.
  expect((await page.request.put(`/api/entries?date=${date}`, { data: { content: "First device.", baseVersion: version } })).ok()).toBeTruthy();
  const next = await page.request.put(`/api/entries?date=${date}`, { data: { content: "Second device.", baseVersion: (await first.json()).version } });
  expect(next.ok()).toBeTruthy();
});

test("writing typed just before the page closes survives a failed save", async ({ page, browserName }) => {
  const date = syncDate(browserName);
  await page.route(`**/api/entries?date=${date}`, (route) => route.request().method() === "PUT" ? route.abort() : route.continue());
  await clickAndFocus(page, page.locator(".cm-line").last());
  await page.keyboard.type("Typed right before closing.");
  // Reloading inside the autosave pause, while every save fails.
  await page.reload();
  await expect(page.locator(".cm-line").filter({ hasText: "Typed right before closing." }).first()).toBeVisible();

  await page.unroute(`**/api/entries?date=${date}`);
  const synced = page.waitForResponse((response) => response.url().includes(`/api/entries?date=${date}`) && response.request().method() === "PUT" && response.ok());
  await page.reload();
  await synced;
  await expect(page.locator(".save-control")).toHaveText("Saved");
  expect((await (await page.request.get(`/api/entries?date=${date}`)).json()).content).toContain("Typed right before closing.");
});

test("leaving the page sends writing without waiting for the autosave pause", async ({ page, browserName }) => {
  const date = syncDate(browserName);
  await clickAndFocus(page, page.locator(".cm-line").last());
  await page.keyboard.type("Sent on the way out.");
  const started = Date.now();
  const save = page.waitForRequest((request) => request.url().includes(`/api/entries?date=${date}`) && request.method() === "PUT");
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide")));
  expect((await save).postDataJSON().content).toContain("Sent on the way out.");
  expect(Date.now() - started).toBeLessThan(600);
});

test("a save that landed after its reply was lost is not reported as a conflict", async ({ page, browserName }) => {
  const date = syncDate(browserName);
  // The first save reaches the server, but its reply never arrives, as when the
  // page closes mid-request. Later saves queue behind it and are never sent.
  let landed = 0;
  await page.route(`**/api/entries?date=${date}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    landed += 1;
    await route.fetch();
    await new Promise(() => {});
  });
  await clickAndFocus(page, page.locator(".cm-line").last());
  await page.keyboard.type("Landed without a reply.");
  await expect.poll(() => landed).toBe(1);
  await page.keyboard.type(" Then kept writing.");
  await expect.poll(async () => (await (await page.request.get(`/api/entries?date=${date}`)).json()).content).toContain("Landed without a reply.");

  await page.unroute(`**/api/entries?date=${date}`);
  await page.reload();
  await expect(page.locator(".cm-line").filter({ hasText: "Then kept writing." }).first()).toBeVisible();
  // The server's copy is this device's own save, so the later writing is sent on
  // top of it rather than offered as a choice between two versions.
  await expect(page.locator(".save-control")).toHaveText("Saved");
  await expect(page.locator(".sync-conflict")).toBeHidden();
  expect((await (await page.request.get(`/api/entries?date=${date}`)).json()).content).toContain("Landed without a reply. Then kept writing.");
});

test("an ended session keeps writing on the device and syncs it after signing in", async ({ page, browserName }) => {
  const date = syncDate(browserName);
  await clickAndFocus(page, page.locator(".cm-line").last());
  // Signing out elsewhere ends every session, including this page's.
  expect((await page.request.post("/api/auth/logout")).ok()).toBeTruthy();
  const refused = page.waitForResponse((response) => response.url().includes(`/api/entries?date=${date}`) && response.request().method() === "PUT" && response.status() === 401);
  await page.keyboard.type("Written after the session ended.");
  await refused;
  await expect(page.locator(".save-control")).toHaveText("Signed out");
  await expect(page.locator(".signed-out-banner")).toBeVisible();

  expect((await page.request.post("/api/auth/login", { data: { password: "paralog" } })).ok()).toBeTruthy();
  const synced = page.waitForResponse((response) => response.url().includes(`/api/entries?date=${date}`) && response.request().method() === "PUT" && response.ok());
  await page.locator(".signed-out-banner").getByRole("button", { name: "Sign in" }).click();
  await synced;
  await expect(page.locator(".signed-out-banner")).toBeHidden();
  await expect(page.locator(".save-control")).toHaveText("Saved");
  expect((await (await page.request.get(`/api/entries?date=${date}`)).json()).content).toContain("Written after the session ended.");
});
