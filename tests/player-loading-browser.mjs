import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const frontend = path.resolve(import.meta.dirname, "../frontend");
const requested = [];
let slow = false;
const pending = new Set();
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="skyblue"/></svg>';
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname.startsWith("/images/")) {
    requested.push(pathname);
    if (pathname.includes("broken")) {
      res.writeHead(404);
      res.end();
      return;
    }
    const send = () => {
      res.writeHead(200, { "Content-Type": "image/svg+xml" });
      res.end(svg);
    };
    if (slow && pathname === "/images/5.svg") pending.add(send);
    else setTimeout(send, 60);
    return;
  }
  if (pathname.startsWith("/static/")) {
    const file = path.resolve(frontend, pathname.slice(8));
    if (!file.startsWith(frontend + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, {
        "Content-Type": file.endsWith(".js") ? "text/javascript" : "text/css",
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(
    '<!doctype html><div id="loading">Loading</div><iframe id="playerFrame" hidden></iframe>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : {}),
});
const errors = [];
async function open(initialPage = 1, viewerMode = false) {
  requested.length = 0;
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/#${viewerMode ? 1 : initialPage}`);
  const elapsed = await page.evaluate(
    async ({ initialPage, viewerMode }) => {
      const { playerDocument } = await import("/static/player/document.js");
      const { mountPresenter } = await import("/static/player/runtime.js");
      const { preparePlayerFrame, revealPlayerFrame } = await import(
        "/static/player/readiness.js"
      );
      const frame = document.querySelector("iframe");
      const notes = Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => [
          i + 1,
          { title: `Slide ${i + 1}`, notes: "", refs: [] },
        ]),
      );
      const html = Object.keys(notes)
        .map(
          (n) =>
            `<section class="slide" data-page="${n}" data-transition="none">${
              n === "2"
                ? '<picture><source srcset="2.svg 1x, 2.svg 2x"><img src="fallback.svg"></picture>'
                : n === "3"
                  ? '<svg width="80" height="40"><image href="3.svg" width="80" height="40"/></svg>'
                  : `<img src="${n === "4" ? "broken" : n}.svg" width="80" height="40">`
            }</section>`,
        )
        .join("");
      const ready = new Promise((resolve, reject) =>
        frame.addEventListener(
          "load",
          async () => {
            try {
              window.presentation = mountPresenter({
                window: frame.contentWindow,
                hostWindow: window,
                initialPage,
                viewerMode,
                icons: new Proxy(
                  {},
                  { get: () => ({ name: "test", body: "" }) },
                ),
              });
              await revealPlayerFrame(
                frame,
                document.querySelector("#loading"),
                350,
              );
              resolve();
            } catch (error) {
              reject(error);
            }
          },
          { once: true },
        ),
      );
      const start = performance.now();
      preparePlayerFrame(frame);
      frame.srcdoc = playerDocument({
        html,
        notes,
        css: "",
        meta: { title: "Test", width: 1600, height: 900 },
        baseURL: `${location.origin}/images/`,
        baseCSS: ".slide{display:none}.slide.active{display:block}",
        playerCSS: "",
      });
      await ready;
      return performance.now() - start;
    },
    { initialPage, viewerMode },
  );
  return { page, elapsed, frame: page.frameLocator("iframe") };
}
try {
  slow = true;
  const first = await open();
  assert(first.elapsed < 2500, "hidden slow images must not block entry");
  assert(!requested.includes("/images/5.svg"), "offscreen image was requested");
  await first.page.waitForTimeout(200);
  assert.deepEqual([...new Set(requested)].sort(), [
    "/images/1.svg",
    "/images/2.svg",
  ]);
  await first.page.evaluate(() => presentation.go(3));
  await first.page.waitForTimeout(200);
  assert(requested.includes("/images/3.svg"), "SVG URL not restored");
  assert.equal(
    await first.frame
      .locator('.slide[data-page="3"] image')
      .getAttribute("href"),
    "3.svg",
  );
  await first.page.evaluate(() => presentation.go(7));
  await first.frame
    .locator(".slide.active img")
    .evaluate((img) => img.decode());
  assert.equal(await first.page.evaluate(() => presentation.current), 7);
  assert(
    !requested.includes("/images/5.svg"),
    "jump should load only its neighbors",
  );
  await first.page.close();

  const hash = await open(5);
  assert(
    hash.elapsed < 2500,
    "stalled current image must not trap the loading screen",
  );
  assert.equal(await hash.page.evaluate(() => presentation.current), 5);
  assert(!requested.includes("/images/1.svg"), "deep link fetched the cover");
  slow = false;
  for (const send of pending) send();
  pending.clear();
  await hash.frame.locator(".slide.active img").evaluate((img) => img.decode());
  await hash.page.evaluate(() => {
    const frame = document.querySelector("iframe");
    frame.contentWindow.print = () => {
      window.printed = true;
    };
    frame.contentDocument.querySelector("#stage").focus();
  });
  await hash.page.keyboard.press("Control+p");
  await hash.page.waitForFunction(() => window.printed);
  assert.equal(
    await hash.frame
      .locator("[data-player-src], [data-player-srcset], [data-player-href]")
      .count(),
    0,
  );
  const printedImages = await hash.frame
    .locator('#deck img:not([src="broken.svg"])')
    .evaluateAll((imgs) =>
      imgs.map((img) => ({
        src: img.getAttribute("src"),
        current: img.currentSrc,
        complete: img.complete,
        width: img.naturalWidth,
      })),
    );
  assert(
    printedImages.every((img) => img.complete && img.width > 0),
    JSON.stringify(printedImages),
  );
  await hash.page.close();

  const room = await open(7, true);
  assert.equal(
    await room.page.evaluate(() => presentation.current),
    7,
    "room initial page ignored",
  );
  assert(!requested.includes("/images/1.svg"));
  await room.page.evaluate(() =>
    document
      .querySelector("iframe")
      .contentWindow.dispatchEvent(new Event("beforeprint")),
  );
  assert.equal(await room.frame.locator("[data-player-src]").count(), 0);
  await room.page.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS player loading: inert HTML/picture/SVG, current/neighbor priority, jumps, hash, room, broken/stalled images, print",
  );
} finally {
  for (const send of pending) send();
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
