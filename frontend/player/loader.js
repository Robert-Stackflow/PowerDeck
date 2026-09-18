import { mountPresenter } from "./runtime.js";
import { playerDocument } from "./document.js";
import { icons, icon } from "../icons.js";
import { loadSite, site, setFavicon } from "../branding.js";
const parts = location.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent),
  shared = parts[0] === "s";
const revision = shared
  ? null
  : new URLSearchParams(location.search).get("revision");
let prefix;
const frame = document.querySelector("#playerFrame");
const loading = document.querySelector("#loading");
let interval;
async function read(url) {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) {
    const e = await r.json();
    throw Object.assign(new Error(e.error), { status: r.status });
  }
  return r.json();
}
function fail(e) {
  clearInterval(interval);
  frame.remove();
  loading.hidden = true;
  document.querySelector("#error").hidden = false;
  document.querySelector("#errorIcon").innerHTML = icon(
    shared ? "link" : "lockKeyhole",
  );
  document.querySelector("#errorTitle").textContent =
    e.status === 401 ? "请登录后打开" : "无法打开演示稿";
  document.querySelector("#errorMessage").textContent = e.message;
}
try {
  await loadSite();
  prefix = shared
    ? "/api/public/" + encodeURIComponent(parts[2] || parts[1])
    : "/api/decks/" +
      (await read("/api/resolve/" + encodeURIComponent(parts[1]))).id;
  const [meta, content, baseCSS, playerCSS, account] = await Promise.all([
    read(prefix + (shared ? "?view=1" : "")),
    read(
      revision
        ? prefix + "/revisions/" + encodeURIComponent(revision)
        : prefix + "/content",
    ),
    fetch("/static/player/base.css").then((r) => r.text()),
    fetch("/static/player/player.css").then((r) => r.text()),
    read("/api/session"),
  ]);
  if (shared && parts[2] && parts[1] !== meta.shareSlug)
    throw Object.assign(new Error("分享链接名称已更改，请使用新的链接"), {
      status: 404,
    });
  document.title = meta.title + " · " + site.name;
  setFavicon(meta.favicon || site.favicon);
  frame.addEventListener(
    "load",
    async () => {
      try {
        await frame.contentDocument.fonts.ready;
        frame.style.visibility = "hidden";
        frame.hidden = false;
        window.presentation = mountPresenter({
          window: frame.contentWindow,
          hostWindow: window,
          icons,
          deckId: revision ? `${meta.id}:revision:${revision}` : meta.id,
          width: meta.width,
          height: meta.height,
          onExit: shared
            ? null
            : () => {
                location.href = "/";
              },
          allowNotes: meta.allowNotes !== false,
          toastPosition: site.toastPosition,
          editURL:
            account.authenticated && !revision
              ? "/edit/" + encodeURIComponent(meta.slug)
              : null,
          presenterURL:
            account.authenticated && !shared && !revision
              ? "/presenter/" + encodeURIComponent(meta.slug)
              : null,
          downloadURL:
            shared && meta.allowDownload ? prefix + "/export?format=pdf" : null,
        });
        await frame.contentDocument.fonts.ready;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
        frame.style.visibility = "visible";
        loading.setAttribute("aria-hidden", "true");
        loading.classList.add("is-leaving");
        const dismissLoading = () => {
          loading.hidden = true;
        };
        if (matchMedia("(prefers-reduced-motion: reduce)").matches)
          dismissLoading();
        else {
          loading.addEventListener("transitionend", dismissLoading, {
            once: true,
          });
          setTimeout(dismissLoading, 220);
        }
        frame.contentDocument.querySelector("#stage").focus();
      } catch (e) {
        fail(e);
      }
    },
    { once: true },
  );
  frame.srcdoc = playerDocument({
    ...content,
    meta,
    baseURL: new URL(prefix + "/files/", location.origin).href,
    baseCSS,
    playerCSS,
  });
  if (shared) interval = setInterval(() => read(prefix).catch(fail), 15000);
} catch (e) {
  fail(e);
}
