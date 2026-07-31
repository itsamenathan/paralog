import { expect, test } from "@playwright/test";
import {
  authenticate,
  clickInEditor,
  lineTextRects,
  pointAtTextOffset,
  seedEntry,
  sourceValue,
} from "./editor-fixtures";

const paragraph = "Started the morning with coffee and a short review of the last few entries before opening the laptop. The pattern is obvious: I write better when I stop trying to summarize the whole week in one sitting.";
const documentText = `${paragraph}\n\nNext logical line.\n\n## Heading with **bold**, *italic*, ~~strike~~, \`code\`, and [link](https://example.com)\n\n> Quoted line\n- [x] Finished task\n- Bullet item\n`;
// Front matter is part of the fixture because its rendered rows are what pull
// CodeMirror's own vertical motion off the adjacent line further down the entry.
const listDocument = `---\nlocation: "Erie, Colorado, United States"\nweight: 221\n---\n\n## Today\n\n- Tightened the demo outline for #work.\n- Booked time with @alex to review the August plan.\n- Added a realistic grocery list instead of another vague note to eat better.\n`;
const primaryDate = (browserName: string) => browserName === "webkit" ? "2098-01-02" : "2098-01-01";

test.beforeEach(async ({ page, browserName }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 900, height: 700 });
  await seedEntry(page, primaryDate(browserName), documentText);
});

test("maps every wrapped row and trailing whitespace to the paragraph", async ({ page, browserName }) => {
  const rowCount = (await lineTextRects(page, "Started the morning")).length;
  expect(rowCount).toBeGreaterThanOrEqual(3);

  for (let row = 0; row < rowCount; row += 1) {
    await clickInEditor(page, async () => {
      const rects = await lineTextRects(page, "Started the morning");
      const rect = rects[row];
      return {
        x: row === rects.length - 1 ? Math.min(rect.right + 220, 490) : rect.left + rect.width * 0.65,
        y: rect.top + rect.height / 2,
      };
    });
    await page.keyboard.type("X");
    const markdown = await sourceValue(page);
    const paragraphLine = markdown.split("\n")[0];
    expect(paragraphLine).toContain("X");
    expect(markdown.split("\n")[1]).toBe("");
    await seedEntry(page, primaryDate(browserName), documentText);
    await expect(page.locator(".cm-line").filter({ hasText: "Started the morning" }).first()).toContainText(paragraph);
  }
});

test("keeps forward and backward drag selections inside wrapped Markdown", async ({ page }) => {
  const selectionFrom = "Started the ".length;
  const selectionTo = paragraph.length - 1;
  const start = await pointAtTextOffset(page, "Started the morning", selectionFrom);
  const end = await pointAtTextOffset(page, "Started the morning", selectionTo);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Bold", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  expect(await sourceValue(page)).toBe(
    documentText.replace(paragraph, `Started the **${paragraph.slice(selectionFrom, selectionTo)}**.`),
  );

  await seedEntry(page, "2098-01-03", documentText);
  const resetStart = await pointAtTextOffset(page, "Started the morning", selectionFrom);
  const resetEnd = await pointAtTextOffset(page, "Started the morning", selectionTo);
  await page.mouse.move(resetEnd.x, resetEnd.y);
  await page.mouse.down();
  await page.mouse.move(resetStart.x, resetStart.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: "Italic", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Italic", exact: true }).click();
  expect(await sourceValue(page)).toBe(
    documentText.replace(paragraph, `Started the *${paragraph.slice(selectionFrom, selectionTo)}*.`),
  );
});

test("reveals active syntax without changing Markdown", async ({ page }) => {
  const before = await sourceValue(page);
  const heading = page.locator(".cm-line").filter({ hasText: "Heading with" }).first();
  await expect(heading).toHaveClass(/cm-live-heading/);
  expect(await heading.textContent()).not.toContain("##");
  await heading.click({ position: { x: 120, y: 12 } });
  await expect(heading).toContainText("##");
  expect(await sourceValue(page)).toBe(before);
  await expect(page.locator(".cm-live-task-checkbox")).toHaveCount(1);
  await expect(page.locator("a.cm-live-navigation").filter({ hasText: "link" })).toHaveCount(1);
});

