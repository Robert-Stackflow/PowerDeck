import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp, projectRoot } from "../server/app.mjs";

const qa = path.join(projectRoot, "work/qa");
fs.mkdirSync(qa, { recursive: true });
const directory = fs.mkdtempSync(path.join(qa, "public-export-"));
const app = await createApp({
  dataDir: path.join(directory, "data"),
  seed: false,
});
const base = await app.listen({ port: 0 });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROME_PATH,
});

const formats = async (frame) =>
  frame
    .locator("#moreMenu .export-format-row")
    .evaluateAll((items) =>
      items.map((item) => item.dataset.action.replace("export:", "")),
    );

try {
  const owner = await browser.newContext({ acceptDownloads: true });
  assert.equal(
    (
      await owner.request.post(base + "/api/setup", {
        data: { username: "admin", password: "public-export-2026" },
      })
    ).status(),
    200,
  );
  const session = await (await owner.request.get(base + "/api/session")).json();
  const deck = app.store.create({
    title: "Public export menu",
    slug: "public-export-menu",
    width: 1600,
    height: 900,
  });
  app.store.save(deck.id, {
    version: app.store.get(deck.id).version,
    html: '<section class="slide" data-slide-id="one"><h1>Export</h1></section>',
    css: ".slide{background:#f7f3ea;color:#173b34;padding:100px}h1{font-size:90px}",
    notes: { 1: { title: "Export", notes: "Private note", refs: [] } },
  });

  const roomResponse = await owner.request.post(base + "/api/rooms", {
    headers: { "X-CSRF-Token": session.csrf },
    data: {
      deckId: deck.id,
      page: 1,
      permissions: {
        directory: true,
        notes: false,
        interaction: false,
        download: true,
        showInteractionFeed: false,
        showOnlineCount: false,
      },
    },
  });
  assert.equal(roomResponse.status(), 201);
  const room = await roomResponse.json();
  assert.equal(room.permissions.download, true);
  assert.equal(room.permissions.downloadPdf, undefined);

  const participant = await browser.newContext({ acceptDownloads: true });
  const deviceId = "public-export-browser-device";
  await participant.addInitScript((value) => {
    localStorage.setItem("powerdeck-room-device", value);
  }, deviceId);
  const join = await participant.request.post(
    `${base}/api/rooms/${room.token}/join`,
    {
      headers: { "X-PowerDeck-Device": deviceId },
      data: { name: "Viewer" },
    },
  );
  assert.equal(join.status(), 200);
  const roomPage = await participant.newPage();
  await roomPage.goto(`${base}/room/${room.token}`);
  await roomPage.locator("#playerFrame.is-ready").waitFor({ timeout: 15000 });
  const roomFrame = roomPage
    .frames()
    .find((frame) => frame.url() === "about:srcdoc");
  assert(roomFrame);
  await roomFrame.locator("#moreBtn").click({ force: true });
  assert(await roomFrame.locator('[data-action="print"]').isVisible());
  await roomPage.keyboard.press("Escape");
  await roomFrame.locator("#exportBtn").click({ force: true });
  assert.deepEqual(await formats(roomFrame), ["zip", "pdf", "pptx", "html"]);
  await roomPage.screenshot({
    path: path.join(directory, "room-export-menu.png"),
  });
  await roomFrame.locator('[data-action="export:html"]').click();
  await roomFrame
    .locator(".player-export-notice.ready")
    .waitFor({ timeout: 60000 });
  const roomDownloadPromise = roomPage.waitForEvent("download");
  await roomFrame.locator(".player-export-notice.ready a").click();
  const roomDownload = await roomDownloadPromise;
  assert.equal(roomDownload.suggestedFilename().endsWith(".html"), true);
  assert.match(
    fs.readFileSync(await roomDownload.path(), "utf8").slice(0, 100),
    /<!doctype html>/i,
  );

  let current = app.store.get(deck.id);
  current = app.store.save(deck.id, {
    visibility: "shared",
    version: current.version,
  });
  const shareResponse = await owner.request.post(
    `${base}/api/decks/${deck.id}/shares`,
    {
      headers: { "X-CSRF-Token": session.csrf },
      data: {
        label: "Export enabled",
        slug: current.slug,
        days: 7,
        allowNotes: false,
        allowDownload: true,
      },
    },
  );
  assert.equal(shareResponse.status(), 201);
  const share = await shareResponse.json();
  const sharedPage = await participant.newPage();
  await sharedPage.goto(base + share.path);
  await sharedPage.locator("#playerFrame.is-ready").waitFor({ timeout: 15000 });
  const sharedFrame = sharedPage
    .frames()
    .find((frame) => frame.url() === "about:srcdoc");
  assert(sharedFrame);
  await sharedFrame.locator("#exportBtn").click({ force: true });
  assert.deepEqual(await formats(sharedFrame), ["zip", "pdf", "pptx", "html"]);
  await sharedPage.screenshot({
    path: path.join(directory, "share-export-menu.png"),
  });
  await sharedFrame.locator('[data-action="export:html"]').click();
  await sharedFrame
    .locator(".player-export-notice.ready")
    .waitFor({ timeout: 60000 });
  const shareDownloadPromise = sharedPage.waitForEvent("download");
  await sharedFrame.locator(".player-export-notice.ready a").click();
  const shareDownload = await shareDownloadPromise;
  const sharedHTML = fs.readFileSync(await shareDownload.path(), "utf8");
  assert.equal(shareDownload.suggestedFilename().endsWith(".html"), true);
  assert.doesNotMatch(sharedHTML, /Private note/);

  await participant.close();
  await owner.close();
  console.log(
    "PASS room participants and shared viewers use the four-format background export menu",
  );
  console.log("Artifacts: " + directory);
} finally {
  await browser.close();
  await app.close();
}
