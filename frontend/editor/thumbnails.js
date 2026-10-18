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
    scrolling = false,
    settleTimer = 0,
    resumeFrame = 0,
    destroyed = false;
  const enqueue =
    window.requestIdleCallback?.bind(window) ||
    ((fn) => setTimeout(() => fn({ timeRemaining: () => 5 }), 0));
  const cancelIdle = window.cancelIdleCallback?.bind(window) || clearTimeout;
  function hydrate(entry) {
    if (!entry.scene || entry.html === entry.pendingHTML) return;
    const template = doc.createElement("template");
    template.innerHTML = entry.pendingHTML;
    template.content.querySelectorAll("img").forEach((image) => {
      image.fetchPriority = "low";
      image.decoding = "async";
    });
    entry.scene.replaceChildren(template.content);
    entry.html = entry.pendingHTML;
  }
  function drain(deadline) {
    idle = 0;
    if (destroyed || !sheet || scrolling) return;
    if (!deadline.didTimeout && deadline.timeRemaining() < 3) {
      idle = enqueue(drain);
      return;
    }
    for (const entry of pending) {
      pending.delete(entry);
      if (!entry.scene?.isConnected) continue;
      hydrate(entry);
      // HTML parsing is only part of the cost. Give style/layout/paint for this
      // one slide a frame of their own before hydrating another complex slide.
      break;
    }
    if (pending.size)
      resumeFrame = requestAnimationFrame(() => {
        resumeFrame = 0;
        if (!scrolling && !destroyed) idle = enqueue(drain);
      });
  }
  function paint() {
    scheduled = 0;
    if (!sheet || destroyed) return;
    const scroll = container.scrollTop,
      height = container.clientHeight;
    // One composited translation, not a transform write for every thumbnail.
    sheet.style.transform = `translate3d(0,${-scroll}px,0)`;
    if (scrolling) return;
    for (const entry of entries.values()) {
      if (!entry.scene || !entry.box) continue;
      const y = entry.box.top - scroll;
      const nearby = y + entry.box.height >= -320 && y <= height + 320;
      if (!nearby) {
        if (entry.scene.isConnected) entry.scene.remove();
        pending.delete(entry);
        continue;
      }
      if (!entry.scene.isConnected) sheet.append(entry.scene);
      if (entry.html !== entry.pendingHTML) pending.add(entry);
    }
    if (pending.size && !idle && !resumeFrame) idle = enqueue(drain);
  }
  function onScroll() {
    scrolling = true;
    cancelIdle(idle);
    idle = 0;
    cancelAnimationFrame(resumeFrame);
    resumeFrame = 0;
    clearTimeout(settleTimer);
    schedulePaint();
    settleTimer = setTimeout(finishScroll, 100);
  }
  function finishScroll() {
    clearTimeout(settleTimer);
    if (destroyed) return;
    scrolling = false;
    schedulePaint();
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
    sheet.style.height = container.scrollHeight + "px";
    for (const { entry, box } of boxes) {
      entry.box = box;
      if (!entry.scene) continue;
      entry.scene.style.transform = `translate(${box.left}px,${box.top}px)`;
      entry.scene.style.width = box.width + "px";
      entry.scene.style.height = box.height + "px";
      entry.scene.style.setProperty(
        "--thumbnail-scale",
        box.width / options.width,
      );
    }
    schedulePaint();
  }
  function revealSelected() {
    const button = entries.get(currentList[selected]?.id)?.button;
    if (!button) return;
    const box = button.getBoundingClientRect(),
      viewport = container.getBoundingClientRect();
    if (box.top < viewport.top + 8)
      container.scrollTop += box.top - viewport.top - 8;
    else if (box.bottom > viewport.bottom - 8)
      container.scrollTop += box.bottom - viewport.bottom + 8;
    schedulePaint();
  }
  function render(list, index) {
    const previous = currentList[selected]?.id,
      changedPage = previous !== list[index]?.id,
      sameContent =
        list.length === currentList.length &&
        list.every(
          (page, i) =>
            page.id === currentList[i].id &&
            page.html === currentList[i].html &&
            page.title === currentList[i].title,
        ),
      sameOrder =
        list.length === currentList.length &&
        list.every((page, i) => page.id === currentList[i].id);
    currentList = list;
    selected = index;
    if (
      sameContent &&
      (!sheet || list.every((page) => entries.get(page.id)?.scene))
    ) {
      if (changedPage) {
        entries.get(previous)?.button.setAttribute("aria-current", "false");
        entries
          .get(list[index]?.id)
          ?.button.setAttribute("aria-current", "page");
        revealSelected();
      }
      return;
    }
    let needsLayout = !sameOrder;
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
        needsLayout = true;
        entry.scene = doc.createElement("div");
        entry.scene.className = "thumbnail-scene";
      }
      entry.pendingHTML = page.html;
    });
    if (needsLayout) layout();
    else schedulePaint();
    if (changedPage) revealSelected();
  }
  function load(css) {
    doc = sheet = null;
    pending.clear();
    clearTimeout(settleTimer);
    scrolling = false;
    cancelAnimationFrame(resumeFrame);
    resumeFrame = 0;
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
      style.textContent = `html,body{background:transparent!important;overflow:hidden!important}#thumbnailSheet{position:relative;width:100%;contain:strict;will-change:transform}.thumbnail-scene{position:absolute;left:0;top:0;overflow:hidden;border-radius:7px;contain:strict;pointer-events:none}.thumbnail-scene>.slide{position:absolute!important;inset:0!important;display:block!important;width:${options.width}px!important;height:${options.height}px!important;transform:scale(var(--thumbnail-scale))!important;transform-origin:0 0!important}*{animation:none!important;transition:none!important}`;
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
  container.addEventListener("scroll", onScroll, { passive: true });
  load(options.css);
  return {
    render,
    load,
    destroy() {
      destroyed = true;
      observer.disconnect();
      cancelAnimationFrame(scheduled);
      cancelIdle(idle);
      clearTimeout(settleTimer);
      cancelAnimationFrame(resumeFrame);
      container.removeEventListener("scroll", onScroll);
      frame.remove();
      entries.clear();
      pending.clear();
    },
  };
}
