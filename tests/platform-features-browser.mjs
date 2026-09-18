import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { createApp, projectRoot } from "../server/app.mjs";

const dir = path.join(projectRoot, "work/qa/platform-features-browser");
fs.rmSync(dir, { recursive: true, force: true });
const app = await createApp({ dataDir: dir }),
  base = await app.listen({ port: 0 }),
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH,
  }),
  context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  }),
  page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

try {
  await page.goto(base);
  await page.locator("input[name=password]").fill("platform-browser-123");
  await page.locator("input[name=confirm]").fill("platform-browser-123");
  await page.getByRole("button", { name: "创建并进入" }).click();
  await page.locator("#accountSettings").click();
  await page.getByRole("button", { name: /品牌与素材/ }).click();
  await page.locator("#brandKitForm").waitFor();
  await page.locator('#brandKitForm input[name="primary"]').fill("#123456");
  await page.locator("#brandKitForm button[type=submit]").click();
  await page.locator("#brandAssetFile").setInputFiles({
    name: "brand.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><rect width="100" height="60" fill="#123456"/></svg>',
    ),
  });
  await page.locator(".brand-settings-grid article").waitFor();

  await page.getByRole("button", { name: /成员与权限/ }).click();
  await page.locator("#addWorkspaceUser").click();
  await page.locator('#dialog input[name="username"]').fill("editor2");
  await page
    .locator('#dialog input[name="password"]')
    .fill("editor-password-123");
  await page.locator("#dialog button[type=submit]").click();
  await page.locator(".workspace-user", { hasText: "editor2" }).waitFor();

  await page.getByRole("button", { name: /备份中心/ }).click();
  await page.locator("#createBackup").click();
  await page.locator(".backup-list article").waitFor();

  await page.goto(base + "/edit/areal");
  await page.locator("#visualCanvas[data-ready=true]").waitFor();
  await page.locator("#openBrandAssets").click();
  await page.locator(".brand-assets-grid button").click();
  const frame = page.locator("#visualCanvas").contentFrame();
  await frame.locator('[data-editor-element="image"]').last().waitFor();

  const presenter = await page.context().newPage();
  await presenter.goto(base + "/presenter/areal");
  await presenter.locator("#audienceButton").click();
  await presenter.locator("#startAudience").click();
  await presenter.locator("#audienceDashboard").waitFor();
  const audienceURL = await presenter
    .locator("#audienceDashboard .remote-control-link input")
    .inputValue();
  const audience = await page.context().newPage();
  await audience.goto(new URL(audienceURL, base).href);
  await audience.locator("#questionForm textarea").fill("测试问题");
  await audience.locator("#questionForm button").click();
  await presenter.waitForTimeout(2200);
  await presenter
    .locator(".audience-questions", { hasText: "测试问题" })
    .waitFor();
  await audience.close();
  await presenter.close();
  assert.deepEqual(errors, []);
  console.log(
    "PASS brand library, workspace members, backup center and audience UI",
  );
} finally {
  await browser.close();
  await app.close();
}
