import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as OTPAuth from "otpauth";
import { createApp, projectRoot } from "../server/app.mjs";
const dir = path.join(projectRoot, "work/qa/settings-browser");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const app = await createApp({ dataDir: path.join(dir, "data"), seed: false });
const base = (await app.listen({ port: 0 })).replace("127.0.0.1", "localhost");
const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH || fs.existsSync(mac)
    ? { executablePath: process.env.CHROME_PATH || mac }
    : {}),
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  }),
  page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2",
    transport: "internal",
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let password = "settings-browser-password-8048",
  id,
  sharePath,
  shareToken,
  recovery;
const api = (url, method = "GET", body) =>
  page.evaluate(
    async ({ url, method, body }) => {
      const s = await fetch("/api/session").then((r) => r.json());
      const r = await fetch("/api" + url, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": s.csrf },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    { url, method, body },
  );
const submit = () => page.locator("#dialog button[type=submit]").click();
const choose = async (label, option) => {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
};
const check = async (name, fn) => {
  await fn();
  console.log("PASS " + name);
};
const svgFile = {
  name: "custom.svg",
  mimeType: "image/svg+xml",
  buffer: Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="28" fill="#8463ba"/><path d="m48 34 43 30-43 30z" fill="white"/></svg>',
  ),
};
try {
  await page.goto(base);
  await page.locator("input[name=password]").fill(password);
  await page.locator("input[name=confirm]").fill(password);
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.locator("#newBtn").waitFor();
  const deck = await api("/decks", "POST", {
    title: "产品更新",
    slug: "product-update",
    html: '<section class="slide"><h1>产品更新</h1></section>',
  });
  id = deck.id;
  await page.reload();
  await page.locator(".deck-card").waitFor();
  await check(
    "card cover, title and presentation action open in a separate tab",
    async () => {
      const originalURL = page.url();
      for (const selector of [
        ".deck-preview",
        ".card-title-row h2",
        ".present-link",
      ]) {
        const popupPromise = page.waitForEvent("popup");
        if (selector === ".present-link") await page.locator(selector).click();
        else {
          const box = await page.locator(selector).boundingBox();
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        }
        const popup = await popupPromise;
        await popup.waitForFunction(() => window.presentation?.count === 1);
        assert.equal(new URL(popup.url()).pathname, "/present/product-update");
        assert.equal(await popup.evaluate(() => window.opener), null);
        assert.equal(page.url(), originalURL);
        assert(await page.locator(".deck-card").isVisible());
        await popup.close();
      }
      await page.locator('.card-actions a[href^="/edit/"]').click();
      await page.waitForURL("**/edit/product-update");
      await page.locator("#visualCanvas").waitFor();
      assert.equal(context.pages().length, 1);
      await page.goto(originalURL);
      await page.locator(".deck-card").waitFor();
    },
  );
  await check(
    "custom select supports keyboard, selection and light dismissal",
    async () => {
      const sort = page.getByRole("combobox", { name: "排序" });
      await sort.focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("End");
      await page.keyboard.press("Enter");
      assert.equal(await page.locator("#sort").inputValue(), "title");
      await sort.click();
      await page.screenshot({ path: path.join(dir, "select.png") });
      await page.locator("h1").click();
      await page.waitForFunction(
        () =>
          document
            .querySelector("#sortTrigger")
            .getAttribute("aria-expanded") === "false",
      );
      assert.equal(await page.locator("select").count(), 0);
    },
  );
  await check(
    "PPT icon and slug are editable without changing its ID",
    async () => {
      await page.locator(".card-more summary").click();
      await page.locator("[data-action=settings]").click();
      await page.locator("input[name=slug]").fill("launch-2026");
      await page.locator("#deckIconFile").setInputFiles(svgFile);
      await page.waitForFunction(() =>
        document
          .querySelector("#deckIconPreview")
          .src.startsWith("data:image/png"),
      );
      await submit();
      await page.waitForFunction(() => !document.querySelector("#dialog").open);
      const result = await api("/decks/" + id);
      assert.equal(result.slug, "launch-2026");
      assert(result.favicon.startsWith("data:image/png"));
      assert.equal(
        await page.locator(".present-link").getAttribute("href"),
        "/present/launch-2026",
      );
      await page.goto(base + "/edit/launch-2026");
      await page.locator("#deckSettings").waitFor();
      const heights = await page
        .locator(".editor-actions .button")
        .evaluateAll((buttons) =>
          buttons.map((b) => b.getBoundingClientRect().height),
        );
      assert(
        heights.every((h) => Math.abs(h - heights[0]) < 1),
        "Editor action buttons have equal heights",
      );
      await page.screenshot({ path: path.join(dir, "editor-buttons.png") });
      assert(
        (await page.locator("link[rel=icon]").getAttribute("href")).startsWith(
          "data:image/png",
        ),
      );
      await page.goto(base);
      await page.locator(".deck-card").waitFor();
    },
  );
  await check(
    "share slug, custom expiry and dialog keyboard behavior",
    async () => {
      await page.locator("[data-action=share]").click();
      assert(
        !(await page.locator("#dialog").textContent()).includes("私有模式下"),
      );
      await page.getByRole("combobox", { name: "访问权限" }).click();
      await page.keyboard.press("Escape");
      assert(await page.locator("#dialog").isVisible());
      await choose("访问权限", "链接分享 · 持有有效链接者可见");
      await page.locator("#generateLink").waitFor();
      await choose("有效期", "30 天");
      await page.locator("#shareSlug").fill("review-link");
      await page.locator("#generateLink").click();
      await page.locator("[data-copy]").waitFor();
      for (const [width, height, name] of [
        [1440, 1000, "share-desktop"],
        [390, 844, "share-mobile"],
      ]) {
        await page.setViewportSize({ width, height });
        const layout = await page.locator("#dialog").evaluate((d) => {
          const name = d.querySelector("#linkLabel").getBoundingClientRect(),
            expiry = d.querySelector("#expiryTrigger").getBoundingClientRect();
          return {
            width: d.clientWidth,
            scroll: d.scrollWidth,
            nameHeight: name.height,
            expiryHeight: expiry.height,
            topDifference: Math.abs(name.top - expiry.top),
          };
        });
        assert(
          layout.scroll <= layout.width + 1,
          "Sharing form must not scroll horizontally",
        );
        assert(
          Math.abs(layout.nameHeight - layout.expiryHeight) < 1,
          "Sharing fields have equal heights",
        );
        assert(layout.topDifference < 1, "Sharing fields are aligned");
        await page.screenshot({ path: path.join(dir, name + ".png") });
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      sharePath = await page.locator("[data-copy]").getAttribute("data-path");
      shareToken = await page.locator("[data-copy]").getAttribute("data-copy");
      assert.equal(sharePath, "/s/review-link/" + shareToken);
      await page.locator("[data-rename-share]").click();
      await page.locator("input[name=slug]").fill("review-final");
      await submit();
      await page.locator("[data-copy]").waitFor();
      sharePath = await page.locator("[data-copy]").getAttribute("data-path");
      await page.locator(".dialog-head .close-dialog").click();
      await page.waitForFunction(() => !document.querySelector("#dialog").open);
    },
  );
  await check(
    "admin opens settings; site name and favicon persist",
    async () => {
      const originalURL = page.url();
      await page.evaluate(() => {
        window.originalSidebar = document.querySelector(".sidebar");
      });
      await page.locator("#accountSettings").click();
      await page.locator("#siteForm").waitFor();
      assert.equal(page.url(), originalURL);
      assert(
        await page.evaluate(
          () => window.originalSidebar === document.querySelector(".sidebar"),
        ),
        "Settings keeps the original library sidebar",
      );
      assert.equal(await page.locator(".sidebar [data-filter]").count(), 3);
      assert.equal(
        await page.locator(".sidebar [data-filter].active").count(),
        0,
      );
      assert.equal(
        await page.locator("#accountSettings").getAttribute("aria-current"),
        "page",
      );
      await page.locator('[data-filter="all"]').click();
      await page.getByRole("combobox", { name: "访问权限筛选" }).click();
      await page.getByRole("option", { name: "私有", exact: true }).click();
      await page.locator("#deckGrid").waitFor();
      assert.equal(await page.locator("main h1").textContent(), "文稿");
      assert(
        await page.evaluate(
          () => window.originalSidebar === document.querySelector(".sidebar"),
        ),
      );
      assert.equal(
        await page.locator("#accountSettings").getAttribute("aria-current"),
        null,
      );
      await page.locator("#accountSettings").click();
      await page.locator("#siteForm").waitFor();
      await page.locator("#siteForm input[name=name]").fill("演示工作室");
      await page.locator("#siteIconFile").setInputFiles(svgFile);
      await page.waitForFunction(() =>
        document
          .querySelector("#siteIconPreview")
          .src.startsWith("data:image/png"),
      );
      await page.getByRole("button", { name: "保存设置" }).click();
      await page.waitForFunction(() => document.title === "设置 · 演示工作室");
      await page.screenshot({ path: path.join(dir, "settings-general.png") });
      await page.reload();
      await page.locator("#siteForm").waitFor();
      assert.equal(
        await page.locator("#siteForm input[name=name]").inputValue(),
        "演示工作室",
      );
    },
  );
  await check(
    "share viewer receives PPT icon and site name; old slug fails",
    async () => {
      const guest = await browser.newPage();
      await guest.goto(base + sharePath);
      await guest.waitForFunction(() => window.presentation?.count === 1);
      assert.equal(await guest.title(), "产品更新 · 演示工作室");
      assert(
        (await guest.locator("link[rel=icon]").getAttribute("href")).startsWith(
          "data:image/png",
        ),
      );
      await guest.goto(base + "/s/review-link/" + shareToken);
      await guest.locator("#errorTitle").waitFor();
      assert(
        (await guest.locator("#errorMessage").textContent()).includes(
          "名称已更改",
        ),
      );
      await guest.close();
    },
  );
  await check(
    "real WebAuthn registration stores a verified public key",
    async () => {
      await page.locator("[data-settings-tab=security]").click();
      await page.locator("#addPasskey").click();
      await page.locator("#dialog input[name=name]").fill("MacBook 通行密钥");
      assert.equal(
        await page.locator("#dialog input[name=currentPassword]").count(),
        0,
      );
      const inputBox = await page
          .locator("#dialog input[name=name]")
          .boundingBox(),
        dialogBox = await page.locator("#dialog").boundingBox();
      await page.mouse.move(
        inputBox.x + inputBox.width - 12,
        inputBox.y + inputBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(dialogBox.x - 24, inputBox.y + inputBox.height / 2);
      await page.mouse.up();
      await page.waitForTimeout(180);
      assert(await page.locator("#dialog").isVisible());
      await submit();
      await page.locator(".passkey-item").waitFor();
      assert.equal((await api("/security")).passkeys.length, 1);
    },
  );
  await check(
    "TOTP setup, verified activation and downloadable one-time recovery codes",
    async () => {
      await page.locator("#toggleTotp").click();
      await page.locator("input[name=currentPassword]").fill(password);
      await submit();
      await page.locator(".totp-secret").waitFor();
      const secret = await page.locator(".totp-secret").textContent();
      const totp = new OTPAuth.TOTP({
        secret,
        algorithm: "SHA1",
        digits: 6,
        period: 30,
      });
      await page.locator("input[name=code]").fill(totp.generate());
      await submit();
      await page.locator(".recovery-codes").waitFor();
      recovery = await page.locator(".recovery-codes code").allTextContents();
      assert.equal(recovery.length, 10);
      const downloadPromise = page.waitForEvent("download");
      await page.locator("#downloadRecovery").click();
      const downloaded = await downloadPromise;
      assert(
        fs.readFileSync(await downloaded.path(), "utf8").includes(recovery[0]),
      );
      await page.locator(".dialog-head .close-dialog").click();
      await page.waitForFunction(() => !document.querySelector("#dialog").open);
      await page.screenshot({ path: path.join(dir, "settings-security.png") });
    },
  );
  await check(
    "password and passkey logins both enforce enabled MFA",
    async () => {
      await api("/logout", "POST");
      await page.goto(base);
      await page.locator("input[name=password]").fill(password);
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await page.locator("#mfaForm").waitFor();
      assert.equal((await api("/session")).authenticated, false);
      await page.locator("input[name=code]").fill(recovery[0]);
      await page.getByRole("button", { name: "继续", exact: true }).click();
      await page.locator("#accountSettings").waitFor();
      await api("/logout", "POST");
      await page.goto(base);
      await page.locator("#passkeyLogin").click();
      await page.locator("#mfaForm").waitFor();
      await page.locator("input[name=code]").fill(recovery[1]);
      await page.getByRole("button", { name: "继续", exact: true }).click();
      await page.locator("#accountSettings").waitFor();
      await page.locator("#accountSettings").click();
      await page.locator("[data-settings-tab=security]").click();
    },
  );
  await check(
    "security removal requires reauthentication, password change is usable",
    async () => {
      await page.locator("[data-remove-passkey]").click();
      await page.locator("input[name=currentPassword]").fill(password);
      await page.locator("input[name=code]").fill(recovery[2]);
      await submit();
      await page.waitForFunction(() => !document.querySelector("#dialog").open);
      assert.equal(await page.locator(".passkey-item").count(), 0);
      await page.locator("#toggleTotp").click();
      await page.locator("input[name=currentPassword]").fill(password);
      await page.locator("input[name=code]").fill(recovery[3]);
      await submit();
      await page.waitForFunction(() => !document.querySelector("#dialog").open);
      assert.equal(await page.locator("#toggleTotp").textContent(), "启用");
      await page.locator("#changePassword").click();
      await page.locator("input[name=currentPassword]").fill(password);
      password = "updated-browser-password-8302";
      await page.locator("input[name=password]").fill(password);
      await page.locator("input[name=confirm]").fill(password);
      await submit();
      await page.waitForFunction(() => !document.querySelector("#dialog").open);
      await api("/logout", "POST");
      await page.goto(base);
      await page.locator("input[name=password]").fill(password);
      await page.getByRole("button", { name: "登录", exact: true }).click();
      await page.locator("#accountSettings").waitFor();
    },
  );
  await check("settings layout fits mobile viewport", async () => {
    await page.locator("#accountSettings").click();
    await page.locator("[data-settings-tab=security]").click();
    assert.equal(new URL(page.url()).pathname, "/");
    await page.locator("#securitySettings").waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth),
      390,
    );
    await page.screenshot({
      path: path.join(dir, "settings-mobile.png"),
      fullPage: true,
    });
  });
  await check(
    "long sharing lists use slim scrollbars without horizontal overflow",
    async () => {
      for (let i = 0; i < 10; i++)
        await api("/decks/" + id + "/shares", "POST", {
          label: "分享 " + (i + 1),
          slug: "review-" + i,
        });
      await page.locator('[data-filter="all"]').click();
      await page.locator("[data-action=share]").click();
      await page.locator(".share-list").waitFor();
      const layout = await page.locator("#dialog").evaluate((d) => {
        const list = d.querySelector(".share-list");
        return {
          overflow: d.scrollWidth > d.clientWidth,
          listScroll: list.scrollHeight > list.clientHeight,
          scrollbar: getComputedStyle(list, "::-webkit-scrollbar").width,
        };
      });
      assert.equal(layout.overflow, false);
      assert(layout.listScroll);
      assert.equal(layout.scrollbar, "8px");
      await page.screenshot({ path: path.join(dir, "share-long-mobile.png") });
    },
  );
  assert.deepEqual(errors, []);
  console.log("ALL 12 SETTINGS BROWSER GROUPS PASSED");
} catch (e) {
  await page.screenshot({
    path: path.join(dir, "failure.png"),
    fullPage: true,
  });
  console.error("Browser errors:", errors);
  throw e;
} finally {
  await browser.close();
  await app.close();
}
