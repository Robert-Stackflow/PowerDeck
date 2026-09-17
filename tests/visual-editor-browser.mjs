import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp, projectRoot } from "../server/app.mjs";

const dir = path.join(projectRoot, "work/qa/visual-editor");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const app = await createApp({ dataDir: path.join(dir, "data") });
const base = await app.listen({ port: 0 });
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({
  viewport: { width: 1540, height: 1000 },
});
const page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const frame = () => page.frameLocator("#visualCanvas");
const api = (route, method = "GET", body) =>
  page.evaluate(
    async ({ route, method, body }) => {
      const session = await fetch("/api/session").then((r) => r.json());
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
const check = async (name, fn) => {
  await fn();
  console.log("PASS " + name);
};
const clickSlide = async (index) =>
  page.locator(`[data-page-index="${index}"]`).click();
const pageAction = async (action) => {
  await page
    .locator('.slide-thumb[aria-current="page"]')
    .click({ button: "right" });
  await page.locator(`[data-menu-action="${action}"]`).click();
};
const insertShape = async (shape = "rounded") => {
  await page.locator("#insertShape").click();
  await page.locator(`#shapePopover [data-shape="${shape}"]`).click();
};
const save = async () => {
  await page.locator("#saveDeck").click();
  await page.waitForFunction(
    () => document.querySelector("#saveState").dataset.state === "saved",
  );
};
const drag = async (locator, dx, dy) => {
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2,
    y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
};
let deck;
try {
  await page.goto(base);
  await page
    .locator("input[name=password]")
    .fill("visual-editor-password-9148");
  await page.locator("input[name=confirm]").fill("visual-editor-password-9148");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.locator("#newBtn").waitFor();
  deck = await api("/decks", "POST", {
    title: "可视化测试",
    slug: "visual-test",
    width: 1600,
    height: 900,
    html: '<section class="slide" data-slide-id="a"><h1 id="headline">标题 <em>强调</em></h1><p id="bodyText">正文内容</p><svg id="diagram" viewBox="0 0 200 100"><defs><marker id="arrow"><path d="M0 0 L8 4 L0 8Z"/></marker></defs><path d="M10 50 H190" stroke="green" marker-end="url(#arrow)"/></svg><div class="math" data-tex="x^2"><span class="katex">x²</span></div></section><section class="slide" data-slide-id="b"><h1>第二页</h1></section>',
    css: ".slide{background:#fff}h1{position:absolute;left:100px;top:80px;font-size:64px;color:#234a3d;margin:0}p{position:absolute;left:100px;top:270px;font-size:32px;margin:0}svg{position:absolute;left:800px;top:200px;width:300px;height:150px}.math{position:absolute;left:800px;top:500px;font-size:40px}",
    notes: {
      1: {
        title: "第一页",
        notes: "第一条备注",
        refs: [["参考", "https://example.com"]],
      },
      2: { title: "第二页", notes: "第二条备注", refs: [] },
    },
  });
  await page.goto(base + "/edit/visual-test");
  await frame().locator("#headline").waitFor();
  await check(
    "default visual editor edits text, preserves other markup, undo and redo",
    async () => {
      assert(await page.locator("#visualWorkspace").isVisible());
      await frame().locator("#bodyText").dblclick();
      await frame().locator("#bodyText").fill("在线修改的文字");
      await page.locator('[data-inspector-tab="page"]').click();
      await page.locator("#visualUndo").click();
      assert.equal(
        await frame().locator("#bodyText").textContent(),
        "正文内容",
      );
      await page.locator("#visualRedo").click();
      assert.equal(
        await frame().locator("#bodyText").textContent(),
        "在线修改的文字",
      );
      assert.equal(await frame().locator("#headline em").textContent(), "强调");
    },
  );
  await check(
    "dragging at scaled canvas coordinates and resizing preserve content",
    async () => {
      const before = await frame().locator("#bodyText").boundingBox();
      await drag(frame().locator("#bodyText"), 60, 35);
      const after = await frame().locator("#bodyText").boundingBox();
      assert(Math.abs(after.x - before.x - 60) < 2);
      assert(Math.abs(after.y - before.y - 35) < 2);
      await frame().locator("#bodyText").click();
      await page.keyboard.press("Shift+ArrowRight");
      const nudged = await frame().locator("#bodyText").boundingBox();
      assert(
        nudged.x > after.x + 5,
        "Keyboard nudges selected content in the canvas",
      );
      await page.locator('input[name="fontSize"]').fill("42");
      await page.locator('input[name="fontSize"]').press("Tab");
      assert.equal(
        await frame()
          .locator("#bodyText")
          .evaluate((node) => getComputedStyle(node).fontSize),
        "42px",
      );
      const widthBefore = (await frame().locator("#bodyText").boundingBox())
        .width;
      await drag(frame().locator('[data-handle="se"]'), 40, 20);
      assert(
        (await frame().locator("#bodyText").boundingBox()).width >
          widthBefore + 30,
      );
    },
  );
  await check(
    "insert, duplicate, delete, image upload and atomic diagram selection",
    async () => {
      await page.locator("#insertText").click();
      await frame().locator('[data-editor-element="text"]').dblclick();
      await frame().locator('[data-editor-element="text"]').fill("新增文本框");
      await page.locator('[data-inspector-tab="page"]').click();
      await page.locator("#duplicateElement").click();
      assert.equal(
        await frame().locator('[data-editor-element="text"]').count(),
        2,
      );
      await page.locator("#deleteElement").click();
      assert.equal(
        await frame().locator('[data-editor-element="text"]').count(),
        1,
      );
      await insertShape();
      assert.equal(await page.locator("#elementType").textContent(), "形状");
      await page.locator("#visualImageFile").setInputFiles({
        name: "pixel.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfN0AAAAASUVORK5CYII=",
          "base64",
        ),
      });
      await frame().locator('[data-editor-element="image"]').waitFor();
      assert(
        await frame()
          .locator('[data-editor-element="image"]')
          .evaluate((image) => image.complete && image.naturalWidth === 1),
      );
      await frame().locator("#diagram").click();
      assert.equal(
        await page.locator("#elementType").textContent(),
        "SVG 图表",
      );
      await page.locator("#duplicateElement").click();
      assert.equal(
        await frame().locator(".slide[data-ve-current] > svg").count(),
        2,
      );
      const ids = await frame()
        .locator(".slide[data-ve-current] [id]")
        .evaluateAll((nodes) => nodes.map((node) => node.id));
      assert.equal(new Set(ids).size, ids.length);
      await frame().locator(".math").click();
      assert.equal(await page.locator("#elementType").textContent(), "公式");
      assert.equal(
        await page.locator("#editElementText").textContent(),
        "编辑公式",
      );
    },
  );
  await check(
    "page operations move notes with slides and undo deletions",
    async () => {
      await page.locator('[data-inspector-tab="notes"]').click();
      await clickSlide(1);
      assert.equal(
        await page.locator("#visualPageNotes").inputValue(),
        "第二条备注",
      );
      await pageAction("up");
      assert.equal(
        await page.locator("#visualPageCount").textContent(),
        "1 / 2",
      );
      assert.equal(
        await frame().locator(".slide[data-ve-current] h1").textContent(),
        "第二页",
      );
      await pageAction("duplicate");
      assert.equal(
        await page.locator("#visualPageCount").textContent(),
        "2 / 3",
      );
      await pageAction("delete");
      assert.equal(
        await page.locator("#visualPageCount").textContent(),
        "2 / 2",
      );
      await page.locator("#visualUndo").click();
      assert.equal(
        await page.locator("#visualPageCount").textContent(),
        "2 / 3",
      );
      await page.locator("#visualRedo").click();
      await clickSlide(1);
      assert.equal(
        await page.locator("#visualPageNotes").inputValue(),
        "第一条备注",
      );
      await page.locator("#visualPageNotes").fill("保存后的备注");
      await page.locator('[data-inspector-tab="references"]').click();
      await page.locator(".reference-label").fill("更新后的参考资料");
      await page.locator(".reference-url").fill("https://example.com/updated");
      await page.locator("#addReference").click();
      await page
        .locator(".reference-row")
        .nth(1)
        .locator(".reference-label")
        .fill("新增资料");
      await page
        .locator(".reference-row")
        .nth(1)
        .locator(".reference-url")
        .fill("https://example.org/new");
      await save();
      const content = await api("/decks/" + deck.id + "/content");
      assert.equal(content.notes[2].notes, "保存后的备注");
      assert.deepEqual(content.notes[2].refs, [
        ["更新后的参考资料", "https://example.com/updated"],
        ["新增资料", "https://example.org/new"],
      ]);
      assert(content.html.includes("在线修改的文字"));
      assert(content.html.includes('data-tex="x^2"'));
      assert(
        !/data-ve-|ve-selection|contenteditable|spellcheck/.test(content.html),
      );
    },
  );
  await check(
    "source round-trip, save reload and presenter render visual edits",
    async () => {
      await page.locator('[data-editor-mode="source"]').click();
      await page.locator("#sourceInput").waitFor();
      const html = await page.locator("#sourceInput").inputValue();
      assert(html.includes("在线修改的文字"));
      await page
        .locator("#sourceInput")
        .fill(html.replace("在线修改的文字", "源码和画布同步"));
      await page.locator('[data-editor-mode="visual"]').click();
      assert.equal(
        await frame().locator("#bodyText").textContent(),
        "源码和画布同步",
      );
      await save();
      await page.reload();
      await clickSlide(1);
      assert.equal(
        await frame().locator("#bodyText").textContent(),
        "源码和画布同步",
      );
      await page.screenshot({ path: path.join(dir, "editor.png") });
      const viewer = await context.newPage();
      await viewer.goto(base + "/present/visual-test#2");
      await viewer.waitForFunction(() => window.presentation?.current === 2);
      const doc = viewer.frames().find((item) => item.url() === "about:srcdoc");
      assert.equal(
        await doc.locator("#bodyText").textContent(),
        "源码和画布同步",
      );
      await viewer.close();
    },
  );
  await check(
    "autosave serializes edits made during an in-flight request",
    async () => {
      let release, received;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const captured = new Promise((resolve) => {
        received = resolve;
      });
      const route = `**/api/decks/${deck.id}/content`;
      await page.route(route, async (request) => {
        if (request.request().method() !== "PUT") return request.continue();
        const response = await request.fetch();
        received();
        await gate;
        await request.fulfill({ response });
      });
      await page.locator("#insertText").click();
      await captured;
      await insertShape();
      release();
      await page.waitForFunction(
        () => !document.querySelector("#saveDeck").disabled,
      );
      await page.waitForFunction(
        () => document.querySelector("#saveState").dataset.state === "saved",
      );
      assert.equal(await page.locator("#saveState").textContent(), "");
      await page.unroute(route);
      await save();
      const saved = await api("/decks/" + deck.id + "/content");
      assert.equal(
        (saved.html.match(/data-editor-element="shape"/g) || []).length,
        2,
      );
    },
  );
  await check(
    "shape palette and text boxes remain editable after multiline input",
    async () => {
      const existing = await frame()
        .locator('[data-editor-element="shape"]')
        .count();
      const ids = [
        "rectangle",
        "rounded",
        "ellipse",
        "triangle",
        "diamond",
        "hexagon",
        "star",
        "arrow-right",
        "arrow-left",
        "chevron",
        "callout",
        "line",
      ];
      for (const shape of ids) {
        await insertShape(shape);
        assert.equal(
          (await frame()
            .locator(`[data-editor-element="shape"][data-shape="${shape}"]`)
            .count()) > 0,
          true,
        );
      }
      assert.equal(
        await frame().locator('[data-editor-element="shape"]').count(),
        existing + ids.length,
      );
      await page.locator("#insertText").click();
      const textbox = frame().locator('[data-editor-element="text"]').last();
      await textbox.dblclick();
      await textbox.fill("第一行");
      await textbox.press("End");
      await textbox.press("Enter");
      await page.keyboard.insertText("第二行");
      await page.locator('[data-inspector-tab="page"]').click();
      await textbox.dblclick();
      assert.equal(await textbox.getAttribute("contenteditable"), "true");
      await textbox.fill("再次双击仍可编辑");
      await page.locator('[data-inspector-tab="page"]').click();
      assert.equal(await textbox.textContent(), "再次双击仍可编辑");
      assert.equal(await page.locator(".canvas-page-header").count(), 0);
      assert.equal(await page.locator(".visual-page-notes").count(), 0);
      assert.equal(
        await page.locator(".visual-inspector #visualPageNotes").count(),
        1,
      );
      assert.equal(await page.locator(".inspector-tabs [role=tab]").count(), 3);
      assert.equal(
        await page
          .locator(".slide-rail-actions,.slide-rail .visual-panel-head")
          .count(),
        0,
      );
    },
  );
  await check(
    "hyperlinks validate, save and open from the presenter without advancing",
    async () => {
      await page.locator("#insertLink").click();
      const href = base + "/present/visual-test#1";
      await page.locator("#editorLinkURL").fill(href);
      await page.locator("#editorLinkForm button[type=submit]").click();
      const textbox = frame().locator('[data-editor-element="text"]').last();
      assert.equal(await textbox.getAttribute("data-editor-href"), href);
      await page.locator("#insertLink").click();
      await page.locator("#editorLinkURL").fill("javascript:alert(1)");
      await page.locator("#editorLinkForm button[type=submit]").click();
      assert(await page.locator("#editorLinkError").textContent());
      assert.equal(await textbox.getAttribute("data-editor-href"), href);
      await page.locator("#closeLink").click();
      await save();
      const viewer = await context.newPage();
      await viewer.goto(base + "/present/visual-test#2");
      await viewer.waitForFunction(() => window.presentation?.current === 2);
      const popup = viewer.waitForEvent("popup");
      await viewer
        .frameLocator("#playerFrame")
        .locator("[data-editor-href]")
        .click();
      const opened = await popup;
      await opened.waitForURL(href);
      assert.equal(await opened.evaluate(() => window.opener), null);
      assert.equal(await viewer.evaluate(() => window.presentation.current), 2);
      await opened.close();
      await viewer.close();
      await page.locator("#insertLink").click();
      await page.locator("#removeEditorLink").click();
      assert.equal(await textbox.getAttribute("data-editor-href"), null);
      await page.locator("#visualUndo").click();
      assert.equal(await textbox.getAttribute("data-editor-href"), href);
    },
  );
  await check(
    "page and canvas context menus handle selection, edges and light dismissal",
    async () => {
      await clickSlide(0);
      await page.locator('[data-page-index="0"]').click({ button: "right" });
      assert(await page.locator('[data-menu-action="up"]').isDisabled());
      await page.keyboard.press("Escape");
      assert.equal(await page.locator("#editorContextMenu").isVisible(), false);
      const bounds = await frame()
        .locator(".slide[data-ve-current]")
        .boundingBox();
      await page.mouse.click(
        bounds.x + bounds.width - 12,
        bounds.y + bounds.height - 12,
        { button: "right" },
      );
      assert(
        await page.locator('[data-menu-action="insert-text"]').isVisible(),
      );
      const menuBounds = await page.locator("#editorContextMenu").boundingBox();
      assert(menuBounds.y + menuBounds.height <= 1000);
      await page.locator('[data-menu-action="insert-text"]').click();
      const textbox = frame()
        .locator('.slide[data-ve-current] [data-editor-element="text"]')
        .last();
      await textbox.click({ button: "right" });
      assert(await page.locator('[data-menu-action="edit-text"]').isVisible());
      await page.mouse.click(bounds.x + bounds.width - 12, bounds.y + 12);
      assert.equal(await page.locator("#editorContextMenu").isVisible(), false);
      await save();
    },
  );
  await check(
    "existing AReaL diagrams and formulas survive a no-op visual save",
    async () => {
      const before = await api("/decks/areal/content");
      await page.goto(base + "/edit/areal");
      await page.locator('[data-page-index="4"]').click();
      await frame().locator(".slide[data-ve-current] h1").waitFor();
      await page.screenshot({ path: path.join(dir, "areal-editor.png") });
      await save();
      const after = await api("/decks/areal/content");
      const check = await page.evaluate(
        ({ before, after }) => {
          const parse = (html) =>
            new DOMParser().parseFromString(html, "text/html");
          const a = parse(before.html),
            b = parse(after.html);
          return {
            equalText: a.body.textContent === b.body.textContent,
            svg:
              a.querySelectorAll("svg").length ===
              b.querySelectorAll("svg").length,
            formulas:
              [...a.querySelectorAll("[data-tex]")]
                .map((el) => el.outerHTML)
                .join("") ===
              [...b.querySelectorAll("[data-tex]")]
                .map((el) => el.outerHTML)
                .join(""),
          };
        },
        { before, after },
      );
      assert.deepEqual(check, { equalText: true, svg: true, formulas: true });
      assert.deepEqual(after.notes, before.notes);
      await frame().locator(".slide[data-ve-current] h1").click();
      assert.equal(await page.locator("#elementType").textContent(), "文字");
      await page.screenshot({ path: path.join(dir, "areal-selected.png") });
      await page.setViewportSize({ width: 1024, height: 768 });
      assert(await frame().locator(".slide[data-ve-current]").isVisible());
      await page.screenshot({ path: path.join(dir, "editor-compact.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth),
        390,
      );
      await page.screenshot({
        path: path.join(dir, "editor-mobile.png"),
        fullPage: true,
      });
    },
  );
  await check(
    "scrolling and page reordering reuse a single thumbnail document",
    async () => {
      await page.setViewportSize({ width: 1540, height: 1000 });
      assert.equal(await page.locator(".slide-rail iframe").count(), 1);
      assert.equal(await page.locator(".slide-thumb-title").count(), 0);
      assert(
        await page.evaluate(() => {
          const list = document.querySelector("#slideList");
          const frame = document.querySelector(".thumbnail-sheet");
          return (
            Math.abs(frame.getBoundingClientRect().height - list.clientHeight) <
            1
          );
        }),
      );
      await page.evaluate(() => {
        window.originalThumbnails =
          document.querySelector(".thumbnail-sheet").contentDocument;
      });
      const list = await page.locator("#slideList").boundingBox();
      await page.mouse.move(list.x + list.width / 2, list.y + list.height / 2);
      await page.mouse.wheel(0, 1600);
      await page.waitForFunction(
        () => document.querySelector("#slideList").scrollTop > 500,
      );
      await page.locator('[data-page-index="20"]').click({ button: "right" });
      await page.locator('[data-menu-action="up"]').click();
      await pageAction("down");
      assert(
        await page.evaluate(
          () =>
            window.originalThumbnails ===
            document.querySelector(".thumbnail-sheet").contentDocument,
        ),
      );
      const thumb = page.frameLocator(".thumbnail-sheet");
      await thumb
        .locator(".thumbnail-scene .slide")
        .first()
        .waitFor({ state: "attached" });
      assert((await thumb.locator(".thumbnail-scene").count()) < 27);
      assert.equal(await page.locator("iframe").count(), 2);
      await page.locator('[data-page-index="4"]').click();
      await page.locator("#insertShape").click();
      await page.waitForFunction(
        () =>
          document.querySelector("#shapePopover").matches(":popover-open") &&
          getComputedStyle(document.querySelector("#shapePopover")).opacity ===
            "1",
      );
      await page.screenshot({ path: path.join(dir, "shape-palette.png") });
      await page.keyboard.press("Escape");
      await page.locator('[data-page-index="4"]').click({ button: "right" });
      await page.waitForFunction(
        () =>
          document
            .querySelector("#editorContextMenu")
            .matches(":popover-open") &&
          getComputedStyle(document.querySelector("#editorContextMenu"))
            .opacity === "1",
      );
      await page.screenshot({ path: path.join(dir, "page-context-menu.png") });
    },
  );
  assert.deepEqual(errors, []);
  console.log("ALL 11 VISUAL EDITOR BROWSER GROUPS PASSED");
} catch (error) {
  await page.screenshot({
    path: path.join(dir, "failure.png"),
    fullPage: true,
  });
  console.error("Browser errors:", errors);
  throw error;
} finally {
  await browser.close();
  await app.close();
}
