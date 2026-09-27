import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("textbox", { name: "Markdown document" }),
  ).toBeVisible();
});
test("saves a draft with undo history across reload", async ({ page }) => {
  await page
    .getByRole("textbox", { name: "Draft title" })
    .fill("A place for words");
  const editor = page.getByRole("textbox", { name: "Markdown document" });
  await editor.fill("The first line.");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Draft title" })).toHaveValue(
    "A place for words",
  );
  await expect(editor).toHaveText("The first line.");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor).toHaveText("");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  await page.reload();
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(editor).toHaveText("The first line.");
});
test("renders Markdown without executing embedded scripts", async ({
  page,
}) => {
  await page
    .getByRole("textbox", { name: "Markdown document" })
    .fill(
      '# A heading\n\n| One | Two |\n| --- | --- |\n| A | B |\n\n~~gone~~ **bold**\n\n<script>document.title="unsafe"</script>\n<img src=x onerror="document.title=\'unsafe\'">',
    );
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator("#rendered h1")).toHaveText("A heading");
  await expect(page.locator("#rendered table")).toBeVisible();
  await expect(page.locator("#rendered s")).toHaveText("gone");
  await expect(page).toHaveTitle("Editor");
  await expect(page.locator("#rendered script")).toHaveCount(0);
});
test("requires acknowledging a finding before editing it", async ({ page }) => {
  await page.route("**/api/settings", (route) =>
    route.fulfill({ json: { hasKey: true } }),
  );
  await page.reload();
  await page.route("**/api/pass", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: {
        answers: Object.fromEntries(
          body.state.spans.map((s: { id: string; text: string }) => [
            s.id,
            { noul: s.text === "very" ? 0.95 : 0.1 },
          ]),
        ),
      },
    });
  });
  const editor = page.getByRole("textbox", { name: "Markdown document" });
  await editor.fill("A very useful piece.");
  await page.getByRole("button", { name: "Show editor" }).click();
  await page.getByRole("button", { name: "Run this pass" }).click();
  await expect(page.locator(".finding")).toHaveText("very");
  await editor.fill("Replaced");
  await expect(editor).toHaveText("A very useful piece.");
  await page.locator(".finding").click();
  await expect(page.locator(".finding-tooltip")).toContainText("padding");
  await page.getByRole("button", { name: "Acknowledge", exact: true }).click();
  await expect(page.locator(".finding")).toHaveCount(0);
  await editor.fill("Replaced");
  await expect(editor).toHaveText("Replaced");
});
test("keeps a long document virtualized", async ({ page }) => {
  const text = Array.from(
    { length: 10000 },
    (_, i) => `Paragraph ${i}. A clear sentence with a person and an action.\n`,
  ).join("\n");
  await page.locator("#file").setInputFiles({
    name: "Long article.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(text),
  });
  await expect(page.getByRole("textbox", { name: "Draft title" })).toHaveValue(
    "Long article",
  );
  await expect(page.locator("#words")).toContainText("words");
  expect(await page.locator(".cm-line").count()).toBeLessThan(200);
  const elapsed = await page.evaluate(async () => {
    const scroller = document.querySelector(".cm-scroller")!;
    const start = performance.now();
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return performance.now() - start;
  });
  expect(elapsed).toBeLessThan(250);
  const editor = page.getByRole("textbox", { name: "Markdown document" });
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+End");
  const typingStart = Date.now();
  await page.keyboard.type("A final thought.");
  expect(Date.now() - typingStart).toBeLessThan(500);
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  console.log(`10,000 paragraphs: scroll update ${Math.round(elapsed)} ms`);
});
test("shows drafts on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Show drafts" }).click();
  await expect(page.getByRole("button", { name: "New draft" })).toBeVisible();
});

