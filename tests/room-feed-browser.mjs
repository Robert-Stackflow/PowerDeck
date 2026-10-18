import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp, projectRoot } from "../server/app.mjs";

const qa = path.join(projectRoot, "work/qa");
fs.mkdirSync(qa, { recursive: true });
const directory = fs.mkdtempSync(path.join(qa, "room-feed-"));
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
  const owner = await browser.newContext();
  await owner.request.post(base + "/api/setup", {
    data: { username: "admin", password: "room-feed-2026" },
  });
  const session = await (await owner.request.get(base + "/api/session")).json();
  const deck = app.store.create({
    title: "Room feed hero",
    slug: "room-feed-hero",
    width: 1600,
    height: 900,
  });
  app.store.save(deck.id, {
    version: deck.version,
    html: '<section class="slide" data-slide-id="one"><h1>Feed</h1></section>',
    css: ".slide{background:#f7f3ea;padding:100px}h1{font-size:80px}",
    notes: { 1: { title: "Feed", notes: "", refs: [] } },
  });
  const roomResponse = await owner.request.post(base + "/api/rooms", {
    headers: { "X-CSRF-Token": session.csrf },
    data: {
      deckId: deck.id,
      page: 1,
      permissions: {
        directory: true,
        notes: false,
        interaction: true,
        download: false,
        showInteractionFeed: true,
        showOnlineCount: true,
      },
    },
  });
  assert.equal(roomResponse.status(), 201);
  const room = await roomResponse.json();
  const participant = await browser.newContext();
  const deviceId = "room-feed-browser-device";
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
  const page = await participant.newPage();
  await page.goto(`${base}/room/${room.token}`);
  await page.locator("#playerFrame.is-ready").waitFor({ timeout: 15000 });
  const frame = page.frames().find((item) => item.url() === "about:srcdoc");
  assert(frame);
  const feed = frame.locator("#roomLiveFeed");
  await frame.waitForFunction(() =>
    document.querySelector("#roomLiveFeed")?.classList.contains("collapsed"),
  );

  const commentResponse = await participant.request.post(
    `${base}/api/audience/${room.interactionToken}/questions`,
    { data: { name: "Alice", body: "A new collapsed comment" } },
  );
  assert.equal(commentResponse.status(), 201);
  const comment = await commentResponse.json();
  const toast = frame.locator(
    `.room-feed-toasts [data-feed-key="comment:${comment.id}"]`,
  );
  await toast.waitFor({ timeout: 10000 });
  await page.waitForTimeout(250);
  const target = frame.locator(
    `#roomFeedItems [data-feed-key="comment:${comment.id}"]`,
  );
  const toastBox = await toast.boundingBox();
  const targetWidth = await target.evaluate((node) => node.offsetWidth);
  const toggleBox = await frame.locator("#roomFeedToggle").boundingBox();
  assert(Math.abs(toastBox.width - targetWidth) < 1);
  assert(toggleBox.y - (toastBox.y + toastBox.height) >= 4);
  assert(toggleBox.y - (toastBox.y + toastBox.height) <= 12);
  await page.screenshot({ path: path.join(directory, "collapsed-toast.png") });

  await frame.locator("#roomFeedToggle").click();
  await page.waitForTimeout(100);
  assert.equal(await target.isVisible(), false);
  assert.equal(await frame.locator(".room-feed-hero").count(), 0);
  const hero = frame.locator(".room-feed-hero");
  await hero.waitFor();
  assert(await hero.isVisible());
  await hero.waitFor({ state: "detached", timeout: 3000 });
  assert(await target.isVisible());
  assert.equal(await toast.count(), 0);
  assert.equal(
    await feed.evaluate((node) => node.classList.contains("collapsed")),
    false,
  );
  await page.screenshot({ path: path.join(directory, "expanded-target.png") });

  await page.emulateMedia({ media: "print" });
  assert.equal(
    await feed.evaluate((node) => getComputedStyle(node).display),
    "none",
  );
  assert.equal(await frame.locator(".room-feed-hero:visible").count(), 0);
  await page.emulateMedia({ media: "screen" });

  await participant.close();
  await owner.close();
  console.log(
    "PASS collapsed comments match feed items and hero into the expanded stream",
  );
  console.log("Artifacts: " + directory);
} finally {
  await browser.close();
  await app.close();
}
