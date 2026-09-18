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
  viewerMode = false,
  viewerPermissions = {},
  interactionURL = null,
  initialPage = 1,
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
    roomSession = null,
    roomSocket = null,
    roomTab = "settings",
    roomPointerTimer = 0,
    roomInkSyncTimer = 0,
    roomInkSyncPage = 0,
    roomPingInterval = 0,
    roomReconnectTimer = 0,
    roomReconnectDelay = 700,
    roomSocketGeneration = 0,
    roomRestoreTimer = 0,
    roomRestoreDelay = 700,
    roomLatency = null,
    roomFeedState = null,
    roomFeedSignature = "",
    roomFeedCollapseTimer = 0,
    roomFeedUnread = 0,
    roomActivities = [],
    roomAudienceState = null,
    remoteInterval = 0,
    audienceInterval = 0,
    audienceStarting = false,
    lastRemoteCommand = 0,
    remoteBusy = false;
  let interactionToken = (() => {
      try {
        return interactionURL
          ? decodeURIComponent(
              new URL(interactionURL, hostWindow.location.origin).pathname
                .split("/")
                .filter(Boolean)
                .pop() || "",
            )
          : "";
      } catch {
        return "";
      }
    })(),
    audienceVisitorKey = "powerdeck-audience-visitor",
    audienceVisitor =
      localStorage.getItem(audienceVisitorKey) ||
      hostWindow.crypto.randomUUID();
  const audienceVoteKey = (pollId) =>
      `voted:${interactionToken}:${pollId || "unknown"}`,
    audienceRatingKey = () => `rating:${interactionToken}`,
    roomHostKey = `powerdeck-room-host:${deckId}`;
  localStorage.setItem(audienceVisitorKey, audienceVisitor);
  const sessionRequest = async (path, options = {}) => {
    const response = await hostWindow.fetch("/api" + path, {
      method: options.method || "GET",
      credentials: "same-origin",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(sessionControls?.csrf
          ? { "X-CSRF-Token": sessionControls.csrf }
          : {}),
        ...(options.headers || {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      ...(options.keepalive ? { keepalive: true } : {}),
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(value.error || "请求失败");
      error.status = response.status;
      throw error;
    }
    return value;
  };
  const roomAudienceRequest = async (path = "", options = {}) => {
    if (!interactionToken) throw new Error("房间未开启互动");
    const response = await hostWindow.fetch(
      `/api/audience/${encodeURIComponent(interactionToken)}${path}`,
      {
        method: options.method || "GET",
        credentials: "same-origin",
        headers: {
          "X-PowerDeck-Device": audienceVisitor,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      },
    );
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.error || "互动请求失败");
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
    syncRoomInk();
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
    syncRoomInk();
  }
  function clearInk() {
    finishDraw();
    if (!inks().length) return;
    const before = clone(inks());
    annotations[current] = [];
    checkpoint(before);
    renderInk();
    syncRoomInk();
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
  function syncRoomInk(page = current) {
    if (!roomSession || viewerMode) return;
    roomSend({ type: "ink", page, strokes: clone(annotations[page] || []) });
  }
  function scheduleRoomInkSync(page = current) {
    if (!roomSession || viewerMode) return;
    roomInkSyncPage = page;
    if (roomInkSyncTimer) return;
    roomInkSyncTimer = hostWindow.setTimeout(() => {
      roomInkSyncTimer = 0;
      syncRoomInk(roomInkSyncPage);
    }, 40);
  }
  for (let n = 1; n <= total; n++) renderInk(n);

  const dock = $("controls");
  const dockButton = (id, icon, label, extra = "") =>
    `<button id="${id}" type="button" aria-label="${label}" data-tip="${label}" ${extra}>${ico(icon)}</button>`;
  const roomEmojis = [
      "😀",
      "👏",
      "👍",
      "❤️",
      "🎉",
      "🔥",
      "💡",
      "🤔",
      "😂",
      "🙌",
      "✅",
      "👀",
      "😊",
      "😍",
      "🥳",
      "😮",
      "😢",
      "😅",
      "🤩",
      "🫡",
      "🙏",
      "💪",
      "👌",
      "✌️",
      "🤝",
      "💯",
      "⭐",
      "🚀",
      "🎯",
      "📌",
      "❓",
      "❗",
      "🧠",
      "✨",
      "🌟",
      "☕",
    ],
    roomFeedMarkup = (host = false) =>
      `<aside id="roomLiveFeed" class="room-live-feed${host ? " room-host-only" : ""}" aria-live="polite"><button id="roomFeedToggle" class="room-feed-toggle" type="button" aria-label="收起互动评论" aria-expanded="true"><span class="room-feed-presence"><span>${ico("users")}<b id="roomFeedOnline">1</b></span><span>${ico("latency")}<em id="roomFeedLatency">连接中</em></span></span><span class="room-feed-idle" hidden>···</span><span class="room-feed-collapse" aria-hidden="true">${ico("down")}</span><i class="room-feed-unread" hidden>0</i></button><div class="room-feed-expanded"><div id="roomFeedItems"></div><form id="roomFeedComposer" class="room-feed-composer" data-host="${host}"><div class="room-emoji-picker" hidden><div>${roomEmojis.map((emoji) => `<button type="button" data-room-emoji-value="${emoji}" aria-label="插入 ${emoji}">${emoji}</button>`).join("")}</div></div><button type="button" class="room-emoji-toggle" aria-label="选择 Emoji" aria-expanded="false">${ico("smile")}</button><input name="body" maxlength="500" autocomplete="off" placeholder="发表评论…" aria-label="发表评论"><button type="submit" class="room-comment-send" aria-label="发送评论">${ico("next")}</button></form></div><div id="roomFeedToasts" class="room-feed-toasts" aria-live="polite"></div></aside>`;
  const sessionToolsMarkup = presenterURL
    ? `<span class="nav-divider session-divider" aria-hidden="true"></span><div class="session-control-group" role="group" aria-label="演讲辅助">${dockButton("presenterViewBtn", "presenter", "演讲者视图")}${dockButton("remoteControlBtn", "smartphone", "手机遥控")}${dockButton("roomBtn", "room", "房间")}</div>`
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
  if (viewerMode) {
    for (const id of [
      "prev",
      "counter",
      "next",
      "pointerBtn",
      "laserBtn",
      "inkBtn",
      "undoBtn",
      "moreBtn",
      "editBtn",
    ])
      if ($(id)) $(id).hidden = true;
    dock
      .querySelectorAll(".nav-divider")
      .forEach((divider) => divider.setAttribute("hidden", ""));
    $("overviewBtn").hidden = !viewerPermissions.directory;
    $("notesBtn").hidden = !viewerPermissions.notes;
    if (interactionURL)
      dock
        .querySelector("#dockTools")
        .insertAdjacentHTML(
          "beforeend",
          '<span class="nav-divider room-interaction-divider" aria-hidden="true"></span><div class="room-interaction-control-group" role="group" aria-label="房间互动">' +
            dockButton(
              "roomPollBtn",
              "chartNoAxesColumn",
              "投票",
              'aria-haspopup="dialog" aria-expanded="false"',
            ) +
            dockButton(
              "roomRatingBtn",
              "star",
              "评分",
              'aria-haspopup="dialog" aria-expanded="false"',
            ) +
            "</div>",
        );
    if (downloadURL)
      dock
        .querySelector("#dockTools")
        .insertAdjacentHTML(
          "beforeend",
          dockButton("roomDownloadBtn", "print", "下载 PDF"),
        );
    document.body.classList.add("room-viewer");
  }
  const ui = document.createElement("div");
  ui.id = "presenterUI";
  ui.innerHTML =
    '<button id="dockReveal" aria-label="显示演示工具"></button><div id="toolMenu" class="presenter-menu" role="menu" aria-label="指针与墨迹" hidden></div><div id="contextMenu" class="presenter-menu" role="menu" aria-label="演示菜单" hidden></div><div id="moreMenu" class="presenter-menu" role="menu" aria-label="更多操作" hidden></div><div id="laserDot"></div><div id="eraserCursor"></div><div id="roomPointer" aria-hidden="true"></div>' +
    (viewerMode
      ? `${viewerPermissions.interaction && (viewerPermissions.showInteractionFeed || viewerPermissions.showOnlineCount) ? roomFeedMarkup() : ""}`
      : "") +
    (presenterURL
      ? `<section id="remoteControlPanel" class="overlay session-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="remoteControlTitle"><div class="session-dialog-card remote-session-card"><div class="overlay-head"><div><p class="session-kicker">演讲辅助</p><h2 id="remoteControlTitle">手机遥控</h2><span>扫码连接后即可控制演示</span></div><button class="dialog-close" type="button" data-close="remoteControlPanel" aria-label="关闭手机遥控">${ico("close")}</button></div><div id="remoteSessionBody" class="session-loading">正在创建遥控会话…</div></div></section><section id="roomPanel" class="overlay session-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="roomTitle"><div class="session-dialog-card room-session-card"><div class="overlay-head"><div><p class="session-kicker">同步放映</p><h2 id="roomTitle">房间</h2><span>让观众同步观看当前演示</span></div><button class="dialog-close" type="button" data-close="roomPanel" aria-label="关闭房间">${ico("close")}</button></div><div id="roomBody" class="session-loading">正在创建房间…</div></div></section><section id="audiencePanel" class="overlay session-overlay" hidden role="dialog" aria-modal="true" aria-labelledby="audienceTitle"><div class="session-dialog-card audience-session-card"><div class="overlay-head"><div><p class="session-kicker">房间互动</p><h2 id="audienceTitle">观众互动</h2><span>评论、投票、评分</span></div><button class="dialog-close" type="button" data-close="audiencePanel" aria-label="关闭观众互动">${ico("close")}</button></div><div id="audienceSetup" class="session-loading">正在开启观众互动…</div><div id="audienceDashboard" hidden></div></div></section>`
      : viewerMode
        ? `<section id="roomPollPanel" class="room-poll-popover" hidden aria-label="投票"><div class="room-poll-popover-head"><div><b>投票</b></div><button type="button" data-close-room-polls aria-label="关闭投票">${ico("close")}</button></div><div id="roomPollBody"></div></section><div id="roomRatingPopover" class="room-rating-popover" hidden></div>`
        : "");
  document.body.append(ui);
  bindRoomFeedComposer();
  if (viewerMode) applyRoomFeedPermissions(viewerPermissions);
  if ($("roomPollPanel"))
    $("roomPollPanel").querySelector("[data-close-room-polls]").onclick = () =>
      closeRoomInteractionPopover($("roomPollPanel"));
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
  const interactionPopoverTimers = new WeakMap();
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
      "roomPanel",
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
      (presenterURL ? row("room", "房间", "room", "") : "") +
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
  function roomInteractionPopoverOpen() {
    return [$("roomPollPanel"), $("roomRatingPopover")].some(
      (popover) => popover && !popover.hidden,
    );
  }
  function roomSideDockActive() {
    return (
      viewerMode &&
      matchMedia("(max-width: 700px) and (orientation: portrait)").matches
    );
  }
  function positionRoomInteractionPopover(popover, anchor) {
    if (!popover || popover.hidden || !anchor) return;
    const anchorRect = anchor.getBoundingClientRect(),
      panelRect = popover.getBoundingClientRect(),
      margin = roomSideDockActive() ? 10 : 12,
      anchorCenter = anchorRect.left + anchorRect.width / 2,
      anchorMiddle = anchorRect.top + anchorRect.height / 2,
      left = Math.max(
        margin,
        Math.min(
          anchorCenter - panelRect.width / 2,
          window.innerWidth - panelRect.width - margin,
        ),
      ),
      arrowLeft = Math.max(
        26,
        Math.min(anchorCenter - left, panelRect.width - 26),
      ),
      bottom = Math.max(12, window.innerHeight - anchorRect.top + 16),
      maxHeight = Math.max(220, anchorRect.top - 32);
    if (roomSideDockActive()) {
      const sideLeft = Math.max(margin, anchorRect.left - panelRect.width - 14),
        top = Math.max(
          margin,
          Math.min(
            anchorMiddle - panelRect.height / 2,
            window.innerHeight - panelRect.height - margin,
          ),
        ),
        arrowTop = Math.max(
          24,
          Math.min(anchorMiddle - top, panelRect.height - 24),
        );
      popover.classList.add("side-anchored");
      popover.style.left = `${sideLeft}px`;
      popover.style.top = `${top}px`;
      popover.style.bottom = "auto";
      popover.style.setProperty("--popover-arrow-top", `${arrowTop}px`);
      popover.style.setProperty(
        "--popover-max-height",
        `${Math.max(220, window.innerHeight - margin * 2)}px`,
      );
      return;
    }
    popover.classList.remove("side-anchored");
    popover.style.left = `${left}px`;
    popover.style.top = "auto";
    popover.style.bottom = `${bottom}px`;
    popover.style.setProperty("--popover-arrow-left", `${arrowLeft}px`);
    popover.style.setProperty("--popover-max-height", `${maxHeight}px`);
  }
  function positionOpenRoomInteractionPopovers() {
    positionRoomInteractionPopover($("roomPollPanel"), $("roomPollBtn"));
    positionRoomInteractionPopover($("roomRatingPopover"), $("roomRatingBtn"));
  }
  function syncRoomInteractionDock() {
    $("roomPollBtn")?.setAttribute(
      "aria-expanded",
      String(!!$("roomPollPanel") && !$("roomPollPanel").hidden),
    );
    $("roomRatingBtn")?.setAttribute(
      "aria-expanded",
      String(!!$("roomRatingPopover") && !$("roomRatingPopover").hidden),
    );
    document.body.classList.toggle(
      "interaction-popover-open",
      roomInteractionPopoverOpen(),
    );
    if (roomInteractionPopoverOpen()) {
      clearTimeout(hideTimer);
      document.body.classList.add("dock-visible");
    }
  }
  function closeRoomInteractionPopover(popover, immediate = false) {
    if (!popover || popover.hidden) return;
    clearTimeout(interactionPopoverTimers.get(popover));
    if (immediate || reduceMotion()) {
      popover.hidden = true;
      popover.classList.remove("is-closing", "is-opening", "is-positioning");
      syncRoomInteractionDock();
      return;
    }
    popover.classList.remove("is-opening", "is-positioning");
    popover.classList.add("is-closing");
    interactionPopoverTimers.set(
      popover,
      hostWindow.setTimeout(() => {
        popover.hidden = true;
        popover.classList.remove("is-closing", "side-anchored");
        syncRoomInteractionDock();
        showDock(3000);
      }, 160),
    );
  }
  function openRoomInteractionPopover(popover, anchor) {
    if (!popover || !anchor) return;
    clearTimeout(interactionPopoverTimers.get(popover));
    popover.classList.remove("is-closing", "is-opening");
    popover.classList.add("is-positioning");
    popover.hidden = false;
    syncRoomInteractionDock();
    positionRoomInteractionPopover(popover, anchor);
    void popover.offsetWidth;
    popover.classList.remove("is-positioning");
    popover.classList.add("is-opening");
    interactionPopoverTimers.set(
      popover,
      hostWindow.setTimeout(() => popover.classList.remove("is-opening"), 260),
    );
  }
  function showDock(delay = 1500) {
    if (openMenu()?.id === "contextMenu" || panelOpen()) return;
    document.body.classList.add("dock-visible");
    clearTimeout(hideTimer);
    if (roomInteractionPopoverOpen()) return;
    hideTimer = setTimeout(hideDock, delay);
  }
  function hideDock() {
    if (
      roomInteractionPopoverOpen() ||
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
      "roomPanel",
    ]) {
      const el = $(id);
      clearTimeout(panelTimers.get(id));
      if (!el) continue;
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
    closeRoomInteractionPopover($("roomPollPanel"), true);
    closeRoomInteractionPopover($("roomRatingPopover"), true);
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
    if (viewerMode) $("roomPointer")?.classList.remove("visible");
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
    if (roomSession && !viewerMode) roomSend({ type: "page", page: current });
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
          .map((connection) => {
            const device = connectionDevice(connection.userAgent);
            return `<article class="connection-item"><span class="connection-device-icon">${ico(/Mobile|iPhone|Android/i.test(connection.userAgent) ? "smartphone" : "monitor")}</span><div class="connection-details"><div class="connection-title"><b>${escapeHTML(connection.name || device)}</b><span><i></i>在线</span></div><small title="${escapeHTML(connection.userAgent)}">${escapeHTML(device)} · ${escapeHTML(connection.userAgent)}</small><div class="connection-meta"><em>设备 ${escapeHTML(connection.deviceId.slice(0, 8))}</em><em>${escapeHTML(connection.ip)}</em></div></div><time><i></i>${new Date(connection.lastSeen).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></article>`;
          })
          .join("")
      : '<p class="session-empty">等待设备连接</p>';
  }
  function updateRemoteConnections(connections = []) {
    const list = $("remoteDeviceList"),
      count = $("remoteDeviceCount");
    if (list) list.innerHTML = connectionsMarkup(connections);
    if (count) count.textContent = `${connections.length} 台`;
  }
  function bindSessionQR(container) {
    const button = container.querySelector(".session-qr-frame"),
      source = button?.querySelector("img");
    if (!button || !source) return;
    button.onclick = () => {
      figureReturn = button.closest(".session-overlay")?.id || null;
      openPanel("figureViewer");
      lightbox.open(source);
    };
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
      body.className = "remote-control-shell";
      body.innerHTML = `<section class="remote-connect-pane"><header class="remote-pane-heading"><span>${ico("smartphone")}</span><div><small>扫码连接</small><h3>手机遥控</h3></div></header><div class="session-qr"><button type="button" class="session-qr-frame" aria-label="放大手机遥控二维码"><img src="${escapeHTML(remoteSession.qr)}" alt="手机遥控二维码"></button><span>${ico("smartphone")}使用手机扫码</span></div><div class="remote-link-block"><label for="remoteControlURL">遥控地址</label><div class="session-link"><input id="remoteControlURL" value="${escapeHTML(remoteSession.url)}" readonly><button type="button">${ico("check")}复制</button></div><div class="remote-session-status"><i></i><span>遥控会话已开启</span></div></div></section><section class="remote-devices-pane"><header class="remote-pane-heading"><div><small>实时设备</small><h3>连接设备</h3></div><em id="remoteDeviceCount">0 台</em></header><div id="remoteDeviceList" class="connection-list">${connectionsMarkup([])}</div></section>`;
      body.querySelector(".session-link button").onclick = (event) =>
        copySessionLink(event.currentTarget, remoteSession.url);
      bindSessionQR(body);
      startRemoteSync();
    } catch (error) {
      body.className = "session-error";
      body.textContent = error.message;
    }
  }
  function roomSend(message) {
    if (roomSocket?.readyState === 1) roomSocket.send(JSON.stringify(message));
  }
  function roomTabCount(id) {
    if (id === "members") return roomSession?.connections?.length || 0;
    if (id === "polls")
      return audienceSession?.polls?.length || (audienceSession?.poll ? 1 : 0);
    if (id === "comments")
      return (
        audienceSession?.questions?.length ||
        audienceSession?.questionCount ||
        0
      );
    return null;
  }
  function updateRoomTabBadges() {
    ["members", "polls", "comments"].forEach((id) => {
      const badge = document.querySelector(
        `[data-room-tab="${id}"] .room-tab-badge`,
      );
      if (badge) badge.textContent = roomTabCount(id);
    });
  }
  function updateRoomConnections(connections = []) {
    const list = $("roomDeviceList"),
      count = $("roomDeviceCount"),
      navCount = $("roomNavCount");
    if (roomSession) roomSession.connections = connections;
    if (list) list.innerHTML = connectionsMarkup(connections);
    if (count) count.textContent = `${connections.length} 人在线`;
    if (navCount) navCount.textContent = connections.length;
    updateRoomTabBadges();
    updateRoomPresence(connections.length, roomLatency);
  }
  function updateRoomPresence(count, latency = null) {
    const online = $("roomFeedOnline"),
      delay = $("roomFeedLatency");
    if (online) online.textContent = String(Math.max(0, count || 0));
    if (delay)
      delay.textContent = Number.isFinite(latency)
        ? `${Math.round(latency)} ms`
        : "连接中";
  }
  function applyRoomFeedPermissions(permissions) {
    const feed = $("roomLiveFeed"),
      toggle = $("roomFeedToggle"),
      presence = feed?.querySelector(".room-feed-presence"),
      idle = feed?.querySelector(".room-feed-idle");
    if (!feed || !toggle) return;
    const showList = !!permissions.showInteractionFeed,
      showPresence = !!permissions.showOnlineCount;
    feed.classList.toggle("status-only", !showList);
    if (presence) presence.hidden = !showPresence;
    if (idle) idle.hidden = showPresence;
    toggle.disabled = !showList;
    if (!showList) setRoomFeedCollapsed(true);
  }
  function ensureRoomChrome() {
    if (!roomSession || viewerMode) return;
    const shouldShowFeed =
      roomSession.permissions.interaction &&
      (roomSession.permissions.showInteractionFeed ||
        roomSession.permissions.showOnlineCount);
    if (shouldShowFeed && !$("roomLiveFeed"))
      ui.insertAdjacentHTML("beforeend", roomFeedMarkup(true));
    else if (!shouldShowFeed) {
      $("roomLiveFeed")?.remove();
    }
    bindRoomFeedComposer();
    applyRoomFeedPermissions(roomSession.permissions);
    updateRoomPresence(roomSession.connections?.length || 0, roomLatency);
  }
  function bindRoomFeedComposer() {
    const form = $("roomFeedComposer");
    if (!form || form.dataset.bound) return;
    form.dataset.bound = "true";
    const input = form.elements.body,
      picker = form.querySelector(".room-emoji-picker"),
      toggle = form.querySelector(".room-emoji-toggle"),
      feed = $("roomLiveFeed"),
      feedToggle = $("roomFeedToggle"),
      scheduleCollapse = () => {
        hostWindow.clearTimeout(roomFeedCollapseTimer);
        roomFeedCollapseTimer = hostWindow.setTimeout(() => {
          const hasDraft = !!String(input.value || "").trim(),
            pickerOpen = picker && !picker.hidden;
          if (hasDraft || pickerOpen || roomInteractionPopoverOpen()) {
            scheduleCollapse();
            return;
          }
          setRoomFeedCollapsed(true);
        }, 3000);
      };
    feedToggle.onclick = () => {
      setRoomFeedCollapsed(!feed.classList.contains("collapsed"));
      scheduleCollapse();
    };
    feed.addEventListener("pointerdown", scheduleCollapse);
    feed.addEventListener("focusin", scheduleCollapse);
    input.addEventListener("input", scheduleCollapse);
    scheduleCollapse();
    toggle.onclick = () => {
      picker.hidden = !picker.hidden;
      toggle.setAttribute("aria-expanded", String(!picker.hidden));
    };
    picker.querySelectorAll("[data-room-emoji-value]").forEach(
      (button) =>
        (button.onclick = () => {
          const start = input.selectionStart ?? input.value.length,
            end = input.selectionEnd ?? start,
            emoji = button.dataset.roomEmojiValue;
          input.setRangeText(emoji, start, end, "end");
          picker.hidden = true;
          toggle.setAttribute("aria-expanded", "false");
          input.focus({ preventScroll: true });
        }),
    );
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = event.submitter,
        body = String(input.value || "").trim();
      if (!body) return;
      button.disabled = true;
      try {
        if (form.dataset.host === "true") {
          audienceSession = await sessionRequest(
            `/audience-sessions/${audienceSession.token}/comments`,
            { method: "POST", body: { body } },
          );
          renderLiveFeed({
            polls: audienceSession.polls,
            poll: audienceSession.poll,
            comments: audienceSession.questions,
          });
          updateRoomTabBadges();
        } else {
          const comment = await roomAudienceRequest("/questions", {
            method: "POST",
            body: {
              name: localStorage.getItem("powerdeck-room-name") || "房间观众",
              body,
            },
          });
          roomFeedState ||= { polls: [], comments: [] };
          roomFeedState.comments = [
            comment,
            ...(roomFeedState.comments || []).filter(
              (item) => item.id !== comment.id,
            ),
          ];
          roomFeedSignature = "";
          renderLiveFeed(roomFeedState);
        }
        input.value = "";
        toast("评论已发布");
        scheduleCollapse();
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
      }
    };
  }
  function setRoomFeedCollapsed(collapsed) {
    const feed = $("roomLiveFeed"),
      toggle = $("roomFeedToggle"),
      badge = feed?.querySelector(".room-feed-unread");
    if (!feed || !toggle) return;
    feed.classList.toggle("collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute(
      "aria-label",
      collapsed ? "展开互动评论" : "收起互动评论",
    );
    if (!collapsed) {
      roomFeedUnread = 0;
      if (badge) badge.hidden = true;
    } else {
      const picker = feed.querySelector(".room-emoji-picker"),
        emojiToggle = feed.querySelector(".room-emoji-toggle"),
        active = document.activeElement;
      if (picker) picker.hidden = true;
      if (emojiToggle) emojiToggle.setAttribute("aria-expanded", "false");
      if (active && feed.contains(active)) active.blur();
    }
  }
  function showCollapsedComment(comment) {
    const feed = $("roomLiveFeed"),
      toasts = $("roomFeedToasts"),
      badge = feed?.querySelector(".room-feed-unread");
    if (!feed?.classList.contains("collapsed") || !toasts) return;
    roomFeedUnread += 1;
    if (badge) {
      badge.textContent = roomFeedUnread > 9 ? "9+" : String(roomFeedUnread);
      badge.hidden = false;
    }
    const toastItem = document.createElement("article");
    toastItem.innerHTML = `<b>${escapeHTML(comment.name || "匿名观众")}</b><p>${escapeHTML(comment.body)}</p>`;
    toasts.append(toastItem);
    while (toasts.children.length > 3) toasts.firstElementChild.remove();
    hostWindow.setTimeout(() => toastItem.classList.add("leaving"), 3800);
    hostWindow.setTimeout(() => toastItem.remove(), 4400);
  }
  function updateRoomPollBadge(polls = []) {
    const button = $("roomPollBtn");
    if (!button) return;
    const pending = polls.filter(
      (poll) =>
        poll.status === "open" &&
        hostWindow.sessionStorage.getItem(audienceVoteKey(poll.id)) !== "1",
    ).length;
    let badge = button.querySelector(".room-poll-badge");
    if (pending && !badge) {
      badge = document.createElement("span");
      badge.className = "room-poll-badge";
      button.append(badge);
    }
    if (badge) {
      badge.textContent = pending > 9 ? "9+" : String(pending);
      badge.hidden = !pending;
    }
    button.classList.toggle("has-pending", pending > 0);
  }
  function renderLiveFeed(feed) {
    const list = $("roomFeedItems");
    if (!feed) return;
    roomFeedState = feed;
    roomAudienceState = {
      ...(roomAudienceState || {}),
      ...(feed.poll !== undefined ? { poll: feed.poll } : {}),
      ...(feed.polls !== undefined ? { polls: feed.polls } : {}),
    };
    const polls = feed.polls || (feed.poll ? [feed.poll] : []),
      comments = (feed.comments || []).slice(0, 24).reverse(),
      activities = roomActivities.slice(-12),
      signature = JSON.stringify({
        polls: polls.map((poll) => [poll.id, poll.status, poll.votes]),
        comments: comments.map((item) => [item.id, item.body, item.authorRole]),
        activities: activities.map((item) => [item.id, item.action]),
      });
    updateRoomPollBadge(polls);
    if (!list) return;
    if (signature === roomFeedSignature) return;
    const hadFeed = !!roomFeedSignature,
      stickToBottom =
        !hadFeed || list.scrollHeight - list.scrollTop - list.clientHeight < 36;
    roomFeedSignature = signature;
    const existing = new Map(
        [...list.children].map((node) => [node.dataset.feedKey, node]),
      ),
      nodes = [],
      reuse = (key, tag, className, html) => {
        const node = existing.get(key) || document.createElement(tag);
        node.dataset.feedKey = key;
        node.className = className;
        if (node.dataset.feedHtml !== html) {
          node.innerHTML = html;
          node.dataset.feedHtml = html;
        }
        return node;
      };
    if (hadFeed)
      for (const comment of comments)
        if (!existing.has(`comment:${comment.id}`))
          showCollapsedComment(comment);
    const stream = [
      ...activities.map((value) => ({ type: "activity", value })),
      ...comments.map((value) => ({ type: "comment", value })),
      ...polls.map((value) => ({ type: "poll", value })),
    ]
      .sort(
        (left, right) =>
          (left.value.at || left.value.createdAt || 0) -
          (right.value.at || right.value.createdAt || 0),
      )
      .slice(-30);
    for (const entry of stream) {
      if (entry.type === "activity") {
        const activity = entry.value;
        nodes.push(
          reuse(
            `activity:${activity.id}`,
            "div",
            "room-feed-activity",
            `${ico(activity.action === "joined" ? "play" : "close")}<span><b>${escapeHTML(activity.name || "一位观众")}</b>${activity.action === "joined" ? "进入了房间" : "离开了房间"}</span>`,
          ),
        );
      } else if (entry.type === "poll") {
        const poll = entry.value,
          node = reuse(
            `poll:${poll.id}`,
            "button",
            "room-feed-poll is-system",
            `<span>${ico("chartNoAxesColumn")}系统 · ${poll.status === "open" ? "发起投票" : "投票已结束"}</span><b>${escapeHTML(poll.question)}</b><small>${poll.status === "open" ? "点击参与" : "查看结果"} · ${poll.votes || 0} 人</small>`,
          );
        node.type = "button";
        node.onclick = () => {
          if (viewerMode) openRoomInteraction("poll");
          else {
            roomTab = "polls";
            openPanel("roomPanel");
            renderRoom();
          }
        };
        nodes.push(node);
      } else {
        const comment = entry.value;
        nodes.push(
          reuse(
            `comment:${comment.id}`,
            "article",
            comment.authorRole === "host"
              ? "is-host"
              : comment.authorRole === "system"
                ? "is-system"
                : "",
            `<b>${escapeHTML(comment.name || "匿名观众")}${comment.authorRole === "host" ? "<em>房主</em>" : comment.authorRole === "system" ? "<em>系统</em>" : ""}</b><p>${escapeHTML(comment.body)}</p>`,
          ),
        );
      }
    }
    list.replaceChildren(...nodes);
    if (stickToBottom)
      requestAnimationFrame(() => {
        list.scrollTop = list.scrollHeight;
      });
    if ($("roomPollPanel") && !$("roomPollPanel").hidden)
      renderRoomPollDialog();
  }
  function pushRoomActivity(activity) {
    if (!activity?.id || roomActivities.some((item) => item.id === activity.id))
      return;
    roomActivities.push(activity);
    roomActivities = roomActivities.slice(-12);
    roomFeedSignature = "";
    renderLiveFeed(roomFeedState || { poll: null, comments: [] });
  }
  function connectRoom() {
    if (!roomSession) return;
    hostWindow.clearTimeout(roomReconnectTimer);
    hostWindow.clearInterval(roomPingInterval);
    const previous = roomSocket;
    if (previous) {
      previous.onclose = null;
      previous.close();
    }
    const generation = ++roomSocketGeneration,
      session = roomSession,
      protocol = hostWindow.location.protocol === "https:" ? "wss:" : "ws:",
      socketURL = `${protocol}//${hostWindow.location.host}/ws/rooms/${session.token}?host=${encodeURIComponent(session.hostToken)}`;
    roomSocket = new hostWindow.WebSocket(socketURL);
    roomSocket.onopen = () => {
      if (generation !== roomSocketGeneration || roomSession !== session)
        return;
      roomReconnectDelay = 700;
      roomSend({ type: "page", page: current });
      for (let page = 1; page <= total; page++)
        if (annotations[page]?.length) syncRoomInk(page);
      const ping = () => roomSend({ type: "ping", at: Date.now() });
      ping();
      roomPingInterval = hostWindow.setInterval(ping, 3000);
    };
    roomSocket.onmessage = ({ data: raw }) => {
      if (generation !== roomSocketGeneration || roomSession !== session)
        return;
      try {
        const message = JSON.parse(raw);
        if (message.type === "participants") {
          roomSession.connections = message.connections || [];
          updateRoomConnections(roomSession.connections);
          pushRoomActivity(message.activity);
        } else if (message.type === "pong") {
          roomLatency = Math.max(0, Date.now() - Number(message.at));
          updateRoomPresence(roomSession.connections?.length || 0, roomLatency);
        }
      } catch {}
    };
    roomSocket.onclose = () => {
      if (generation !== roomSocketGeneration || roomSession !== session)
        return;
      hostWindow.clearInterval(roomPingInterval);
      roomSocket = null;
      updateRoomPresence(roomSession.connections?.length || 0, null);
      const delay = roomReconnectDelay + Math.random() * 180;
      roomReconnectDelay = Math.min(8000, roomReconnectDelay * 1.65);
      roomReconnectTimer = hostWindow.setTimeout(() => {
        if (roomSession === session) connectRoom();
      }, delay);
    };
  }
  const roomTabs = [
      ["settings", "房间设置", "room"],
      ["members", "成员列表", "users"],
      ["polls", "投票", "chartNoAxesColumn"],
      ["comments", "评论", "audience"],
    ],
    roomPermissionRows = [
      ["directory", "查看目录", "浏览演示页面结构", "overview"],
      ["notes", "查看备注", "阅读当前页面备注", "notes"],
      ["interaction", "参与互动", "评论、投票与评分", "audience"],
      ["downloadPdf", "下载 PDF", "保存演示文稿副本", "print"],
      ["showInteractionFeed", "互动浮层", "在放映页展示实时消息", "flag"],
      ["showOnlineCount", "在线状态", "显示人数与连接延迟", "users"],
    ];
  function roomPollMarkup() {
    const polls = audienceSession?.polls || [],
      history = polls.length
        ? `<section class="room-poll-history"><div class="poll-heading"><div><h3>投票历史</h3><p>${polls.length} 个独立投票</p></div></div><div class="room-poll-history-list">${polls
            .map((poll) => {
              const totalVotes = poll.votes || 0;
              return `<article class="audience-live-poll"><div class="poll-heading"><div><h3>${escapeHTML(poll.question)}</h3><p>${totalVotes} 人参与</p></div><span class="session-status ${poll.status === "open" ? "live" : ""}">${poll.status === "open" ? "进行中" : "已结束"}</span></div><div class="poll-result-list">${poll.options
                .map((option, optionIndex) => {
                  const percent = totalVotes
                      ? Math.round((option.count / totalVotes) * 100)
                      : 0,
                    voters = (poll.voters || [])
                      .filter((voter) => voter.optionIndex === optionIndex)
                      .map((voter) => escapeHTML(voter.name || "匿名观众"));
                  return `<div class="poll-result"><div><span>${escapeHTML(option.label)}</span><b>${option.count} · ${percent}%</b></div><i><span style="width:${percent}%"></span></i>${voters.length ? `<p>${voters.map((name) => `<em>${name}</em>`).join("")}</p>` : ""}</div>`;
                })
                .join(
                  "",
                )}</div>${poll.status === "open" ? `<button type="button" class="audience-close-poll" data-close-room-poll="${poll.id}">结束此投票</button>` : ""}</article>`;
            })
            .join("")}</div></section>`
        : '<section class="audience-live-poll empty-poll"><h3>投票历史</h3><p>发布的投票会独立保存在这里。</p></section>';
    return `<div class="room-poll-layout"><form id="roomPollForm" class="audience-poll-form"><div class="poll-heading room-poll-create-heading"><h3>发起投票</h3></div><label>投票题目<input name="question" maxlength="200" placeholder="输入一个简短问题" required></label><div class="poll-option-fields"><label>选项 1<input name="option" maxlength="100" placeholder="输入选项" required></label><label>选项 2<input name="option" maxlength="100" placeholder="输入选项" required></label></div><button type="button" class="add-poll-option">${ico("plus")}添加选项</button><div class="poll-actions"><button class="session-primary" type="submit">发布投票</button></div></form>${history}</div>`;
  }
  function roomCommentsMarkup() {
    const comments = audienceSession?.questions || [];
    return `<section class="room-tab-section room-comments"><header class="room-tab-heading"><div><span>互动记录</span><h3>现场评论</h3></div><em>${comments.length} 条</em></header><div class="room-comment-list">${
      comments.length
        ? [...comments]
            .map((comment) => {
              const role = ["host", "system"].includes(comment.authorRole)
                  ? comment.authorRole
                  : "audience",
                roleLabel =
                  role === "host"
                    ? "房主"
                    : role === "system"
                      ? "系统"
                      : "参与者",
                displayName =
                  role === "system" ? "PowerDeck" : comment.name || "匿名观众",
                time = Number(comment.createdAt)
                  ? new Date(comment.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "";
              return `<article class="room-comment-item is-${role}"><span class="room-comment-avatar">${ico(role === "system" ? "room" : role === "host" ? "presenter" : "audience")}</span><div class="room-comment-content"><header><div><b>${escapeHTML(displayName)}</b><i>${roleLabel}</i></div>${time ? `<time>${escapeHTML(time)}</time>` : ""}</header><p>${escapeHTML(comment.body)}</p></div></article>`;
            })
            .join("")
        : '<p class="session-empty">还没有收到评论</p>'
    }</div></section>`;
  }
  function renderRoomTab() {
    const panel = $("roomTabPanel");
    if (!panel || !roomSession) return;
    updateRoomTabBadges();
    if (roomTab === "settings")
      panel.innerHTML = `<div class="room-settings-layout"><section class="room-settings-card room-share-card"><header class="room-card-heading"><div><span>邀请观众</span><h3>分享房间</h3></div><em class="room-status-chip"><i></i>正在同步</em></header><div class="room-share-content"><div class="session-qr"><button type="button" class="session-qr-frame" aria-label="放大房间二维码"><img src="${escapeHTML(roomSession.qr)}" alt="房间二维码"></button></div><div class="room-share-details"><label>房间链接</label><div class="session-link"><input value="${escapeHTML(roomSession.url)}" readonly><button type="button" data-copy-room>${ico("check")}复制链接</button></div></div></div></section><section class="room-settings-card room-permissions-card"><header class="room-card-heading"><div><span>访问控制</span><h3>观众权限</h3></div></header><div class="room-permission-grid">${roomPermissionRows.map(([key, label, description, icon]) => `<label><span class="room-permission-icon">${ico(icon)}</span><span><b>${escapeHTML(label)}</b><small>${escapeHTML(description)}</small></span><input type="checkbox" data-room-permission="${key}" ${roomSession.permissions[key] ? "checked" : ""}><i aria-hidden="true"></i></label>`).join("")}</div></section><section class="room-settings-card room-password-control"><div class="room-card-heading"><div><span>访问安全</span><h3>房间密码</h3></div></div><div class="room-password-form"><input type="password" data-room-password maxlength="128" placeholder="${roomSession.passwordProtected ? "输入新密码，留空可移除" : "可选：设置访问密码"}"><button type="button" data-room-password-save>保存密码</button></div></section><section class="room-danger-zone"><div><h3>结束房间</h3></div><button type="button" data-room-end>结束房间</button></section></div>`;
    else if (roomTab === "members")
      panel.innerHTML = `<section class="room-tab-section room-members"><header class="room-tab-heading"><div><span>实时成员</span><h3>房间成员</h3></div><em id="roomDeviceCount">${roomSession.connections?.length || 0} 人在线</em></header><div id="roomDeviceList" class="connection-list">${connectionsMarkup(roomSession.connections)}</div></section>`;
    else if (roomTab === "polls") panel.innerHTML = roomPollMarkup();
    else panel.innerHTML = roomCommentsMarkup();

    if (roomTab === "settings") {
      panel.querySelector("[data-copy-room]").onclick = (event) =>
        copySessionLink(event.currentTarget, roomSession.url);
      bindSessionQR(panel);
      panel.querySelectorAll("[data-room-permission]").forEach((input) => {
        input.onchange = async () => {
          const permissions = {
            ...roomSession.permissions,
            [input.dataset.roomPermission]: input.checked,
          };
          try {
            const state = await sessionRequest(`/rooms/${roomSession.token}`, {
              method: "PATCH",
              headers: { "X-Room-Host": roomSession.hostToken },
              body: { permissions, page: current },
            });
            roomSession.permissions = state.permissions;
            ensureRoomChrome();
            toast("房间权限已更新");
          } catch (error) {
            input.checked = !input.checked;
            toast(error.message);
          }
        };
      });
      panel.querySelector("[data-room-password-save]").onclick = async (
        event,
      ) => {
        const input = panel.querySelector("[data-room-password]");
        event.currentTarget.disabled = true;
        try {
          const state = await sessionRequest(`/rooms/${roomSession.token}`, {
            method: "PATCH",
            headers: { "X-Room-Host": roomSession.hostToken },
            body: { password: input.value, page: current },
          });
          roomSession = { ...roomSession, ...state };
          ensureRoomChrome();
          renderRoomTab();
          toast(
            state.passwordProtected
              ? "房间密码已更新，观众需要重新加入"
              : "房间密码已移除",
          );
        } catch (error) {
          event.currentTarget.disabled = false;
          toast(error.message);
        }
      };
      panel.querySelector("[data-room-end]").onclick = endRoom;
    } else if (roomTab === "polls") bindRoomPoll(panel);
  }
  function bindRoomPoll(panel) {
    const form = panel.querySelector("#roomPollForm"),
      addOption = () => {
        const fields = form.querySelector(".poll-option-fields"),
          count = fields.children.length;
        if (count >= 8) return toast("最多可添加 8 个选项");
        const label = document.createElement("label");
        label.innerHTML = `选项 ${count + 1}<span><input name="option" maxlength="100" placeholder="输入选项" required><button type="button" aria-label="删除选项">${ico("close")}</button></span>`;
        label.querySelector("button").onclick = () => label.remove();
        fields.append(label);
        label.querySelector("input").focus();
      };
    form.querySelector(".add-poll-option").onclick = addOption;
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      event.submitter.disabled = true;
      try {
        audienceSession = await sessionRequest(
          `/audience-sessions/${audienceSession.token}/polls`,
          {
            method: "POST",
            body: {
              question: values.get("question"),
              options: values
                .getAll("option")
                .map((value) => String(value).trim())
                .filter(Boolean),
            },
          },
        );
        renderRoomTab();
        toast("投票已发起");
      } catch (error) {
        event.submitter.disabled = false;
        toast(error.message);
      }
    };
    panel.querySelectorAll("[data-close-room-poll]").forEach((button) => {
      button.onclick = async () => {
        button.disabled = true;
        try {
          audienceSession = await sessionRequest(
            `/audience-sessions/${audienceSession.token}/polls/${button.dataset.closeRoomPoll}/close`,
            { method: "POST", body: {} },
          );
          renderRoomTab();
        } catch (error) {
          button.disabled = false;
          toast(error.message);
        }
      };
    });
  }
  function rememberRoomSession(session) {
    const saved = JSON.stringify({
      token: session.token,
      hostToken: session.hostToken,
      savedAt: Date.now(),
    });
    try {
      hostWindow.sessionStorage.setItem(roomHostKey, saved);
      localStorage.setItem(roomHostKey, saved);
    } catch {}
  }
  function forgetRoomSession() {
    try {
      hostWindow.sessionStorage.removeItem(roomHostKey);
      localStorage.removeItem(roomHostKey);
    } catch {}
  }
  function rememberedRoomSession() {
    let saved;
    try {
      saved = JSON.parse(
        hostWindow.sessionStorage.getItem(roomHostKey) ||
          localStorage.getItem(roomHostKey),
      );
    } catch {}
    if (!saved?.token || !saved?.hostToken) return null;
    if (saved.savedAt && Date.now() - saved.savedAt > 8 * 60 * 60 * 1000) {
      forgetRoomSession();
      return null;
    }
    return { ...saved, savedAt: saved.savedAt || Date.now() };
  }
  async function endRoom() {
    try {
      await sessionRequest(`/rooms/${roomSession.token}`, {
        method: "DELETE",
        headers: { "X-Room-Host": roomSession.hostToken },
      });
    } catch {}
    roomSocketGeneration += 1;
    roomSocket?.close();
    roomSocket = null;
    roomSession = null;
    audienceSession = null;
    hostWindow.clearInterval(audienceInterval);
    hostWindow.clearInterval(roomPingInterval);
    hostWindow.clearTimeout(roomReconnectTimer);
    hostWindow.clearTimeout(roomRestoreTimer);
    audienceInterval = 0;
    roomLatency = null;
    forgetRoomSession();
    $("roomLiveFeed")?.remove();
    dismissPanel();
    toast("房间已结束");
  }
  function renderRoom() {
    if (!roomSession) return;
    const body = $("roomBody"),
      panel = $("roomPanel");
    panel?.classList.remove("room-setup-mode");
    panel?.classList.add("room-dashboard-mode");
    body.className = "room-dashboard";
    body.innerHTML = `<div class="room-dashboard-shell"><aside class="room-dashboard-nav"><div class="room-live-summary"><span><i></i>房间进行中</span><strong><b id="roomNavCount">${roomSession.connections?.length || 0}</b> 人在线</strong></div><nav class="room-tabs" role="tablist" aria-label="房间管理">${roomTabs
      .map(([id, label, icon]) => {
        const count = roomTabCount(id);
        return `<button type="button" role="tab" data-room-tab="${id}" aria-selected="${roomTab === id}"><span class="room-tab-icon">${ico(icon)}</span><span class="room-tab-label">${escapeHTML(label)}</span>${count === null ? "" : `<em class="room-tab-badge">${count}</em>`}</button>`;
      })
      .join(
        "",
      )}</nav></aside><div id="roomTabPanel" class="room-tab-panel" role="tabpanel"></div></div>`;
    body.querySelectorAll("[data-room-tab]").forEach(
      (button) =>
        (button.onclick = () => {
          roomTab = button.dataset.roomTab;
          body
            .querySelectorAll("[data-room-tab]")
            .forEach((tab) =>
              tab.setAttribute("aria-selected", tab === button),
            );
          renderRoomTab();
        }),
    );
    renderRoomTab();
    startAudiencePolling();
  }
  function renderRoomSetup() {
    const body = $("roomBody");
    $("roomPanel")?.classList.remove("room-dashboard-mode");
    $("roomPanel")?.classList.add("room-setup-mode");
    body.className = "room-setup";
    body.innerHTML = `<form id="roomSetupForm" class="room-setup-shell"><section class="room-setup-hero"><span class="room-setup-symbol">${ico("room")}</span><p class="room-setup-kicker">实时同步放映</p><h3>创建演示房间</h3><p>观众通过链接或二维码加入后，会同步看到当前页面、光标和批注。</p><ul><li>${ico("check")}页面切换即时同步</li><li>${ico("check")}评论、投票与评分集中管理</li><li>${ico("check")}权限可以随时调整</li></ul></section><section class="room-setup-config"><header><h3>访问配置</h3></header><label class="room-setup-password"><span><b>房间密码</b><em>可选</em></span><input name="password" type="password" maxlength="128" placeholder="不填写则无需密码"></label><fieldset class="room-setup-permission-grid"><legend>默认权限</legend>${roomPermissionRows.map(([key, label, description, icon]) => `<label><input type="checkbox" name="${key}" ${["directory", "interaction", "showInteractionFeed", "showOnlineCount"].includes(key) ? "checked" : ""}><span class="room-setup-option-icon">${ico(icon)}</span><span><b>${escapeHTML(label)}</b><small>${escapeHTML(description)}</small></span><i aria-hidden="true"></i></label>`).join("")}</fieldset><div class="room-setup-actions"><button type="button" data-close="roomPanel">取消</button><button type="submit" class="session-primary">${ico("room")}开启房间</button></div></section></form>`;
    body.querySelector("[data-close]").onclick = () => dismissPanel();
    body.querySelector("form").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget,
        values = new FormData(form),
        button = event.submitter;
      button.disabled = true;
      button.innerHTML = `${ico("room")}正在开启…`;
      try {
        roomSession = await sessionRequest("/rooms", {
          method: "POST",
          body: {
            deckId,
            page: current,
            password: values.get("password"),
            permissions: Object.fromEntries(
              [
                "directory",
                "notes",
                "interaction",
                "downloadPdf",
                "showInteractionFeed",
                "showOnlineCount",
              ].map((key) => [key, values.has(key)]),
            ),
          },
        });
        audienceSession = roomSession.interaction;
        rememberRoomSession(roomSession);
        roomTab = "settings";
        connectRoom();
        ensureRoomChrome();
        renderRoom();
      } catch (error) {
        button.disabled = false;
        button.innerHTML = `${ico("room")}开启房间`;
        toast(error.message);
      }
    };
  }
  async function restoreRoomSession() {
    const saved = rememberedRoomSession();
    if (!saved) return;
    try {
      roomSession = await sessionRequest(`/rooms/${saved.token}/host`, {
        headers: { "X-Room-Host": saved.hostToken },
      });
      rememberRoomSession(roomSession);
      audienceSession = roomSession.interaction;
      roomTab = "settings";
      if (Number.isFinite(roomSession.page)) go(roomSession.page, false);
      roomRestoreDelay = 700;
      connectRoom();
      ensureRoomChrome();
      startAudiencePolling();
    } catch (error) {
      roomSession = null;
      audienceSession = null;
      if (error.status === 403) {
        forgetRoomSession();
        return;
      }
      hostWindow.clearTimeout(roomRestoreTimer);
      const delay = roomRestoreDelay + Math.random() * 180;
      roomRestoreDelay = Math.min(8000, roomRestoreDelay * 1.65);
      roomRestoreTimer = hostWindow.setTimeout(restoreRoomSession, delay);
    }
  }
  function openRoom() {
    openPanel("roomPanel");
    if (roomSession) renderRoom();
    else renderRoomSetup();
  }
  function captureAudienceDraft() {
    const form = $("audiencePollForm"),
      active = document.activeElement;
    if (!form || !active?.closest("#audiencePollForm")) return null;
    const optionInputs = [...form.querySelectorAll('[name="option"]')],
      optionIndex = optionInputs.indexOf(active);
    return {
      question: form.elements.question.value,
      options: optionInputs.map((input) => input.value),
      focus: active.name === "question" ? "question" : "option",
      optionIndex,
      selectionStart: active.selectionStart,
      selectionEnd: active.selectionEnd,
    };
  }
  function renderAudienceDashboard(draft = null) {
    if (!audienceSession) return;
    const panel = $("audienceDashboard"),
      poll = audienceSession.poll,
      feedback = audienceSession.feedback,
      qr = audienceSession.qr || panel.querySelector("img")?.src || "",
      totalVotes = poll?.votes || 0,
      unanswered = audienceSession.questions.filter(
        (question) => !question.answered,
      ).length;
    panel.innerHTML = `<div class="session-connect audience-connect"><div class="session-qr"><button type="button" class="session-qr-frame" aria-label="放大观众互动二维码"><img src="${escapeHTML(qr)}" alt="观众互动二维码"></button><span>${ico("audience")}扫码加入</span></div><div><label>互动地址</label><div class="session-link"><input value="${escapeHTML(audienceSession.url)}" readonly><button type="button" data-copy-audience>${ico("check")}复制链接</button></div><div class="audience-metrics"><span><b>${audienceSession.questionCount}</b>评论</span><span><b>${totalVotes}</b>投票</span><span><b>${feedback.count ? feedback.average.toFixed(1) : "—"}</b>评分</span></div></div></div><section class="session-connections audience-connections"><div class="connection-heading"><div><h3>参与设备</h3><p>已打开互动页面的设备</p></div><span>${audienceSession.connections?.length || 0} 台</span></div><div class="connection-list">${connectionsMarkup(audienceSession.connections)}</div></section><div class="audience-dashboard-grid"><form id="audiencePollForm" class="audience-poll-form"><div class="poll-heading"><div><h3>发起投票</h3><p>设置问题与选项</p></div>${poll?.status === "open" ? '<span class="session-status live"><i></i>进行中</span>' : '<span class="session-status">未开始</span>'}</div><label>投票题目<input name="question" maxlength="200" placeholder="输入一个简短问题" required></label><div class="poll-option-fields"><label>选项 1<input name="option" maxlength="100" placeholder="输入选项" required></label><label>选项 2<input name="option" maxlength="100" placeholder="输入选项" required></label></div><button type="button" class="add-poll-option">${ico("plus")}添加选项</button><div class="poll-actions"><button class="session-primary" type="submit">${poll?.status === "open" ? "发布新投票" : "发起投票"}</button>${poll?.status === "open" ? '<button type="button" class="audience-close-poll">结束当前投票</button>' : ""}</div></form>${
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
    }</div><section class="audience-questions"><div class="question-heading"><div><h3>现场评论</h3><p>${unanswered ? `${unanswered} 条未处理` : "暂无未处理评论"}</p></div><span>${audienceSession.questionCount}</span></div>${
      audienceSession.questions.length
        ? [...audienceSession.questions]
            .sort((a, b) => Number(a.answered) - Number(b.answered))
            .map(
              (question) =>
                `<button type="button" data-question="${question.id}" class="${question.answered ? "answered" : ""}"><span><b>${escapeHTML(question.name || "匿名观众")}</b>${escapeHTML(question.body)}</span><em>${question.answered ? `${ico("check")}已回答` : "标记已回答"}</em></button>`,
            )
            .join("")
        : '<p class="session-empty">还没有收到评论</p>'
    }</section>`;
    panel.querySelector("[data-copy-audience]").onclick = (event) =>
      copySessionLink(event.currentTarget, audienceSession.url);
    bindSessionQR(panel);
    panel.append(panel.querySelector(".audience-connections"));
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
        toast("投票已发起");
      } catch (error) {
        button.disabled = false;
        toast(error.message);
      }
    };
    const addPollOption = (value = "") => {
      const fields = panel.querySelector(".poll-option-fields"),
        count = fields.children.length;
      if (count >= 8) return toast("最多可添加 8 个选项");
      const label = document.createElement("label");
      label.innerHTML = `选项 ${count + 1}<span><input name="option" maxlength="100" placeholder="输入选项" required><button type="button" aria-label="删除选项">${ico("close")}</button></span>`;
      label.querySelector("button").onclick = () => label.remove();
      fields.append(label);
      label.querySelector("input").value = value;
      return label.querySelector("input");
    };
    panel.querySelector(".add-poll-option").onclick = () =>
      addPollOption()?.focus();
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
    if (draft) {
      const form = panel.querySelector("#audiencePollForm"),
        options = [...form.querySelectorAll('[name="option"]')];
      form.elements.question.value = draft.question;
      draft.options.slice(0, 2).forEach((value, index) => {
        options[index].value = value;
      });
      draft.options.slice(2).forEach((value) => addPollOption(value));
      const target =
        draft.focus === "question"
          ? form.elements.question
          : form.querySelectorAll('[name="option"]')[draft.optionIndex];
      target?.focus({ preventScroll: true });
      target?.setSelectionRange?.(draft.selectionStart, draft.selectionEnd);
    }
  }
  function startAudiencePolling() {
    audienceInterval ||= hostWindow.setInterval(async () => {
      const audienceOpen = $("audiencePanel") && !$("audiencePanel").hidden,
        roomOpen = $("roomPanel") && !$("roomPanel").hidden;
      if (!audienceSession || (!audienceOpen && !roomOpen && !roomSession))
        return;
      try {
        const next = await sessionRequest(
          `/audience-sessions/${audienceSession.token}`,
        );
        next.qr = audienceSession.qr;
        audienceSession = next;
        updateRoomTabBadges();
        if (roomSession)
          renderLiveFeed({
            poll: next.poll,
            polls: next.polls,
            comments: next.questions,
          });
        if (audienceOpen) renderAudienceDashboard(captureAudienceDraft());
        if (
          roomOpen &&
          ["polls", "comments"].includes(roomTab) &&
          !document.activeElement?.closest("#roomPollForm")
        )
          renderRoomTab();
      } catch {}
    }, 1800);
  }
  async function startAudience() {
    if (audienceSession || audienceStarting) return;
    audienceStarting = true;
    const setup = $("audienceSetup");
    setup.className = "session-loading";
    setup.textContent = "正在开启观众互动…";
    try {
      audienceSession = await sessionRequest("/audience-sessions", {
        method: "POST",
        body: { deckId },
      });
      setup.hidden = true;
      $("audienceDashboard").hidden = false;
      renderAudienceDashboard();
      startAudiencePolling();
    } catch (error) {
      setup.hidden = false;
      setup.className = "audience-session-setup";
      setup.innerHTML = `<p>${escapeHTML(error.message)}</p><button id="retryAudience" type="button">重试</button>`;
      $("retryAudience").onclick = startAudience;
      toast(error.message);
    } finally {
      audienceStarting = false;
    }
  }
  function openAudience() {
    openPanel("audiencePanel");
    if (audienceSession) {
      $("audienceSetup").hidden = true;
      $("audienceDashboard").hidden = false;
      renderAudienceDashboard();
      startAudiencePolling();
    } else startAudience();
  }
  function renderRoomPollDialog() {
    const body = $("roomPollBody"),
      polls =
        roomAudienceState?.polls ||
        (roomAudienceState?.poll ? [roomAudienceState.poll] : []);
    if (!body) return;
    if (!polls.length) {
      body.innerHTML = `<div class="room-poll-empty">${ico("chartNoAxesColumn")}<b>暂时没有投票</b><span>房主发布后会显示在这里</span></div>`;
      return;
    }
    const pollCard = (poll) => {
        const submitted =
            hostWindow.sessionStorage.getItem(audienceVoteKey(poll.id)) === "1",
          showResults = poll.status !== "open" || submitted,
          total = poll.votes || 0;
        return `<article class="room-poll-card ${poll.status === "open" ? "is-open" : "is-closed"}"><div class="room-poll-card-top"><span class="room-poll-state">${poll.status === "open" ? "正在投票" : "已结束"}</span><span class="room-poll-participants">${total} 人参与</span></div><h3 class="room-poll-question">${escapeHTML(poll.question)}</h3><div class="room-poll-card-options">${poll.options
          .map((option, index) => {
            const percent = total
              ? Math.round((option.count / total) * 100)
              : 0;
            return `<button type="button" data-instant-room-vote="${index}" data-poll-id="${poll.id}" ${showResults ? "disabled" : ""}>${showResults ? `<i style="width:${percent}%"></i>` : ""}<span>${escapeHTML(option.label)}</span>${showResults ? `<b>${percent}%</b>` : "<em></em>"}</button>`;
          })
          .join("")}</div></article>`;
      },
      sections = [
        ["待参与", polls.filter((poll) => poll.status === "open")],
        ["投票历史", polls.filter((poll) => poll.status !== "open")],
      ].filter(([, items]) => items.length);
    body.innerHTML = `<div class="room-poll-sections">${sections
      .map(
        ([label, items]) =>
          `<section class="room-poll-section"><div class="room-poll-section-title"><b>${label}</b><span>${items.length}</span></div><div class="room-poll-card-list">${items.map(pollCard).join("")}</div></section>`,
      )
      .join("")}</div>`;
    body.querySelectorAll("[data-instant-room-vote]").forEach((button) => {
      button.onclick = async () => {
        const pollId = button.dataset.pollId,
          card = button.closest(".room-poll-card");
        card
          .querySelectorAll("button")
          .forEach((item) => (item.disabled = true));
        card.classList.add("is-submitting");
        try {
          roomAudienceState = await roomAudienceRequest("/vote", {
            method: "POST",
            body: {
              pollId,
              option: Number(button.dataset.instantRoomVote),
              visitor: audienceVisitor,
              name: localStorage.getItem("powerdeck-room-name") || "匿名观众",
            },
          });
          hostWindow.sessionStorage.setItem(audienceVoteKey(pollId), "1");
          updateRoomPollBadge(roomAudienceState.polls || []);
          renderRoomPollDialog();
        } catch (error) {
          renderRoomPollDialog();
          toast(error.message);
        }
      };
    });
  }
  function renderRoomRatingDialog(message = "") {
    const body = $("roomRatingPopover"),
      rating = Number(
        hostWindow.sessionStorage.getItem(audienceRatingKey()) || 0,
      );
    if (!body) return;
    body.innerHTML = `<div class="room-rating-head"><span>${rating ? `已评分 ${rating} 分` : "为本次演示评分"}</span><button type="button" data-close-rating aria-label="关闭">${ico("close")}</button></div><div class="room-rating-options">${[
      1, 2, 3, 4, 5,
    ]
      .map(
        (number) =>
          `<button type="button" data-room-rating="${number}" class="${rating === number ? "selected" : ""}" aria-label="${number} 分"><span>${number}</span>${ico("star")}</button>`,
      )
      .join("")}</div><p>${escapeHTML(message || "点击分数即可提交")}</p>`;
    body.querySelector("[data-close-rating]").onclick = () => {
      closeRoomInteractionPopover(body);
    };
    body.querySelectorAll("[data-room-rating]").forEach(
      (button) =>
        (button.onclick = async () => {
          const value = Number(button.dataset.roomRating);
          body
            .querySelectorAll("button")
            .forEach((item) => (item.disabled = true));
          try {
            await roomAudienceRequest("/feedback", {
              method: "POST",
              body: { rating: value, visitor: audienceVisitor },
            });
            hostWindow.sessionStorage.setItem(
              audienceRatingKey(),
              String(value),
            );
            renderRoomRatingDialog(`已提交 ${value} 分评价`);
            hostWindow.setTimeout(() => closeRoomInteractionPopover(body), 900);
          } catch (error) {
            renderRoomRatingDialog(error.message);
          }
        }),
    );
  }
  async function openRoomInteraction(mode) {
    if (mode === "rating") {
      const popover = $("roomRatingPopover"),
        opening = popover.hidden;
      closeRoomInteractionPopover($("roomPollPanel"), true);
      if (!opening) {
        closeRoomInteractionPopover(popover);
        return;
      }
      renderRoomRatingDialog();
      openRoomInteractionPopover(popover, $("roomRatingBtn"));
      return;
    }
    const panel = $("roomPollPanel");
    if (!panel) return;
    const opening = panel.hidden;
    if (!opening) {
      closeRoomInteractionPopover(panel);
      return;
    }
    closeRoomInteractionPopover($("roomRatingPopover"), true);
    const body = $("roomPollBody");
    let loadedBeforeOpen = false;
    if (roomAudienceState) renderRoomPollDialog();
    else {
      body.innerHTML = '<div class="session-loading">正在加载投票…</div>';
      try {
        roomAudienceState = await roomAudienceRequest();
        renderRoomPollDialog();
        loadedBeforeOpen = true;
      } catch (error) {
        body.innerHTML = `<div class="native-interaction-empty"><h3>无法加载投票</h3><p>${escapeHTML(error.message)}</p></div>`;
      }
    }
    openRoomInteractionPopover(panel, $("roomPollBtn"));
    if (!roomAudienceState || loadedBeforeOpen) return;
    try {
      roomAudienceState = await roomAudienceRequest();
      renderRoomPollDialog();
    } catch (error) {
      if (!body.children.length)
        body.innerHTML = `<div class="native-interaction-empty"><h3>无法加载投票</h3><p>${escapeHTML(error.message)}</p></div>`;
    }
  }
  function syncViewerRoomAccess(nextRoom) {
    if (!viewerMode || !nextRoom?.permissions) return;
    const permissions = nextRoom.permissions;
    Object.assign(viewerPermissions, permissions);
    allowNotes = !!permissions.notes;
    if (nextRoom.content?.notes) {
      for (const key of Object.keys(data)) delete data[key];
      Object.assign(data, nextRoom.content.notes);
      const overview = document.querySelector(".overview-list");
      if (overview)
        overview.innerHTML = Object.entries(data)
          .map(
            ([page, entry]) =>
              `<button class="toc-item${Number(page) === current ? " current" : ""}" data-goto="${page}"><b>${String(page).padStart(2, "0")}</b><span>${escapeHTML(entry.title)}</span></button>`,
          )
          .join("");
      notesPage = 0;
      if (!$("notes").hidden && allowNotes) renderNotes();
    }
    $("overviewBtn").hidden = !permissions.directory;
    $("notesBtn").hidden = !permissions.notes;
    if (!permissions.directory && !$("overview").hidden) dismissPanel();
    if (!permissions.notes && !$("notes").hidden) dismissPanel();

    interactionURL = nextRoom.interactionURL || interactionURL;
    if (nextRoom.interactionURL)
      try {
        interactionToken = decodeURIComponent(
          new URL(nextRoom.interactionURL, hostWindow.location.origin).pathname
            .split("/")
            .filter(Boolean)
            .pop() || "",
        );
      } catch {}
    const dockTools = dock.querySelector("#dockTools");
    if (permissions.interaction && !$("roomPollBtn")) {
      dockTools.insertAdjacentHTML(
        "beforeend",
        '<span class="nav-divider room-interaction-divider" aria-hidden="true"></span><div class="room-interaction-control-group" role="group" aria-label="房间互动">' +
          dockButton(
            "roomPollBtn",
            "chartNoAxesColumn",
            "投票",
            'aria-haspopup="dialog" aria-expanded="false"',
          ) +
          dockButton(
            "roomRatingBtn",
            "star",
            "评分",
            'aria-haspopup="dialog" aria-expanded="false"',
          ) +
          "</div>",
      );
      $("roomPollBtn").onclick = () => openRoomInteraction("poll");
      $("roomRatingBtn").onclick = () => openRoomInteraction("rating");
    }
    document
      .querySelector(".room-interaction-control-group")
      ?.toggleAttribute("hidden", !permissions.interaction);
    document
      .querySelector(".room-interaction-divider")
      ?.toggleAttribute("hidden", !permissions.interaction);
    if (!permissions.interaction) {
      closeRoomInteractionPopover($("roomPollPanel"), true);
      closeRoomInteractionPopover($("roomRatingPopover"), true);
    }

    downloadURL = nextRoom.downloadURL || null;
    if (permissions.downloadPdf && downloadURL && !$("roomDownloadBtn")) {
      dockTools.insertAdjacentHTML(
        "beforeend",
        dockButton("roomDownloadBtn", "print", "下载 PDF"),
      );
      $("roomDownloadBtn").onclick = () =>
        (hostWindow.location.href = downloadURL);
    }
    $("roomDownloadBtn")?.toggleAttribute("hidden", !permissions.downloadPdf);

    const showFeed =
      permissions.interaction &&
      (permissions.showInteractionFeed || permissions.showOnlineCount);
    if (showFeed && !$("roomLiveFeed")) {
      ui.insertAdjacentHTML("beforeend", roomFeedMarkup());
      bindRoomFeedComposer();
      roomFeedSignature = "";
      renderLiveFeed(roomFeedState || { poll: null, polls: [], comments: [] });
    } else if (!showFeed) {
      $("roomLiveFeed")?.remove();
    }
    applyRoomFeedPermissions(permissions);
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
        openAudience();
        break;
      case "room":
        openRoom();
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
  if ($("roomBtn")) $("roomBtn").onclick = () => openRoom();
  if ($("roomPollBtn"))
    $("roomPollBtn").onclick = () => openRoomInteraction("poll");
  if ($("roomRatingBtn"))
    $("roomRatingBtn").onclick = () => openRoomInteraction("rating");
  if ($("roomDownloadBtn"))
    $("roomDownloadBtn").onclick = () =>
      (hostWindow.location.href = downloadURL);
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
  document.addEventListener("pointerdown", (event) => {
    const popover = $("roomRatingPopover"),
      polls = $("roomPollPanel");
    if (
      popover &&
      !popover.hidden &&
      !event.target.closest("#roomRatingPopover,#roomRatingBtn")
    )
      closeRoomInteractionPopover(popover);
    if (
      polls &&
      !polls.hidden &&
      !event.target.closest("#roomPollPanel,#roomPollBtn")
    )
      closeRoomInteractionPopover(polls);
  });
  $("stage").addEventListener("contextmenu", (e) => {
    if (panelOpen() || viewerMode) return;
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
      hostWindow.clearTimeout(roomInkSyncTimer);
      roomInkSyncTimer = 0;
      syncRoomInk();
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
      (performance.now() < eatClickUntil &&
        !["pen", "highlighter", "eraser"].includes(tool))
    )
      return;
    cursorPoint = { clientX: e.clientX, clientY: e.clientY };
    const pt = slidePoint(e);
    if (!inside(pt)) {
      clickStart = null;
      return;
    }
    clickStart = { x: e.clientX, y: e.clientY };
    if (viewerMode) return;
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
    if (drawing.changed) scheduleRoomInkSync();
  });
  $("stage").addEventListener("pointerup", (e) => {
    if (drawing && e.pointerId === drawing.id) {
      finishDraw();
      return;
    }
    if (touchStart && !viewerMode) {
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
    if (viewerMode) {
      e.preventDefault();
      showDock(4000);
      return;
    }
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
      if (viewerMode || panelOpen() || openMenu() || drawing) return;
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
    if (
      roomSession &&
      !viewerMode &&
      performance.now() - roomPointerTimer > 28
    ) {
      const point = slidePoint(e);
      roomPointerTimer = performance.now();
      roomSend({
        type: "pointer",
        pointer: inside(point)
          ? {
              page: current,
              x: point[0] / width,
              y: point[1] / height,
              tool,
              color: inkColors[tool] || inkColors.laser,
            }
          : null,
      });
    }
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
    if (roomSession && !viewerMode)
      roomSend({ type: "pointer", pointer: null });
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
      if ($("roomRatingPopover") && !$("roomRatingPopover").hidden) {
        closeRoomInteractionPopover($("roomRatingPopover"));
        return;
      }
      if ($("roomPollPanel") && !$("roomPollPanel").hidden) {
        closeRoomInteractionPopover($("roomPollPanel"));
        return;
      }
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
        "roomPanel",
      ]
        .map($)
        .find((el) => el && !el.hidden && !el.classList.contains("closing"));
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
    if (viewerMode) {
      const k = e.key.toLowerCase();
      if (k === "f") {
        e.preventDefault();
        full();
      } else if (k === "g" && viewerPermissions.directory) {
        e.preventDefault();
        togglePanel("overview");
      } else if (k === "n" && viewerPermissions.notes) {
        e.preventDefault();
        togglePanel("notes");
      }
      return;
    }
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
  const timer = viewerMode
    ? {
        go() {},
        toggle() {},
        reset() {},
        snapshot: () => ({ running: false, total: 0 }),
      }
    : mountTimer({
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
  $("roomLiveFeed")
    ?.querySelector("header button")
    ?.addEventListener("click", () =>
      $("roomLiveFeed").classList.toggle("collapsed"),
    );
  document.querySelectorAll("[data-goto]").forEach(
    (b) =>
      (b.onclick = () => {
        if (viewerMode) return;
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
  addEventListener("resize", () => {
    size();
    positionOpenRoomInteractionPopovers();
  });
  addEventListener("orientationchange", () =>
    hostWindow.setTimeout(positionOpenRoomInteractionPopovers, 180),
  );
  addEventListener("hashchange", () => {
    if (!viewerMode) go(fromHash(), false);
  });
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
    hostWindow.clearInterval(roomPingInterval);
    hostWindow.clearTimeout(roomReconnectTimer);
    hostWindow.clearTimeout(roomRestoreTimer);
    roomSocketGeneration += 1;
    roomSocket?.close();
    if (remoteSession)
      sessionRequest(`/presenter-sessions/${remoteSession.token}`, {
        method: "DELETE",
        keepalive: true,
      }).catch(() => {});
    if (audienceSession && !roomSession)
      sessionRequest(`/audience-sessions/${audienceSession.token}`, {
        method: "DELETE",
        keepalive: true,
      }).catch(() => {});
  });
  if (!allowNotes || (viewerMode && !viewerPermissions.notes))
    $("notesBtn").hidden = true;
  size();
  go(viewerMode ? initialPage : fromHash());
  if (!viewerMode && presenterURL) void restoreRoomSession();
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
    applyRoomState(state) {
      if (!state) return;
      if (state.ink)
        for (const [page, strokes] of Object.entries(state.ink))
          this.applyRoomInk(+page, strokes);
      if (Number.isFinite(state.page)) go(state.page, false);
      this.applyRoomPointer(state.pointer);
    },
    updateRoomAccess(roomData) {
      syncViewerRoomAccess(roomData);
    },
    applyRoomInk(page, strokes) {
      if (!viewerMode || !Number.isInteger(page) || !Array.isArray(strokes))
        return;
      annotations[page] = clone(strokes);
      renderInk(page);
    },
    applyRoomPointer(pointer) {
      const dot = $("roomPointer");
      if (
        !viewerMode ||
        !pointer ||
        pointer.page !== current ||
        pointer.visible === false
      ) {
        dot.classList.remove("visible");
        return;
      }
      const rect = $("deck").getBoundingClientRect();
      const pointerTool = ["pointer", "laser", "pen", "highlighter"].includes(
        pointer.tool,
      )
        ? pointer.tool
        : "pointer";
      if (dot.dataset.tool !== pointerTool) {
        dot.dataset.tool = pointerTool;
        dot.innerHTML = pointerTool === "laser" ? "" : ico(pointerTool);
      }
      dot.style.setProperty("--room-pointer-color", pointer.color || "#ff3b30");
      dot.style.left = rect.left + pointer.x * rect.width + "px";
      dot.style.top = rect.top + pointer.y * rect.height + "px";
      dot.classList.add("visible");
    },
    updateRoomParticipants(count, latency = null) {
      updateRoomPresence(count, latency);
    },
    addRoomActivity(activity) {
      pushRoomActivity(activity);
    },
    applyRoomFeed(feed) {
      renderLiveFeed(feed);
    },
    get strokeCount() {
      return inks().length;
    },
  };
  return window.presentation;
}