test("acknowledges only findings currently on screen", async ({ page }) => {
  await page.route("**/api/settings", (route) =>
    route.fulfill({ json: { hasKey: true } }),
  );
  await page.reload();
  await page.route("**/api/pass", (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({
      json: {
        answers: Object.fromEntries(
          body.state.spans.map((s: { id: string }) => [s.id, { noul: 0.95 }]),
        ),
      },
    });
  });
  await page
    .getByRole("textbox", { name: "Markdown document" })
    .fill("very\n\n".repeat(100));
  await page.getByRole("button", { name: "Show editor" }).click();
  await page.getByRole("button", { name: "Run this pass" }).click();
  await expect(page.locator("#flag-count")).toHaveText("100 open findings");
  await page.getByRole("button", { name: "Show editor" }).click();
  const button = page.getByRole("button", { name: /Acknowledge visible/ });
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.locator("#flag-count")).not.toHaveText("100 open findings");
  await expect(page.locator("#flag-count")).not.toHaveText("No open findings");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  await page.reload();
  await expect(page.locator("#flag-count")).not.toHaveText("No open findings");
});
test("discards a pass when the text changes", async ({ page }) => {
  await page.route("**/api/settings", (route) =>
    route.fulfill({ json: { hasKey: true } }),
  );
  await page.reload();
  let release: () => void = () => {};
  const wait = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/api/pass", async (route) => {
    await wait;
    try {
      const body = route.request().postDataJSON();
      await route.fulfill({
        json: {
          answers: Object.fromEntries(
            body.state.spans.map((s: { id: string }) => [s.id, { noul: 0.95 }]),
          ),
        },
      });
    } catch {}
  });
  const editor = page.getByRole("textbox", { name: "Markdown document" });
  await editor.fill("A very useful piece.");
  await page.getByRole("button", { name: "Show editor" }).click();
  await page.getByRole("button", { name: "Run this pass" }).click();
  await page.getByRole("button", { name: "Show editor" }).click();
  await expect(page.getByRole("button", { name: "Cancel pass" })).toBeVisible();
  await editor.fill("A different piece.");
  release();
  await expect(page.locator("#pass-status")).toContainText("Text changed");
  await expect(page.locator(".finding")).toHaveCount(0);
});
test("keeps draft text separate when switching drafts", async ({ page }) => {
  await page
    .getByRole("textbox", { name: "Draft title" })
    .fill("First article");
  await page
    .getByRole("textbox", { name: "Markdown document" })
    .fill("First text");
  await page.getByRole("button", { name: "Show drafts" }).click();
  await page.getByRole("button", { name: "New draft" }).click();
  await page
    .getByRole("textbox", { name: "Draft title" })
    .fill("Second article");
  await page
    .getByRole("textbox", { name: "Markdown document" })
    .fill("Second text");
  await expect(page.locator("#save-status")).toHaveText("Saved on this device");
  await page.getByRole("button", { name: "Show drafts" }).click();
  await page.getByRole("button", { name: /First article/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Markdown document" }),
  ).toHaveText("First text");
});

test("starts with both sidebars collapsed", async ({ page }) => {
  await expect(page.locator(".library")).toBeHidden();
  await expect(page.locator(".editor-pane")).toBeHidden();
  await page.getByRole("button", { name: "Show drafts" }).click();
  await expect(page.locator(".library")).toBeVisible();
  await page.getByRole("button", { name: "Close drafts" }).click();
  await page.getByRole("button", { name: "Show editor" }).click();
  await expect(page.locator(".library")).toBeHidden();
  await expect(page.locator(".editor-pane")).toBeVisible();
  await page.getByRole("button", { name: "Close editor" }).click();
  await expect(page.locator(".editor-pane")).toBeHidden();
});
test("gives single newlines paragraph spacing in write and preview", async ({
  page,
}) => {
  await page
    .getByRole("textbox", { name: "Markdown document" })
    .fill(
      "First paragraph.\nSecond paragraph.\n\n- List item\n- Next item\n\n```js\nconst x = 1;\n```",
    );
  const lines = page.locator(".cm-line");
  const first = await lines.nth(0).boundingBox();
  const second = await lines.nth(1).boundingBox();
  expect(second!.y - first!.y - first!.height).toBeGreaterThan(5);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator("#rendered .graf-space")).toHaveCount(1);
  await expect(page.locator("#rendered li")).toHaveCount(2);
  await expect(page.locator("#rendered code")).toContainText(["const x = 1;"]);
});

