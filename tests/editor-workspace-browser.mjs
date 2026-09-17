import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp, projectRoot } from "../server/app.mjs";
const dir = path.join(projectRoot, "work/qa/editor-workspace");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const app = await createApp({ dataDir: path.join(dir, "data") }),
  base = await app.listen({ port: 0 });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({
    viewport: { width: 1540, height: 1000 },
  }),
  page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const frame = () => page.frameLocator("#visualCanvas");
const api = (route, method = "GET", body) =>
  page.evaluate(
    async ({ route, method, body }) => {
      const s = await fetch("/api/session").then((r) => r.json());
      const r = await fetch("/api" + route, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": s.csrf },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    { route, method, body },
  );
const check = async (name, fn) => {
  await fn();
  console.log("PASS " + name);
};
const saved = () =>
  page.waitForFunction(
    () => document.querySelector("#saveState")?.dataset.state === "saved",
  );
const number = async (name, value) => {
  await page.locator(`[name="${name}"]`).fill(String(value));
  await page.locator(`[name="${name}"]`).press("Tab");
};
const color = async (name, value, custom = false) => {
  await page.locator(`[data-color-field="${name}"]`).click();
  if (custom) {
    await page.getByLabel("十六进制颜色").fill(value);
    await page.locator(".color-apply").click();
  } else
    await page
      .locator(`.color-popover [data-color="${value}"]`)
      .first()
      .click();
};
const drag = async (selector, dx, dy) => {
  const b = await page.locator(selector).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, {
    steps: 8,
  });
  await page.mouse.up();
};
let deck;
try {
  await page.goto(base);
  await page
    .locator("input[name=password]")
    .fill("workspace-test-password-2026");
  await page
    .locator("input[name=confirm]")
    .fill("workspace-test-password-2026");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.locator("#newBtn").waitFor();
  deck = await api("/decks", "POST", {
    title: "样式验证",
    author: "原作者",
    description: "说明",
    slug: "workspace-test",
    width: 1600,
    height: 900,
    html: '<section class="slide"><h1 id="heading" style="position:absolute;left:100px;top:100px;font-size:50px">可以编辑的标题</h1><div id="group" style="position:absolute;left:100px;top:300px;width:400px;height:200px"><p id="paragraph">组合文字</p><svg id="diagram" width="180" height="80" viewBox="0 0 180 80"><rect width="180" height="80" fill="#ddd"/><text x="10" y="50" fill="#111" font-size="24">图表文字</text></svg></div><img id="photo" src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22150%22%3E%3C/svg%3E" style="position:absolute;left:700px;top:100px;width:300px;height:150px"></section><section class="slide"><h1>第二页</h1></section>',
    css: ".slide{background:#fff;color:#243d36}",
    notes: { 1: { title: "第一页", notes: "原备注" }, 2: { title: "第二页" } },
  });
  await check(
    "loading skeleton stays visible while presentation data is pending",
    async () => {
      let release;
      const gate = new Promise((r) => (release = r));
      await page.route(`**/api/decks/${deck.id}/content`, async (route) => {
        await gate;
        await route.continue();
      });
      await page.goto(base + "/edit/workspace-test", {
        waitUntil: "domcontentloaded",
      });
      await page.locator(".editor-loading").waitFor();
      assert(await page.locator(".loading-track").isVisible());
      await page.screenshot({ path: path.join(dir, "loading.png") });
      release();
      await frame().locator("#heading").waitFor();
      await page.unroute(`**/api/decks/${deck.id}/content`);
      await page.waitForFunction(
        () =>
          document.querySelector(".editor")?.getAttribute("aria-busy") ===
          "false",
      );
    },
  );
  await check(
    "source-to-visual switches before slow rendering and preserves invalid source",
    async () => {
      await page.getByRole("tab", { name: "源码", exact: true }).click();
      await page.locator('[data-tab="css"]').click();
      const css = await page.locator("#sourceInput").inputValue();
      let release;
      const gate = new Promise((resolve) => (release = resolve));
      await page.route("**/static/mode-switch-delay.css", async (route) => {
        await gate;
        await route.fulfill({ contentType: "text/css", body: "" });
      });
      await page
        .locator("#sourceInput")
        .fill('@import url("/static/mode-switch-delay.css");\n' + css);
      await page.getByRole("tab", { name: "可视化", exact: true }).click();
      await page.locator(".editor-loading-overlay").waitFor();
      assert.equal(
        await page
          .locator('[data-editor-mode="visual"]')
          .getAttribute("aria-selected"),
        "true",
      );
      assert(await page.locator("#sourceWorkspace").isHidden());
      const header = await page.locator(".editor-header").boundingBox(),
        overlay = await page.locator(".editor-loading-overlay").boundingBox(),
        canvas = await page
          .locator(".editor-loading-overlay .skeleton-canvas")
          .boundingBox();
      assert(Math.abs(overlay.y - header.y - header.height) < 1);
      assert.equal(canvas.y, overlay.y);
      release();
      await page
        .locator(".editor-loading-overlay")
        .waitFor({ state: "detached" });
      await page.getByRole("tab", { name: "源码", exact: true }).click();
      await page.locator("#sourceInput").fill(css);
      await page.locator('[data-tab="notes"]').click();
      const notes = await page.locator("#sourceInput").inputValue();
      await page.locator("#sourceInput").fill("{");
      await page.getByRole("tab", { name: "可视化", exact: true }).click();
      await page.waitForFunction(
        () => !document.querySelector("#sourceWorkspace").hidden,
      );
      assert.equal(await page.locator("#sourceInput").inputValue(), "{");
      assert.equal(await page.locator(".editor-loading-overlay").count(), 0);
      await page.locator("#sourceInput").fill(notes);
      await page.getByRole("tab", { name: "可视化", exact: true }).click();
      await page
        .locator(".editor-loading-overlay")
        .waitFor({ state: "detached" });
      await saved();
      await page.unroute("**/static/mode-switch-delay.css");
    },
  );
  await check(
    "universal border, fill, text style controls persist and custom numbers step",
    async () => {
      await frame().locator("#heading").click();
      await color("backgroundColor", "#b5d0c2");
      await color("borderColor", "#365f51");
      await number("borderWidth", 4);
      await page.getByRole("combobox", { name: "边框样式" }).click();
      await page.getByRole("option", { name: "虚线", exact: true }).click();
      await number("fontSize", 54);
      await page.getByRole("button", { name: "增加字号", exact: true }).click();
      assert.equal(await page.locator("[name=fontSize]").inputValue(), "55");
      await color("color", "#4472c4");
      await page.locator("#textItalic").click();
      await page.locator("#textUnderline").click();
      const style = await frame()
        .locator("#heading")
        .evaluate((n) => {
          const s = getComputedStyle(n);
          return [
            s.borderTopWidth,
            s.borderTopStyle,
            s.borderTopColor,
            s.backgroundColor,
            s.color,
            s.fontSize,
            s.fontStyle,
            s.textDecorationLine,
          ];
        });
      assert.deepEqual(style, [
        "4px",
        "dashed",
        "rgb(54, 95, 81)",
        "rgb(181, 208, 194)",
        "rgb(68, 114, 196)",
        "55px",
        "italic",
        "underline",
      ]);
      await saved();
      let c = await api("/decks/" + deck.id + "/content");
      assert(c.html.includes("border-style: dashed"));
      await page.screenshot({ path: path.join(dir, "inspector.png") });
      await frame().locator("#diagram").click();
      assert(await page.locator("[name=fontSize]").isVisible());
      await color("color", "#ed7d31");
      await number("fontSize", 28);
      await number("borderWidth", 2);
      assert.equal(
        await frame()
          .locator("#diagram text")
          .evaluate((n) => getComputedStyle(n).fill),
        "rgb(237, 125, 49)",
      );
      assert.equal(
        await frame()
          .locator("#diagram text")
          .evaluate((n) => getComputedStyle(n).fontSize),
        "28px",
      );
      await frame().locator("#photo").click();
      assert(await page.locator("[data-color-field=color]").isVisible());
      await color("backgroundColor", "#ffc000");
      await number("borderWidth", 3);
      assert.equal(
        await frame()
          .locator("#photo")
          .evaluate((n) => getComputedStyle(n).borderTopWidth),
        "3px",
      );
      await frame().locator("#paragraph").click();
      await page.locator("#selectParent").click();
      await color("backgroundColor", "#e7e6e6");
      await color("color", "#365f51");
      assert.equal(
        await frame()
          .locator("#paragraph")
          .evaluate((n) => getComputedStyle(n).color),
        "rgb(54, 95, 81)",
      );
      await saved();
    },
  );
  await check(
    "shape strokes follow the contour and custom colors remember recent choices",
    async () => {
      await page.locator("#insertShape").click();
      await page.getByRole("button", { name: "三角形", exact: true }).click();
      await color("backgroundColor", "#123abc", true);
      await color("borderColor", "#a855f7");
      await number("borderWidth", 7);
      await page.getByRole("combobox", { name: "边框样式" }).click();
      await page.getByRole("option", { name: "点线", exact: true }).click();
      const shape = frame().locator("[data-shape=triangle]");
      assert.equal(
        await shape
          .locator("path")
          .evaluate((n) => getComputedStyle(n).strokeWidth),
        "7px",
      );
      assert.equal(
        await shape.locator("path").evaluate((n) => getComputedStyle(n).fill),
        "rgb(18, 58, 188)",
      );
      assert.equal(
        await shape
          .locator("path")
          .evaluate((n) => getComputedStyle(n).strokeDasharray),
        "7px, 14px",
      );
      assert.equal(
        await shape.evaluate((n) => getComputedStyle(n).borderTopStyle),
        "none",
      );
      await page.locator("[data-color-field=backgroundColor]").click();
      assert.equal(
        await page.locator('.recent-colors [data-color="#123abc"]').count(),
        1,
      );
      await page.waitForFunction(() => {
        const panel = document.querySelector(".color-popover");
        return (
          panel.matches(":popover-open") &&
          getComputedStyle(panel).opacity === "1"
        );
      });
      await page.screenshot({ path: path.join(dir, "color-picker.png") });
      await page.locator(".color-hex").fill("badhex");
      await page.locator(".color-apply").click();
      assert.equal(
        await page.locator(".color-error").textContent(),
        "请输入有效的十六进制颜色",
      );
      await page.locator("[data-transparent]").click();
      assert.equal(
        await shape.locator("path").evaluate((n) => getComputedStyle(n).fill),
        "rgba(0, 0, 0, 0)",
      );
      // The OS picker cannot be driven headlessly. Verify its user-gesture API wiring with a stub.
      await page.evaluate(() => {
        window.EyeDropper = class {
          async open() {
            window.eyeDropperOpened = true;
            return { sRGBHex: "#345678" };
          }
        };
      });
      await page.locator("[data-color-field=backgroundColor]").click();
      await page.locator("[data-eyedropper]").click();
      assert(await page.evaluate(() => window.eyeDropperOpened));
      assert.equal(
        await shape.locator("path").evaluate((n) => getComputedStyle(n).fill),
        "rgb(52, 86, 120)",
      );
      await saved();
    },
  );
  await check(
    "autosave keeps caret and active text editing, retries errors, and saves bottom notes",
    async () => {
      await page.locator("#insertText").click();
      const text = frame().locator("[data-editor-element=text]").last();
      await text.dblclick();
      await text.fill("自动保存输入");
      const caret = await text.evaluate((n) => ({
        offset: n.ownerDocument.getSelection().anchorOffset,
        active: n.ownerDocument.activeElement === n,
      }));
      await saved();
      assert.equal(await text.getAttribute("contenteditable"), "true");
      assert.deepEqual(
        await text.evaluate((n) => ({
          offset: n.ownerDocument.getSelection().anchorOffset,
          active: n.ownerDocument.activeElement === n,
        })),
        caret,
      );
      await page.keyboard.insertText("继续");
      await saved();
      let content = await api("/decks/" + deck.id + "/content");
      assert(content.html.includes("自动保存输入继续"));
      assert(!/data-ve-|contenteditable|spellcheck/.test(content.html));
      await page.locator('[data-inspector-tab="notes"]').click();
      await page.locator("#visualPageNotes").fill("无需离开输入框就能保存");
      await saved();
      content = await api("/decks/" + deck.id + "/content");
      assert.equal(content.notes[1].notes, "无需离开输入框就能保存");
      const route = `**/api/decks/${deck.id}/content`;
      await page.route(route, (r) =>
        r.request().method() === "PUT"
          ? r.fulfill({
              status: 503,
              contentType: "application/json",
              body: JSON.stringify({ error: "暂时无法连接" }),
            })
          : r.continue(),
      );
      await page.locator("#visualPageTitle").fill("异常恢复");
      await page.waitForFunction(
        () => document.querySelector("#saveState").dataset.state === "error",
      );
      assert(
        (await page.locator("#saveState").getAttribute("aria-label")).includes(
          "重试",
        ),
      );
      await page.unroute(route);
      await page.locator("#saveState").click();
      await saved();
      content = await api("/decks/" + deck.id + "/content");
      assert.equal(content.notes[1].title, "异常恢复");
    },
  );
  await check(
    "both side panels resize across iframes, support keyboard and survive reload",
    async () => {
      const measure = () =>
        page.evaluate(() =>
          [".slide-rail", ".visual-inspector"].map((selector) =>
            Math.round(
              document.querySelector(selector).getBoundingClientRect().width,
            ),
          ),
        );
      const before = await measure();
      await drag(".panel-resizer-left", 58, 0);
      await drag(".panel-resizer-right", -62, 0);
      const after = await measure();
      assert(after[0] >= before[0] + 55);
      assert(after[1] >= before[1] + 59);
      await page.locator(".panel-resizer-right").focus();
      await page.keyboard.press("ArrowLeft");
      const final = await measure();
      assert.equal(final[1], after[1] + 8);
      await page.reload();
      await frame().locator("#heading").waitFor();
      assert.deepEqual(await measure(), final);
      assert.equal(await page.locator(".panel-resize-shield").count(), 0);
      const thumb = page.frameLocator(".thumbnail-sheet");
      await thumb.locator(".thumbnail-scene").first().waitFor();
      assert.equal(
        await thumb
          .locator(".thumbnail-scene")
          .first()
          .evaluate((n) => getComputedStyle(n).borderRadius),
        "7px",
      );
      await page.screenshot({ path: path.join(dir, "resized-workspace.png") });
    },
  );
  await check(
    "metadata settings flush pending changes and later autosaves preserve metadata",
    async () => {
      await page.locator('[data-inspector-tab="notes"]').click();
      await page.locator("#visualPageTitle").fill("设置前尚未保存的页名");
      await page.locator("#deckSettings").click();
      await page.locator("dialog[open] input[name=title]").fill("新演示名称");
      await page.locator("dialog input[name=author]").fill("新作者");
      await page.locator("dialog textarea[name=description]").fill("新简介");
      await page.locator("dialog input[name=slug]").fill("workspace-renamed");
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector("dialog")).opacity === "1",
      );
      await page.screenshot({ path: path.join(dir, "metadata-settings.png") });
      await page.locator("dialog button[type=submit]").click();
      await page.locator("dialog").waitFor({ state: "hidden" });
      assert.equal(
        await page.locator(".editor-header h1").textContent(),
        "新演示名称",
      );
      assert(page.url().endsWith("/edit/workspace-renamed"));
      assert.equal(await page.locator("#sourceMetadata").count(), 0);
      await page.locator('[data-inspector-tab="notes"]').click();
      await page.locator("#visualPageNotes").fill("设置后的自动保存");
      await saved();
      const data = await api("/decks/" + deck.id),
        content = await api("/decks/" + deck.id + "/content");
      assert.equal(data.title, "新演示名称");
      assert.equal(data.author, "新作者");
      assert.equal(data.description, "新简介");
      assert.equal(content.notes[1].title, "设置前尚未保存的页名");
      assert.equal(content.notes[1].notes, "设置后的自动保存");
    },
  );
  assert.deepEqual(errors, []);
  console.log("ALL 6 EDITOR WORKSPACE GROUPS PASSED");
} catch (error) {
  await page.screenshot({
    path: path.join(dir, "failure.png"),
    fullPage: true,
  });
  console.error(errors);
  throw error;
} finally {
  await browser.close();
  await app.close();
}