test("continues Markdown lists without rewriting lowercase input", async ({ page, browserName }) => {
  await seedEntry(page, browserName === "webkit" ? "2098-01-16" : "2098-01-15", "* Test");
  await clickInEditor(page, async () => {
    const [rect] = await lineTextRects(page, "* Test");
    return { x: Math.min(rect.right + 100, 500), y: rect.top + rect.height / 2 };
  });
  await page.keyboard.press("Enter");
  await expect(page.locator(".cm-content")).toHaveAttribute("autocapitalize", "sentences");
  await page.keyboard.insertText("t");
  await page.waitForTimeout(50);
  expect(await sourceValue(page)).toBe("* Test\n* t\n");
});

test("preserves metadata editing and mobile theme/view fallbacks", async ({ page }) => {
  const metadata = `---\nlocation: \"Denver, Colorado\"\n---\n\n${documentText}`;
  await seedEntry(page, "2098-01-04", metadata);
  await expect(page.locator(".cm-live-metadata-preview")).toHaveCount(3);
  await page.locator(".cm-live-metadata-field").click();
  await expect(page.locator(".cm-live-metadata-editing")).toHaveCount(3);

  await page.setViewportSize({ width: 390, height: 844 });
  const currentTheme = await page.locator("html").getAttribute("data-theme");
  if (currentTheme === "light") {
    await page.getByRole("button", { name: "Use dark mode" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  }
  await page.getByRole("button", { name: "Use light mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Reading view" }).click();
  await expect(page.locator("article.preview")).toBeVisible();
  await page.getByRole("button", { name: "Markdown source" }).click();
  await expect(page.locator("textarea.source-editor")).toBeVisible();
});

test("keeps vertical movement and image reflow on the intended document lines", async ({ page, browserName }) => {
  const imageDocument = `${paragraph}\n\n![Paralog icon](/icon.svg)\n\nAfter the image.`;
  await seedEntry(page, browserName === "webkit" ? "2098-01-06" : "2098-01-05", imageDocument);
  await expect(page.locator(".cm-live-image img")).toHaveJSProperty("complete", true);

  await clickInEditor(page, () => pointAtTextOffset(page, "Started the morning", 16));
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("X");
  let markdown = await sourceValue(page);
  expect(markdown.split("\n")[0]).toContain("X");
  expect(markdown.split("\n")[1]).toBe("");

  await seedEntry(page, browserName === "webkit" ? "2098-01-08" : "2098-01-07", imageDocument);
  await clickInEditor(page, () => pointAtTextOffset(page, "After the image", 6));
  await page.keyboard.type("X");
  markdown = await sourceValue(page);
  expect(markdown.split("\n").find((line) => line.includes("After"))).toBe("After Xthe image.");
});

test("preserves Vim logical-line and visual-row movement", async ({ page, browserName }) => {
  const settings = await page.request.put("/api/settings", { data: { vimMode: true } });
  expect(settings.ok()).toBeTruthy();
  try {
    await seedEntry(page, browserName === "webkit" ? "2098-01-10" : "2098-01-09", documentText);
    await expect(page.locator(".cm-vim-panel")).toBeVisible();
    await clickInEditor(page, () => pointAtTextOffset(page, "Started the morning", 5));
    await page.keyboard.press("Escape");
    await page.keyboard.press("j");
    await page.keyboard.press("i");
    await page.keyboard.type("X");
    let markdown = await sourceValue(page);
    expect(markdown.split("\n")[1]).toBe("X");

    await seedEntry(page, browserName === "webkit" ? "2098-01-12" : "2098-01-11", documentText);
    await clickInEditor(page, () => pointAtTextOffset(page, "Started the morning", 5));
    await page.keyboard.press("Escape");
    await page.keyboard.press("g");
    await page.keyboard.press("j");
    await page.keyboard.press("i");
    await page.keyboard.type("X");
    markdown = await sourceValue(page);
    expect(markdown.split("\n")[0]).toContain("X");
    expect(markdown.split("\n")[1]).toBe("");

    // Vim owns the arrow keys in normal mode, where they must land on the
    // adjacent logical line instead of stepping over neighbours whose Markdown
    // markers Live Preview replaced with a widget.
    await seedEntry(page, browserName === "webkit" ? "2098-01-14" : "2098-01-13", listDocument);
    await page.locator(".cm-line").filter({ hasText: "Added a realistic" }).first().click({ position: { x: 90, y: 8 } });
    await page.keyboard.press("Escape");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("i");
    await page.keyboard.type("X");
    markdown = await sourceValue(page);
    expect(markdown.split("\n").findIndex((line) => line.includes("X"))).toBe(8);
  } finally {
    await page.request.put("/api/settings", { data: { vimMode: false } });
  }
});
