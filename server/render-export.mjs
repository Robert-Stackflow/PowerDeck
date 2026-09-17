import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import PptxGenJS from "pptxgenjs";
import { HttpError, assetTypes, escapeHTML } from "./content.mjs";
const root = path.resolve(import.meta.dirname, "..");
const origin = "https://deck-export.invalid";
let active = false;
export const exportTypes = {
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
export function exportDocument(meta, content) {
  const css =
    fs.readFileSync(path.join(root, "frontend/player/base.css"), "utf8") +
    "\n" +
    content.css;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'none';"><base href="${origin}/deck/"><title>${escapeHTML(meta.title)}</title><style>${css.replace(/<\/style/gi, "<\\/style")}</style><style>
  :root{--slide-width:${meta.width}px;--slide-height:${meta.height}px;--scale:1}
  html,body{margin:0!important;padding:0!important;background:white!important;overflow:visible!important;width:${meta.width}px!important}
  #deck{position:relative!important;inset:auto!important;transform:none!important;width:${meta.width}px!important;height:auto!important;margin:0!important;padding:0!important}
  #deck>.slide{display:block!important;visibility:visible!important;position:relative!important;inset:auto!important;transform:none!important;width:${meta.width}px!important;height:${meta.height}px!important;min-height:0!important;margin:0!important;border:0!important;border-radius:0!important;box-shadow:none!important;overflow:hidden!important;break-after:page;break-inside:avoid;content-visibility:visible!important;opacity:1!important}
  #deck>.slide:last-child{break-after:auto}
  *,*::before,*::after{animation:none!important;transition:none!important;print-color-adjust:exact!important;-webkit-print-color-adjust:exact!important}
  @page{size:${meta.width}px ${meta.height}px;margin:0}
  </style></head><body><div id="deck">${content.html}</div></body></html>`;
}
export async function renderExport(store, id, format, { signal } = {}) {
  if (!exportTypes[format]) throw new HttpError(400, "导出格式不正确");
  if (active) throw new HttpError(429, "正在生成另一份文件，请稍后再试");
  active = true;
  let browser,
    timeout,
    cancelled = false;
  const abort = () => {
    cancelled = true;
    browser?.close().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const meta = store.get(id),
      content = store.content(id);
    if (signal?.aborted) throw new HttpError(499, "导出已取消");
    try {
      browser = await chromium.launch({
        headless: true,
        timeout: 20000,
        ...(process.env.EXPORT_CHROMIUM_PATH
          ? { executablePath: process.env.EXPORT_CHROMIUM_PATH }
          : {}),
      });
    } catch {
      throw new HttpError(
        503,
        "导出引擎不可用，请在服务器安装 Chromium（npx playwright install chromium）",
      );
    }
    if (cancelled) throw new HttpError(499, "导出已取消");
    timeout = setTimeout(abort, 120000);
    const context = await browser.newContext({
      viewport: { width: meta.width, height: meta.height },
      deviceScaleFactor: Math.min(2, 3840 / Math.max(meta.width, meta.height)),
      javaScriptEnabled: false,
      serviceWorkers: "block",
    });
    const assetFiles = new Map(
      store.assets(id).map((a) => ["/deck/" + a.path, store.file(id, a.path)]),
    );
    const katexRoot = path.dirname(fileURLToPath(import.meta.resolve("katex")));
    let missing = false;
    // Serve a private snapshot in memory: no cookies, public route or external network access.
    await context.route("**/*", async (route) => {
      try {
        const url = new URL(route.request().url()),
          pathname = decodeURIComponent(url.pathname);
        if (url.origin !== origin) {
          missing = true;
          return await route.abort();
        }
        if (pathname === "/")
          return await route.fulfill({
            body: exportDocument(meta, content),
            contentType: "text/html; charset=utf-8",
          });
        let file = assetFiles.get(pathname);
        if (pathname === "/static/katex/katex.min.css")
          file = path.join(katexRoot, "katex.min.css");
        if (
          /^\/static\/katex\/fonts\/[A-Za-z0-9_-]+\.(woff2?|ttf)$/.test(
            pathname,
          )
        )
          file = path.join(katexRoot, "fonts", path.basename(pathname));
        if (!file) {
          missing = true;
          return await route.abort();
        }
        await route.fulfill({
          body: await fs.promises.readFile(file),
          contentType:
            path.extname(file) === ".css"
              ? "text/css"
              : assetTypes[path.extname(file)] || "application/octet-stream",
        });
      } catch {
        missing = true;
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(origin + "/", {
      waitUntil: "load",
      timeout: 30000,
    });
    await page.emulateMedia({ media: "screen" });
    await page.evaluate(async () => {
      document
        .querySelectorAll("img")
        .forEach((img) => (img.loading = "eager"));
      await Promise.all(
        [...document.images].map((img) => img.decode().catch(() => {})),
      );
      await document.fonts.ready;
    });
    if (
      missing ||
      (await page
        .locator("img")
        .evaluateAll((images) =>
          images.some((img) => !img.complete || !img.naturalWidth),
        ))
    )
      throw new HttpError(
        422,
        "部分图片或字体无法读取，请先将外部素材上传至文稿后再导出",
      );
    let result;
    if (format === "pdf") {
      result = await page.pdf({
        width: meta.width + "px",
        height: meta.height + "px",
        printBackground: true,
        preferCSSPageSize: true,
        margin: { top: 0, right: 0, bottom: 0, left: 0 },
      });
    } else {
      const pptx = new PptxGenJS();
      const w = 13.333333,
        h = (w * meta.height) / meta.width;
      pptx.defineLayout({ name: "CONTENT", width: w, height: h });
      pptx.layout = "CONTENT";
      pptx.author = meta.author || "";
      pptx.title = meta.title;
      pptx.subject = meta.description || "";
      pptx.company = "";
      pptx.lang = "zh-CN";
      const slides = page.locator("#deck > .slide"),
        count = await slides.count();
      for (let i = 0; i < count; i++) {
        const png = await slides
          .nth(i)
          .screenshot({ type: "png", animations: "disabled", timeout: 20000 });
        const slide = pptx.addSlide(),
          note = content.notes[i + 1];
        slide.addImage({
          data: "image/png;base64," + png.toString("base64"),
          x: 0,
          y: 0,
          w,
          h,
          altText: note?.title || `第 ${i + 1} 页`,
        });
        if (note)
          slide.addNotes(
            [
              note.notes,
              ...(note.refs || []).map(([label, url]) => label + "\n" + url),
            ]
              .filter(Boolean)
              .join("\n\n"),
          );
      }
      result = await pptx.write({
        outputType: "nodebuffer",
        compression: true,
      });
    }
    if (cancelled) throw new HttpError(408, "导出超时，请拆分文稿后再试");
    return result;
  } catch (error) {
    if (cancelled) throw new HttpError(408, "导出已取消或超时，请重试");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
    await browser?.close().catch(() => {});
    active = false;
  }
}
