import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createApp, projectRoot } from "../server/app.mjs";

const qa = path.join(projectRoot, "work/qa"),
  directory = fs.mkdtempSync(path.join(qa, "room-host-recovery-")),
  app = await createApp({ dataDir: path.join(directory, "data"), seed: false }),
  base = await app.listen({ port: 0 }),
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH,
  }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  const setup = await context.request.post(base + "/api/setup", {
    data: { username: "admin", password: "room-recovery-2026" },
  });
  assert.equal(setup.status(), 200);
  const session = await context.request
      .get(base + "/api/session")
      .then((response) => response.json()),
    deck = app.store.create({
      title: "Recoverable room",
      slug: "recoverable-room",
      width: 960,
      height: 540,
    });
  app.store.save(deck.id, {
    version: deck.version,
    html: '<section class="slide"><h1>Recoverable room</h1></section>',
    css: ".slide{background:#fff;color:#111}",
    notes: {},
  });

  await page.goto(`${base}/present/${deck.slug}`);
  const frame = page.locator("#playerFrame").contentFrame();
  await frame.locator("#roomBtn").click();
  await frame.locator("#roomSetupForm").waitFor();
  await frame.locator("#roomSetupForm button[type=submit]").click();
  await frame.locator("#roomBody.room-dashboard").waitFor();
  const roomURL = await frame.locator(".session-link input").inputValue(),
    roomToken = roomURL.split("/").pop();

  const active = await context.request
    .get(`${base}/api/rooms/active?deckId=${encodeURIComponent(deck.id)}`)
    .then((response) => response.json());
  assert.equal(active.room.token, roomToken);

  const reusedResponse = await context.request.post(base + "/api/rooms", {
      headers: { "X-CSRF-Token": session.csrf },
      data: { deckId: deck.id, page: 1, permissions: {} },
    }),
    reused = await reusedResponse.json();
  assert.equal(reusedResponse.status(), 200);
  assert.equal(reused.token, roomToken);
  const listed = await context.request
    .get(base + "/api/rooms")
    .then((response) => response.json());
  assert.equal(listed.rooms.length, 1);

  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.route("**/api/rooms/active?*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await page.reload();
  const restoredFrame = page.locator("#playerFrame").contentFrame();
  await restoredFrame.locator("#roomBtn").click();
  await restoredFrame
    .locator("#roomBody.session-loading", { hasText: "正在恢复房间" })
    .waitFor();
  await restoredFrame.locator("#roomBody.room-dashboard").waitFor();
  assert.equal(
    await restoredFrame.locator(".session-link input").inputValue(),
    roomURL,
  );
  await page.screenshot({ path: path.join(directory, "restored-room.png") });
  assert.deepEqual(errors, []);
  console.log(
    "PASS room host restores by account after storage loss and reload",
  );
  console.log("Artifacts: " + directory);
} finally {
  await browser.close();
  await app.close();
}
