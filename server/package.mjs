import path from "node:path";
import yazl from "yazl";
import { readZip } from "./archive.mjs";
import { assetTypes, HttpError, requireValue } from "./content.mjs";
const MB = 1024 * 1024;
export const PACKAGE_LIMIT = 200 * MB;
const FORMAT = "deck-library/zip-v1";
const jsonBytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
export function exportPackage(store, id) {
  const d = store.get(id),
    content = store.content(id),
    zip = new yazl.ZipFile();
  zip.on("error", (error) => zip.outputStream.destroy(error));
  const metadata = {
    format: FORMAT,
    title: d.title,
    description: d.description,
    author: d.author,
    kind: d.kind,
    slug: d.slug,
    width: d.width,
    height: d.height,
    slideCount: d.slideCount,
    favicon: d.favicon ? "favicon.png" : null,
  };
  zip.addBuffer(jsonBytes(metadata), "metadata.json");
  zip.addBuffer(Buffer.from(content.html), "content.html");
  zip.addBuffer(Buffer.from(content.css), "styles.css");
  zip.addBuffer(jsonBytes(content.notes), "notes.json");
  if (d.favicon)
    zip.addBuffer(
      Buffer.from(d.favicon.split(",")[1], "base64"),
      "favicon.png",
    );
  for (const asset of store.assets(id))
    zip.addFile(store.file(id, asset.path), asset.path);
  zip.end();
  return zip.outputStream;
}
export async function importPackageArchive(bytes) {
  const files = await readZip(bytes, {
    label: "ZIP 内容包",
    maxCompressed: PACKAGE_LIMIT,
    maxTotal: 256 * MB,
    maxEntries: 1100,
  });
  const file = (name, limit) => {
    requireValue(files.has(name), `内容包缺少 ${name}`);
    const value = files.get(name);
    requireValue(value.length <= limit, `${name} 文件过大`);
    return value;
  };
  const object = (name, limit) => {
    let value;
    try {
      value = JSON.parse(file(name, limit).toString("utf8"));
    } catch (error) {
      if (error.status) throw error;
      throw new HttpError(400, `${name} 不是有效的 JSON`);
    }
    requireValue(
      value && typeof value === "object" && !Array.isArray(value),
      `${name} 格式不正确`,
    );
    return value;
  };
  const metadata = object("metadata.json", MB);
  requireValue(
    metadata.format === FORMAT,
    "不支持此内容包版本，请选择演示库导出的 ZIP 文件",
  );
  requireValue(
    ["deck", "template"].includes(metadata.kind),
    "内容包类型不正确",
  );
  const html = file("content.html", 24 * MB).toString("utf8"),
    css = file("styles.css", 4 * MB).toString("utf8"),
    notes = object("notes.json", 8 * MB);
  requireValue(html.trim().length > 0, "内容包的页面不能为空");
  let favicon = null;
  if (metadata.favicon != null) {
    requireValue(metadata.favicon === "favicon.png", "内容包图标路径不正确");
    favicon =
      "data:image/png;base64," +
      file("favicon.png", 256 * 1024).toString("base64");
  }
  const assets = [];
  for (const [name, data] of files) {
    if (!name.startsWith("assets/")) continue;
    const ext = path.posix.extname(name).toLowerCase();
    requireValue(assetTypes[ext], `内容包包含不支持的素材：${name}`);
    requireValue(
      data.length > 0 && data.length <= 12 * MB,
      `素材需小于 12 MB：${name}`,
    );
    assets.push({
      name: path.posix.basename(name),
      path: name,
      base64: data.toString("base64"),
    });
  }
  requireValue(assets.length <= 1000, "素材数量超过 1000 个，请拆分后导入");
  // New identity and private access come from store.create; never restore share credentials.
  return {
    format: "deck-library/v1",
    title: metadata.title,
    description: metadata.description,
    author: metadata.author,
    width: metadata.width,
    height: metadata.height,
    kind: metadata.kind,
    favicon,
    html,
    css,
    notes,
    assets,
  };
}
