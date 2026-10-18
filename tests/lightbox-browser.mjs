import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp, projectRoot } from "../server/app.mjs";

const qa = path.join(projectRoot, "work/qa");
fs.mkdirSync(qa, { recursive: true });
const directory = fs.mkdtempSync(path.join(qa, "lightbox-"));
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
      viewport: { width: 1440, height: 1000 },
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const setup = await context.request.post(base + "/api/setup", {
    data: { username: "admin", password: "lightbox-test-2026" },
  });
  assert.equal(setup.status(), 200);
  const session = await (
    await context.request.get(base + "/api/session")
  ).json();
  const response = await context.request.post(base + "/api/decks", {
    headers: { "X-CSRF-Token": session.csrf },
    data: {
      slug: "lightbox-fixture",
      title: "Lightbox fixture",
      width: 1600,
      height: 900,
      html: `<section class="slide" data-slide-id="lightbox-slide"><main><figure style="position:absolute;left:400px;top:200px;width:800px;height:450px;margin:0"><img id="hero-source" src="/static/qa-lightbox.svg" alt="AReaL architecture overview" style="display:block;width:100%;height:100%;object-fit:cover;border-radius:24px"><figcaption>Architecture overview · rollout and training</figcaption></figure></main></section>`,
      css: ".slide{background:#f5f1e9}.slide figcaption{position:absolute;clip-path:inset(50%)}",
      notes: { 1: { title: "Lightbox", notes: "", refs: [] } },
    },
  });
  assert(response.ok(), await response.text());
  await page.route("**/static/qa-lightbox.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#dce8e2"/><stop offset="1" stop-color="#efc98c"/></linearGradient></defs><rect width="1600" height="900" fill="url(#g)"/><g fill="#193f35" font-family="Arial" text-anchor="middle"><text x="800" y="420" font-size="90" font-weight="700">AReaL</text><text x="800" y="520" font-size="38">Rollout → Training → Update</text></g></svg>`,
    }),
  );
  await page.goto(base + "/present/lightbox-fixture#1");
  await page.waitForFunction(() =>
    [...document.querySelectorAll("iframe")].some(
      (frame) => frame.contentDocument?.querySelector("#hero-source")?.complete,
    ),
  );
  const frame = page.frames().find((item) => item.url() === "about:srcdoc"),
    source = frame.locator("#hero-source"),
    viewer = frame.locator("#figureViewer"),
    image = frame.locator("#figureImage"),
    backdrop = frame.locator("#figureBackdrop"),
    caption = frame.locator("#figureCaption"),
    controls = frame.locator(".lightbox-controls"),
    previewTrigger = frame.locator("#imagePreviewTrigger"),
    viewport = frame.locator("#figureViewport");
  const sourceBox = await source.boundingBox();
  await source.hover();
  assert.notEqual(
    await source.evaluate((node) => getComputedStyle(node).cursor),
    "zoom-in",
  );
  assert(
    await previewTrigger.isVisible(),
    "hover must reveal a preview button",
  );
  const triggerBox = await previewTrigger.boundingBox();
  assert(triggerBox.x > sourceBox.x + sourceBox.width * 0.75);
  assert(triggerBox.y < sourceBox.y + sourceBox.height * 0.25);
  await page.screenshot({
    path: path.join(directory, "preview-trigger.png"),
  });
  await source.dblclick({ position: { x: 40, y: 40 } });
  assert(
    !(await viewer.isVisible()),
    "double-click must not open the lightbox",
  );
  await page.mouse.move(0, 0);
  await source.hover();
  await previewTrigger.click();
  assert(await viewer.isVisible());
  assert(
    ["opening", "open"].includes(await viewer.getAttribute("data-state")),
    "viewer must enter through the hero transition",
  );
  const openingControlsBox = await controls.boundingBox();
  await frame.waitForFunction(
    () => document.querySelector("#figureViewer")?.dataset.state === "open",
  );
  assert.equal(await viewer.getAttribute("data-state"), "open");
  assert.equal(
    await caption.textContent(),
    "Architecture overview · rollout and training",
  );
  const captionBox = await caption.boundingBox(),
    viewerBox = await viewer.boundingBox(),
    lightboxImageBox = await image.boundingBox(),
    openControlsBox = await controls.boundingBox(),
    viewportBox = await viewport.boundingBox();
  assert(
    Math.abs(captionBox.x + captionBox.width / 2 - viewerBox.width / 2) < 2,
  );
  assert(captionBox.y > viewerBox.height * 0.75);
  assert(
    Math.abs(
      openingControlsBox.x +
        openingControlsBox.width / 2 -
        (openControlsBox.x + openControlsBox.width / 2),
    ) < 1,
    "controls must remain centered throughout the hero transition",
  );
  assert(Math.abs(viewportBox.x - viewerBox.x) < 1);
  assert(Math.abs(viewportBox.y - viewerBox.y) < 1);
  assert(Math.abs(viewportBox.width - viewerBox.width) < 1);
  assert(Math.abs(viewportBox.height - viewerBox.height) < 1);
  assert.equal(
    await image.evaluate((node) => getComputedStyle(node).backgroundColor),
    "rgb(255, 255, 255)",
  );
  assert(lightboxImageBox.width > sourceBox.width * 1.2);
  assert(lightboxImageBox.width < viewerBox.width - 30);
  await page.screenshot({
    path: path.join(directory, "immersive-lightbox.png"),
  });

  await image.click();
  assert.equal(await frame.locator("#figureScale").textContent(), "250%");
  await frame.locator("#figureFit").click();
  await page.waitForTimeout(300);
  assert.equal(await frame.locator("#figureScale").textContent(), "100%");

  let box = await image.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 12,
    box.y + box.height / 2 + 90,
    {
      steps: 6,
    },
  );
  assert.equal(await viewer.getAttribute("data-dragging"), "true");
  assert(
    Number(await backdrop.evaluate((node) => getComputedStyle(node).opacity)) <
      0.95,
    "backdrop must lighten while dragging down",
  );
  await page.mouse.up();
  await frame.waitForFunction(
    () =>
      !document.querySelector("#figureViewer")?.hasAttribute("data-dragging"),
  );
  assert(await viewer.isVisible(), "short downward drag must spring back");
  assert(
    Number(await backdrop.evaluate((node) => getComputedStyle(node).opacity)) >
      0.99,
  );

  box = await image.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 20,
    box.y + box.height / 2 + 230,
    {
      steps: 8,
    },
  );
  await page.mouse.up();
  await viewer.waitFor({ state: "hidden", timeout: 1500 });

  await source.hover();
  await previewTrigger.click();
  await frame.waitForFunction(
    () => document.querySelector("#figureViewer")?.dataset.state === "open",
  );
  await page.keyboard.press("Escape");
  assert.equal(await viewer.getAttribute("data-state"), "closing");
  await viewer.waitFor({ state: "hidden", timeout: 1500 });
  assert.deepEqual(errors, []);
  console.log(
    "PASS preview trigger, stable controls, full viewport, white canvas, hero, zoom and drag close",
  );
  console.log("Screenshots: " + directory);
} finally {
  await browser.close();
  await app.close();
}
