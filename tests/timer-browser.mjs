import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp, projectRoot } from "../server/app.mjs";
const qa = path.join(projectRoot, "work/qa");
fs.mkdirSync(qa, { recursive: true });
const dir = fs.mkdtempSync(path.join(qa, "timer-"));
const app = await createApp({ dataDir: path.join(dir, "data") });
const base = await app.listen({ port: 0 });
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : process.platform === "win32"
        ? { channel: "msedge" }
        : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.request.post(base + "/api/setup", {
    data: { username: "admin", password: "timer-test-password-123" },
  });
  assert.equal(response.status(), 200);
  await page.goto(base + "/present/areal#8");
  let frame = page.frameLocator("iframe");
  await frame.locator("#timerDetails").waitFor({ state: "attached" });
  const click = async (selector) => {
    await page.waitForTimeout(300);
    const box = await frame.locator(selector).boundingBox();
    assert(box, selector);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  };
  const reveal = async () => {
    const size = page.viewportSize();
    await page.mouse.move(size.width / 2, size.height / 2);
    await page.waitForTimeout(200);
    await page.mouse.move(size.width / 2, size.height - 32);
    await page.waitForTimeout(300);
  };
  await reveal();
  assert.equal(await frame.locator("#controls #presentationTimer").count(), 1);
  assert.equal(await frame.locator("#timerTotal").textContent(), "00:00");
  assert.equal(await frame.locator("#timingReset").isDisabled(), true);
  assert.equal(await frame.locator("#timerFloating").count(), 0);
  assert.deepEqual(
    await frame.locator("#presentationTimer").evaluate((timer) => {
      const details = timer.querySelector("#timerDetails");
      const toggle = timer.querySelector("#timerToggle");
      const style = getComputedStyle(timer);
      return {
        detailsWidth: details.getBoundingClientRect().width,
        toggleWidth: toggle.getBoundingClientRect().width,
        gap: style.columnGap,
      };
    }),
    { detailsWidth: 104, toggleWidth: 38, gap: "6px" },
  );
  assert.deepEqual(
    await frame.locator("#controls").evaluate(() => {
      const values = (element) => {
        const style = getComputedStyle(element);
        return [
          style.width,
          style.height,
          style.backgroundColor,
          style.marginRight,
        ];
      };
      return [
        values(document.querySelector("#timerDivider")),
        values(document.querySelector("#controls .nav-divider")),
      ];
    }),
    await frame.locator("#controls").evaluate(() => {
      const style = getComputedStyle(
        document.querySelector("#controls .nav-divider"),
      );
      const values = [
        style.width,
        style.height,
        style.backgroundColor,
        style.marginRight,
      ];
      return [values, values];
    }),
  );
  const expandedWidth = (await frame.locator("#controls").boundingBox()).width;
  await click("#timerToggle");
  await page.waitForTimeout(2200);
  assert.notEqual(await frame.locator("#timerPage").textContent(), "00:00");
  assert.equal(await frame.locator("#timingPanel").isVisible(), false);
  await reveal();
  await page.screenshot({ path: path.join(dir, "dock.png") });
  await page.mouse.move(700, 300);
  await page.waitForTimeout(2100);
  assert.equal(
    await frame
      .locator("#controls")
      .evaluate((e) => getComputedStyle(e).opacity),
    "1",
  );
  const compact = await frame.locator("#controls").boundingBox();
  assert(compact.width > 70 && compact.width < 100);
  assert(compact.width > compact.height * 1.5);
  assert(Math.abs(compact.x + compact.width / 2 - 720) < 1);
  assert.equal(await frame.locator("#prev").evaluate((e) => e.offsetWidth), 0);
  await page.screenshot({ path: path.join(dir, "immersive.png") });
  await page.mouse.move(720, 875);
  await page.waitForTimeout(100);
  const transitioningWidth = (await frame.locator("#controls").boundingBox())
    .width;
  assert(
    transitioningWidth > compact.width && transitioningWidth < expandedWidth,
  );
  await page.waitForTimeout(300);
  assert(
    (await frame.locator("#controls").boundingBox()).width > compact.width,
  );
  await click("#timerToggle");
  assert.equal(
    await frame.locator("#timerToggle").getAttribute("aria-label"),
    "继续计时",
  );
  const paused = await frame.locator("#timerTotal").textContent();
  await page.mouse.move(700, 300);
  await page.waitForTimeout(2100);
  assert.equal(
    await frame
      .locator("#controls")
      .evaluate((e) => getComputedStyle(e).opacity),
    "0",
  );
  assert.equal(await frame.locator("#timerTotal").textContent(), paused);
  await reveal();
  await click("#timerDetails");
  await page.waitForTimeout(300);
  assert.equal(await frame.locator("#timingPanel button").count(), 1);
  assert.equal(await frame.locator("#timingTotal").textContent(), paused);
  await page.screenshot({ path: path.join(dir, "panel.png") });
  await page.keyboard.press("Escape");
  await page.reload();
  frame = page.frameLocator("iframe");
  await frame.locator("#timerDetails").waitFor({ state: "attached" });
  await reveal();
  assert.equal(
    await frame.locator("#timerToggle").getAttribute("aria-label"),
    "继续计时",
  );
  assert.equal(await frame.locator("#timerTotal").textContent(), paused);
  for (const width of [800, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await reveal();
    const bounds = await frame.locator("#controls").boundingBox();
    assert(
      bounds.x >= 0 && bounds.x + bounds.width <= width,
      "dock bounds at " + width,
    );
    for (const selector of ["#moreBtn", "#timingReset"]) {
      const button = await frame.locator(selector).boundingBox();
      assert(
        button.x >= 0 && button.x + button.width <= width,
        selector + " bounds at " + width,
      );
    }
    await page.screenshot({ path: path.join(dir, "mobile-" + width + ".png") });
  }
  await reveal();
  await click("#timingReset");
  assert.equal(await frame.locator("#timerTotal").textContent(), paused);
  assert.equal(
    await frame.locator("#timingReset").getAttribute("aria-label"),
    "再次点击确认重置",
  );
  await click("#timingReset");
  assert.equal(await frame.locator("#timerTotal").textContent(), "00:00");
  assert.equal(await frame.locator("#timingReset").isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(
    "PASS timer dock, running/page time, auto-hide, automatic compact mode, pause, restore, reset and mobile layout",
  );
  console.log("Screenshots: " + dir);
} finally {
  await browser?.close();
  await app.close();
}
