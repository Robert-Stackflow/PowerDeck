import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp, projectRoot } from "../server/app.mjs";

const root = path.join(projectRoot, "work/qa");
fs.mkdirSync(root, { recursive: true });
const dir = fs.mkdtempSync(path.join(root, "references-"));
const app = await createApp({ dataDir: path.join(dir, "data") });
const base = await app.listen({ port: 0 });
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : process.platform === "win32"
        ? { channel: "msedge" }
        : {}),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page
    .locator("input[name=password]")
    .fill("references-test-password-4208");
  await page
    .locator("input[name=confirm]")
    .fill("references-test-password-4208");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.locator("#newBtn").waitFor();
  const api = (route, method = "GET", body) =>
    page.evaluate(
      async ({ route, method, body }) => {
        const session = await fetch("/api/session").then((response) =>
          response.json(),
        );
        const response = await fetch("/api" + route, {
          method,
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": session.csrf,
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) throw new Error(await response.text());
        return response.json();
      },
      { route, method, body },
    );
  let deck = await api("/decks", "POST", {
    title: "参考资料测试",
    slug: "reference-test",
    width: 1600,
    height: 900,
    html: '<section class="slide" data-slide-id="one"><h1>第一页</h1></section><section class="slide" data-slide-id="two"><h1 id="pageTwo">第二页</h1></section>',
    css: ".slide{background:white}h1{margin:100px}",
    notes: {
      1: {
        title: "第一页",
        notes: "",
        refs: [["待删除资料", "https://example.net/old"]],
      },
      2: { title: "第二页", notes: "第二页备注", refs: [] },
    },
  });
  await page.goto(base + "/edit/reference-test#2");
  await page.frameLocator("#visualCanvas").locator("#pageTwo").waitFor();
  await page
    .locator('#slideList [data-page-index="1"][aria-current="page"]')
    .waitFor();
  assert.equal(page.url().split("#")[1], "2");
  assert.equal(await page.locator(".inspector-tabs [role=tab]").count(), 4);
  assert.equal(await page.locator(".visual-page-notes").count(), 0);
  assert((await page.locator(".visual-inspector").boundingBox()).width >= 330);
  await page.locator('[data-inspector-tab="notes"]').click();
  assert.equal(await page.locator(".canvas-page-header").count(), 0);
  assert.equal(await page.locator("#visualPageTitle").inputValue(), "第二页");
  assert.equal(
    await page.locator("#visualPageNotes").inputValue(),
    "第二页备注",
  );
  await page.screenshot({ path: path.join(dir, "title-notes-tab.png") });
  await page.frameLocator("#visualCanvas").locator("#pageTwo").click();
  assert.equal(
    await page
      .locator('[data-inspector-tab="element"]')
      .getAttribute("aria-selected"),
    "true",
  );
  const customSelect = page.locator("#elementBorderStyleTrigger");
  await customSelect.click();
  await page.locator("#elementBorderStyleOptions:popover-open").waitFor();
  await customSelect.click();
  await page.locator("#elementBorderStyleOptions").waitFor({ state: "hidden" });
  const [currentPagePresentation] = await Promise.all([
    context.waitForEvent("page"),
    page.locator("#presentDeck").click(),
  ]);
  await currentPagePresentation.waitForURL("**/present/reference-test#2");
  await currentPagePresentation.close();
  await page.locator("#presentOptions").click();
  await page.locator("#presentMenu:popover-open").waitFor();
  assert.equal(
    await page.locator("#presentOptions").getAttribute("aria-expanded"),
    "true",
  );
  await page.locator("#presentOptions").click();
  await page.locator("#presentMenu").waitFor({ state: "hidden" });
  assert.equal(
    await page.locator("#presentOptions").getAttribute("aria-expanded"),
    "false",
  );
  await page.locator("#presentOptions").click();
  await page.locator("#presentMenu:popover-open").waitFor();
  assert.match(
    await page
      .locator('[data-present-mode="standard"][data-present-from="current"]')
      .getAttribute("href"),
    /\/present\/reference-test#2$/,
  );
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(dir, "present-split-menu.png") });
  const [firstPagePresentation] = await Promise.all([
    context.waitForEvent("page"),
    page
      .locator('[data-present-mode="standard"][data-present-from="start"]')
      .click(),
  ]);
  await firstPagePresentation.waitForURL("**/present/reference-test#1");
  await firstPagePresentation.close();
  await page.locator('[data-inspector-tab="references"]').click();
  assert.equal(
    await page
      .locator("#referenceList")
      .evaluate((element) => getComputedStyle(element).overflowY),
    "visible",
  );
  await page.locator("#addReference").click();
  await page.locator(".reference-label").fill("官方文档");
  await page.locator(".reference-url").fill("https://example.com/docs");
  await page.screenshot({ path: path.join(dir, "references-editor.png") });
  await page.locator("#saveDeck").click();
  await page.waitForFunction(
    () => document.querySelector("#saveState").dataset.state === "saved",
  );
  let content = await api("/decks/" + deck.id + "/content");
  assert.deepEqual(content.notes[2].refs, [
    ["官方文档", "https://example.com/docs"],
  ]);
  await page.locator('#slideList [data-page-index="0"]').click();
  await page.locator(".remove-reference").click();
  await page.locator("#saveDeck").click();
  await page.waitForFunction(
    () => document.querySelector("#saveState").dataset.state === "saved",
  );
  content = await api("/decks/" + deck.id + "/content");
  assert.deepEqual(content.notes[1].refs, []);
  assert.deepEqual(content.notes[2].refs, [
    ["官方文档", "https://example.com/docs"],
  ]);
  await page.goto(base + "/present/reference-test#2");
  await page.waitForFunction(() => window.presentation?.current === 2);
  let frame = page.frameLocator("#playerFrame");
  await page.mouse.move(720, 875);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(dir, "edit-current-page.png") });
  await frame.locator("#editBtn").click();
  await page.waitForURL("**/edit/reference-test#2");
  await page
    .locator('#slideList [data-page-index="1"][aria-current="page"]')
    .waitFor();
  deck = await api("/decks/" + deck.id, "PATCH", {
    visibility: "shared",
    version: (await api("/decks/" + deck.id)).version,
  });
  const share = await api("/decks/" + deck.id + "/shares", "POST", {
    days: null,
    allowNotes: true,
  });
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto(base + share.path + "#2");
  await guest.waitForFunction(() => window.presentation?.current === 2);
  frame = guest.frameLocator("#playerFrame");
  assert.equal(await frame.locator("#editBtn").count(), 0);
  await guestContext.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS inspector tabs, dropdown toggles, reference editing and direct current-page editing",
  );
} finally {
  await browser?.close();
  await app.close();
}
