import { visualDocument } from "./document.js";

// A viewport-sized frame: offscreen slides are cached as detached DOM, never painted.
export function createThumbnails(container, options) {
  const inner = document.createElement("div"),
    frame = document.createElement("iframe");
  inner.className = "slide-list-inner";
  frame.className = "thumbnail-sheet";
  frame.title = "页面缩略图";
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  container.append(inner);
  container.parentElement.append(frame);
  const entries = new Map(),
    pending = new Set();
  let doc,
    sheet,
    currentList = [],
    selected = 0,
    scheduled = 0,
    idle = 0,
    destroyed = false;
  const enqueue =
    window.requestIdleCallback?.bind(window) ||
    ((fn) => setTimeout(() => fn({ timeRemaining: () => 5 }), 0));
  const cancelIdle = window.cancelIdleCallback?.bind(window) || clearTimeout;
  function hydrate(entry) {
    if (!entry.scene || entry.html === entry.pendingHTML) return;
    entry.scene.innerHTML = entry.pendingHTML;
    entry.html = entry.pendingHTML;
  }
  function drain(deadline) {
    idle = 0;
    if (destroyed || !sheet) return;
    const start = performance.now();
    for (const entry of pending) {
      pending.delete(entry);
      hydrate(entry);
      if (deadline.timeRemaining() < 2 || performance.now() - start > 5) break;
    }
    if (pending.size) idle = enqueue(drain, { timeout: 120 });
  }
  function paint() {
    scheduled = 0;
    if (!sheet || destroyed) return;
    const scroll = container.scrollTop,
      height = container.clientHeight;
    for (const entry of entries.values()) {
      if (!entry.scene || !entry.box) continue;
      const y = entry.box.top - scroll;
      const nearby = y + entry.box.height >= -240 && y <= height + 240;
      if (!nearby) {
        entry.scene.remove();
        pending.delete(entry);
        continue;
      }
      entry.scene.style.transform = `translate(${entry.box.left}px,${y}px)`;
      if (!entry.scene.isConnected) sheet.append(entry.scene);
      if (entry.html !== entry.pendingHTML) pending.add(entry);
    }
    if (pending.size && !idle) idle = enqueue(drain, { timeout: 120 });
  }
  function schedulePaint() {
    if (!scheduled) scheduled = requestAnimationFrame(paint);
  }
  function layout() {
    if (!sheet || destroyed) return;
    const origin = container.getBoundingClientRect(),
      scroll = container.scrollTop;
    // Read all geometry before writing; scrolling only uses these cached positions.
    const boxes = currentList.map((page) => {
      const entry = entries.get(page.id),
        r = entry.preview.getBoundingClientRect();
      return {
        entry,
        box: {
          left: r.left - origin.left + 1,
          top: r.top - origin.top + scroll + 1,
          width: r.width - 2,
          height: r.height - 2,
        },
      };
    });
    frame.style.width = container.clientWidth + "px";
    frame.style.height = container.clientHeight + "px";
    for (const { entry, box } of boxes) {
      entry.box = box;
      if (!entry.scene) continue;
      entry.scene.style.width = box.width + "px";
      entry.scene.style.height = box.height + "px";
      entry.scene.style.setProperty(
        "--thumbnail-scale",
        box.width / options.width,
      );
    }
    schedulePaint();
  }
  function render(list, index) {
    currentList = list;
    selected = index;
    const keys = new Set(list.map((page) => page.id));
    for (const [key, entry] of entries)
      if (!keys.has(key)) {
        entry.button.remove();
        entry.scene?.remove();
        pending.delete(entry);
        entries.delete(key);
      }
    list.forEach((page, i) => {
      let entry = entries.get(page.id);
      if (!entry) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "slide-thumb";
        button.innerHTML =
          '<span class="slide-thumb-number"></span><span class="slide-thumb-content"><span class="slide-thumb-preview"></span></span>';
        entry = {
          button,
          preview: button.querySelector(".slide-thumb-preview"),
          number: button.querySelector(".slide-thumb-number"),
          html: null,
        };
        entry.preview.style.aspectRatio = `${options.width} / ${options.height}`;
        entries.set(page.id, entry);
      }
      if (inner.children[i] !== entry.button)
        inner.insertBefore(entry.button, inner.children[i] || null);
      entry.button.dataset.pageIndex = i;
      entry.button.dataset.slideKey = page.id;
      entry.button.setAttribute("aria-label", `第 ${i + 1} 页：${page.title}`);
      entry.button.setAttribute("aria-current", i === index ? "page" : "false");
      entry.number.textContent = i + 1;
      if (sheet && !entry.scene) {
        entry.scene = doc.createElement("div");
        entry.scene.className = "thumbnail-scene";
      }
      entry.pendingHTML = page.html;
    });
    layout();
  }
  function load(css) {
    doc = sheet = null;
    pending.clear();
    cancelIdle(idle);
    idle = 0;
    for (const entry of entries.values()) {
      entry.scene = null;
      entry.html = null;
    }
    frame.onload = () => {
      if (destroyed || !frame.contentDocument?.querySelector("#deck")) return;
      doc = frame.contentDocument;
      doc.body.innerHTML = '<div id="thumbnailSheet"></div>';
      sheet = doc.querySelector("#thumbnailSheet");
      const style = doc.createElement("style");
      style.textContent = `html,body{background:transparent!important;overflow:hidden!important}#thumbnailSheet{position:relative;width:100%;height:100%;contain:strict}.thumbnail-scene{position:absolute;left:0;top:0;overflow:hidden;border-radius:7px;contain:strict;pointer-events:none}.thumbnail-scene>.slide{position:absolute!important;inset:0!important;display:block!important;width:${options.width}px!important;height:${options.height}px!important;transform:scale(var(--thumbnail-scale))!important;transform-origin:0 0!important}*{animation:none!important;transition:none!important}`;
      doc.head.append(style);
      render(currentList, selected);
      doc.fonts.ready.then(layout);
    };
    frame.srcdoc = visualDocument({
      ...options,
      html: "",
      css,
      thumbnail: true,
    });
  }
  const observer = new ResizeObserver(layout);
  observer.observe(container);
  container.addEventListener("scroll", schedulePaint, { passive: true });
  load(options.css);
  return {
    render,
    load,
    destroy() {
      destroyed = true;
      observer.disconnect();
      cancelAnimationFrame(scheduled);
      cancelIdle(idle);
      container.removeEventListener("scroll", schedulePaint);
      frame.remove();
      entries.clear();
      pending.clear();
    },
  };
}
