import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFragment, serialize } from "parse5";
import { icons as lucideIcons } from "lucide/dist/esm/lucide.js";
import { presenterIcons } from "../scripts/icons.mjs";
import { HttpError, assetTypes, escapeHTML } from "./content.mjs";

const root = path.resolve(import.meta.dirname, "..");
const MAX_STANDALONE_SIZE = 220 * 1024 * 1024;
const runtimeFiles = [
  "frontend/player/timing.js",
  "frontend/player/timer.js",
  "frontend/components/toast.js",
  "frontend/components/wheel-navigation.js",
  "frontend/player/media.js",
  "frontend/player/lightbox.js",
  "frontend/player/runtime.js",
];
const cssFiles = [
  "frontend/player/base.css",
  "frontend/components/scrollbars.css",
  "frontend/components/toast.css",
  "frontend/player/timer.css",
  "frontend/player/player.css",
];

const escapeScript = (value) =>
  String(value)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
const safeScript = (value) =>
  String(value).replace(/<\/script/gi, "<\\/script");
const safeStyle = (value) => String(value).replace(/<\/style/gi, "<\\/style");

function lucide(name) {
  const nodes = lucideIcons[name];
  if (!nodes) throw new Error(`Missing Lucide icon: ${name}`);
  return {
    name: name
      .replace(/[a-z0-9][A-Z]/g, (value) => value[0] + "-" + value[1])
      .replace(/([a-zA-Z])(\d+)/g, "$1-$2")
      .toLowerCase(),
    body: nodes
      .map(
        ([tag, attrs]) =>
          `<${tag} ${Object.entries(attrs)
            .map(([key, value]) => `${key}="${escapeHTML(value)}"`)
            .join(" ")}/>`,
      )
      .join(""),
  };
}

const standaloneIcons = {
  ...presenterIcons,
  rotateCcw: lucide("RotateCcw"),
};

function bundledRuntime() {
  return runtimeFiles
    .map((file) =>
      fs
        .readFileSync(path.join(root, file), "utf8")
        .replace(/^import\s+[^;]+;\s*/gm, "")
        .replace(
          /\bexport\s+(?=(?:async\s+)?(?:function|const|let|class))/g,
          "",
        ),
    )
    .join("\n\n");
}

function dataURL(file, mime) {
  return `data:${mime};base64,${fs.readFileSync(file).toString("base64")}`;
}

