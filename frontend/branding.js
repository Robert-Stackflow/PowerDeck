import { api, esc } from "./api.js";
export let site = {
  name: document.documentElement.dataset.siteName || "演示库",
  favicon: document.documentElement.dataset.siteFavicon || null,
};
export const defaultIcon = "/static/favicon.svg";
export function setFavicon(value) {
  let link = document.querySelector('link[rel="icon"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.append(link);
  }
  link.href = value || defaultIcon;
  link.type = value ? "image/png" : "image/svg+xml";
}
export function setSite(value) {
  site = value;
  document.documentElement.dataset.siteName = site.name;
  document.documentElement.dataset.siteFavicon = site.favicon || "";
  document.documentElement.dataset.toastPosition =
    site.toastPosition || "bottom-center";
  let theme = site.theme || "system";
  try {
    theme = localStorage.getItem("site.theme.override") || theme;
  } catch {}
  window.setAppTheme?.(theme);
  document.title = site.name;
  setFavicon(site.favicon);
}
export async function loadSite() {
  setSite(await api("/site"));
  return site;
}
export const brand = () =>
  `<img class="site-logo" src="${esc(site.favicon || defaultIcon)}" alt=""><span>${esc(site.name)}</span>`;
export async function iconFromFile(file) {
  if (!file || file.size > 4 * 1024 * 1024 || !file.type.startsWith("image/"))
    throw new Error("请选择小于 4 MB 的图片");
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const scale = Math.min(128 / img.naturalWidth, 128 / img.naturalHeight),
      w = img.naturalWidth * scale,
      h = img.naturalHeight * scale;
    canvas.getContext("2d").drawImage(img, (128 - w) / 2, (128 - h) / 2, w, h);
    return canvas.toDataURL("image/png");
  } catch {
    throw new Error("无法读取这张图片，请换一张 PNG、JPG、WebP 或 SVG 图片");
  } finally {
    URL.revokeObjectURL(url);
  }
}
