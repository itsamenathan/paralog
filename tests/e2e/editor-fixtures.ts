import { expect, type Page } from "@playwright/test";

export async function authenticate(page: Page) {
  await page.goto("/");
  const response = await page.request.post("/api/auth/login", { data: { password: "paralog" } });
  expect(response.ok()).toBeTruthy();
}

export async function seedEntry(page: Page, date: string, content: string) {
  // Disconnect the open entry before replacing its server-side fixture. Otherwise
  // the synchronization channel correctly reports the fixture reset as a remote
  // edit and presents the conflict UI.
  await page.goto("about:blank");
  const response = await page.request.put(`/api/entries?date=${date}`, {
    data: { content },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto(`/?date=${date}`);
  await expect(page.locator(".live-editor-host .cm-editor")).toBeVisible();
  await expect(page.locator(".cm-line").filter({ hasText: content.split("\n").find((line) => line.length > 20) ?? "" }).first()).toBeVisible();
}

export async function sourceValue(page: Page) {
  await page.getByRole("button", { name: "Markdown source" }).click();
  const value = await page.locator("textarea.source-editor").inputValue();
  await page.getByRole("button", { name: "Editor view" }).click();
  await expect(page.locator(".live-editor-host .cm-editor")).toBeVisible();
  return value;
}

// Clicking at a point measured earlier can miss. The entry is re-seeded between
// passes, and on a loaded machine the surrounding layout can still be settling
// when the click is dispatched. A missed click leaves the editor unfocused and
// silently drops whatever is typed next, which surfaces much later as a
// confusing assertion about text that never arrived. Re-measuring the point and
// retrying until the editor holds focus keeps that from being a coin flip.
export async function clickInEditor(page: Page, point: () => Promise<{ x: number; y: number }>) {
  await expect(async () => {
    const { x, y } = await point();
    await page.mouse.click(x, y);
    // Short, so a miss is retried against freshly measured coordinates rather
    // than spending the whole budget waiting on the click that already missed.
    await expect(page.locator(".live-editor-host .cm-editor")).toHaveClass(/cm-focused/, { timeout: 500 });
  }).toPass({ timeout: 10_000 });
}

export async function lineTextRects(page: Page, startsWith: string) {
  return page.locator(".cm-line").evaluateAll((lines, prefix) => {
    const line = lines.find((candidate) => candidate.textContent?.startsWith(prefix));
    if (!line) throw new Error(`Could not find editor line starting with ${prefix}`);
    const range = document.createRange();
    range.selectNodeContents(line);
    return [...range.getClientRects()]
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }));
  }, startsWith);
}

export async function pointAtTextOffset(
  page: Page,
  startsWith: string,
  offset: number,
) {
  return page.locator(".cm-line").evaluateAll((lines, args) => {
    const line = lines.find((candidate) => candidate.textContent?.startsWith(args.startsWith));
    if (!line) throw new Error(`Could not find editor line starting with ${args.startsWith}`);

    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let remaining = args.offset;
    let textNode = walker.nextNode();
    while (textNode) {
      const length = textNode.textContent?.length ?? 0;
      if (remaining < length) {
        const range = document.createRange();
        range.setStart(textNode, remaining);
        range.setEnd(textNode, Math.min(remaining + 1, length));
        const rect = range.getBoundingClientRect();
        return { x: rect.left + 0.5, y: rect.top + rect.height / 2 };
      }
      remaining -= length;
      textNode = walker.nextNode();
    }
    throw new Error(`Text offset ${args.offset} is outside the matching editor line`);
  }, { startsWith, offset });
}
