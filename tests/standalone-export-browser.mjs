import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createApp, projectRoot } from "../server/app.mjs";
import { exportStandalone } from "../server/standalone-export.mjs";

const qa = path.join(projectRoot, "work/qa");
fs.mkdirSync(qa, { recursive: true });
const directory = fs.mkdtempSync(path.join(qa, "standalone-"));
const app = await createApp({
  dataDir: path.join(directory, "data"),
  seed: false,
});
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});

try {
  const deck = app.store.create({
    title: "Offline presentation",
    width: 1600,
    height: 900,
  });
  app.store.upload(deck.id, [
    {
      name: "pixel.png",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfN0AAAAASUVORK5CYII=",
    },
  ]);
  app.store.save(deck.id, {
    version: app.store.get(deck.id).version,
    html: '<section class="slide" data-slide-id="first"><h1>First</h1><figure style="position:absolute;left:400px;top:200px;width:800px;height:450px"><img id="offline-image" src="assets/pixel.png" alt="Offline image" style="width:100%;height:100%;object-fit:contain"><figcaption>Embedded image</figcaption></figure></section><section class="slide" data-slide-id="second"><h1>Second</h1></section>',
    css: ".slide{background:#f5f1e9}h1{font-size:72px}",
    notes: {
      1: { title: "First page", notes: "Offline speaker note", refs: [] },
      2: { title: "Second page", notes: "", refs: [] },
    },
  });
  const file = path.join(directory, "offline.html");
  fs.writeFileSync(file, exportStandalone(app.store, deck.id));

  const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
    }),
    errors = [],
    remoteRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (/^https?:/i.test(request.url())) remoteRequests.push(request.url());
  });
  await page.goto(pathToFileURL(file).href, { waitUntil: "load" });
  await page.waitForSelector("#counter");
  assert.equal(await page.locator("#counter").textContent(), "01 / 2");
  assert(await page.locator("#presentationTimer").isVisible());
  await page.waitForFunction(
    () => document.querySelector("#offline-image")?.complete,
  );
  assert.match(
    await page.locator("#offline-image").getAttribute("src"),
    /^data:image\/png;base64,/,
  );

  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#counter").textContent(), "02 / 2");
  assert(
    await page
      .locator(".slide")
      .nth(1)
      .evaluate((node) => node.classList.contains("active")),
  );
  await page.keyboard.press("Home");
  await page.locator("#offline-image").hover();
  assert(await page.locator("#imagePreviewTrigger").isVisible());
  await page.locator("#imagePreviewTrigger").click();
  await page.waitForFunction(
    () => document.querySelector("#figureViewer")?.dataset.state === "open",
  );
  assert.equal(
    await page.locator("#figureCaption").textContent(),
    "Embedded image",
  );
  await page.keyboard.press("Escape");
  await page.locator("#figureViewer").waitFor({ state: "hidden" });

  await page.keyboard.press("n");
  assert(await page.locator("#notes").isVisible());
  assert.match(
    await page.locator("#notesBody").textContent(),
    /Offline speaker note/,
  );
  await page.keyboard.press("Escape");
  assert.deepEqual(remoteRequests, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS standalone HTML: embedded assets, offline controls, navigation, notes and lightbox",
  );
  console.log("Artifact: " + file);
} finally {
  await browser.close();
  await app.close();
}
