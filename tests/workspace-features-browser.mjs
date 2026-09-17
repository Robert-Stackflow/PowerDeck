import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp, projectRoot } from "../server/app.mjs";

const qaRoot = path.join(projectRoot, "work/qa");
fs.mkdirSync(qaRoot, { recursive: true });
const dir = fs.mkdtempSync(path.join(qaRoot, "workspace-features-"));
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
  await page.locator("input[name=password]").fill("feature-test-password-8832");
  await page.locator("input[name=confirm]").fill("feature-test-password-8832");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.locator("#newBtn").waitFor();
  const request = (route, method = "GET", body) =>
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
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        return data;
      },
      { route, method, body },
    );
  const template = await request("/decks", "POST", {
    title: "版式测试模板",
    slug: "layout-test-template",
    kind: "template",
    html: '<section class="slide"><h1>封面版式</h1></section><section class="slide"><h1>内容版式</h1><p>模板内容</p></section>',
    css: ".slide{background:#fff;color:#123}h1{font-size:60px}",
    notes: {
      1: { title: "封面", notes: "", refs: [] },
      2: { title: "内容页", notes: "", refs: [] },
    },
  });
  let deck = await request("/decks", "POST", {
    title: "功能联调文稿",
    slug: "workspace-feature-test",
    html: '<section class="slide"><h1>初始版本</h1></section>',
    css: ".slide{background:#fff}",
    notes: { 1: { title: "初始页", notes: "", refs: [] } },
  });
  await page.reload();
  const card = page.locator(`[data-id="${deck.id}"]`);
  await card.locator(".card-more summary").click();
  assert.equal(await card.locator(".card-more").getAttribute("open"), "");
  await page.locator(".library-header h1").click();
  assert.equal(await card.locator(".card-more").getAttribute("open"), null);

  deck = await request(`/decks/${deck.id}/content`, "PUT", {
    version: deck.version,
    html: '<section class="slide"><h1>第二版本</h1></section>',
    css: ".slide{background:#fff}",
    notes: { 1: { title: "第二版", notes: "", refs: [] } },
  });
  let revisions = (await request(`/decks/${deck.id}/revisions`)).revisions;
  assert.equal(revisions.length, 2);
  deck = await request(
    `/decks/${deck.id}/revisions/${revisions.at(-1).id}/restore`,
    "POST",
    { version: deck.version },
  );
  assert.match((await request(`/decks/${deck.id}/content`)).html, /初始版本/);
  revisions = (await request(`/decks/${deck.id}/revisions`)).revisions;
  assert.equal(revisions.length, 3);

  await page.goto(`${base}/edit/${deck.slug}`);
  await page.locator("#visualCanvas").waitFor();
  await page.locator("#shareDeck").click();
  await page.getByRole("heading", { name: "权限与分享" }).waitFor();
  await page.locator("#dialog .close-dialog").click();
  await page.locator("#presentOptions").click();
  assert.match(
    await page
      .locator('[data-present-mode="presenter"][data-present-from="current"]')
      .getAttribute("href"),
    /\/presenter\/workspace-feature-test#1$/,
  );
  await page.locator("#presentMenu").press("Escape");
  await page.locator('[data-page-index="0"]').click({ button: "right" });
  await page.locator('[data-menu-action="add"]').hover();
  await page.locator('[data-submenu-action="blank"]').waitFor();
  await page.locator('[data-submenu-action="template"]').waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.locator("#insertPage").click();
  await page.locator('[data-insert-page="duplicate"]').click();
  await page.locator('[data-page-index="1"]').waitFor();
  await page.locator("#insertPage").click();
  await page.locator('[data-insert-page="template"]').click();
  await page.locator(`[data-layout-template="${template.id}"]`).click();
  await page.locator('[data-layout-index="1"]').click();
  await page.locator('[data-page-index="2"]').waitFor();
  const canvas = page.frameLocator("#visualCanvas");
  await canvas.locator(".slide[data-ve-current] h1").click();
  await canvas
    .locator(".slide[data-ve-current] p")
    .click({ modifiers: ["Shift"] });
  await page.getByText("已选择 2 个图层").waitFor();
  assert.equal(
    await page
      .locator('[data-inspector-tab="element"]')
      .getAttribute("aria-selected"),
    "true",
  );
  assert.equal(await page.locator(".layer-row.selected").count(), 2);
  await page.locator("#alignSelectionLeft").click();
  await page.locator('[data-inspector-tab="page"]').click();
  await page.locator("#pageTransitionTrigger").click();
  await page.locator('#pageTransitionOptions [data-value="fade"]').click();
  await page.locator('[data-inspector-tab="references"]').click();
  await page.locator("#addReference").click();
  await page.locator(".reference-label").fill("产品文档");
  await page.locator(".reference-url").fill("https://example.com/docs");
  await page.locator(".reference-url").blur();
  await page.locator("#openReferenceLibrary").click();
  await page
    .locator('[data-use-library="https%3A%2F%2Fexample.com%2Fdocs"]')
    .waitFor();
  await page.locator("#referenceLibraryPopover").press("Escape");
  await page.locator('[data-page-index="0"]').click();
  await page.locator("#openReferenceLibrary").click();
  await page
    .locator('[data-use-library="https%3A%2F%2Fexample.com%2Fdocs"]')
    .click();
  assert.equal(await page.locator("#referenceList .reference-row").count(), 1);
  await page.locator("#saveDeck").click();
  await page.locator('#saveState[data-state="saved"]').waitFor();
  const saved = await request(`/decks/${deck.id}/content`);
  assert.equal(saved.notes[1].referenceLibrary.length, 1);
  assert.match(saved.html, /模板内容/);
  assert.match(saved.html, /data-transition="fade"/);

  const projection = await context.newPage();
  await projection.goto(`${base}/present/${deck.slug}#1`);
  await projection.locator("#playerFrame:not([hidden])").waitFor();
  const presenter = await context.newPage();
  await presenter.goto(`${base}/presenter/${deck.slug}#1`);
  await presenter.waitForTimeout(500);
  if (await presenter.locator(".presenter-error").count())
    throw new Error(await presenter.locator(".presenter-error").innerText());
  await presenter.locator("#nextPage").waitFor();
  await presenter.getByRole("button", { name: "进入全屏" }).waitFor();
  await presenter.locator(".presenter-status.connected").waitFor({
    timeout: 6000,
  });
  await presenter
    .frameLocator("#currentFrame")
    .locator('[data-presenter-preview-active][data-page="1"]')
    .waitFor();
  await presenter.evaluate(() => {
    window.__presenterPreviewLoads = 0;
    document.querySelector(".presenter-main").addEventListener(
      "load",
      (event) => {
        if (event.target.matches?.("iframe"))
          window.__presenterPreviewLoads += 1;
      },
      true,
    );
  });
  await presenter.waitForTimeout(3200);
  assert.equal(
    await presenter.evaluate(() => window.__presenterPreviewLoads),
    0,
  );
  const rapidSyncStarted = Date.now();
  await projection.evaluate(() => {
    for (let index = 0; index < 120; index += 1)
      window.presentation.go((index % 3) + 1);
    window.presentation.go(3);
  });
  await presenter
    .frameLocator("#currentFrame")
    .locator('[data-presenter-preview-active][data-page="3"]')
    .waitFor({ timeout: 1500 });
  assert(Date.now() - rapidSyncStarted < 1500);
  assert.equal(
    await presenter.evaluate(() => window.__presenterPreviewLoads),
    0,
  );
  await projection.evaluate(() => window.presentation.go(1));
  await presenter
    .frameLocator("#currentFrame")
    .locator('[data-presenter-preview-active][data-page="1"]')
    .waitFor();
  const presenterLayout = await presenter.evaluate(() => {
    const nextWrap = document.querySelector(".next-card .slide-frame-wrap"),
      nextFrame = document.querySelector("#nextFrame"),
      notes = document.querySelector("#speakerNotes");
    notes.textContent = "很长的演讲备注。".repeat(1000);
    const wrapRect = nextWrap.getBoundingClientRect(),
      frameRect = nextFrame.getBoundingClientRect();
    return {
      pageFits: document.documentElement.scrollHeight <= innerHeight,
      notesScroll: notes.scrollHeight > notes.clientHeight,
      nextFits:
        frameRect.left >= wrapRect.left &&
        frameRect.right <= wrapRect.right &&
        frameRect.top >= wrapRect.top &&
        frameRect.bottom <= wrapRect.bottom,
    };
  });
  assert.deepEqual(presenterLayout, {
    pageFits: true,
    notesScroll: true,
    nextFits: true,
  });
  await presenter.locator(".current-card .slide-frame-wrap").click();
  await projection.waitForURL("**/present/workspace-feature-test#2");
  await presenter
    .frameLocator("#currentFrame")
    .locator('[data-presenter-preview-active][data-page="2"]')
    .waitFor();
  await presenter.locator("#previousPage").click();
  await projection.waitForURL("**/present/workspace-feature-test#1");
  await presenter
    .locator(".current-card .slide-frame-wrap")
    .dispatchEvent("wheel", { deltaX: 0, deltaY: 120, deltaMode: 0 });
  await projection.waitForURL("**/present/workspace-feature-test#2");
  await presenter
    .frameLocator("#currentFrame")
    .locator('[data-presenter-preview-active][data-page="2"]')
    .waitFor();
  assert.match(
    await presenter.locator("#currentFrame").getAttribute("src"),
    /all=1/,
  );
  let sharedDeck = await request(`/decks/${deck.id}`);
  sharedDeck = await request(`/decks/${deck.id}`, "PATCH", {
    version: sharedDeck.version,
    visibility: "shared",
  });
  const share = await request(`/decks/${deck.id}/shares`, "POST", {
    label: "可下载链接",
    slug: sharedDeck.slug,
    days: 7,
    allowNotes: true,
    allowDownload: true,
  });
  const sharedPage = await context.newPage();
  await sharedPage.goto(`${base}${share.path}`);
  await sharedPage.locator("#playerFrame:not([hidden])").waitFor();
  await sharedPage.close();
  let shareStats = (await request(`/decks/${deck.id}/shares`)).shares.find(
    (item) => item.id === share.id,
  );
  assert.equal(shareStats.viewCount, 1);
  assert.equal(shareStats.allowDownload, true);
  const downloadStatus = await page.evaluate(async (token) => {
    const response = await fetch(`/api/public/${token}/export?format=zip`);
    await response.arrayBuffer();
    return response.status;
  }, share.token);
  assert.equal(downloadStatus, 200);
  shareStats = (await request(`/decks/${deck.id}/shares`)).shares.find(
    (item) => item.id === share.id,
  );
  assert.equal(shareStats.downloadCount, 1);
  await page.bringToFront();
  await page.locator("#shareDeck").click();
  await page.locator(".share-item.is-active").waitFor();
  assert.match(await page.locator(".share-metrics").innerText(), /1\s+次访问/);
  assert.match(await page.locator(".share-metrics").innerText(), /1\s+次下载/);
  await page.locator("#dialog .close-dialog").click();
  assert.deepEqual(errors, []);
  console.log(
    "PASS menus, revisions, page insertion, layers, references, transitions, presenter and share stats",
  );
} finally {
  await browser?.close();
  await app.close();
}