test("continues bullets once and exits on an empty bullet", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", { name: "Markdown document" });
  await editor.fill("- First item");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second item");
  await expect(editor).toHaveText("- First item- Second item");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Next paragraph");
  await expect(editor).toHaveText("- First item- Second itemNext paragraph");
  await expect(page.locator(".cm-line").last()).toHaveText("Next paragraph");
  const markdown = await page.locator(".cm-content").getAttribute("aria-label");
  expect(markdown).toBe("Markdown document");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator("#rendered li")).toHaveCount(2);
  await expect(page.locator("#rendered p").last()).toHaveText("Next paragraph");
});

test("keeps list items compact and styles pasted fenced code", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", { name: "Markdown document" });
  await editor.fill(
    "Before.\n\n- One\n- Two\n\n```js\nconst x = 1;\nconsole.log(x);\n```\n\nAfter.",
  );
  await expect(page.locator(".cm-list-line")).toHaveCount(2);
  await expect(page.locator(".cm-code-line")).toHaveCount(4);
  const first = await page.locator(".cm-list-line").nth(0).boundingBox();
  const second = await page.locator(".cm-list-line").nth(1).boundingBox();
  expect(second!.y - first!.y - first!.height).toBeLessThan(3);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator("#rendered pre code")).toContainText(
    "console.log(x);",
  );
  await expect(page.locator("#rendered li")).toHaveCount(2);
});

test("styles a code fence while typing and after closing it", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", { name: "Markdown document" });
  await editor.fill("Intro.\n\n");
  await page.keyboard.type("```js");
  await page.keyboard.press("Enter");
  await page.keyboard.type("const answer = 42;");
  await expect(page.locator(".cm-code-line")).toHaveCount(2);
  await page.keyboard.press("Enter");
  await page.keyboard.type("```");
  await expect(page.locator(".cm-code-line")).toHaveCount(3);
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator("#rendered pre code")).toContainText(
    "const answer = 42;",
  );
});

test("starts a new prose paragraph at column zero", async ({ page }) => {
  const editor = page.getByRole("textbox", { name: "Markdown document" });
  await editor.fill("  First paragraph");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second paragraph");
  await expect(page.locator(".cm-line").nth(1)).toHaveText("Second paragraph");
  expect(
    await page
      .locator(".cm-line")
      .nth(1)
      .evaluate((element) => element.textContent),
  ).toBe("Second paragraph");
});

test("double-clicking selects a word for replacement", async ({ page }) => {
  const editor = page.getByRole("textbox", { name: "Markdown document" });
  await editor.fill("Select this word please");
  const line = page.locator(".cm-line").first();
  await line.dblclick({ position: { x: 92, y: 14 } });
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    "word",
  );
  await page.keyboard.type("phrase");
  await expect(line).toHaveText("Select this phrase please");
});

test("double-clicking a finding selects the word before acknowledgement", async ({
  page,
}) => {
  await page.route("**/api/settings", (route) =>
    route.fulfill({ json: { hasKey: true } }),
  );
  await page.reload();
  await page.route("**/api/pass", (route) => {
    const body = route.request().postDataJSON();
    return route.fulfill({
      json: {
        answers: Object.fromEntries(
          body.state.spans.map((span: { id: string; text: string }) => [
            span.id,
            { noul: span.text === "very" ? 0.95 : 0.1 },
          ]),
        ),
      },
    });
  });
  await page
    .getByRole("textbox", { name: "Markdown document" })
    .fill("A very useful piece.");
  await page.getByRole("button", { name: "Show editor" }).click();
  await page.getByRole("button", { name: "Run this pass" }).click();
  await page.locator(".finding").dblclick();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    "very",
  );
  await expect(page.locator(".finding-tooltip")).toBeVisible();
});
