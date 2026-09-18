import { api } from "../api.js";
import { icon } from "../icons.js";
import { wheelNavigation } from "../components/wheel-navigation.js";

const root = document.querySelector("#presenterApp");
const slug = decodeURIComponent(
  location.pathname.split("/").filter(Boolean)[1] || "",
);
const duration = (milliseconds) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};

try {
  const session = await api("/session");
  if (!session.authenticated) throw new Error("请登录后使用演讲者视图");
  const { id } = await api("/resolve/" + encodeURIComponent(slug));
  const [deck, content] = await Promise.all([
    api(`/decks/${id}`),
    api(`/decks/${id}/content`),
  ]);
  let current = Math.max(
      1,
      Math.min(
        deck.slideCount,
        Number.parseInt(location.hash.slice(1), 10) || 1,
      ),
    ),
    connected = false,
    lastStateAt = 0,
    running = true,
    accumulated = 0,
    startedAt = performance.now();
  const channel = new BroadcastChannel(`powerdeck-presenter:${id}`);
  document.title = `${deck.title} · 演讲者视图`;
  root.innerHTML = `<header class="presenter-topbar"><div class="presenter-title"><h1></h1><p>演讲者视图</p></div><div id="connectionStatus" class="presenter-status"><i></i><span>等待演示窗口</span></div><output id="sessionClock" class="session-clock">00:00</output></header><main class="presenter-main"><section class="presenter-card current-card"><div class="card-heading"><b>当前页面</b><span id="currentTitle"></span></div><div class="slide-frame-wrap"><iframe id="currentFrame" title="当前页面"></iframe></div></section><aside class="presenter-side"><section class="presenter-card next-card"><div class="card-heading"><b>下一页</b><span id="nextTitle"></span></div><div class="slide-frame-wrap"><iframe id="nextFrame" title="下一页"></iframe></div></section><section class="presenter-card notes-card"><div class="card-heading"><b>演讲备注</b><span id="notesPage"></span></div><div id="speakerNotes" class="speaker-notes"></div><div id="speakerRefs" class="speaker-refs" hidden><h3>参考资料</h3><div></div></div></section></aside></main><footer class="presenter-controls"><button id="previousPage" aria-label="上一页">${icon("prev")}上一页</button><div id="presenterCounter" class="presenter-counter"></div><button id="nextPage" class="primary">下一页${icon("next")}</button><button id="openProjection" class="projection-button">${icon("presentation")}打开演示窗口</button><button id="timerToggle" class="timer-toggle">${icon("pause")}暂停计时</button><button id="timerReset" class="timer-reset" aria-label="重置计时" title="重置计时">${icon("rotateCcw")}</button></footer>`;
  root.removeAttribute("aria-busy");
  root.querySelector(".presenter-title h1").textContent = deck.title;
  const $ = (selector) => root.querySelector(selector);
  const fullscreenButton = document.createElement("button");
  fullscreenButton.id = "presenterFullscreen";
  fullscreenButton.className = "fullscreen-button";
  fullscreenButton.type = "button";
  fullscreenButton.innerHTML = `${icon("full")}全屏`;
  $("#openProjection").after(fullscreenButton);
  for (const id of ["currentFrame", "nextFrame"])
    $("#" + id).className = "preview-frame is-active";
  function sizePreviewFrames() {
    for (const wrap of root.querySelectorAll(".slide-frame-wrap")) {
      const style = getComputedStyle(wrap),
        availableWidth =
          wrap.clientWidth -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight),
        availableHeight =
          wrap.clientHeight -
          Number.parseFloat(style.paddingTop) -
          Number.parseFloat(style.paddingBottom),
        width = Math.max(
          0,
          Math.min(availableWidth, (availableHeight * 16) / 9),
        ),
        height = (width * 9) / 16;
      for (const frame of wrap.querySelectorAll("iframe")) {
        frame.style.width = `${width}px`;
        frame.style.height = `${height}px`;
      }
    }
  }
  const previewObserver = new ResizeObserver(sizePreviewFrames);
  root
    .querySelectorAll(".slide-frame-wrap")
    .forEach((wrap) => previewObserver.observe(wrap));
  const previewURL = () => `/api/decks/${id}/thumbnail?all=1&v=${deck.version}`;
  function displayPreviewPage(frame, page) {
    if (!frame.dataset.ready) return;
    const previous = frame._activePreview,
      next = frame._previewPages?.get(page);
    if (!next || previous === next) return;
    if (previous) {
      previous.style.setProperty("display", "none", "important");
      previous.removeAttribute("data-presenter-preview-active");
      previous.setAttribute("aria-hidden", "true");
    }
    next.style.setProperty("display", "block", "important");
    next.setAttribute("data-presenter-preview-active", "true");
    next.setAttribute("aria-hidden", "false");
    frame._activePreview = next;
    frame.dataset.page = String(page);
  }
  function updatePreview(card, frameId, page) {
    const wrap = root.querySelector(`${card} .slide-frame-wrap`),
      frame = $("#" + frameId);
    wrap.dataset.requestedPage = page ? String(page) : "";
    if (!page) {
      wrap.classList.add("is-empty");
      frame.classList.remove("is-active");
      return;
    }
    wrap.classList.remove("is-empty");
    frame.classList.add("is-active");
    displayPreviewPage(frame, page);
  }
  for (const id of ["currentFrame", "nextFrame"]) {
    const frame = $("#" + id);
    frame.onload = () => {
      frame._previewPages = new Map(
        [...frame.contentDocument.querySelectorAll(".slide")].map((slide) => [
          Number(slide.dataset.page),
          slide,
        ]),
      );
      frame._activePreview =
        frame.contentDocument.querySelector('[data-page="1"]');
      frame._activePreview?.setAttribute(
        "data-presenter-preview-active",
        "true",
      );
      frame.dataset.ready = "true";
      displayPreviewPage(
        frame,
        Number(frame.closest(".slide-frame-wrap").dataset.requestedPage) || 1,
      );
    };
    frame.src = previewURL();
  }
  function noteAt(page) {
    return (
      content.notes?.[page] || { title: `第 ${page} 页`, notes: "", refs: [] }
    );
  }
  function render() {
    const note = noteAt(current),
      next = current < deck.slideCount ? noteAt(current + 1) : null;
    location.hash = String(current);
    updatePreview(".current-card", "currentFrame", current);
    $("#currentTitle").textContent = note.title || `第 ${current} 页`;
    $("#nextTitle").textContent = next
      ? next.title || `第 ${current + 1} 页`
      : "演示结束";
    updatePreview(".next-card", "nextFrame", next ? current + 1 : null);
    $("#notesPage").textContent = `${current} / ${deck.slideCount}`;
    $("#speakerNotes").textContent = note.notes || "此页没有演讲备注";
    $("#speakerNotes").classList.toggle("empty", !note.notes);
    const refs = Array.isArray(note.refs) ? note.refs : [],
      refBox = $("#speakerRefs");
    refBox.hidden = !refs.length;
    const list = refBox.querySelector("div");
    list.replaceChildren();
    for (const [label, url] of refs) {
      const link = document.createElement("a");
      link.textContent = label || url;
      link.href = url;
      link.target = "_blank";
      link.rel = "noopener";
      list.append(link);
    }
    $("#presenterCounter").textContent =
      `${String(current).padStart(2, "0")} / ${deck.slideCount}`;
    $("#previousPage").disabled = current === 1;
    $("#nextPage").disabled = current === deck.slideCount;
  }
  function go(page, notify = true) {
    const next = Math.max(1, Math.min(deck.slideCount, Math.trunc(page)));
    if (next === current) return;
    current = next;
    render();
    if (notify) channel.postMessage({ type: "go", page: current });
  }
  function updateConnection() {
    $("#connectionStatus").classList.toggle("connected", connected);
    $("#connectionStatus span").textContent = connected
      ? "已连接演示窗口"
      : "等待演示窗口";
  }
  let pendingStatePage = null,
    stateFrame = 0;
  channel.onmessage = ({ data }) => {
    if (data?.type === "notes") {
      const note = noteAt(data.page);
      content.notes[data.page] = { ...note, notes: data.notes };
      if (data.page === current) render();
      return;
    }
    if (data?.type !== "state") return;
    connected = true;
    lastStateAt = performance.now();
    updateConnection();
    pendingStatePage = data.current;
    if (stateFrame) return;
    stateFrame = requestAnimationFrame(() => {
      stateFrame = 0;
      go(pendingStatePage, false);
    });
  };
  $("#previousPage").onclick = () => go(current - 1);
  $("#nextPage").onclick = () => go(current + 1);
  for (const preview of root.querySelectorAll(".slide-frame-wrap")) {
    preview.tabIndex = 0;
    preview.setAttribute("role", "button");
    preview.setAttribute("aria-label", "前往下一页");
    preview.onclick = () => go(current + 1);
    preview.onkeydown = (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      go(current + 1);
    };
  }
  const handleWheel = wheelNavigation((direction) => go(current + direction));
  addEventListener(
    "wheel",
    (event) => {
      if (event.target.closest(".speaker-notes,.speaker-refs")) return;
      if (handleWheel(event)) event.preventDefault();
    },
    { passive: false },
  );
  $("#openProjection").onclick = () => {
    const projection = open(
      `/present/${encodeURIComponent(deck.slug)}#${current}`,
      `powerdeck-projection-${id}`,
    );
    projection?.focus();
  };
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      fullscreenButton.title = "请使用浏览器的全屏功能";
    }
  }
  function updateFullscreenButton() {
    const active = Boolean(document.fullscreenElement);
    fullscreenButton.innerHTML = `${icon(active ? "exitFull" : "full")}${active ? "退出全屏" : "全屏"}`;
    fullscreenButton.setAttribute(
      "aria-label",
      active ? "退出全屏" : "进入全屏",
    );
  }
  fullscreenButton.onclick = toggleFullscreen;
  addEventListener("fullscreenchange", updateFullscreenButton);
  updateFullscreenButton();
  $("#timerToggle").onclick = () => {
    if (running) accumulated += performance.now() - startedAt;
    else startedAt = performance.now();
    running = !running;
    $("#timerToggle").innerHTML = running
      ? `${icon("pause")}暂停计时`
      : `${icon("play")}继续计时`;
  };
  $("#timerReset").onclick = () => {
    accumulated = 0;
    startedAt = performance.now();
  };
  addEventListener("keydown", (event) => {
    if (event.target.closest("a,button,input,textarea")) return;
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      toggleFullscreen();
      return;
    }
    if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(event.key)) {
      event.preventDefault();
      go(current + 1);
    }
    if (["ArrowLeft", "ArrowUp", "PageUp"].includes(event.key)) {
      event.preventDefault();
      go(current - 1);
    }
  });
  let lastRequestAt = 0,
    lastClock = "";
  setInterval(() => {
    const now = performance.now();
    const elapsed = accumulated + (running ? performance.now() - startedAt : 0);
    const clock = duration(elapsed);
    if (clock !== lastClock) {
      lastClock = clock;
      $("#sessionClock").textContent = clock;
    }
    if (now - lastRequestAt > (connected ? 2500 : 800)) {
      channel.postMessage({ type: "request" });
      lastRequestAt = now;
    }
    if (connected && now - lastStateAt > 6500) {
      connected = false;
      updateConnection();
    }
  }, 250);
  addEventListener("beforeunload", () => {
    cancelAnimationFrame(stateFrame);
    previewObserver.disconnect();
    channel.close();
  });
  render();
  requestAnimationFrame(sizePreviewFrames);
  channel.postMessage({ type: "request" });
} catch (error) {
  root.innerHTML = `<div class="presenter-error"></div>`;
  root.querySelector(".presenter-error").textContent = error.message;
  root.removeAttribute("aria-busy");
}
