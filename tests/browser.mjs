import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp, projectRoot } from "../server/app.mjs";
import { importPackageArchive } from "../server/package.mjs";
const dir = path.join(projectRoot, "work/qa/platform-browser");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const app = await createApp({ dataDir: path.join(dir, "data") });
const base = await app.listen({ port: 0 });
const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH || fs.existsSync(mac)
    ? { executablePath: process.env.CHROME_PATH || mac }
    : {}),
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  p = await context.newPage(),
  errors = [],
  failedAssets = [],
  passed = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("response", (r) => {
  if (r.url().includes("/files/") && r.status() !== 200)
    failedAssets.push(r.url() + ":" + r.status());
});
const check = async (name, fn) => {
  await fn();
  passed.push(name);
  console.log("PASS " + name);
};
const frame = () => p.frames().find((f) => f.url() === "about:srcdoc");
const frameClick = async (selector, options = {}) => {
  const el = frame().locator(selector);
  await el.evaluate((e) => e.scrollIntoView({ block: "nearest" }));
  await pause(250);
  const r = await el.boundingBox();
  await p.mouse.click(r.x + r.width / 2, r.y + r.height / 2, options);
};
const current = () => p.evaluate(() => presentation.current),
  go = (n) => p.evaluate((n) => presentation.go(n), n),
  pause = (ms) => p.waitForTimeout(ms);