function normalizedAssetPath(value) {
  let clean = String(value || "").trim();
  try {
    clean = decodeURIComponent(clean);
  } catch {}
  clean = clean.replace(/[?#].*$/, "").replaceAll("\\", "/");
  const filesAt = clean.indexOf("/files/");
  if (filesAt >= 0) clean = clean.slice(filesAt + 7);
  clean = clean.replace(/^\.\//, "").replace(/^\/deck\//, "");
  clean = clean.replace(/^\//, "");
  return clean;
}

function assetResolver(store, id) {
  const assets = new Map();
  for (const asset of store.assets(id))
    assets.set(asset.path, dataURL(store.file(id, asset.path), asset.type));
  return (value, { required = false } = {}) => {
    const source = String(value || "").trim();
    if (!source || source.startsWith("data:") || source.startsWith("#"))
      return source;
    if (/^(?:https?:|blob:|file:|\/\/)/i.test(source)) {
      if (required)
        throw new HttpError(
          422,
          "单文件 HTML 不能包含外部素材，请先将图片、音视频或字体上传到素材库",
        );
      return source;
    }
    const name = normalizedAssetPath(source),
      embedded = assets.get(name);
    if (embedded) return embedded;
    if (required || name.startsWith("assets/"))
      throw new HttpError(422, `素材不存在，无法导出：${name}`);
    return source;
  };
}

function embedCSS(css, resolve, { allowImports = false } = {}) {
  if (!allowImports && /@import\s/i.test(css))
    throw new HttpError(
      422,
      "单文件 HTML 不能包含外部样式，请移除 @import 或上传相关字体",
    );
  return css.replace(
    /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
    (match, quote, value) => {
      if (value.startsWith("data:") || value.startsWith("#")) return match;
      const embedded = resolve(value, { required: true });
      return `url("${embedded}")`;
    },
  );
}

function embedKaTeX() {
  const katexRoot = path.dirname(fileURLToPath(import.meta.resolve("katex"))),
    css = fs.readFileSync(path.join(katexRoot, "katex.min.css"), "utf8");
  return css.replace(
    /url\(\s*(["']?)([^"')]+)\1\s*\)/gi,
    (match, quote, value) => {
      const file = path.resolve(katexRoot, value);
      if (!file.startsWith(katexRoot + path.sep) || !fs.existsSync(file))
        throw new HttpError(500, "KaTeX 字体资源不完整");
      const mime = assetTypes[path.extname(file)] || "application/octet-stream";
      return `url("${dataURL(file, mime)}")`;
    },
  );
}

const attr = (node, name) => node.attrs?.find((item) => item.name === name);
const parentTag = (node, name) => {
  for (let current = node.parentNode; current; current = current.parentNode)
    if (current.tagName === name) return true;
  return false;
};

function embedMarkup(html, resolve) {
  const fragment = parseFragment(html);
  const visit = (node) => {
    if (node.attrs) {
      const style = attr(node, "style");
      if (style) style.value = embedCSS(style.value, resolve);
      const media = ["img", "source", "video", "audio", "image"].includes(
        node.tagName,
      );
      for (const item of node.attrs) {
        if (item.name === "srcset" && media) {
          item.value = item.value
            .split(",")
            .map((candidate) => {
              const parts = candidate.trim().split(/\s+/),
                url = parts.shift();
              return [resolve(url, { required: true }), ...parts].join(" ");
            })
            .join(", ");
        } else if (media && ["src", "poster"].includes(item.name))
          item.value = resolve(item.value, { required: true });
        else if (
          node.tagName === "image" &&
          ["href", "xlink:href"].includes(item.name)
        )
          item.value = resolve(item.value, { required: true });
      }
      const deferred =
        node.tagName === "img" ||
        node.tagName === "image" ||
        (node.tagName === "source" && parentTag(node, "picture"));
      if (deferred)
        for (const item of node.attrs) {
          if (item.name === "src") item.name = "data-player-src";
          else if (item.name === "srcset") item.name = "data-player-srcset";
          else if (item.name === "href") item.name = "data-player-href";
          else if (item.name === "xlink:href")
            item.name = "data-player-xlink-href";
        }
    }
    for (const child of node.childNodes || []) visit(child);
  };
  visit(fragment);
  return serialize(fragment);
}

function offlineNotes(notes, resolve, allowNotes) {
  return Object.fromEntries(
    Object.entries(notes).map(([page, note]) => [
      page,
      {
        ...note,
        notes: allowNotes ? note.notes : "",
        refs: allowNotes ? note.refs : [],
        figures: allowNotes
          ? (note.figures || []).map((figure) => ({
              ...figure,
              src: resolve(figure.src, { required: true }),
            }))
          : [],
      },
    ]),
  );
}

export function standaloneDocument(store, id, { allowNotes = true } = {}) {
  const meta = store.get(id),
    content = store.content(id),
    resolve = assetResolver(store, id),
    notes = offlineNotes(content.notes, resolve, allowNotes),
    html = embedMarkup(content.html, resolve),
    toc = Object.entries(notes)
      .filter(([page]) => /^\d+$/.test(page))
      .map(
        ([page, note]) =>
          `<button class="toc-item" data-goto="${page}"><b>${String(page).padStart(2, "0")}</b><span>${escapeHTML(note.title)}</span></button>`,
      )
      .join(""),
    baseCSS = fs
      .readFileSync(path.join(root, cssFiles[0]), "utf8")
      .replace(/@import\s+url\([^)]*katex[^)]*\)\s*;?/gi, ""),
    styles = [
      embedKaTeX(),
      baseCSS,
      embedCSS(content.css, resolve),
      ...cssFiles
        .slice(1)
        .map((file) => fs.readFileSync(path.join(root, file), "utf8")),
      `:root{--slide-width:${Number(meta.width)}px;--slide-height:${Number(meta.height)}px}#deck,.slide{width:var(--slide-width);height:var(--slide-height)}@media print{@page{size:${Number(meta.width)}px ${Number(meta.height)}px;margin:0}#deck{width:var(--slide-width)}}`,
    ].join("\n"),
    config = escapeScript(
      JSON.stringify({
        deckId: `offline:${id}`,
        width: meta.width,
        height: meta.height,
        allowNotes,
        icons: standaloneIcons,
      }),
    ),
    runtime = safeScript(bundledRuntime()),
    noteJSON = escapeHTML(JSON.stringify(notes));
  const document = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"><title>${escapeHTML(meta.title)}</title><style>${safeStyle(styles)}</style></head><body><div id="stage"><div id="deck">${html}</div></div><nav id="controls" aria-label="演示控制"></nav><div id="progress"><i></i></div><div id="panelBackdrop" hidden></div><div id="overview" class="overlay" role="dialog" aria-modal="true" aria-labelledby="overviewTitle" hidden><div class="overlay-head"><h2 id="overviewTitle">目录</h2><button class="dialog-close" data-close="overview" aria-label="关闭目录"></button></div><div class="overview-list">${toc}</div></div><aside id="notes" class="overlay" role="dialog" aria-modal="true" aria-labelledby="notesTitle" hidden><div class="overlay-head"><h2 id="notesTitle"></h2><button class="dialog-close" data-close="notes" aria-label="关闭备注"></button></div><div id="notesBody"></div></aside><div id="toast" role="status"></div><template id="notesData">${noteJSON}</template><script>(()=>{"use strict";const config=${config};${runtime}\nconst memory=new Map();const storage={getItem:key=>memory.has(key)?memory.get(key):null,setItem:(key,value)=>memory.set(key,String(value)),removeItem:key=>memory.delete(key)};window.presentation=mountPresenter({window,hostWindow:window,icons:config.icons,deckId:config.deckId,width:config.width,height:config.height,allowNotes:config.allowNotes,toastPosition:"bottom-center",storage});document.querySelector("#stage")?.focus({preventScroll:true});})();</script></body></html>`;
  if (Buffer.byteLength(document) > MAX_STANDALONE_SIZE)
    throw new HttpError(413, "单文件 HTML 超过 220 MB，请压缩素材后重试");
  return document;
}

export function exportStandalone(store, id, options) {
  return Buffer.from(standaloneDocument(store, id, options));
}
