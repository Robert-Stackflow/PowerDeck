import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp, projectRoot } from "../server/app.mjs";

const qa = path.join(projectRoot, "work/qa");
fs.mkdirSync(qa, { recursive: true });
const directory = fs.mkdtempSync(path.join(qa, "editor-interactions-"));
const app = await createApp({
  dataDir: path.join(directory, "data"),
  seed: false,
  publicURL: "",
  adminPassword: "",
});
const base = await app.listen({ port: 0 });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});
try {
  const context = await browser.newContext({
    viewport: { width: 1540, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await context.newPage(),
    errors = [],
    imageRequests = new Set();
  page.on("pageerror", (error) => errors.push(error.message));
  const setup = await context.request.post(base + "/api/setup", {
    data: { username: "admin", password: "editor-interactions-test-2026" },
  });
  assert.equal(setup.status(), 200);
  const session = await (
    await context.request.get(base + "/api/session")
  ).json();
  const api = async (route, method = "GET", data) => {
    const response = await context.request.fetch(base + "/api" + route, {
      method,
      data,
      headers: { "X-CSRF-Token": session.csrf },
    });
    assert(response.ok(), await response.text());
    return response.json();
  };
  const notes = {},
    slides = [];
  for (let n = 1; n <= 35; n++) {
    notes[n] = { title: `Slide ${n}`, notes: "", refs: [] };
    slides.push(
      `<section class="slide" data-slide-id="slide-${n}"><main style="position:absolute;inset:0"><div id="a-${n}" data-editor-element="text" style="position:absolute;left:100px;top:100px;width:200px;height:80px;font-size:32px">Alpha ${n}</div><div id="b-${n}" data-editor-element="text" style="position:absolute;left:400px;top:100px;width:200px;height:80px;font-size:32px">Beta ${n}</div><div id="c-${n}" data-editor-element="text" style="position:absolute;left:950px;top:100px;width:200px;height:80px;font-size:32px">Gamma ${n}</div><div id="locked-${n}" data-editor-element="shape" data-editor-locked="true" style="position:absolute;left:100px;top:300px;width:200px;height:100px;background:#ddd"></div><img loading="lazy" decoding="sync" src="/static/qa-editor-image-${n}.svg" style="position:absolute;left:950px;top:650px;width:100px;height:100px"></main></section>`,
    );
  }
  const deck = await api("/decks", "POST", {
    slug: "interaction-fixture",
    title: "Editor test",
    width: 1600,
    height: 900,
    html: slides.join(""),
    css: ".slide{background:white}",
    notes,
  });
  await page.route("**/static/qa-editor-image-*.svg", async (route) => {
    const n = Number(
      route
        .request()
        .url()
        .match(/image-(\d+)/)[1],
    );
    imageRequests.add(n);
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#abd"/></svg>',
    });
  });
  const started = Date.now();
  await page.goto(base + "/edit/interaction-fixture#20");
  await page.waitForFunction(
    () =>
      document.querySelector(".editor")?.getAttribute("aria-busy") === "false",
  );
  const readyMs = Date.now() - started;
  const frame = page.frameLocator("#visualCanvas");
  const current = () => frame.locator(".slide[data-ve-current]");
  const visibleThumb = () =>
    page.locator('.slide-thumb[aria-current="page"]').evaluate((button) => {
      const b = button.getBoundingClientRect(),
        p = button.closest(".slide-list").getBoundingClientRect();
      return b.top >= p.top - 1 && b.bottom <= p.bottom + 1;
    });
  assert.equal(await current().getAttribute("data-slide-id"), "slide-20");
  assert(await visibleThumb(), "initial thumbnail must be in view");
  assert(imageRequests.size < 20, `eager image loading: ${[...imageRequests]}`);
  assert(!imageRequests.has(1), "opening page 20 fetched the cover");
  console.log(
    `PASS initial deep link and lazy media: ${readyMs}ms, ${imageRequests.size}/35 image requests`,
  );
  await page.locator("#openBrandAssets").click();
  const emptyAssets = page.locator(".brand-assets-empty");
  await emptyAssets.waitFor();
  assert(
    (await emptyAssets.boundingBox()).height >= 190,
    "empty brand asset library must retain a useful content height",
  );
  await page.locator("#closeBrandAssets").click();
  console.log("PASS empty brand asset library keeps a stable dialog height");
  await page.waitForTimeout(400);
  const scrollWork = await page.evaluate(async () => {
    const rail = document.querySelector("#slideList"),
      sheet = document
        .querySelector(".thumbnail-sheet")
        .contentDocument.querySelector("#thumbnailSheet");
    const counts = { sceneWrites: 0, addedNodes: 0 };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes" && record.target !== sheet)
          counts.sceneWrites++;
        else if (record.type === "childList")
          counts.addedNodes += record.addedNodes.length;
      }
    });
    observer.observe(sheet, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    for (let i = 0; i < 60; i++) {
      rail.scrollTop = ((rail.scrollHeight - rail.clientHeight) * i) / 59;
      await new Promise(requestAnimationFrame);
    }
    observer.disconnect();
    return counts;
  });
  assert.equal(
    scrollWork.sceneWrites,
    0,
    "scroll must not rewrite every thumbnail transform",
  );
  assert(
    scrollWork.addedNodes < 10,
    "complex thumbnail HTML must wait until scrolling settles",
  );
  await page.waitForTimeout(700);
  const aligned = await page.evaluate(() => {
    const rail = document.querySelector("#slideList"),
      viewport = rail.getBoundingClientRect(),
      frame = document.querySelector(".thumbnail-sheet"),
      origin = frame.getBoundingClientRect();
    return [
      ...frame.contentDocument.querySelectorAll(".thumbnail-scene"),
    ].flatMap((scene) => {
      const key = scene.querySelector(".slide")?.dataset.slideId;
      const preview = [...rail.querySelectorAll(".slide-thumb")]
        .find((button) => button.dataset.slideKey === key)
        ?.querySelector(".slide-thumb-preview");
      if (!preview) return [];
      const expected = preview.getBoundingClientRect(),
        actual = scene.getBoundingClientRect();
      if (expected.bottom < viewport.top || expected.top > viewport.bottom)
        return [];
      return [Math.abs(actual.top + origin.top - expected.top - 1) < 2];
    });
  });
  assert(
    aligned.length >= 4 && aligned.every(Boolean),
    "visible previews must recover and align after scrolling",
  );
  console.log(
    "PASS sidebar scroll: no per-scene writes/HTML hydration during fling; settled previews align",
  );
  const coordinates = async (x, y) => {
    const box = await current().boundingBox();
    return {
      x: box.x + (x * box.width) / 1600,
      y: box.y + (y * box.height) / 900,
    };
  };
  const clickAt = async (x, y) => {
    const p = await coordinates(x, y);
    await page.mouse.click(p.x, p.y);
  };
  await clickAt(800, 500);
  await page.mouse.wheel(0, 200);
  await page.waitForURL("**#21");
  assert(await visibleThumb(), "wheel navigation must reveal active thumbnail");
  console.log("PASS canvas wheel / sidebar synchronization");
  const dragBy = async (locator, dx, dy) => {
    const box = await locator.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + dx,
      box.y + box.height / 2 + dy,
      { steps: 5 },
    );
    await page.mouse.up();
  };
  const translateOf = (locator) =>
    locator.evaluate((node) => getComputedStyle(node).translate);
  const originalA21 = await translateOf(frame.locator("#a-21"));
  await dragBy(frame.locator("#a-21"), 36, 0);
  const changedA21 = await translateOf(frame.locator("#a-21"));
  assert.notEqual(changedA21, originalA21);
  await page.locator('[data-page-index="21"]').click();
  assert.equal(await current().getAttribute("data-slide-id"), "slide-22");
  const originalA22 = await translateOf(frame.locator("#a-22"));
  await dragBy(frame.locator("#a-22"), 0, 36);
  const changedA22 = await translateOf(frame.locator("#a-22"));
  assert.notEqual(changedA22, originalA22);
  await page.keyboard.press("Control+z");
  assert.equal(
    await current().getAttribute("data-slide-id"),
    "slide-22",
    "undoing the B-page action must remain on page B",
  );
  assert.equal(await translateOf(frame.locator("#a-22")), originalA22);
  assert.equal(await translateOf(frame.locator("#a-21")), changedA21);
  await page.keyboard.press("Control+z");
  assert.equal(
    await current().getAttribute("data-slide-id"),
    "slide-21",
    "undoing the next A-page action must navigate to page A",
  );
  assert.equal(await translateOf(frame.locator("#a-21")), originalA21);
  await page.keyboard.press("Control+Shift+z");
  assert.equal(await current().getAttribute("data-slide-id"), "slide-21");
  assert.equal(await translateOf(frame.locator("#a-21")), changedA21);
  await page.keyboard.press("Control+Shift+z");
  assert.equal(await current().getAttribute("data-slide-id"), "slide-22");
  assert.equal(await translateOf(frame.locator("#a-22")), changedA22);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  assert.equal(await current().getAttribute("data-slide-id"), "slide-21");
  console.log("PASS cross-page undo and redo focus the affected page");
  await current().evaluate((slide) => {
    slide.insertAdjacentHTML(
      "beforeend",
      `
      <div id="pick-fixture">
        <div id="empty-layout" style="position:absolute;left:650px;top:300px;width:200px;height:100px"><div style="width:100%;height:100%"></div></div>
        <div id="text-layout" style="position:absolute;left:650px;top:450px;width:200px;height:100px"><p style="margin:40px 0 0">Nested text</p></div>
        <div id="plain-year" style="position:absolute;left:100px;top:450px">2026</div>
        <div id="pick-group" data-editor-element="group" style="position:absolute;left:350px;top:450px;width:150px;height:100px"><p>Grouped text</p></div>
        <div id="pick-math" class="math" data-tex="x" style="position:absolute;left:950px;top:400px"><span><i>x</i></span></div>
        <div id="pick-shape" data-editor-element="shape" style="position:absolute;left:1150px;top:400px;width:100px;height:80px;background:#abc"></div>
      </div>`,
    );
  });
  await frame.locator("#a-21").click();
  await frame.locator("#empty-layout > div").click();
  assert.equal(await current().locator("[data-ve-selected]").count(), 0);
  await frame.locator("#empty-layout > div").dblclick();
  assert.equal(await current().locator("[contenteditable]").count(), 0);
  await frame.locator("#text-layout").click({ position: { x: 10, y: 10 } });
  assert.equal(await current().locator("[data-ve-selected]").count(), 0);
  await frame.locator("#text-layout p").click();
  assert.equal(
    await current().locator("[data-ve-selected]").textContent(),
    "Nested text",
  );
  for (const [target, selected] of [
    ["#plain-year", "plain-year"],
    ["#pick-group p", "pick-group"],
    ["#pick-math i", "pick-math"],
    ["#pick-shape", "pick-shape"],
  ]) {
    await frame.locator(target).click();
    assert.equal(
      await current().locator("[data-ve-selected]").getAttribute("id"),
      selected,
    );
  }
  await clickAt(800, 600);
  await frame.locator("#pick-fixture").evaluate((node) => node.remove());
  console.log(
    "PASS blank containers ignored; text, groups, formulas, explicit shapes remain selectable",
  );
  await frame.locator("#a-21").click();
  assert.equal(
    await frame
      .locator("#a-21")
      .evaluate((node) => getComputedStyle(node).outlineStyle),
    "none",
  );
  const selection = frame.locator("#ve-selection");
  assert.equal(
    await selection.evaluate((node) => getComputedStyle(node).borderTopWidth),
    "1px",
  );
  const handle = selection.locator('[data-handle="se"]');
  assert.equal(
    await handle.evaluate((node) => getComputedStyle(node).width),
    "8px",
  );
  await current().screenshot({
    path: path.join(directory, "single-selection.png"),
  });
  const beforeResize = await frame.locator("#a-21").boundingBox();
  const handleBox = await handle.boundingBox();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2,
    handleBox.y + handleBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    handleBox.x + handleBox.width / 2 + 40,
    handleBox.y + handleBox.height / 2 + 20,
    { steps: 5 },
  );
  await page.mouse.up();
  const afterResize = await frame.locator("#a-21").boundingBox();
  assert(afterResize.width > beforeResize.width + 30);
  await page.keyboard.press("Control+z");
  await page.locator('[data-page-index="20"]').click();
  assert(
    Math.abs(
      (await frame.locator("#a-21").boundingBox()).width - beforeResize.width,
    ) < 1,
  );
  console.log(
    "PASS single thin selection border, compact handles, resize and undo",
  );
  const marquee = async (x1, y1, x2, y2) => {
    const start = await coordinates(x1, y1),
      end = await coordinates(x2, y2);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 10 });
    await page.mouse.up();
  };
  await marquee(60, 60, 650, 220);
  assert.equal(await current().locator("[data-ve-selected]").count(), 2);
  assert.equal(
    await frame
      .locator("#a-21")
      .evaluate((node) => getComputedStyle(node).outlineStyle),
    "dashed",
  );
  await current().screenshot({
    path: path.join(directory, "multi-selection.png"),
  });
  await marquee(50, 50, 150, 130);
  assert.equal(
    await current().locator("[data-ve-selected]").count(),
    0,
    "containment mode must ignore partially covered components",
  );
  await page.locator("#openGuideSettings").click();
  assert.equal(
    await page.locator("#containMarqueeSelection").getAttribute("aria-checked"),
    "true",
  );
  await page.locator("#containMarqueeSelection").click();
  await page.locator("#openGuideSettings").click();
  await marquee(50, 50, 150, 130);
  assert.equal(
    await current().locator("[data-ve-selected]").count(),
    1,
    "intersection mode must include partially covered components",
  );
  await page.locator("#openGuideSettings").click();
  await page.locator("#containMarqueeSelection").click();
  await page.locator("#openGuideSettings").click();
  await marquee(60, 60, 650, 220);
  assert.equal(
    await current().locator("main").getAttribute("style"),
    "position:absolute;inset:0",
  );
  await page.keyboard.down("Shift");
  await marquee(900, 70, 1200, 240);
  await page.keyboard.up("Shift");
  assert.equal(await current().locator("[data-ve-selected]").count(), 3);
  await marquee(50, 270, 350, 420);
  assert.equal(
    await current().locator("[data-ve-selected]").count(),
    0,
    "locked layer must be excluded",
  );
  await marquee(60, 60, 650, 220);
  const start = await coordinates(700, 400),
    end = await coordinates(1200, 600);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.equal(
    await current().locator("[data-ve-selected]").count(),
    2,
    "Escape should restore selection",
  );
  console.log(
    "PASS containment/intersection marquee modes, additive selection, locked layers, Escape",
  );
  await current().evaluate((slide) => {
    slide.insertAdjacentHTML(
      "beforeend",
      `<style id="unmarked-style">
        .unmarked-stack > div { position:absolute;left:200px;width:440px;height:80px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff8e9;border:2px solid #dc8428;border-radius:24px;color:#17211f;font:700 30px/1.2 Arial,sans-serif; }
        .unmarked-stack > div small { color:#65716d;font-size:18px;font-weight:400;line-height:1.25; }
      </style><div id="unmarked-fixture" class="unmarked-stack">
        <div id="unmarked-a" style="top:500px">Card A</div>
        <div id="unmarked-b" style="top:620px">Card B</div>
        <div id="unmarked-c" style="top:740px">Card C<small>Helper</small></div>
      </div>`,
    );
  });
  await marquee(170, 470, 680, 850);
  assert.deepEqual(
    await current()
      .locator("[data-ve-selected]")
      .evaluateAll((nodes) => nodes.map((node) => node.id).sort()),
    ["unmarked-a", "unmarked-b", "unmarked-c"],
    "marquee must discover the same unmarked cards that clicking discovers",
  );
  await clickAt(1200, 500);
  await frame.locator("#unmarked-c").click();
  const unmarkedBox = await frame.locator("#unmarked-c").boundingBox();
  await page.mouse.move(
    unmarkedBox.x + unmarkedBox.width / 2,
    unmarkedBox.y + unmarkedBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    unmarkedBox.x + unmarkedBox.width / 2 + 50,
    unmarkedBox.y + unmarkedBox.height / 2 + 50,
  );
  await page.mouse.move(
    unmarkedBox.x + unmarkedBox.width / 2 + 3,
    unmarkedBox.y + unmarkedBox.height / 2 + 3,
  );
  await page.waitForTimeout(50);
  assert(
    (await frame.locator('[data-guide-kind="alignment"]').count()) >= 1,
    "an unmarked card must align with its sibling cards while dragging",
  );
  assert(
    (await frame.locator('[data-guide-kind="spacing"]').count()) >= 2,
    "an unmarked card must show repeated spacing while dragging",
  );
  await page.mouse.up();
  await page.keyboard.press("Control+c");
  const unmarkedText = await page.evaluate(() =>
    navigator.clipboard.readText(),
  );
  await current().evaluate((slide, plainText) => {
    const data = new DataTransfer();
    data.setData("text/plain", plainText);
    slide.ownerDocument.body.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, unmarkedText);
  const pastedCard = current().locator('[id^="copy-"]').last();
  await pastedCard.waitFor();
  for (const property of [
    "backgroundColor",
    "borderTopColor",
    "borderRadius",
    "fontWeight",
  ])
    assert.equal(
      await pastedCard.evaluate(
        (node, name) => getComputedStyle(node)[name],
        property,
      ),
      await frame
        .locator("#unmarked-c")
        .evaluate((node, name) => getComputedStyle(node)[name], property),
      `pasted card must preserve ${property}`,
    );
  assert.deepEqual(
    await pastedCard.locator("small").evaluate((node) => {
      const style = getComputedStyle(node);
      return [style.color, style.fontSize, style.fontWeight];
    }),
    await frame.locator("#unmarked-c small").evaluate((node) => {
      const style = getComputedStyle(node);
      return [style.color, style.fontSize, style.fontWeight];
    }),
    "pasted card must preserve nested text styling",
  );
  await current().evaluate((slide) => {
    slide.querySelector("#unmarked-style")?.remove();
    slide.querySelector("#unmarked-fixture")?.remove();
    slide.querySelectorAll('[id^="copy-"]').forEach((node) => node.remove());
  });
  await marquee(60, 60, 650, 220);
  console.log(
    "PASS unmarked cards: marquee, sibling guides, spacing and style-preserving clipboard fallback",
  );
  await page.keyboard.press("Control+c");
  assert.equal(
    await page.evaluate(() => navigator.clipboard.readText()),
    "Alpha 21\nBeta 21",
  );
  await page.locator('[data-page-index="21"]').click();
  await clickAt(800, 500);
  await page.keyboard.press("Control+v");
  await current().locator('[id^="copy-"]').first().waitFor();
  assert.equal(await current().locator("[data-ve-selected]").count(), 2);
  assert.equal(await current().locator('[id^="copy-"]').count(), 2);
  await page.keyboard.press("Control+z");
  assert.equal(await current().locator('[id^="copy-"]').count(), 0);
  await page.keyboard.press("Control+Shift+z");
  assert.equal(await current().locator('[id^="copy-"]').count(), 2);
  console.log("PASS native component clipboard across pages, undo/redo");
  await current().locator('[id^="copy-"]').first().click();
  await current()
    .locator('[id^="copy-"]')
    .last()
    .click({ modifiers: ["Shift"] });
  await page.keyboard.press("Control+x");
  assert.equal(await current().locator('[id^="copy-"]').count(), 0);
  await page.keyboard.press("Control+z");
  assert.equal(await current().locator('[id^="copy-"]').count(), 2);
  await page.evaluate(() =>
    navigator.clipboard.writeText("Plain text\nSecond line"),
  );
  await clickAt(800, 500);
  await page.keyboard.press("Control+v");
  await current().getByText("Plain text", { exact: false }).waitFor();
  await page.evaluate(() =>
    navigator.clipboard.writeText("https://example.com/docs"),
  );
  await clickAt(800, 500);
  await page.keyboard.press("Control+v");
  await current()
    .locator('[data-editor-href="https://example.com/docs"]')
    .waitFor();
  await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 800;
    canvas.getContext("2d").fillRect(0, 0, 240, 800);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
  });
  await clickAt(800, 500);
  await page.keyboard.press("Control+v");
  await current().locator('img[src*="paste-"]').waitFor();
  await current()
    .locator('img[src*="paste-"]')
    .evaluate((img) => img.decode());
  const checkImageRatio = async (locator, expected) => {
    const size = await locator.evaluate((img) => ({
      width: parseFloat(img.style.width),
      height: parseFloat(img.style.height),
    }));
    assert(
      Math.abs(size.width / size.height - expected) < 0.001,
      JSON.stringify(size),
    );
    assert(size.width <= 480 && size.height <= 320);
  };
  await checkImageRatio(current().locator('img[src*="paste-"]'), 0.3);
  console.log(
    "PASS native external text / URL / PNG clipboard and asset upload",
  );
  await current().locator('img[src*="paste-"]').click();
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  assert.equal(await current().locator('img[src*="paste-"]').count(), 2);
  await page.keyboard.press("Control+z");
  assert.equal(await current().locator('img[src*="paste-"]').count(), 1);
  await checkImageRatio(current().locator('img[src*="paste-"]'), 0.3);
  for (const [width, height] of [
    [1200, 400],
    [600, 600],
  ]) {
    const base64 = await page.evaluate(
      ([width, height]) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d").fillRect(0, 0, width, height);
        return canvas.toDataURL("image/png").split(",")[1];
      },
      [width, height],
    );
    await page.locator("#visualImageFile").setInputFiles({
      name: "ratio.png",
      mimeType: "image/png",
      buffer: Buffer.from(base64, "base64"),
    });
    const uploaded = current().locator('img[src*="assets/image-"]');
    await uploaded.waitFor();
    await checkImageRatio(uploaded, width / height);
    await uploaded.click();
    await page.keyboard.press("Control+z");
    assert.equal(await uploaded.count(), 0);
    await page.keyboard.press("Control+Shift+z");
    await checkImageRatio(uploaded, width / height);
    await page.keyboard.press("Control+z");
  }
  console.log(
    "PASS portrait paste, landscape/square upload preserve aspect ratio; atomic undo/redo",
  );
  await frame.locator("#c-22").dblclick();
  await page.evaluate(() => navigator.clipboard.writeText("Edited text"));
  await page.keyboard.press("Control+v");
  await page.keyboard.press("Escape");
  assert.equal(await frame.locator("#c-22").textContent(), "Edited text");
  await checkImageRatio(current().locator('img[src*="paste-"]'), 0.3);
  await page.locator("#saveDeck").click();
  await page.waitForFunction(
    () => document.querySelector("#saveState").dataset.state === "saved",
  );
  const saved = await api(`/decks/${deck.id}/content`);
  assert(
    !/data-player-|data-ve-/.test(saved.html),
    "runtime markers leaked into saved content",
  );
  assert.equal((saved.html.match(/loading="lazy"/g) || []).length, 35);
  assert.equal((saved.html.match(/decoding="sync"/g) || []).length, 35);
  assert(saved.html.includes("Edited text"));
  assert.equal(
    (saved.html.match(/qa-editor-image-/g) || []).length,
    35,
    "hidden image URLs were lost",
  );
  await page.reload();
  await page.waitForFunction(
    () =>
      document.querySelector(".editor")?.getAttribute("aria-busy") === "false",
  );
  assert(await visibleThumb());
  assert.equal(await frame.locator("#c-22").textContent(), "Edited text");
  const lastThumb = page.locator(".slide-thumb").last();
  await lastThumb.scrollIntoViewIfNeeded();
  const fromBox = await lastThumb.boundingBox(),
    toBox = await page.locator(".slide-thumb").nth(33).boundingBox();
  await page.mouse.move(
    fromBox.x + fromBox.width / 2,
    fromBox.y + fromBox.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 4, {
    steps: 10,
  });
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      document.querySelectorAll(".slide-thumb")[33].dataset.slideKey ===
      "slide-35",
  );
  assert(await visibleThumb());
  await page.keyboard.press("Control+z");
  assert.equal(
    await page.locator(".slide-thumb").last().getAttribute("data-slide-key"),
    "slide-35",
  );
  console.log("PASS sidebar drag reorder and undo after scrolling");
  await current().evaluate((slide) => {
    slide.insertAdjacentHTML(
      "beforeend",
      `<div id="guide-fixtures">
        <div id="guide-a" data-editor-element="shape" style="position:absolute;left:100px;top:500px;width:100px;height:80px;background:#e8eef5"></div>
        <div id="guide-b" data-editor-element="shape" style="position:absolute;left:300px;top:500px;width:100px;height:80px;background:#e8eef5"></div>
        <div id="guide-c" data-editor-element="shape" style="position:absolute;left:660px;top:500px;width:100px;height:80px;background:#f5e8d8"></div>
        <div id="guide-size" data-editor-element="shape" style="position:absolute;left:1000px;top:500px;width:140px;height:80px;background:#e5f1e7"></div>
        <div id="dist-a" data-editor-element="shape" style="position:absolute;left:100px;top:700px;width:100px;height:60px;background:#eee"></div>
        <div id="dist-b" data-editor-element="shape" style="position:absolute;left:420px;top:700px;width:100px;height:60px;background:#eee"></div>
        <div id="dist-c" data-editor-element="shape" style="position:absolute;left:900px;top:700px;width:100px;height:60px;background:#eee"></div>
      </div>`,
    );
  });
  const slideBox = await current().boundingBox(),
    canvasScale = slideBox.width / 1600,
    dragNode = async (locator, dx, dy, beforeUp) => {
      const box = await locator.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 + dx * canvasScale,
        box.y + box.height / 2 + dy * canvasScale,
        { steps: 8 },
      );
      await beforeUp?.();
      await page.mouse.up();
    },
    slideX = async (locator) =>
      ((await locator.boundingBox()).x - slideBox.x) / canvasScale;
  await dragNode(frame.locator("#guide-c"), -158, 0, async () => {
    assert(
      (await frame.locator('[data-guide-kind="spacing"]').count()) >= 2,
      "equal-spacing dimensions must be visible while dragging",
    );
    assert(
      (await frame.locator('[data-guide-kind="distance-label"]').count()) >= 2,
      "equal-spacing dimensions must include values",
    );
    await current().screenshot({
      path: path.join(directory, "smart-spacing-guides.png"),
    });
  });
  assert(Math.abs((await slideX(frame.locator("#guide-c"))) - 500) < 1);
  await frame.locator("#guide-c").click();
  const sizeHandle = frame.locator('#ve-selection [data-handle="se"]'),
    sizeBox = await sizeHandle.boundingBox();
  await page.mouse.move(sizeBox.x + 4, sizeBox.y + 4);
  await page.mouse.down();
  await page.mouse.move(sizeBox.x + 42 * canvasScale, sizeBox.y + 4, {
    steps: 7,
  });
  assert(
    (await frame.locator('[data-guide-kind="equal-size"]').count()) >= 1,
    "equal-size guide must appear while resizing",
  );
  await page.mouse.up();
  assert(
    Math.abs(
      (await frame.locator("#guide-c").boundingBox()).width / canvasScale - 140,
    ) < 1,
  );
  await frame.locator("#dist-a").click();
  await frame.locator("#dist-b").click({ modifiers: ["Shift"] });
  await frame.locator("#dist-c").click({ modifiers: ["Shift"] });
  await page.locator("#distributeHorizontal").click();
  const distributed = await Promise.all(
    ["#dist-a", "#dist-b", "#dist-c"].map((selector) =>
      frame.locator(selector).boundingBox(),
    ),
  );
  const gaps = [
    distributed[1].x - distributed[0].x - distributed[0].width,
    distributed[2].x - distributed[1].x - distributed[1].width,
  ];
  assert(Math.abs(gaps[0] - gaps[1]) < 1, JSON.stringify(gaps));
  assert.equal(await page.locator(".guide-split > button").count(), 2);
  await page.locator("#snapToggle").click();
  assert.equal(
    await page.locator("#snapToggle").getAttribute("aria-pressed"),
    "false",
  );
  await page.locator("#snapToggle").click();
  assert.equal(
    await page.locator("#snapToggle").getAttribute("aria-pressed"),
    "true",
  );
  await page.locator("#openGuideSettings").click();
  await page.locator("#showDrawingGuides").click();
  assert.equal(
    await page.locator("#showDrawingGuides").getAttribute("aria-checked"),
    "true",
  );
  assert.equal(await frame.locator(".ve-fixed-guide").count(), 2);
  await page.locator("#addVerticalGuide").click();
  assert.equal(await frame.locator(".ve-fixed-guide").count(), 3);
  await page.locator("#showEditorGrid").click();
  assert.equal(
    await page.locator("#showEditorGrid").getAttribute("aria-checked"),
    "true",
  );
  assert.equal(await page.locator("#editorGridSize").isEnabled(), true);
  assert.equal(
    await frame
      .locator('[data-guide-layer="grid"]')
      .evaluate((node) => getComputedStyle(node).display),
    "block",
  );
  await current().screenshot({
    path: path.join(directory, "fixed-guides-grid.png"),
  });
  await page.screenshot({
    path: path.join(directory, "guide-controls.png"),
  });
  await page.locator("#clearCustomGuides").click();
  assert.equal(await frame.locator(".ve-fixed-guide").count(), 2);
  await page.locator("#showDrawingGuides").click();
  await page.locator("#showEditorGrid").click();
  assert.equal(await page.locator("#editorGridSize").isDisabled(), true);
  await page.keyboard.press("Escape");
  await clickAt(800, 600);
  await frame.locator("#guide-fixtures").evaluate((node) => node.remove());
  console.log(
    "PASS smart alignment spacing labels, equal-size resize, distribution, fixed guides and grid",
  );
  await current().screenshot({
    path: path.join(directory, "edited-slide.png"),
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS text editing, save/reload, original image attributes/URLs preserved; no JS errors",
  );
  console.log(`Screenshots: ${directory}`);
} finally {
  await browser.close();
  await app.close();
}
