import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createApp, projectRoot } from "../server/app.mjs";

const qa = path.join(projectRoot, "work/qa"),
  directory = fs.mkdtempSync(path.join(qa, "cache-management-")),
  app = await createApp({ dataDir: path.join(directory, "data"), seed: false }),
  base = await app.listen({ port: 0 }),
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH,
  }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  }),
  page = await context.newPage(),
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));

try {
  const setup = await context.request.post(base + "/api/setup", {
    data: { username: "admin", password: "cache-management-2026" },
  });
  assert.equal(setup.status(), 200);
  const deck = app.store.create({
      title: "Cache management deck",
      slug: "cache-management-deck",
      width: 960,
      height: 540,
    }),
    saved = app.store.save(deck.id, {
      version: app.store.get(deck.id).version,
      html: '<section class="slide"><h1>Cache</h1></section>',
      css: ".slide{background:#fff;color:#111}",
      notes: {},
    }),
    session = await context.request
      .get(base + "/api/session")
      .then((response) => response.json()),
    started = await context.request
      .post(`${base}/api/decks/${deck.id}/exports`, {
        headers: { "X-CSRF-Token": session.csrf },
        data: { format: "html" },
      })
      .then((response) => response.json());
  let job = started;
  for (let attempt = 0; attempt < 80 && job.status !== "ready"; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    job = await context.request
      .get(`${base}/api/decks/${deck.id}/exports/${job.id}`)
      .then((response) => response.json());
  }
  assert.equal(job.status, "ready");
  const secondStarted = await context.request
    .post(`${base}/api/decks/${deck.id}/exports`, {
      headers: { "X-CSRF-Token": session.csrf },
      data: { format: "zip" },
    })
    .then((response) => response.json());
  let secondJob = secondStarted;
  for (
    let attempt = 0;
    attempt < 80 && secondJob.status !== "ready";
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    secondJob = await context.request
      .get(`${base}/api/decks/${deck.id}/exports/${secondJob.id}`)
      .then((response) => response.json());
  }
  assert.equal(secondJob.status, "ready");

  await page.goto(base);
  await page.locator("#accountSettings").click();
  await page.getByRole("button", { name: /缓存管理/ }).click();
  const row = page.locator(".cache-table tbody tr");
  await row.first().waitFor();
  assert.equal(await row.count(), 2);
  assert.match(await row.first().textContent(), /Cache management deck/);
  assert.match(await row.first().textContent(), new RegExp(`v${saved.version}`));
  assert.match(await row.first().textContent(), /最新/);

  assert.equal(await page.locator("#cacheVersionTrigger").isDisabled(), true);
  await page.locator("#cacheDeckTrigger").click();
  await page
    .getByRole("option", {
      name: new RegExp(`Cache management deck.*${deck.id}`),
    })
    .click();
  await page.waitForFunction(
    () => !document.querySelector("#cacheVersionTrigger")?.disabled,
  );
  assert.equal(await page.locator("#cacheVersionTrigger").isEnabled(), true);
  await page.locator("#cacheVersionTrigger").click();
  await page.getByRole("option", { name: `版本 ${saved.version}` }).click();
  await row.first().waitFor();
  assert.equal(await row.count(), 2);

  const htmlRow = row.filter({ hasText: "单文件网页" });
  const downloadPromise = page.waitForEvent("download");
  await htmlRow.getByRole("link", { name: "下载缓存文件" }).click();
  await downloadPromise;
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".cache-table tbody tr")].some(
      (item) =>
        item.textContent.includes("单文件网页") &&
        item.textContent.includes("1 次"),
    ),
  );
  await htmlRow.getByRole("button", { name: "删除缓存文件" }).click();
  await page.locator("#dialog button[type=submit]").click();
  await page.waitForFunction(
    () => document.querySelectorAll(".cache-table tbody tr").length === 1,
  );

  await page.locator("#exportCacheMinutesTrigger").click();
  await page.getByRole("option", { name: "6 小时" }).click();
  await page.locator("#exportCachePolicy button[type=submit]").click();
  await page.waitForFunction(() =>
    document.querySelector("#toast")?.textContent.includes("缓存保留时间"),
  );
  const site = await context.request
    .get(base + "/api/site")
    .then((response) => response.json());
  assert.equal(site.exportCacheMinutes, 360);
  await page.screenshot({ path: path.join(directory, "cache-management.png") });

  await page.locator("#clearExportCache").click();
  await page.locator("#dialog button[type=submit]").click();
  await page.locator(".cache-empty").waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS cache management filters, configures and clears exports");
  console.log("Artifacts: " + directory);
} finally {
  await browser.close();
  await app.close();
}
