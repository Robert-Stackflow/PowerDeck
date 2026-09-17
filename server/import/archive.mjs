import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import { HttpError, requireValue } from "../content.mjs";
import { readZip } from "../archive.mjs";

export const readArchive = (buffer) => readZip(buffer, { label: "PowerPoint" });
export const children = (node, name) =>
  Array.from(node?.childNodes || []).filter(
    (n) => n.nodeType === 1 && (!name || n.localName === name),
  );
export const child = (node, name) => children(node, name)[0];
export const all = (node, name) =>
  Array.from(node?.getElementsByTagNameNS("*", name) || []);
export const first = (node, name) => all(node, name)[0];
export const attr = (node, key, fallback = "") =>
  node?.hasAttribute(key) ? node.getAttribute(key) : fallback;
export const number = (node, key, fallback = 0) => {
  const v = Number(attr(node, key, fallback));
  return Number.isFinite(v) ? v : fallback;
};
export const relationId = (node) => attr(node, "r:id") || attr(node, "r:embed");
export function xmlReader(files) {
  const cache = new Map();
  return (name) => {
    if (cache.has(name)) return cache.get(name);
    const bytes = files.get(name);
    if (!bytes) return null;
    requireValue(bytes.length < 16 * 1024 * 1024, "PowerPoint 页面结构过大");
    const text = bytes.toString("utf8");
    requireValue(!/<!DOCTYPE|<!ENTITY/i.test(text), "不支持包含外部实体的 XML");
    let doc;
    try {
      doc = new DOMParser({
        onError: (level) => {
          if (level !== "warning") throw new Error("XML");
        },
      }).parseFromString(text, "application/xml");
    } catch {
      throw new HttpError(400, "PowerPoint XML 格式不正确");
    }
    cache.set(name, doc);
    return doc;
  };
}
export function relationships(xml, name) {
  const doc = xml(
    path.posix.join(
      path.posix.dirname(name),
      "_rels",
      path.posix.basename(name) + ".rels",
    ),
  );
  return new Map(
    all(doc, "Relationship").map((r) => {
      const external = attr(r, "TargetMode") === "External",
        target = attr(r, "Target");
      const resolved = target.startsWith("/")
        ? target.slice(1)
        : path.posix.normalize(
            path.posix.join(path.posix.dirname(name), target),
          );
      return [
        attr(r, "Id"),
        {
          type: attr(r, "Type").split("/").at(-1),
          target: external ? target : resolved,
          external,
        },
      ];
    }),
  );
}
