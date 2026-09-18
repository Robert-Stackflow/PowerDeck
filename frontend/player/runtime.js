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
  sessionControls = null,
  downloadURL = null,
  saveNote = null,
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
    dockPressed = false,
    dockTouch = null,
    remoteSession = null,
    audienceSession = null,
    remoteInterval = 0,
    audienceInterval = 0,
    lastRemoteCommand = 0,
    remoteBusy = false;
  const sessionRequest = async (path, options = {}) => {
    const response = await hostWindow.fetch("/api" + path, {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(sessionControls?.csrf
          ? { "X-CSRF-Token": sessionControls.csrf }
          : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      ...(options.keepalive ? { keepalive: true } : {}),
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.error || "请求失败");
    return value;
  };
  const escapeHTML = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
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
  const sessionToolsMarkup = presenterURL
    ? `<span class="nav-divider session-divider" aria-hidden="true"></span><div class="session-control-group" role="group" aria-label="演讲辅助">${dockButton("presenterViewBtn", "presenter", "演讲者视图")}${dockButton("remoteControlBtn", "smartphone", "手机遥控")}${dockButton("audienceBtn", "audience", "观众互动")}</div>`
    : "";
  dock.innerHTML =
    '<div id="dockTools" class="dock-tools">' +
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
    (editURL ? dockButton("editBtn", "edit", "编辑当前页") : "") +
    dockButton("fullscreenBtn", "full", "全屏 F") +
    dockButton(
      "moreBtn",
      "more",
      "更多",
      'aria-haspopup="menu" aria-expanded="false"',
    ) +
    "</div>" +
    sessionToolsMarkup;
  const ui = document.createElement("div");
  ui.id = "presenterUI";
  ui.innerHTML =
    '<button id="dockReveal" aria-label="显示演示工具"></button><div id="toolMenu" class="presenter-menu" role="menu" aria-label="指针与墨迹" hidden></div><div id="contextMenu" class="presenter-menu" role="menu" aria-label="演示菜单" hidden></div><div id="moreMenu" class="presenter-menu" role="menu" aria-label="更多操作" hidden></div><div id="laserDot"></div><div id="eraserCursor"></div>' +
    (presenterURL
      ? `<section id="remoteControlPanel" class="overlay session-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="remoteControlTitle"><div class="session-dialog-card remote-session-card"><div class="overlay-head"><div><p class="session-kicker">演讲辅助</p><h2 id="remoteControlTitle">手机遥控</h2><span>扫码连接后即可控制演示</span></div><button class="dialog-close" type="button" data-close="remoteControlPanel" aria-label="关闭手机遥控">${ico("close")}</button></div><div id="remoteSessionBody" class="session-loading">正在创建遥控会话…</div></div></section><section id="audiencePanel" class="overlay session-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="audienceTitle"><div class="session-dialog-card audience-session-card"><div class="overlay-head"><div><p class="session-kicker">现场互动</p><h2 id="audienceTitle">观众互动</h2><span>提问、投票、评分</span></div><button class="dialog-close" type="button" data-close="audiencePanel" aria-label="关闭观众互动">${ico("close")}</button></div><div id="audienceSetup" class="audience-session-setup"><button id="startAudience" type="button">开启观众互动</button></div><div id="audienceDashboard" hidden></div></div></section>`
      : "");
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
    [
      "overview",
      "notes",
      "figureViewer",
      "timingPanel",
      "remoteControlPanel",
      "audiencePanel",
    ].some((id) => $(id) && !$(id).hidden);
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
      (presenterURL ? row("remote", "手机遥控", "smartphone", "") : "") +
      (presenterURL ? row("audience", "观众互动", "audience", "") : "") +
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
    for (const id of [
      "overview",
      "notes",
      "figureViewer",
      "timingPanel",
      "remoteControlPanel",
      "audiencePanel",
    ]) {
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
    hostWindow.setTimeout(() => showDock(4000), reduceMotion() ? 0 : 190);
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
    const d =
      data[current] ||
      (data[current] = {
        title: `第 ${current} 页`,
        notes: "",
        refs: [],
        figures: [],
      });
    $("notesTitle").textContent = "备注";
    $("notesBody").replaceChildren();
    const title = document.createElement("p");
    title.className = "note-slide-title";
    title.textContent = String(current).padStart(2, "0") + " · " + d.title;
    $("notesBody").append(title);
    if (saveNote) {
      const editor = document.createElement("div"),
        textarea = document.createElement("textarea"),
        actions = document.createElement("div"),
        status = document.createElement("span"),
        button = document.createElement("button");
      let saving = false;
      editor.className = "note-editor";
      textarea.value = d.notes || "";
      textarea.maxLength = 30000;
      textarea.rows = 8;
      textarea.setAttribute("aria-label", "当前页备注");
      textarea.placeholder = "添加当前页的演讲备注…";
      actions.className = "note-editor-actions";
      status.className = "note-save-status";
      status.setAttribute("role", "status");
      status.textContent = "修改后保存到当前页";
      button.type = "button";
      button.className = "note-save-button";
      button.innerHTML = ico("save") + "保存备注";
      button.disabled = true;
      textarea.oninput = () => {
        d.notes = textarea.value;
        status.textContent = "尚未保存";
        button.disabled = saving;
      };
      const persist = async () => {
        if (saving || button.disabled) return;
        const page = current,
          value = textarea.value;
        saving = true;
        button.disabled = true;
        status.textContent = "保存中…";
        try {
          await saveNote(page, value);
          presenterChannel?.postMessage({ type: "notes", page, notes: value });
          if (d.notes === value) status.textContent = "已保存";
          else {
            status.textContent = "有新的修改尚未保存";
            button.disabled = false;
          }
        } catch (error) {
          status.textContent = "保存失败";
          button.disabled = false;
          toast(error.message);
        } finally {
          saving = false;
          if (d.notes !== value) button.disabled = false;
        }
      };
      button.onclick = persist;
      textarea.onkeydown = (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          event.preventDefault();
          persist();
        }
      };
      actions.append(status, button);
      editor.append(textarea, actions);
      $("notesBody").append(editor);
    } else {
      const p = document.createElement("p");
      p.textContent = d.notes;
      $("notesBody").append(p);
    }
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
  async function copySessionLink(button, value) {
    try {
      await hostWindow.navigator.clipboard.writeText(value);
      const original = button.innerHTML;
      button.innerHTML = ico("check") + "已复制";
      hostWindow.setTimeout(() => (button.innerHTML = original), 1500);
    } catch {
      toast("复制失败，请手动复制链接");
    }
  }
  function connectionDevice(userAgent = "") {
    if (/iPad/i.test(userAgent)) return "iPad";
    if (/iPhone/i.test(userAgent)) return "iPhone";
    if (/Android/i.test(userAgent)) return "Android 设备";
    if (/Windows/i.test(userAgent)) return "Windows 设备";
    if (/Macintosh|Mac OS/i.test(userAgent)) return "Mac";
    if (/Linux/i.test(userAgent)) return "Linux 设备";
    return "浏览器设备";
  }
  function connectionsMarkup(connections = []) {
    return connections.length
      ? connections
          .map(
            (connection) =>
              `<article><span class="connection-device-icon">${ico(/Mobile|iPhone|Android/i.test(connection.userAgent) ? "smartphone" : "monitor")}</span><div><b>${escapeHTML(connectionDevice(connection.userAgent))}</b><small title="${escapeHTML(connection.userAgent)}">${escapeHTML(connection.userAgent)}</small><em>设备 ${escapeHTML(connection.deviceId.slice(0, 8))} · ${escapeHTML(connection.ip)}</em></div><time>${new Date(connection.lastSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></article>`,
          )
          .join("")
      : '<p class="session-empty">等待设备连接</p>';
  }
  function updateRemoteConnections(connections = []) {
    const list = $("remoteDeviceList"),
      count = $("remoteDeviceCount");
    if (list) list.innerHTML = connectionsMarkup(connections);
    if (count) count.textContent = `${connections.length} 台`;
  }
  function startRemoteSync() {
    if (remoteInterval) return;
    remoteInterval = hostWindow.setInterval(async () => {
      if (!remoteSession || remoteBusy) return;
      remoteBusy = true;
      try {
        const state = timer.snapshot();
        const adminState = await sessionRequest(
          `/presenter-sessions/${remoteSession.token}`,
          {
            method: "PATCH",
            body: {
              page: current,
              running: state.running,
              elapsed: state.total,
            },
          },
        );
        remoteSession.connections = adminState.connections || [];
        updateRemoteConnections(remoteSession.connections);
        const result = await sessionRequest(
          `/remote/${remoteSession.token}/commands?after=${lastRemoteCommand}`,
        );
        for (const command of result.commands) {
          lastRemoteCommand = Math.max(lastRemoteCommand, command.id);
          if (command.action === "previous") go(current - 1);
          if (command.action === "next") go(current + 1);
          if (command.action === "go") go(command.page);
          if (command.action === "toggleTimer") timer.toggle();
          if (command.action === "resetTimer") timer.reset();
        }
      } catch {}
      remoteBusy = false;
    }, 650);
  }
  async function openRemoteControl() {
    openPanel("remoteControlPanel");
    if (remoteSession) return;
    const body = $("remoteSessionBody");
    body.className = "session-loading";
    body.textContent = "正在创建遥控会话…";
    try {
      remoteSession = await sessionRequest("/presenter-sessions", {
        method: "POST",
        body: { deckId, page: current },
      });
      body.className = "session-connect";
      body.innerHTML = `<div class="session-connect-main"><div class="session-qr"><div class="session-qr-frame"><img src="${escapeHTML(remoteSession.qr)}" alt="手机遥控二维码"></div><span>${ico("smartphone")}扫码连接</span></div><div><label for="remoteControlURL">遥控地址</label><div class="session-link"><input id="remoteControlURL" value="${escapeHTML(remoteSession.url)}" readonly><button type="button">${ico("check")}复制链接</button></div><small><i></i>已连接当前演示</small></div></div><section class="session-connections"><div class="connection-heading"><div><h3>连接设备</h3><p>近期开启此遥控器的设备</p></div><span id="remoteDeviceCount">0 台</span></div><div id="remoteDeviceList" class="connection-list">${connectionsMarkup([])}</div></section>`;
      body.querySelector("button").onclick = (event) =>
        copySessionLink(event.currentTarget, remoteSession.url);
      startRemoteSync();
    } catch (error) {
      body.className = "session-error";
      body.textContent = error.message;
    }
  }
  function renderAudienceDashboard() {
    if (!audienceSession) return;
    const panel = $("audienceDashboard"),
      poll = audienceSession.poll,
      feedback = audienceSession.feedback,
      qr = audienceSession.qr || panel.querySelector("img")?.src || "",
      totalVotes = poll?.votes || 0,
      unanswered = audienceSession.questions.filter(
        (question) => !question.answered,
      ).length;
    panel.innerHTML = `<div class="session-connect audience-connect"><div class="session-qr"><div class="session-qr-frame"><img src="${escapeHTML(qr)}" alt="观众互动二维码"></div><span>${ico("audience")}扫码加入</span></div><div><label>互动地址</label><div class="session-link"><input value="${escapeHTML(audienceSession.url)}" readonly><button type="button" data-copy-audience>${ico("check")}复制链接</button></div><div class="audience-metrics"><span><b>${audienceSession.questionCount}</b>问题</span><span><b>${totalVotes}</b>投票</span><span><b>${feedback.count ? feedback.average.toFixed(1) : "—"}</b>评分</span></div></div></div><section class="session-connections audience-connections"><div class="connection-heading"><div><h3>参与设备</h3><p>已打开互动页面的设备</p></div><span>${audienceSession.connections?.length || 0} 台</span></div><div class="connection-list">${connectionsMarkup(audienceSession.connections)}</div></section><div class="audience-dashboard-grid"><form id="audiencePollForm" class="audience-poll-form"><div class="poll-heading"><div><h3>发起投票</h3><p>设置问题与选项</p></div>${poll?.status === "open" ? '<span class="session-status live"><i></i>进行中</span>' : '<span class="session-status">未开始</span>'}</div><label>投票题目<input name="question" maxlength="200" placeholder="输入一个简短问题" required></label><div class="poll-option-fields"><label>选项 1<input name="option" maxlength="100" placeholder="输入选项" required></label><label>选项 2<input name="option" maxlength="100" placeholder="输入选项" required></label></div><button type="button" class="add-poll-option">${ico("plus")}添加选项</button><div class="poll-actions"><button class="session-primary" type="submit">${poll?.status === "open" ? "发布新投票" : "发起投票"}</button>${poll?.status === "open" ? '<button type="button" class="audience-close-poll">结束当前投票</button>' : ""}</div></form>${
      poll
        ? `<section class="audience-live-poll"><div class="poll-heading"><div><h3>${escapeHTML(poll.question)}</h3><p>${totalVotes} 人参与</p></div><span class="session-status ${poll.status === "open" ? "live" : ""}">${poll.status === "open" ? "实时" : "已结束"}</span></div><div class="poll-result-list">${poll.options
            .map((option) => {
              const percent = totalVotes
                ? Math.round((option.count / totalVotes) * 100)
                : 0;
              return `<div class="poll-result"><div><span>${escapeHTML(option.label)}</span><b>${option.count} · ${percent}%</b></div><i><span style="width:${percent}%"></span></i></div>`;
            })
            .join("")}</div></section>`
        : '<section class="audience-live-poll empty-poll"><h3>实时结果</h3><p>发起投票后，结果会在这里更新。</p></section>'
    }</div><section class="audience-questions"><div class="question-heading"><div><h3>观众问题</h3><p>${unanswered ? `${unanswered} 个待回答` : "暂无待回答问题"}</p></div><span>${audienceSession.questionCount}</span></div>${
      audienceSession.questions.length
        ? [...audienceSession.questions]
            .sort((a, b) => Number(a.answered) - Number(b.answered))
            .map(
              (question) =>
                `<button type="button" data-question="${question.id}" class="${question.answered ? "answered" : ""}"><span><b>${escapeHTML(question.name || "匿名观众")}</b>${escapeHTML(question.body)}</span><em>${question.answered ? `${ico("check")}已回答` : "标记已回答"}</em></button>`,
            )
            .join("")
        : '<p class="session-empty">还没有收到问题</p>'
    }</section>`;
    panel.querySelector("[data-copy-audience]").onclick = (event) =>
      copySessionLink(event.currentTarget, audienceSession.url);
    panel.querySelector("#audiencePollForm").onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget),
        button = event.submitter;
      button.disabled = true;
      try {
        audienceSession = await sessionRequest(
          `/audience-sessions/${audienceSession.token}/polls`,
          {
            method: "POST",
            body: {
              question: form.get("question"),
              options: form
                .getAll("option")
                .map((value) => String(value).trim())
                .filter(Boolean),
            },
          },
        );
        renderAudienceDashboard();
      } catch (error) {
        button.disabled = false;
        toast(error.message);
      }
    };
    panel.querySelector(".add-poll-option").onclick = () => {
      const fields = panel.querySelector(".poll-option-fields"),
        count = fields.children.length;
      if (count >= 8) return toast("最多可添加 8 个选项");
      const label = document.createElement("label");
      label.innerHTML = `选项 ${count + 1}<span><input name="option" maxlength="100" placeholder="输入选项" required><button type="button" aria-label="删除选项">${ico("close")}</button></span>`;
      label.querySelector("button").onclick = () => label.remove();
      fields.append(label);
      label.querySelector("input").focus();
    };
    panel
      .querySelector(".audience-close-poll")
      ?.addEventListener("click", async () => {
        audienceSession = await sessionRequest(
          `/audience-sessions/${audienceSession.token}/polls/close`,
          { method: "POST", body: {} },
        );
        renderAudienceDashboard();
      });
    panel.querySelectorAll("[data-question]").forEach(
      (button) =>
        (button.onclick = async () => {
          audienceSession = await sessionRequest(
            `/audience-sessions/${audienceSession.token}/questions/${button.dataset.question}`,
            {
              method: "PATCH",
              body: { answered: !button.classList.contains("answered") },
            },
          );
          renderAudienceDashboard();
        }),
    );
  }
  async function startAudience() {
    const button = $("startAudience");
    button.disabled = true;
    try {
      audienceSession = await sessionRequest("/audience-sessions", {
        method: "POST",
        body: { deckId },
      });
      $("audienceSetup").hidden = true;
      $("audienceDashboard").hidden = false;
      renderAudienceDashboard();
      audienceInterval ||= hostWindow.setInterval(async () => {
        if (!audienceSession || $("audiencePanel").hidden) return;
        try {
          const next = await sessionRequest(
            `/audience-sessions/${audienceSession.token}`,
          );
          next.qr = audienceSession.qr;
          audienceSession = next;
          if (!document.activeElement?.closest("#audiencePollForm"))
            renderAudienceDashboard();
        } catch {}
      }, 1800);
    } catch (error) {
      button.disabled = false;
      toast(error.message);
    }
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
      case "remote":
        openRemoteControl();
        break;
      case "audience":
        openPanel("audiencePanel");
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
  if ($("remoteControlBtn"))
    $("remoteControlBtn").onclick = () => openRemoteControl();
  if ($("audienceBtn"))
    $("audienceBtn").onclick = () => openPanel("audiencePanel");
  if ($("startAudience")) $("startAudience").onclick = startAudience;
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
  dock.addEventListener(
    "touchstart",
    (event) => {
      const touch = event.touches[0],
        button = event.target.closest("button");
      if (!touch || !button || event.touches.length !== 1) return;
      dockTouch = {
        id: touch.identifier,
        button,
        x: touch.clientX,
        y: touch.clientY,
        moved: false,
      };
      dockPressed = true;
      showDock(5000);
    },
    { capture: true, passive: true },
  );
  dock.addEventListener(
    "touchmove",
    (event) => {
      if (!dockTouch) return;
      const touch = [...event.touches].find(
        (item) => item.identifier === dockTouch.id,
      );
      if (
        touch &&
        Math.hypot(touch.clientX - dockTouch.x, touch.clientY - dockTouch.y) > 9
      )
        dockTouch.moved = true;
    },
    { capture: true, passive: true },
  );
  dock.addEventListener(
    "touchend",
    (event) => {
      const touch = dockTouch;
      dockTouch = null;
      releaseDock();
      if (!touch || touch.moved || touch.button.disabled) return;
      const ended = [...event.changedTouches].find(
        (item) => item.identifier === touch.id,
      );
      if (!ended) return;
      const target = document.elementFromPoint(ended.clientX, ended.clientY);
      if (!touch.button.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      touch.button.click();
    },
    { capture: true, passive: false },
  );
  dock.addEventListener(
    "touchcancel",
    () => {
      dockTouch = null;
      releaseDock();
    },
    { capture: true, passive: true },
  );
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
      const panel = [
        "figureViewer",
        "notes",
        "overview",
        "timingPanel",
        "remoteControlPanel",
        "audiencePanel",
      ]
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
    hostWindow.clearInterval(remoteInterval);
    hostWindow.clearInterval(audienceInterval);
    if (remoteSession)
      sessionRequest(`/presenter-sessions/${remoteSession.token}`, {
        method: "DELETE",
        keepalive: true,
      }).catch(() => {});
    if (audienceSession)
      sessionRequest(`/audience-sessions/${audienceSession.token}`, {
        method: "DELETE",
        keepalive: true,
      }).catch(() => {});
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
