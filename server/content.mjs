import { parse, serialize, serializeOuter } from "parse5";
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const requireValue = (ok, message = "请求参数不正确") => {
  if (!ok) throw new HttpError(400, message);
};
export const escapeHTML = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const attr = (n, k) => n.attrs?.find((a) => a.name === k)?.value;
const walk = (node, fn) => {
  fn(node);
  for (const c of node.childNodes || []) walk(c, fn);
};
const blocked = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "base",
  "meta",
  "link",
  "form",
]);
const reserved = new Set([
  "controls",
  "presenterUI",
  "panelBackdrop",
  "overview",
  "notes",
  "toast",
  "progress",
  "figureViewer",
  "presentationTimer",
  "timingPanel",
]);
function clean(node) {
  node.childNodes = (node.childNodes || []).filter(
    (n) => !blocked.has(n.tagName) && !reserved.has(attr(n, "id")),
  );
  for (const child of node.childNodes) {
    if (child.attrs)
      child.attrs = child.attrs.filter(
        (a) =>
          !/^on/i.test(a.name) &&
          a.name !== "srcdoc" &&
          !(
            ["href", "src", "xlink:href", "action"].includes(a.name) &&
            /^\s*(javascript|vbscript):/i.test(a.value)
          ),
      );
    clean(child);
  }
}
export function normalizeContent(input) {
  requireValue(
    typeof input.html === "string" &&
      input.html.length > 0 &&
      Buffer.byteLength(input.html) < 24 * 1024 * 1024,
    "HTML 内容不能为空，且需小于 24 MB",
  );
  requireValue(
    typeof (input.css || "") === "string" &&
      Buffer.byteLength(input.css || "") < 4 * 1024 * 1024,
    "样式文件过大",
  );
  requireValue(
    input.notes === undefined ||
      (input.notes !== null &&
        typeof input.notes === "object" &&
        !Array.isArray(input.notes)),
    "备注需要按页编号组织的 JSON 对象",
  );
  const doc = parse(input.html);
  let embeddedCSS = [],
    notes = input.notes || {},
    body,
    deck;
  walk(doc, (n) => {
    if (n.tagName === "body") body = n;
    if (attr(n, "id") === "deck") deck = n;
    if (n.tagName === "style")
      embeddedCSS.push(n.childNodes?.map((c) => c.value || "").join("") || "");
    if (attr(n, "id") === "notesData" && !input.notes) {
      try {
        notes = JSON.parse(n.childNodes?.map((c) => c.value || "").join(""));
      } catch {}
    }
  });
  clean(doc);
  const candidates = [];
  const collect = (n) => {
    if ((attr(n, "class") || "").split(/\s+/).includes("slide"))
      candidates.push(n);
    else for (const child of n.childNodes || []) collect(child);
  };
  collect(deck || body);
  requireValue(
    candidates.length > 0 && candidates.length <= 200,
    'HTML 中需要 1–200 个 class="slide" 的页面',
  );
  const ids = new Set();
  const pages = candidates.map((node, i) => {
    node.attrs = node.attrs.filter((a) => a.name !== "data-page");
    node.attrs.push({ name: "data-page", value: String(i + 1) });
    let id = attr(node, "data-slide-id");
    if (!id || ids.has(id) || id.length > 100) {
      id = "slide-" + (i + 1);
      node.attrs = node.attrs.filter((a) => a.name !== "data-slide-id");
      node.attrs.push({ name: "data-slide-id", value: id });
    }
    ids.add(id);
    return serializeOuter(node);
  });
  const normalizedNotes = {};
  for (let i = 1; i <= pages.length; i++) {
    const n = notes[i] || {};
    const title =
      typeof n.title === "string" ? n.title.slice(0, 200) : `第 ${i} 页`;
    normalizedNotes[i] = {
      title,
      notes: typeof n.notes === "string" ? n.notes.slice(0, 30000) : "",
      refs: Array.isArray(n.refs)
        ? n.refs
            .filter(
              (r) =>
                Array.isArray(r) &&
                typeof r[0] === "string" &&
                typeof r[1] === "string" &&
                /^https?:\/\//i.test(r[1]),
            )
            .slice(0, 40)
        : [],
      figures: Array.isArray(n.figures)
        ? n.figures
            .filter(
              (f) =>
                typeof f.src === "string" &&
                typeof f.title === "string" &&
                /^(assets\/|data:image\/)/.test(f.src),
            )
            .slice(0, 12)
        : [],
    };
  }
  const referenceLibrary = [
    ...(Array.isArray(notes.references) ? notes.references : []),
    ...Object.values(notes).flatMap((note) =>
      Array.isArray(note?.referenceLibrary) ? note.referenceLibrary : [],
    ),
  ]
    .filter(
      (r) =>
        Array.isArray(r) &&
        typeof r[0] === "string" &&
        typeof r[1] === "string" &&
        /^https?:\/\//i.test(r[1]),
    )
    .map(([label, url]) => [label.slice(0, 300), url.slice(0, 2048)])
    .slice(0, 500);
  if (referenceLibrary.length)
    normalizedNotes[1].referenceLibrary = referenceLibrary;
  return {
    html: pages.join("\n"),
    css: embeddedCSS.join("\n") + "\n" + (input.css || ""),
    notes: normalizedNotes,
    slideCount: pages.length,
  };
}
export const blankContent = {
  html: '<section class="slide" data-slide-id="cover"><div class="title-page"><p>新的开始</p><h1>我的演示</h1><span>在编辑器中开始创作</span></div></section>',
  css: ".slide{background:#f7f5f0;color:#183c38}.title-page{position:absolute;inset:120px;display:flex;flex-direction:column;justify-content:center}.title-page p{font-size:24px;letter-spacing:5px;color:#7c8c87}.title-page h1{font-size:92px;margin:30px 0}.title-page span{font-size:28px;color:#7c8c87}",
  notes: { 1: { title: "我的演示", notes: "", refs: [] } },
};
export const assetTypes = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};
