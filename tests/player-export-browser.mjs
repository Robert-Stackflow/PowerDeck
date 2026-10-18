import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp, projectRoot } from "../server/app.mjs";

const qa = path.join(projectRoot, "work/qa");
fs.mkdirSync(qa, { recursive: true });
const directory = fs.mkdtempSync(path.join(qa, "player-export-"));
const app = await createApp({
  dataDir: path.join(directory, "data"),
  seed: false,
});
const base = await app.listen({ port: 0 });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});

try {
  const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      acceptDownloads: true,
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const setup = await context.request.post(base + "/api/setup", {
    data: { username: "admin", password: "player-export-2026" },
  });
  assert.equal(setup.status(), 200);
  const deck = app.store.create({
    title: "Player background export",
    slug: "player-background-export",
    width: 1600,
    height: 900,
  });
  app.store.save(deck.id, {
    version: app.store.get(deck.id).version,
    html: '<section class="slide" data-slide-id="one"><h1>One</h1></section><section class="slide" data-slide-id="two"><h1>Two</h1></section>',
    css: ".slide{background:#f5f1e9;color:#173b34;padding:100px}h1{font-size:90px}",
    notes: {
      1: { title: "One", notes: "", refs: [] },
      2: { title: "Two", notes: "", refs: [] },
    },
  });
  await page.goto(base + "/present/player-background-export#1");
  await page.locator("#playerFrame.is-ready").waitFor({ timeout: 15000 });
  const frame = page.frames().find((item) => item.url() === "about:srcdoc");
  assert(frame);

  await frame.locator("#exportBtn").click({ force: true });
  const formats = frame.locator("#moreMenu .export-format-row");
  assert.equal(await formats.count(), 4);
  assert.deepEqual(
    await formats.evaluateAll((items) =>
      items.map((item) => item.dataset.action.replace("export:", "")),
    ),
    ["zip", "pdf", "pptx", "html"],
  );
  await page.screenshot({ path: path.join(directory, "export-menu.png") });

  const started = performance.now();
  await frame.locator('#moreMenu [data-action="export:pdf"]').click();
  assert(performance.now() - started < 1000);
  await frame.waitForFunction(
    () =>
      document.querySelector("#toast")?.classList.contains("visible") &&
      document.querySelector("#toast")?.textContent.includes("后台生成"),
  );
  assert.equal(await frame.locator(".player-export-notice").count(), 0);
  await page.screenshot({ path: path.join(directory, "export-toast.png") });
  await page.keyboard.press("ArrowRight");
  await frame.waitForFunction(
    () => document.querySelector("#counter")?.textContent === "02 / 2",
  );
  await frame.locator("#exportBtn").click({ force: true });
  const busyPDF = frame.locator(
    '#moreMenu [data-action="export:pdf"][disabled]',
  );
  if (await busyPDF.count()) assert(await busyPDF.isVisible());
  const readyPDF = frame.locator(
    '#moreMenu [data-action="export-download:pdf"]',
  );
  await readyPDF.waitFor({ timeout: 60000 });
  const readyNotice = frame.locator(".player-export-notice.ready");
  await readyNotice.waitFor();
  const noticeBox = await readyNotice.boundingBox();
  const dockBox = await frame.locator("#controls").boundingBox();
  assert(noticeBox.y + noticeBox.height < dockBox.y - 6);
  await page.screenshot({
    path: path.join(directory, "export-ready-menu.png"),
  });
  const downloadPromise = page.waitForEvent("download");
  await readyPDF.click();
  const download = await downloadPromise,
    bytes = fs.readFileSync(await download.path());
  assert(download.suggestedFilename().endsWith(".pdf"));
  assert.equal(bytes.toString("ascii", 0, 5), "%PDF-");

  await page.reload();
  await page.locator("#playerFrame.is-ready").waitFor({ timeout: 15000 });
  const reloadedFrame = page
    .frames()
    .find((item) => item.url() === "about:srcdoc");
  assert(reloadedFrame);
  await reloadedFrame.locator("#exportBtn").click({ force: true });
  await reloadedFrame
    .locator('#moreMenu [data-action="export-download:pdf"]')
    .waitFor({ timeout: 5000 });
  assert.deepEqual(errors, []);
  console.log(
    "PASS export uses background notices and restores versioned cache after reload",
  );
  console.log("Artifacts: " + directory);
} finally {
  await browser.close();
  await app.close();
}
