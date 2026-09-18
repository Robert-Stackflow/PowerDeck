import { mountTimer } from "./timer.js";
import { createToast } from "../components/toast.js";
import { createLightbox } from "./lightbox.js";
import { wheelNavigation } from "../components/wheel-navigation.js";
export function mountPresenter({
  window,
  hostWindow = window,
  icons,
  deckId = "areal",
  width = 1600,
  height = 900,
  allowNotes = true,
  toastPosition = "bottom-center",
  onExit = null,
  editURL = null,
  presenterURL = null,
  downloadURL = null,
  syncHash = true,
  storage = hostWindow.localStorage,
}) {
  const document = window.document;
  document.documentElement.dataset.toastPosition = toastPosition;
  const toast = createToast(document.getElementById("toast"));
  const localStorage = storage;
  const location = hostWindow.location;
  const addEventListener = (type, fn, options) =>
    (["hashchange", "beforeunload"].includes(type)
      ? hostWindow
      : window
    ).addEventListener(type, fn, options);
  const getComputedStyle = window.getComputedStyle.bind(window);
  const matchMedia = window.matchMedia.bind(window);
  const requestAnimationFrame = window.requestAnimationFrame.bind(window);
  const $ = (id) => document.getElementById(id),
    pages = [...document.querySelectorAll(".slide")],
    total = pages.length;
  const data = JSON.parse(
      $("notesData").content?.textContent || $("notesData").textContent,
    ),
    NS = "http://www.w3.org/2000/svg";
  const linkURL = (node) => {
    try {
      const url = new URL(node?.getAttribute("data-editor-href"));
      return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol)
        ? url.href
        : null;
    } catch {
      return null;
    }
  };
  document.querySelectorAll("[data-editor-href]").forEach((node) => {
    if (linkURL(node)) {
      node.setAttribute("role", "link");
      node.setAttribute("tabindex", "0");
    }
  });

  const ico = (name, cls = "") => {
    const icon = icons[name];
    return `<svg class="lucide lucide-${icon.name} ${cls}" data-lucide="${icon.name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon.body}</svg>`;
  };
  const toolNames = {
    pointer: "普通指针",
    laser: "激光笔",
    pen: "画笔",
    highlighter: "荧光笔",
    eraser: "橡皮擦",
  };
  const toolKeys = {
    pointer: "V",
    laser: "L",
    pen: "P",
    highlighter: "H",
    eraser: "E",
  };
  const colors = [
    ["#ffffff", "白色"],
    ["#151515", "黑色"],
    ["#b51f28", "深红"],
    ["#ff3b30", "红色"],
    ["#ffbe00", "橙黄"],
    ["#fff000", "黄色"],
    ["#91d34b", "浅绿"],
    ["#00b750", "绿色"],
    ["#18bade", "青色"],
    ["#168dda", "蓝色"],
    ["#244a96", "深蓝"],
    ["#b632e7", "紫色"],
  ];
  let current = 1,
    tool = "pointer",
    lastPaint = "pen",
    hideTimer,
    saveTimer,
    drawing = null,
    touchStart = null,
    clickStart = null,
    imageClickTimer,
    dockPressed = false;
  const presenterChannel =
    presenterURL && typeof hostWindow.BroadcastChannel === "function"
      ? new hostWindow.BroadcastChannel(`powerdeck-presenter:${deckId}`)
      : null;
  let eatClickUntil = 0;
  let menuReturn = null,
    menuAnchor = null,
    trailAt = 0,
    saveFailed = false,
    cursorPoint = null;
  const inkColors = {
      pen: "#ff3b30",
      highlighter: "#fff000",
      laser: "#ff3b30",
    },
    widths = { pen: 4, highlighter: 26 };
  const STORE = `deck-library:ink:${deckId}:v1`,
    LEGACY_STORE = "areal-intern-presentation-ink-v1",
    annotations = {},
    histories = {};
  const inkKey = (n) => pages[n - 1].dataset.slideId || String(n);
  function cleanInk(raw, legacy = false) {
    if (!raw || typeof raw !== "object") return;
    for (let n = 1; n <= total; n++) {
      const entry = raw[legacy ? pages[n - 1].dataset.originalPage : inkKey(n)];
      if (Array.isArray(entry))
        annotations[n] = entry
          .slice(-400)
          .filter(
            (s) =>
              s &&
              ["pen", "highlighter"].includes(s.tool) &&
              /^#[\da-f]{6}$/i.test(s.color) &&
              Number.isFinite(s.width) &&
              Array.isArray(s.points),
          )
          .map((s) => ({
            tool: s.tool,
            color: s.color,
            width: Math.min(60, Math.max(1, s.width)),
            points: s.points
              .slice(0, 5000)
              .filter(
                (p) =>
                  Array.isArray(p) &&
                  p.length === 2 &&
                  p.every(Number.isFinite),
              )
              .map(([x, y]) => [
                Math.max(0, Math.min(width, x)),
                Math.max(0, Math.min(height, y)),
              ]),
          }))
          .filter((s) => s.points.length);
    }
  }
  try {
    const saved = localStorage.getItem(STORE);
    cleanInk(
      JSON.parse(
        saved ||
          (deckId === "areal"
            ? localStorage.getItem("areal-intern-presentation-ink-v2") ||
              localStorage.getItem(LEGACY_STORE)
            : null) ||
          "null",
      ),
      !saved && !localStorage.getItem("areal-intern-presentation-ink-v2"),
    );
  } catch {}
  const savedInk = () =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(annotations).map(([n, v]) => [inkKey(+n), v]),
      ),
    );
  const inks = () => annotations[current] || (annotations[current] = []);
  const history = () =>
    histories[current] || (histories[current] = { undo: [], redo: [] });
  const clone = (v) => JSON.parse(JSON.stringify(v));
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORE, savedInk());
      } catch {
        if (!saveFailed) {
          toast("浏览器限制本地保存，墨迹仅在本次打开期间保留");
          saveFailed = true;
        }
      }
    }, 120);
  }
  function checkpoint(before) {
    const h = history();
    h.undo.push(before);
    if (h.undo.length > 40) h.undo.shift();
    h.redo = [];
    persist();
    syncUI();
  }
  function undo() {
    finishDraw();
    const h = history();
    if (!h.undo.length) return;
    h.redo.push(clone(inks()));
    annotations[current] = h.undo.pop();
    renderInk();
    persist();
    syncUI();
  }
  function redo() {
    finishDraw();
    const h = history();
    if (!h.redo.length) return;
    h.undo.push(clone(inks()));
    annotations[current] = h.redo.pop();
    renderInk();
    persist();
    syncUI();
  }
  function clearInk() {
    finishDraw();
    if (!inks().length) return;
    const before = clone(inks());
    annotations[current] = [];
    checkpoint(before);
    renderInk();
  }
  function pathData(points) {
    if (points.length === 1) return `M${points[0][0]} ${points[0][1]}h.01`;
    return points
      .map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1))
      .join(" ");
  }
  function makePath(s) {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", pathData(s.points));
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", s.color);
    p.setAttribute("stroke-width", s.width);
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    if (s.tool === "highlighter") p.setAttribute("opacity", ".32");
    return p;
  }
  const layers = pages.map((s, i) => {
    const el = document.createElementNS(NS, "svg");
    el.setAttribute("class", "ink-layer");
    el.setAttribute("viewBox", `0 0 ${width} ${height}`);
    el.setAttribute("aria-hidden", "true");
    el.dataset.page = i + 1;
    s.append(el);
    return el;
  });
  function renderInk(n = current) {
    layers[n - 1].replaceChildren(...(annotations[n] || []).map(makePath));
  }
  for (let n = 1; n <= total; n++) renderInk(n);

  const dock = $("controls");
  const dockButton = (id, icon, label, extra = "") =>
    `<button id="${id}" type="button" aria-label="${label}" data-tip="${label}" ${extra}>${ico(icon)}</button>`;
  dock.innerHTML =
    dockButton("prev", "prev", "上一页 ←") +
    '<button id="counter" type="button" aria-label="跳转页面" data-tip="跳转页面 G">01 / ' +
    total +
    "</button>" +
    dockButton("next", "next", "下一页 →") +
    '<span class="nav-divider"></span>' +
    dockButton("pointerBtn", "pointer", "普通指针 V", 'aria-pressed="true"') +
    dockButton("laserBtn", "laser", "激光笔 L", 'aria-pressed="false"') +
    '<button id="inkBtn" type="button" aria-label="画笔与颜色" data-tip="画笔与颜色" aria-haspopup="menu" aria-expanded="false">' +
    ico("pen") +
    ico("down", "chevron") +
    "</button>" +
    dockButton("undoBtn", "undo", "撤销 ⌘Z") +
    '<span class="nav-divider"></span>' +
    dockButton("overviewBtn", "overview", "目录 G") +
    dockButton("notesBtn", "notes", "备注 N") +
    (presenterURL
      ? dockButton("presenterViewBtn", "presenter", "演讲者视图")
      : "") +
    (editURL ? dockButton("editBtn", "edit", "编辑当前页") : "") +
    dockButton("fullscreenBtn", "full", "全屏 F") +
    dockButton(
      "moreBtn",
      "more",
      "更多",
      'aria-haspopup="menu" aria-expanded="false"',
    );
  const ui = document.createElement("div");
  ui.id = "presenterUI";
  ui.innerHTML =
    '<button id="dockReveal" aria-label="显示演示工具"></button><div id="toolMenu" class="presenter-menu" role="menu" aria-label="指针与墨迹" hidden></div><div id="contextMenu" class="presenter-menu" role="menu" aria-label="演示菜单" hidden></div><div id="moreMenu" class="presenter-menu" role="menu" aria-label="更多操作" hidden></div><div id="laserDot"></div><div id="eraserCursor"></div>';
  document.body.append(ui);
  const fv = document.createElement("aside");
  fv.id = "figureViewer";
  fv.className = "overlay";
  fv.hidden = true;
  fv.setAttribute("role", "dialog");
  fv.setAttribute("aria-modal", "true");
  fv.setAttribute("aria-label", "图片详情");
  document.body.append(fv);
  const lightbox = createLightbox({
    element: fv,
    icon: ico,
    close: dismissPanel,
  });
  $("stage").tabIndex = -1;
  document
    .querySelectorAll(".dialog-close")
    .forEach((b) => (b.innerHTML = ico("close")));
  const panelTimers = new Map();
  let backdropTimer,
    panelReturn = null,
    figureReturn = null;
  const reduceMotion = () =>
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hoverPointer = matchMedia("(hover: hover) and (pointer: fine)");

  const panelOpen = () =>
    ["overview", "notes", "figureViewer", "timingPanel"].some(
      (id) => $(id) && !$(id).hidden,
    );
  const openMenu = () =>
    ["toolMenu", "contextMenu", "moreMenu"].map($).find((e) => !e.hidden);
  const menuRule = '<div class="menu-rule" role="separator"></div>';
  function row(
    action,
    label,
    icon,
    key = "",
    disabled = false,
    selected = false,
  ) {
    return `<button type="button" class="menu-row${selected ? " active" : ""}" role="${action.startsWith("tool:") ? "menuitemradio" : "menuitem"}" ${action.startsWith("tool:") ? `aria-checked="${selected}"` : ""} data-action="${action}" ${disabled ? "disabled" : ""}>${ico(icon)}<span>${label}</span>${key ? "<kbd>" + key + "</kbd>" : ""}</button>`;
  }
  function toolRows() {
    return Object.keys(toolNames)
      .map((t) =>
        row(
          "tool:" + t,
          toolNames[t],
          t,
          toolKeys[t],
          t === "eraser" && !inks().length,
          tool === t,
        ),
      )
      .join("");
  }
  function palette() {
    const colorTool = ["pen", "highlighter", "laser"].includes(tool)
      ? tool
      : lastPaint;
    return (
      '<div class="menu-colors" role="group" aria-label="墨迹颜色">' +
      colors
        .map(
          ([c, n]) =>
            `<button type="button" role="radio" aria-label="${n}" title="${n}" aria-checked="${inkColors[colorTool] === c}" data-color="${c}" style="background:${c};--contrast:${["#151515", "#b51f28", "#244a96"].includes(c) ? "#fff" : "#161616"}">${inkColors[colorTool] === c ? ico("check") : ""}</button>`,
        )
        .join("") +
      "</div>"
    );
  }
  function widthControl() {
    const t = tool === "highlighter" ? "highlighter" : "pen";
    return `<label class="menu-width">粗细<input id="strokeWidth" type="range" min="${t === "pen" ? 2 : 12}" max="${t === "pen" ? 12 : 44}" step="${t === "pen" ? 1 : 2}" value="${widths[t]}" aria-label="墨迹粗细"><output>${widths[t]}</output></label>`;
  }
  function fillMenus() {
    const canUndo = history().undo.length > 0,
      canRedo = history().redo.length > 0;
    const clear = row("clear", "擦除本页所有墨迹", "clear", "", !inks().length);
    $("toolMenu").innerHTML =
      toolRows() + menuRule + clear + palette() + widthControl();
    $("contextMenu").innerHTML =
      row("next", "下一页", "next", "→", current === total) +
      row("prev", "上一页", "prev", "←", current === 1) +
      row("overview", "跳转页面", "overview", "G") +
      menuRule +
      toolRows() +
      menuRule +
      clear +
      (["pen", "highlighter", "laser"].includes(tool) ? palette() : "") +
      '<div class="menu-undo">' +
      row("undo", "撤销", "undo", "⌘Z", !canUndo) +
      row("redo", "重做", "redo", "⇧⌘Z", !canRedo) +
      "</div>" +
      menuRule +
      (allowNotes ? row("notes", "备注", "notes", "N") : "") +
      row(
        "full",
        document.fullscreenElement ? "退出全屏" : "全屏",
        document.fullscreenElement ? "exitFull" : "full",
        "F",
      );
    $("moreMenu").innerHTML =
      (onExit ? row("exit", "返回演示库", "arrowLeft", "") + menuRule : "") +
      row("overview", "目录 / 跳转", "overview", "G") +
      (allowNotes ? row("notes", "备注", "notes", "N") : "") +
      (presenterURL ? row("presenter", "演讲者视图", "presenter", "") : "") +
      menuRule +
      row("undo", "撤销墨迹", "undo", "⌘Z", !canUndo) +
      row("redo", "重做墨迹", "redo", "⇧⌘Z", !canRedo) +
      clear +
      menuRule +
      (downloadURL ? row("download", "下载 PDF", "print") : "") +
      row("print", "打印 / 另存 PDF", "print");
  }
  function syncUI() {
    $("prev").disabled = current === 1;
    $("next").disabled = current === total;
    $("counter").textContent = String(current).padStart(2, "0") + " / " + total;
    $("pointerBtn").setAttribute("aria-pressed", tool === "pointer");
    $("laserBtn").setAttribute("aria-pressed", tool === "laser");
    $("inkBtn").setAttribute(
      "aria-pressed",
      ["pen", "highlighter", "eraser"].includes(tool),
    );
    $("inkBtn").innerHTML =
      ico(["pen", "highlighter", "eraser"].includes(tool) ? tool : lastPaint) +
      ico("down", "chevron");
    $("undoBtn").disabled = !history().undo.length;
    document.body.dataset.tool = tool;
    document.documentElement.style.setProperty(
      "--laser-color",
      inkColors.laser,
    );
    if (!drawing && openMenu()) fillMenus();
  }
  function showDock(delay = 1500) {
    if (openMenu()?.id === "contextMenu" || panelOpen()) return;
    document.body.classList.add("dock-visible");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideDock, delay);
  }
  function hideDock() {
    if (
      (openMenu() && openMenu().id !== "contextMenu") ||
      dockPressed ||
      (hoverPointer.matches && dock.matches(":hover")) ||
      dock.querySelector(":focus-visible")
    ) {
      showDock(1100);
      return;
    }
    document.body.classList.remove("dock-visible");
  }
  function hideCursors() {
    $("laserDot").classList.remove("visible");
    $("eraserCursor").classList.remove("visible");
  }
  function closeMenus(restore = false) {
    const was = openMenu();
    ["toolMenu", "contextMenu", "moreMenu"].forEach(
      (id) => ($(id).hidden = true),
    );
    $("inkBtn").setAttribute("aria-expanded", "false");
    $("moreBtn").setAttribute("aria-expanded", "false");
    document.body.classList.remove("menu-open", "context-open");
    if (was && restore)
      (menuReturn?.isConnected ? menuReturn : $("stage")).focus({
        preventScroll: true,
      });
    menuAnchor = null;
    if (was) requestAnimationFrame(() => updateToolCursor());
  }
  function placeMenu(el, x, y) {
    const r = el.getBoundingClientRect();
    el.style.left =
      Math.max(12, Math.min(x, window.innerWidth - r.width - 12)) + "px";
    el.style.top =
      Math.max(12, Math.min(y, window.innerHeight - r.height - 12)) + "px";
  }
  function showMenu(id, { x, y, anchor = null, keyboard = false } = {}) {
    finishDraw();
    const already = !$(id).hidden;
    closeMenus();
    if (already && anchor) return;
    fillMenus();
    const el = $(id);
    menuReturn = anchor || $("stage");
    menuAnchor = anchor;
    el.hidden = false;
    if (anchor) {
      const r = anchor.getBoundingClientRect();
      x = r.left - 20;
      y = r.top - el.getBoundingClientRect().height - 14;
    }
    placeMenu(el, x ?? window.innerWidth / 2, y ?? window.innerHeight / 2);
    document.body.classList.add("menu-open");
    hideCursors();
    document.querySelectorAll(".laser-trail").forEach((e) => e.remove());
    if (id === "contextMenu") {
      document.body.classList.add("context-open");
      clearTimeout(hideTimer);
      document.body.classList.remove("dock-visible");
    } else showDock(5000);
    if (id === "toolMenu") $("inkBtn").setAttribute("aria-expanded", "true");
    if (id === "moreMenu") $("moreBtn").setAttribute("aria-expanded", "true");
    if (keyboard)
      el.querySelector("button:not(:disabled)")?.focus({ preventScroll: true });
  }
  function closePanels(immediate = false) {
    for (const id of ["overview", "notes", "figureViewer", "timingPanel"]) {
      const el = $(id);
      clearTimeout(panelTimers.get(id));
      if (el.hidden) continue;
      el.inert = true;
      if (immediate || id === "figureViewer" || reduceMotion()) {
        el.hidden = true;
        el.classList.remove("closing");
      } else {
        el.classList.add("closing");
        panelTimers.set(
          id,
          setTimeout(() => {
            el.hidden = true;
            el.classList.remove("closing");
          }, 170),
        );
      }
    }
    document.body.classList.remove("panel-open");
    $("stage").inert = false;
    dock.inert = false;
    $("panelBackdrop").classList.remove("visible");
    clearTimeout(backdropTimer);
    if (immediate || reduceMotion()) $("panelBackdrop").hidden = true;
    else
      backdropTimer = setTimeout(() => ($("panelBackdrop").hidden = true), 180);
  }
  function openPanel(id) {
    if (id === "notes") renderNotes();
    finishDraw();
    closeMenus();
    hideCursors();
    panelReturn = document.activeElement;
    closePanels(true);
    const el = $(id);
    el.hidden = false;
    el.inert = false;
    el.classList.remove("closing");
    document.body.classList.add("panel-open");
    $("stage").inert = true;
    dock.inert = true;
    $("panelBackdrop").hidden = false;
    requestAnimationFrame(() => {
      if (!el.hidden && !el.classList.contains("closing"))
        $("panelBackdrop").classList.add("visible");
    });
    el.querySelector("button")?.focus({ preventScroll: true });
  }
  function dismissPanel() {
    if (!$("figureViewer").hidden && figureReturn) {
      const back = figureReturn;
      figureReturn = null;
      openPanel(back);
      return;
    }
    closePanels();
    (panelReturn?.isConnected && !panelReturn.closest(".overlay")
      ? panelReturn
      : $("stage")
    ).focus({ preventScroll: true });
  }
  function togglePanel(id) {
    if (id === "notes" && !allowNotes) return;
    const open = $(id).hidden || $(id).classList.contains("closing");
    if (open) openPanel(id);
    else dismissPanel();
    showDock();
  }
  $("panelBackdrop").addEventListener("click", dismissPanel);
  let notesPage = 0;
  function renderNotes() {
    if (!allowNotes || notesPage === current) return;
    notesPage = current;
    const d = data[current];
    $("notesTitle").textContent = "备注";
    $("notesBody").replaceChildren();
    const title = document.createElement("p");
    title.className = "note-slide-title";
    title.textContent = String(current).padStart(2, "0") + " · " + d.title;
    $("notesBody").append(title);
    const p = document.createElement("p");
    p.textContent = d.notes;
    $("notesBody").append(p);
    if (d.figures?.length) {
      const gallery = document.createElement("div");
      gallery.className = "note-figures";
      d.figures.forEach((f) => {
        const fig = document.createElement("figure");
        fig.className = "note-figure";
        const img = document.createElement("img");
        img.className = "zoomable";
        img.src = f.src;
        img.alt = f.title;
        img.tabIndex = 0;
        img.setAttribute("role", "button");
        img.setAttribute("aria-label", "放大查看：" + f.title);
        const cap = document.createElement("figcaption");
        cap.textContent = f.title;
        fig.append(img, cap);
        gallery.append(fig);
      });
      $("notesBody").append(gallery);
    }
    if (d.refs.length) {
      const h = document.createElement("h3");
      h.textContent = "参考资料";
      $("notesBody").append(h);
      d.refs.forEach(([t, u]) => {
        const a = document.createElement("a");
        a.textContent = t + " ";
        a.insertAdjacentHTML("beforeend", ico("external"));
        a.href = u;
        a.target = "_blank";
        a.rel = "noopener";
        $("notesBody").append(a);
      });
    }
  }
  const fromHash = () => {
    const n = Number(location.hash.slice(1));
    return Number.isFinite(n) && n >= 1 && n <= total ? Math.trunc(n) : 1;
  };
  pages.forEach((page) => page.setAttribute("aria-hidden", "true"));
  let prepareJob;
  function prepareNeighbors() {
    if (prepareJob) window.cancelIdleCallback?.(prepareJob);
    const run = () => {
      pages.forEach((page, index) => {
        const nearby = Math.abs(index - current + 1) === 1;
        page.classList.toggle("is-prepared", nearby);
        if (nearby)
          page
            .querySelectorAll("img")
            .forEach((img) => img.decode?.().catch(() => {}));
      });
    };
    if (window.requestIdleCallback)
      prepareJob = window.requestIdleCallback(run, { timeout: 300 });
    else requestAnimationFrame(run);
  }
  function go(n, hash = true) {
    clearTimeout(imageClickTimer);
    finishDraw();
    const next = Math.max(1, Math.min(total, Math.trunc(n)));
    if (next === current && pages[next - 1].classList.contains("active")) {
      if (hash) historyReplace(current);
      presenterChannel?.postMessage({ type: "state", current, total });
      return;
    }
    const previous = pages[current - 1];
    current = next;
    if (previous !== pages[current - 1]) {
      previous.classList.remove("active");
      previous.classList.remove("transition-enter");
      previous.setAttribute("aria-hidden", "true");
    }
    pages[current - 1].classList.add("active");
    pages[current - 1].classList.remove("transition-enter");
    if (pages[current - 1].dataset.transition !== "none") {
      void pages[current - 1].offsetWidth;
      pages[current - 1].classList.add("transition-enter");
    }
    pages[current - 1].classList.remove("is-prepared");
    pages[current - 1].setAttribute("aria-hidden", "false");
    closeMenus();
    hideCursors();
    syncUI();
    timer.go(current);
    $("progress").querySelector("i").style.width =
      (current / total) * 100 + "%";
    document
      .querySelectorAll(".toc-item")
      .forEach((b) =>
        b.classList.toggle("current", +b.dataset.goto === current),
      );
    if (hash) historyReplace(current);
    document.title = current + "/" + total + " · " + data[current].title;
    presenterChannel?.postMessage({ type: "state", current, total });
    if (!$("notes").hidden) renderNotes();
    prepareNeighbors();
    updateToolCursor();
  }
  function historyReplace(n) {
    if (!syncHash) return;
    hostWindow.history.replaceState(null, "", "#" + n);
  }
  function size() {
    document.documentElement.style.setProperty(
      "--scale",
      Math.min(window.innerWidth / width, window.innerHeight / height),
    );
    if (openMenu()) closeMenus();
    hideCursors();
  }
  async function full() {
    closeMenus();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (document.documentElement.requestFullscreen)
        await document.documentElement.requestFullscreen();
      else toast("请使用浏览器的全屏功能");
    } catch {
      toast("请使用浏览器的全屏功能");
    }
  }
  function setTool(t) {
    if (!Object.hasOwn(toolNames, t)) return;
    finishDraw();
    tool = t;
    if (t === "pen" || t === "highlighter") lastPaint = t;
    closeMenus();
    hideCursors();
    syncUI();
    $("stage").focus({ preventScroll: true });
    updateToolCursor();
  }
  function act(action) {
    if (action.startsWith("tool:")) {
      setTool(action.slice(5));
      return;
    }
    closeMenus();
    switch (action) {
      case "exit":
        onExit?.();
        break;
      case "next":
        go(current + 1);
        break;
      case "prev":
        go(current - 1);
        break;
      case "overview":
        togglePanel("overview");
        break;
      case "notes":
        togglePanel("notes");
        break;
      case "presenter":
        hostWindow.open(
          presenterURL + "#" + current,
          `powerdeck-presenter-${deckId}`,
          "popup=yes,width=1440,height=900",
        );
        break;
      case "full":
        full();
        break;
      case "undo":
        undo();
        break;
      case "redo":
        redo();
        break;
      case "clear":
        clearInk();
        break;
      case "print":
        finishDraw();
        closePanels();
        window.print();
        break;
      case "download":
        hostWindow.location.href = downloadURL;
        break;
    }
  }

  $("prev").onclick = () => go(current - 1);
  $("next").onclick = () => go(current + 1);
  $("counter").onclick = () => togglePanel("overview");
  $("pointerBtn").onclick = () => setTool("pointer");
  $("laserBtn").onclick = () => setTool(tool === "laser" ? "pointer" : "laser");
  $("inkBtn").onclick = (e) =>
    showMenu("toolMenu", { anchor: e.currentTarget, keyboard: e.detail === 0 });
  $("undoBtn").onclick = undo;
  $("overviewBtn").onclick = () => togglePanel("overview");
  $("notesBtn").onclick = () => togglePanel("notes");
  if ($("presenterViewBtn"))
    $("presenterViewBtn").onclick = () => act("presenter");
  if ($("editBtn"))
    $("editBtn").onclick = () => {
      hostWindow.location.href = editURL + "#" + current;
    };
  $("fullscreenBtn").onclick = full;
  $("moreBtn").onclick = (e) =>
    showMenu("moreMenu", { anchor: e.currentTarget, keyboard: e.detail === 0 });
  $("dockReveal").onclick = () => showDock(4000);
  $("dockReveal").onmouseenter = () => {
    if (hoverPointer.matches) showDock();
  };
  $("dockReveal").onfocus = () => showDock();
  dock.onmouseenter = () => {
    if (hoverPointer.matches) showDock();
  };
  dock.onmouseleave = () => {
    if (hoverPointer.matches) showDock(1100);
  };
  dock.onfocusin = () => showDock(4000);
  dock.addEventListener(
    "pointerdown",
    () => {
      dockPressed = true;
      showDock(5000);
    },
    true,
  );
  const releaseDock = () => {
    if (!dockPressed) return;
    dockPressed = false;
    showDock(4000);
  };
  dock.addEventListener("pointerup", releaseDock, true);
  dock.addEventListener("pointercancel", releaseDock, true);
  for (const el of document.querySelectorAll(".presenter-menu")) {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const btn = e.target.closest("button");
      if (!btn || btn.disabled) return;
      if (btn.dataset.action) act(btn.dataset.action);
      else if (btn.dataset.color) {
        const t = ["pen", "highlighter", "laser"].includes(tool)
          ? tool
          : lastPaint;
        inkColors[t] = btn.dataset.color;
        if (tool === "pointer" || tool === "eraser") setTool(t);
        else {
          syncUI();
          closeMenus();
          $("stage").focus({ preventScroll: true });
        }
        if (el.id !== "contextMenu") showDock();
      }
    });
    el.addEventListener("input", (e) => {
      if (e.target.type === "range") {
        const t = tool === "highlighter" ? "highlighter" : "pen";
        widths[t] = +e.target.value;
        e.target.nextElementSibling.textContent = e.target.value;
      }
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        const controls = [
            ...el.querySelectorAll(
              "button:not(:disabled),input:not(:disabled)",
            ),
          ],
          index = controls.indexOf(document.activeElement);
        e.preventDefault();
        controls[
          (index + (e.shiftKey ? -1 : 1) + controls.length) % controls.length
        ]?.focus();
        return;
      }
      if (e.target.type === "range") return;
      const buttons = [...el.querySelectorAll("button:not(:disabled)")];
      let index = buttons.indexOf(document.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        index =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? buttons.length - 1
              : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                buttons.length;
        buttons[index]?.focus();
      }
    });
  }
  // A dismissal click closes the menu without also turning a slide or drawing.
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (openMenu() && !e.target.closest(".presenter-menu,#inkBtn,#moreBtn")) {
        closeMenus();
        eatClickUntil = performance.now() + 400;
        e.preventDefault();
      }
    },
    true,
  );
  $("stage").addEventListener("contextmenu", (e) => {
    if (panelOpen()) return;
    e.preventDefault();
    cursorPoint = { clientX: e.clientX, clientY: e.clientY };
    finishDraw();
    showMenu("contextMenu", { x: e.clientX, y: e.clientY });
  });
  for (const el of document.querySelectorAll(".presenter-menu"))
    el.addEventListener("contextmenu", (e) => e.preventDefault());

  function slidePoint(e) {
    const r = $("deck").getBoundingClientRect();
    return [
      ((e.clientX - r.left) * width) / r.width,
      ((e.clientY - r.top) * height) / r.height,
    ];
  }
  const inside = (p) =>
    p[0] >= 0 && p[0] <= width && p[1] >= 0 && p[1] <= height;
  const clamped = (p) => [
    Math.max(0, Math.min(width, p[0])),
    Math.max(0, Math.min(height, p[1])),
  ];
  function distance(p, a, b) {
    const x = b[0] - a[0],
      y = b[1] - a[1],
      q = x * x + y * y;
    if (!q) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * x + (p[1] - a[1]) * y) / q),
    );
    return Math.hypot(p[0] - a[0] - t * x, p[1] - a[1] - t * y);
  }
  function eraseAt(pt) {
    let changed = false;
    annotations[current] = inks().filter((s) => {
      const radius = 16 + s.width / 2;
      const hit =
        s.points.length === 1
          ? distance(pt, s.points[0], s.points[0]) < radius
          : s.points.some(
              (q, i) => i && distance(pt, s.points[i - 1], q) < radius,
            );
      if (hit) changed = true;
      return !hit;
    });
    if (changed) {
      drawing.changed = true;
      renderInk();
    }
  }
  function finishDraw(cancel = false) {
    if (!drawing) return;
    const d = drawing;
    drawing = null;
    if (cancel) {
      annotations[current] = d.before;
      renderInk();
    } else if (d.changed) {
      checkpoint(d.before);
    }
    eatClickUntil = performance.now() + 350;
    try {
      if ($("stage").hasPointerCapture(d.id))
        $("stage").releasePointerCapture(d.id);
    } catch {}
    syncUI();
  }
  $("stage").addEventListener("pointerdown", (e) => {
    if (
      e.button !== 0 ||
      !e.isPrimary ||
      panelOpen() ||
      openMenu() ||
      performance.now() < eatClickUntil
    )
      return;
    cursorPoint = { clientX: e.clientX, clientY: e.clientY };
    const pt = slidePoint(e);
    if (!inside(pt)) {
      clickStart = null;
      return;
    }
    clickStart = { x: e.clientX, y: e.clientY };
    if (e.pointerType === "touch" && ["pointer", "laser"].includes(tool))
      touchStart = { x: e.clientX, y: e.clientY };
    if (!["pen", "highlighter", "eraser"].includes(tool)) return;
    e.preventDefault();
    const before = clone(inks());
    drawing = { id: e.pointerId, before, changed: false };
    $("stage").setPointerCapture(e.pointerId);
    if (tool === "eraser") eraseAt(pt);
    else {
      const s = {
        tool,
        color: inkColors[tool],
        width: widths[tool],
        points: [pt],
      };
      inks().push(s);
      drawing.stroke = s;
      drawing.path = makePath(s);
      layers[current - 1].append(drawing.path);
      drawing.changed = true;
    }
  });
  $("stage").addEventListener("pointermove", (e) => {
    if (!drawing || e.pointerId !== drawing.id) return;
    e.preventDefault();
    for (const event of e.getCoalescedEvents?.().length
      ? e.getCoalescedEvents()
      : [e]) {
      const pt = clamped(slidePoint(event));
      if (tool === "eraser") {
        eraseAt(pt);
        continue;
      }
      const s = drawing.stroke,
        last = s.points.at(-1);
      if (
        Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= 1.3 &&
        s.points.length < 5000
      )
        s.points.push(pt);
    }
    if (drawing.path)
      drawing.path.setAttribute("d", pathData(drawing.stroke.points));
  });
  $("stage").addEventListener("pointerup", (e) => {
    if (drawing && e.pointerId === drawing.id) {
      finishDraw();
      return;
    }
    if (touchStart) {
      const dx = e.clientX - touchStart.x,
        dy = e.clientY - touchStart.y;
      touchStart = null;
      if (
        Math.abs(dx) > 65 &&
        Math.abs(dx) > Math.abs(dy) * 1.25 &&
        !panelOpen() &&
        !openMenu()
      ) {
        go(current + (dx < 0 ? 1 : -1));
        eatClickUntil = performance.now() + 500;
      }
    }
  });
  $("stage").addEventListener("pointercancel", () => {
    finishDraw(true);
    touchStart = null;
    clickStart = null;
  });
  $("stage").addEventListener("lostpointercapture", () => {
    if (drawing) finishDraw();
  });
  $("stage").addEventListener("click", (e) => {
    const linked = e.target.closest("[data-editor-href]");
    if (linked && tool === "pointer" && !panelOpen() && !openMenu()) {
      e.preventDefault();
      const href = linkURL(linked);
      if (
        href &&
        performance.now() >= eatClickUntil &&
        e.button === 0 &&
        e.detail <= 1
      )
        hostWindow.open(href, "_blank", "noopener,noreferrer");
      return;
    }
    if (
      !["pointer", "laser"].includes(tool) ||
      panelOpen() ||
      openMenu() ||
      performance.now() < eatClickUntil ||
      e.button !== 0 ||
      e.target.closest("button,input") ||
      (tool === "pointer" && e.target.closest("a"))
    )
      return;
    if (
      clickStart &&
      Math.hypot(e.clientX - clickStart.x, e.clientY - clickStart.y) > 9
    )
      return;
    e.preventDefault();
    const inDockRevealZone =
      e.clientX >= window.innerWidth * 0.3 &&
      e.clientX <= window.innerWidth * 0.7;
    if (inDockRevealZone) {
      showDock(4000);
      return;
    }
    const nextPage =
      current + (e.shiftKey || e.clientX < window.innerWidth / 2 ? -1 : 1);
    if (e.target.closest(".zoomable")) {
      if (e.detail > 1) return;
      clearTimeout(imageClickTimer);
      imageClickTimer = setTimeout(() => go(nextPage), 240);
    } else go(nextPage);
  });
  const wheelStep = wheelNavigation((direction) => go(current + direction));
  $("stage").addEventListener(
    "wheel",
    (event) => {
      if (panelOpen() || openMenu() || drawing) return;
      if (wheelStep(event)) event.preventDefault();
    },
    { passive: false },
  );

  function updateToolCursor(point = cursorPoint, trail = false) {
    if (!point) {
      hideCursors();
      return;
    }
    const target = document.elementFromPoint(point.clientX, point.clientY);
    const active =
      document.hasFocus() &&
      !panelOpen() &&
      !openMenu() &&
      target?.closest("#stage") &&
      inside(slidePoint(point));
    if (tool === "laser" && active) {
      const dot = $("laserDot");
      dot.style.left = point.clientX + "px";
      dot.style.top = point.clientY + "px";
      dot.classList.add("visible");
      if (trail && performance.now() - trailAt > 24 && !reduceMotion()) {
        trailAt = performance.now();
        const t = document.createElement("i");
        t.className = "laser-trail";
        t.style.left = point.clientX + "px";
        t.style.top = point.clientY + "px";
        document.body.append(t);
        setTimeout(() => t.remove(), 400);
      }
    } else $("laserDot").classList.remove("visible");
    if (tool === "eraser" && active) {
      const c = $("eraserCursor");
      c.style.left = point.clientX + "px";
      c.style.top = point.clientY + "px";
      c.classList.add("visible");
    } else $("eraserCursor").classList.remove("visible");
  }
  addEventListener("pointermove", (e) => {
    cursorPoint = { clientX: e.clientX, clientY: e.clientY };
    if (e.clientY > window.innerHeight - 110 && !drawing && !openMenu())
      showDock();
    updateToolCursor(cursorPoint, true);
  });
  addEventListener("blur", () => {
    cursorPoint = null;
    finishDraw();
    hideCursors();
    closeMenus();
  });
  document.addEventListener("pointerleave", () => {
    cursorPoint = null;
    hideCursors();
  });

  addEventListener("keydown", (e) => {
    const input = e.target.closest('input,textarea,[contenteditable="true"]');
    if (
      e.key === "Enter" &&
      tool === "pointer" &&
      !panelOpen() &&
      !openMenu()
    ) {
      const href = linkURL(e.target.closest("[data-editor-href]"));
      if (href) {
        e.preventDefault();
        hostWindow.open(href, "_blank", "noopener,noreferrer");
        return;
      }
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (openMenu()) {
        closeMenus(true);
        return;
      }
      if (panelOpen()) {
        dismissPanel();
        return;
      }
      if (drawing) finishDraw(true);
      if (tool !== "pointer") setTool("pointer");
      else showDock();
      return;
    }
    if (e.key === "Tab" && panelOpen()) {
      const panel = ["figureViewer", "notes", "overview", "timingPanel"]
        .map($)
        .find((el) => !el.hidden && !el.classList.contains("closing"));
      if (panel) {
        const items = [
            ...panel.querySelectorAll('button,a[href],[tabindex="0"]'),
          ].filter((el) => !el.disabled),
          first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
      return;
    }
    if (input) return;
    if (
      (e.ctrlKey || e.metaKey) &&
      e.key.toLowerCase() === "z" &&
      !panelOpen()
    ) {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
      e.preventDefault();
      showMenu("contextMenu", {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
        keyboard: true,
      });
      return;
    }
    if (openMenu() || panelOpen()) return;
    if (e.target.tagName === "BUTTON" && [" ", "Enter"].includes(e.key)) return;
    const k = e.key.toLowerCase();
    if (drawing) return;
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(e.key)) {
      e.preventDefault();
      go(current + 1);
    } else if (["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key)) {
      e.preventDefault();
      go(current - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      go(1);
    } else if (e.key === "End") {
      e.preventDefault();
      go(total);
    } else if (k === "f") {
      e.preventDefault();
      full();
    } else if (k === "g") {
      e.preventDefault();
      togglePanel("overview");
    } else if (k === "n") {
      e.preventDefault();
      togglePanel("notes");
    } else {
      const t = Object.keys(toolKeys).find(
        (t) => toolKeys[t].toLowerCase() === k,
      );
      if (t) {
        e.preventDefault();
        setTool(t);
      }
    }
  });
  const timer = mountTimer({
    document,
    hostWindow,
    storage,
    deckId,
    pages,
    notes: data,
    icon: ico,
    openPanel,
    toast,
  });
  if (presenterChannel)
    presenterChannel.onmessage = ({ data: message }) => {
      if (message?.type === "request")
        presenterChannel.postMessage({ type: "state", current, total });
      if (message?.type === "go") go(message.page);
      if (message?.type === "next") go(current + 1);
      if (message?.type === "prev") go(current - 1);
    };
  document.querySelectorAll("[data-close]").forEach(
    (b) =>
      (b.onclick = () => {
        dismissPanel();
        showDock();
      }),
  );
  document.querySelectorAll("[data-goto]").forEach(
    (b) =>
      (b.onclick = () => {
        go(+b.dataset.goto);
        closePanels();
        $("stage").focus({ preventScroll: true });
      }),
  );
  document.querySelectorAll(".slide img").forEach((img) => {
    if (img.closest(".corner-brand,footer,.brand,a,[data-editor-href]")) return;
    img.classList.add("zoomable");
    img.tabIndex = 0;
    img.setAttribute("role", "button");
    img.setAttribute("aria-label", "双击查看图片：" + (img.alt || "图片"));
  });
  function showFigure(img) {
    if (
      (!["pointer", "laser"].includes(tool) && !img.closest("#notes")) ||
      performance.now() < eatClickUntil
    )
      return;
    clearTimeout(imageClickTimer);
    figureReturn = img.closest("#notes") ? "notes" : null;
    openPanel("figureViewer");
    lightbox.open(img);
  }
  document.addEventListener("dblclick", (e) => {
    const img = e.target.closest(".zoomable");
    if (img) {
      e.preventDefault();
      e.stopPropagation();
      showFigure(img);
    }
  });
  document.addEventListener("keydown", (e) => {
    const img = e.target.closest(".zoomable");
    if (img && e.key === "Enter") {
      e.preventDefault();
      showFigure(img);
    }
  });
  addEventListener("resize", size);
  addEventListener("hashchange", () => go(fromHash(), false));
  addEventListener("fullscreenchange", () => {
    const name = document.fullscreenElement ? "退出全屏 F" : "全屏 F";
    $("fullscreenBtn").setAttribute("aria-label", name);
    $("fullscreenBtn").dataset.tip = name;
    $("fullscreenBtn").innerHTML = ico(
      document.fullscreenElement ? "exitFull" : "full",
    );
    size();
  });
  addEventListener("beforeunload", () => {
    finishDraw();
    try {
      localStorage.setItem(STORE, savedInk());
    } catch {}
    presenterChannel?.close();
  });
  if (!allowNotes) $("notesBtn").hidden = true;
  size();
  go(fromHash());
  showDock(3500);
  window.presentation = {
    go,
    get current() {
      return current;
    },
    count: total,
    setTool,
    get tool() {
      return tool;
    },
    undo,
    redo,
    clearInk,
    get strokeCount() {
      return inks().length;
    },
  };
  return window.presentation;
}