const api = async (route, method = "GET", body) =>
  p.evaluate(
    async ({ route, method, body }) => {
      const s = await fetch("/api/session").then((r) => r.json());
      const r = await fetch("/api" + route, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": s.csrf },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: r.status, value: await r.json() };
    },
    { route, method, body },
  );
let createdId, shareToken;
try {
  await check(
    "first-time setup, real library cover and mobile library",
    async () => {
      await p.goto(base);
      await p
        .locator("input[name=password]")
        .fill("browser-test-password-6391");
      await p.locator("input[name=confirm]").fill("browser-test-password-6391");
      await p.getByRole("button", { name: "创建并进入" }).click();
      await p.locator(".deck-card").waitFor();
      assert.equal(await p.locator(".deck-card").count(), 1);
      await pause(300);
      await p.screenshot({ path: path.join(dir, "library.png") });
      await p.setViewportSize({ width: 390, height: 844 });
      assert(await p.locator("#newBtn").isVisible());
      assert.equal(
        await p.evaluate(() => document.documentElement.scrollWidth),
        390,
      );
      await p.screenshot({ path: path.join(dir, "library-mobile.png") });
      await p.setViewportSize({ width: 1440, height: 1000 });
    },
  );
  await check(
    "create, edit HTML and notes, upload an asset and save",
    async () => {
      await p.locator("#newBtn").click();
      await p.locator("#dialog input[name=title]").fill("浏览器测试演示");
      await p.getByRole("button", { name: "创建演示", exact: true }).click();
      await p.waitForURL("**/edit/*");
      createdId = p.url().split("/").at(-1);
      await p.locator('[data-editor-mode="source"]').click();
      await p.locator("#sourceInput").waitFor();
      await p
        .locator("#sourceInput")
        .fill(
          '<section class="slide" data-slide-id="one"><h1>第一页</h1><img src="assets/pixel.png"><script>parent.__injected=true</script><img src="assets/pixel.png" onload="parent.__injected=true"></section><section class="slide" data-slide-id="two"><h1>第二页</h1></section>',
        );
      await p.locator("[data-tab=notes]").click();
      await p.locator("#sourceInput").fill(
        JSON.stringify({
          1: { title: "第一页", notes: "私密备注", refs: [] },
          2: { title: "第二页", notes: "", refs: [] },
        }),
      );
      await p.locator("[data-tab=assets]").click();
      await p.locator("#assetFiles").setInputFiles({
        name: "pixel.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfN0AAAAASUVORK5CYII=",
          "base64",
        ),
      });
      await p.locator(".asset-item").waitFor();
      await p.locator("#saveDeck").click();
      await p.waitForFunction(
        () => document.querySelector("#saveState").dataset.state === "saved",
      );
      assert.equal(await p.locator("#editorPreview,.preview-panel").count(), 0);
      assert.equal(await p.evaluate(() => window.__injected), undefined);
      await p.screenshot({ path: path.join(dir, "editor.png") });
    },
  );
  await check("HTML import and content-package export are usable", async () => {
    await p.goto(base);
    await p.locator(".deck-card").first().waitFor();
    await p.locator("#importFile").setInputFiles({
      name: "导入示例.html",
      mimeType: "text/html",
      buffer: Buffer.from(
        '<style>.slide{background:#edf5ef}</style><section class="slide"><h1>导入成功</h1></section>',
      ),
    });
    await p.locator("#dialog").waitFor();
    await p.locator("#dialog button[type=submit]").click();
    await p.waitForFunction(
      () => document.querySelectorAll(".deck-card").length === 3,
    );
    await pause(160);
    const card = p.locator(`[data-id="${createdId}"]`).first();
    await card.locator("summary").click();
    const downloaded = p.waitForEvent("download");
    await card.locator("[data-action=export]").click();
    await p.locator("#dialog button[type=submit]").click();
    const download = await downloaded,
      pack = await importPackageArchive(fs.readFileSync(await download.path()));
    assert(download.suggestedFilename().endsWith(".zip"));
    assert.equal(pack.format, "deck-library/v1");
    assert.equal(pack.assets.length, 1);
    assert(!pack.html.includes("<script"));
    await p.locator("#search").fill("导入示例");
    assert.equal(await p.locator(".deck-card").count(), 1);
    await p.locator("#search").fill("");
  });
  await check(
    "permission dialog creates a read-only link with separate visitor access",
    async () => {
      await p.locator(`[data-action=share][data-id="${createdId}"]`).click();
      await p.getByRole("combobox", { name: "访问权限" }).click();
      await p
        .getByRole("option", {
          name: "链接分享 · 持有有效链接者可见",
          exact: true,
        })
        .click();
      await p.locator("#generateLink").waitFor();
      await p.locator("#linkLabel").fill("访客演示");
      await p.locator("#generateLink").click();
      await p.locator("[data-copy]").waitFor();
      shareToken = await p
        .locator("[data-copy]")
        .first()
        .getAttribute("data-copy");
      await p.screenshot({ path: path.join(dir, "share.png") });
      const guestContext = await browser.newContext({
          viewport: { width: 1600, height: 900 },
        }),
        guest = await guestContext.newPage();
      await guest.goto(base + "/s/" + shareToken);
      await guest.waitForFunction(() => window.presentation?.count === 2);
      const f = guest.frames().find((f) => f.url() === "about:srcdoc");
      assert(!(await f.locator("#notesBtn").isVisible()));
      assert.equal(await f.locator("#editBtn").count(), 0);
      await guest.keyboard.press("n");
      assert(!(await f.locator("#notes").isVisible()));
      assert.equal(await guest.evaluate(() => window.__injected), undefined);
      await guest.mouse.click(1300, 150);
      assert.equal(await guest.evaluate(() => presentation.current), 2);
      const raw = await guest.evaluate(
        async (t) =>
          fetch("/api/public/" + t + "/content").then((r) => r.json()),
        shareToken,
      );
      assert(!JSON.stringify(raw).includes("私密备注"));
      await p.locator("[data-revoke]").first().click();
      await p.locator(".status-off").waitFor();
      await guest.waitForFunction(
        () => !document.querySelector("#error").hidden,
        {},
        { timeout: 18000 },
      );
      assert(
        (await guest.locator("#errorMessage").textContent()).includes("撤销"),
      );
      await guestContext.close();
      await p.locator("#dialog .close-dialog").click();
      await pause(170);
    },
  );
  await check(
    "private viewer access is denied; recycle and restore retain content",
    async () => {
      const guest = await browser.newPage();
      await guest.goto(base + "/present/areal");
      await guest.locator("#error:not([hidden])").waitFor();
      assert(
        (await guest.locator("#errorTitle").textContent()).includes("登录"),
      );
      await guest.close();
      const card = p.locator(`[data-id="${createdId}"]`).first();
      await card.locator("summary").click();
      await card.locator("[data-action=trash]").click();
      await p.waitForFunction(
        (id) => !document.querySelector(`[data-action=share][data-id="${id}"]`),
        createdId,
      );
      await p.locator("[data-filter=trash]").click();
      await p.locator("[data-action=restore]").last().click();
      await p.locator("[data-filter=all]").click();
      await p.locator(`[data-action=share][data-id="${createdId}"]`).waitFor();
      assert.equal(
        (await api("/decks/" + createdId)).value.visibility,
        "private",
      );
    },
  );
  await check(
    "shared player: left/right clicks, laser, wheel, menus and ink isolation",
    async () => {
      await p.setViewportSize({ width: 1600, height: 900 });
      await p.goto(base + "/present/areal#7");
      await p.waitForFunction(() => window.presentation?.count === 27);
      let f = frame();
      await f.evaluate(() => document.fonts.ready);
      assert(await f.locator("#editBtn").isVisible());
      await f.locator("#editBtn").click();
      await p.waitForURL("**/edit/areal#7");
      await p
        .locator('#slideList [data-page-index="6"][aria-current="page"]')
        .waitFor();
      await p.goto(base + "/present/areal#7");
      await p.waitForFunction(() => window.presentation?.count === 27);
      f = frame();
      await f.evaluate(() => document.fonts.ready);
      for (const key of ["v", "l"]) {
        await p.keyboard.press(key);
        await go(7);
        await p.mouse.click(250, 140);
        await pause(200);
        assert.equal(await current(), 6);
        await p.mouse.click(1250, 140);
        await pause(200);
        assert.equal(await current(), 7);
        // Consecutive clicks carry detail=2/3; ordinary slide areas must not
        // treat them as an image-preview gesture and swallow navigation.
        await p.mouse.click(1250, 140, { clickCount: 2 });
        assert.equal(await current(), 9);
        await p.mouse.click(250, 140, { clickCount: 2 });
        assert.equal(await current(), 7);
      }
      await p.mouse.click(1200, 350, { button: "right" });
      await f.locator("#contextMenu").waitFor();
      await p.mouse.move(200, 350);
      assert.equal(
        await f.evaluate(
          () => getComputedStyle(document.elementFromPoint(200, 350)).cursor,
        ),
        "default",
      );
      await p.mouse.move(200, 884);
      await pause(300);
      assert.equal(
        await f
          .locator("#controls")
          .evaluate((e) => getComputedStyle(e).opacity),
        "0",
      );
      await p.keyboard.press("Escape");
      await p.keyboard.press("v");
      await p.mouse.click(1200, 350, { button: "right" });
      assert.equal(await f.locator("#contextMenu .menu-colors").count(), 0);
      const shortcutRights = await f
        .locator("#contextMenu > .menu-row kbd")
        .evaluateAll((keys) =>
          keys.map((key) => key.getBoundingClientRect().right),
        );
      assert(Math.max(...shortcutRights) - Math.min(...shortcutRights) < 1);
      assert.equal(await f.locator("#contextMenu .selected-check").count(), 0);
      await p.keyboard.press("Escape");
      await pause(450);
      await p.keyboard.press("p");
      await p.mouse.move(900, 250);
      await p.mouse.down();
      await p.mouse.move(1200, 250, { steps: 15 });
      await p.mouse.up();
      await pause(200);
      assert.equal(await p.evaluate(() => presentation.strokeCount), 1);
      await p.keyboard.press("Meta+z");
      assert.equal(await p.evaluate(() => presentation.strokeCount), 0);
      await p.keyboard.press("Meta+Shift+z");
      assert.equal(await p.evaluate(() => presentation.strokeCount), 1);
      await pause(200);
      await p.reload();
      await p.waitForFunction(
        () => typeof window.presentation?.go === "function",
      );
      assert.equal(await p.evaluate(() => presentation.strokeCount), 1);
      await p.evaluate(() => presentation.clearInk());
      await p.mouse.move(1200, 300);
      await p.mouse.wheel(0, 150);
      await pause(120);
      assert.equal(await current(), 8);
      await pause(600);
      await p.mouse.wheel(0, -150);
      await pause(120);
      assert.equal(await current(), 7);
      // Sustained trackpad events must keep navigating without waiting for
      // the gesture to go idle (the former gesture lock blocked this).
      for (let i = 0; i < 20; i++) {
        await p.mouse.wheel(0, 16.5);
        await pause(50);
      }
      assert((await current()) >= 10);
      await p.goto(base + "/present/" + createdId);
      await p.waitForFunction(
        () => typeof window.presentation?.go === "function",
      );
      assert.equal(await p.evaluate(() => presentation.strokeCount), 0);
    },
  );
  await check(
    "all 27 slide layouts, real assets, notes, figures, fullscreen and print",
    async () => {
      await p.goto(base + "/present/areal#7");
      await p.waitForFunction(() => window.presentation?.count === 27);
      const f = frame();
      await f.evaluate(() => document.fonts.ready);
      const issues = [];
      for (let n = 1; n <= 27; n++) {
        await go(n);
        const bad = await f.evaluate(() => {
          const slide = document.querySelector(".slide.active");
          return [
            ...slide.querySelectorAll(
              "svg text,.katex-display>.katex,.concepts,.paradigm-intro",
            ),
          ]
            .filter((e) => {
              const a = (
                  e.closest("svg") ||
                  e.closest(".paradigm-copy") ||
                  slide
                ).getBoundingClientRect(),
                r = e.getBoundingClientRect();
              return (
                r.width &&
                r.height &&
                (r.x < a.x - 1 ||
                  r.right > a.right + 1 ||
                  r.y < a.y - 1 ||
                  r.bottom > a.bottom + 1)
              );
            })
            .map((e) => e.textContent.slice(0, 80));
        });
        if (bad.length) issues.push({ n, bad });
      }
      assert.deepEqual(issues, []);
      assert.deepEqual(
        await f
          .locator("img[src]")
          .evaluateAll((imgs) =>
            imgs
              .filter((i) => !i.complete || !i.naturalWidth)
              .map((i) => i.src),
          ),
        [],
      );
      await go(12);
      await p.keyboard.press("n");
      await f.locator("#notes").waitFor();
      assert.equal(await f.locator("#notes .zoomable").count(), 2);
      await frameClick("#notes .zoomable >> nth=0");
      assert(!(await f.locator("#figureViewer").isVisible()));
      await frameClick("#notes .zoomable >> nth=0", { clickCount: 2 });
      assert(await f.locator("#figureViewer").isVisible());
      await frameClick("#figureImage");
      assert.equal(await f.locator("#figureScale").innerText(), "250%");
      await p.mouse.wheel(0, -80);
      await pause(100);
      assert(parseInt(await f.locator("#figureScale").innerText()) > 250);
      await frameClick("#figureFit");
      assert.equal(await f.locator("#figureScale").innerText(), "100%");
      await p.keyboard.press("Escape");
      await pause(250);
      await p.keyboard.press("Escape");
      await pause(250);
      await p.keyboard.press("g");
      assert.equal(await f.locator(".toc-item").count(), 27);
      await frameClick('[data-goto="7"]');
      await pause(220);
      assert.equal(await current(), 7);
      await p.keyboard.press("f");
      await pause(180);
      assert(await f.evaluate(() => !!document.fullscreenElement));
      await p.keyboard.press("f");
      await pause(180);
      await p.mouse.move(1000, 100);
      await pause(1600);
      await p.screenshot({ path: path.join(dir, "player.png") });
      // Use the same shared frame document, with no controls, for a print regression check.
      const printPage = await context.newPage({
        viewport: { width: 1600, height: 900 },
      });
      const documentHTML = await f.content();
      await printPage.goto(base);
      await printPage.setContent(documentHTML);
      await printPage.evaluate(() => document.fonts.ready);
      const pdf = await printPage.pdf({
        path: path.join(dir, "print.pdf"),
        preferCSSPageSize: true,
        printBackground: true,
      });
      assert.equal(
        (pdf.toString("latin1").match(/\/Type \/Page\b/g) || []).length,
        27,
      );
      await printPage.close();
    },
  );
  await check("mobile presenter and dialogs stay in bounds", async () => {
    await p.setViewportSize({ width: 390, height: 844 });
    await go(7);
    await p.keyboard.press("l");
    await p.mouse.click(70, 400);
    await pause(200);
    assert.equal(await current(), 6);
    await p.mouse.click(320, 400);
    await pause(200);
    assert.equal(await current(), 7);
    const f = frame();
    await p.mouse.click(380, 730, { button: "right" });
    await pause(250);
    let r = await f.locator("#contextMenu").boundingBox();
    assert(
      r.x >= 0 && r.y >= 0 && r.x + r.width <= 390 && r.y + r.height <= 844,
    );
    await p.keyboard.press("Escape");
    await p.keyboard.press("g");
    await pause(280);
    r = await f.locator("#overview").boundingBox();
    assert(
      r.x >= 0 && r.y >= 0 && r.x + r.width <= 390 && r.y + r.height <= 844,
    );
    await p.screenshot({ path: path.join(dir, "player-mobile.png") });
    await p.keyboard.press("Escape");
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(failedAssets, []);
  fs.writeFileSync(
    path.join(dir, "results.json"),
    JSON.stringify({ passed, errors, failedAssets }, null, 2),
  );
  console.log("ALL " + passed.length + " BROWSER GROUPS PASSED");
} finally {
  await browser.close();
  await app.close();
}
