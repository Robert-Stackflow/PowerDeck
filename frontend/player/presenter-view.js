import { api, esc, setSession } from "../api.js";
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
  setSession(session);
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
    startedAt = performance.now(),
    pageStartedAt = performance.now(),
    pageStats = Array.from({ length: deck.slideCount }, () => ({
      ms: 0,
      visits: 0,
    }));
  pageStats[current - 1].visits = 1;
  const channel = new BroadcastChannel(`powerdeck-presenter:${id}`);
  document.title = `${deck.title} · 演讲者视图`;
  root.innerHTML = `<header class="presenter-topbar"><div class="presenter-title"><h1></h1><p>演讲者视图</p></div><div id="connectionStatus" class="presenter-status"><i></i><span>等待演示窗口</span></div><button id="audienceButton" class="topbar-action" type="button">${icon("messageSquare")}观众互动</button><button id="remoteControlButton" class="topbar-action" type="button">${icon("smartphone")}手机遥控</button><output id="sessionClock" class="session-clock">00:00</output></header><main class="presenter-main"><section class="presenter-card current-card"><div class="card-heading"><b>当前页面</b><span id="currentTitle"></span></div><div class="slide-frame-wrap"><iframe id="currentFrame" title="当前页面"></iframe></div></section><aside class="presenter-side"><section class="presenter-card next-card"><div class="card-heading"><b>下一页</b><span id="nextTitle"></span></div><div class="slide-frame-wrap"><iframe id="nextFrame" title="下一页"></iframe></div></section><section class="presenter-card notes-card"><div class="card-heading"><b>演讲备注</b><span id="notesPage"></span></div><div id="speakerNotes" class="speaker-notes"></div><div id="speakerRefs" class="speaker-refs" hidden><h3>参考资料</h3><div></div></div></section></aside></main><footer class="presenter-controls"><button id="previousPage" aria-label="上一页">${icon("prev")}上一页</button><div id="presenterCounter" class="presenter-counter"></div><button id="nextPage" class="primary">下一页${icon("next")}</button><button id="openProjection" class="projection-button">${icon("presentation")}打开演示窗口</button><button id="finishRehearsal">${icon("flag")}结束排练</button><button id="timerToggle" class="timer-toggle">${icon("pause")}暂停计时</button><button id="timerReset" class="timer-reset" aria-label="重置计时" title="重置计时">${icon("rotateCcw")}</button></footer><section id="remoteControlPanel" class="presenter-dialog" hidden role="dialog" aria-modal="true" aria-labelledby="remoteControlTitle"><div class="presenter-dialog-card remote-control-card"><button class="dialog-dismiss" type="button" aria-label="关闭">${icon("close")}</button><div><p class="dialog-eyebrow">手机遥控器</p><h2 id="remoteControlTitle">扫码连接演讲</h2><p>手机无需登录。扫码后可以切换页面、查看备注和控制计时。</p></div><img id="remoteControlQR" alt="手机遥控器二维码"><div class="remote-control-link"><input id="remoteControlURL" readonly aria-label="遥控器链接"><button id="copyRemoteURL" type="button">${icon("copy")}复制</button></div></div></section><section id="audiencePanel" class="presenter-dialog" hidden role="dialog" aria-modal="true" aria-labelledby="audienceTitle"><div class="presenter-dialog-card audience-card"><button class="dialog-dismiss" type="button" aria-label="关闭">${icon("close")}</button><div><p class="dialog-eyebrow">现场互动</p><h2 id="audienceTitle">观众互动中心</h2><p>观众扫码后可以匿名提问、参与投票和提交评分。</p></div><div id="audienceSetup" class="audience-setup"><button id="startAudience" class="dialog-primary" type="button">开启观众互动</button></div><div id="audienceDashboard" hidden></div></div></section><section id="rehearsalPanel" class="presenter-dialog" hidden role="dialog" aria-modal="true" aria-labelledby="rehearsalTitle"><div class="presenter-dialog-card rehearsal-card"><button class="dialog-dismiss" type="button" aria-label="关闭">${icon("close")}</button><div><p class="dialog-eyebrow">排练报告</p><h2 id="rehearsalTitle">本次演讲复盘</h2></div><div class="rehearsal-summary"></div><div class="rehearsal-table"></div><button id="continueRehearsal" class="dialog-primary" type="button">继续排练</button></div></section>`;
  root.removeAttribute("aria-busy");
  root.querySelector(".presenter-title h1").textContent = deck.title;
  const $ = (selector) => root.querySelector(selector);
  let remoteSession = null,
    audienceSession = null,
    audienceInterval = 0,
    lastRemoteCommand = 0,
    remoteBusy = false;
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
  function settlePage() {
    if (!running) return;
    const now = performance.now();
    pageStats[current - 1].ms += Math.max(0, now - pageStartedAt);
    pageStartedAt = now;
  }
  function go(page, notify = true) {
    const next = Math.max(1, Math.min(deck.slideCount, Math.trunc(page)));
    if (next === current) return;
    settlePage();
    current = next;
    pageStats[current - 1].visits += 1;
    pageStartedAt = performance.now();
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
  const closePresenterDialog = (panel) => {
    panel.hidden = true;
  };
  for (const panel of root.querySelectorAll(".presenter-dialog")) {
    panel.querySelector(".dialog-dismiss").onclick = () =>
      closePresenterDialog(panel);
    panel.onclick = (event) => {
      if (event.target === panel) closePresenterDialog(panel);
    };
  }
  try {
    remoteSession = await api("/presenter-sessions", {
      method: "POST",
      body: { deckId: id, page: current },
    });
    $("#remoteControlQR").src = remoteSession.qr;
    $("#remoteControlURL").value = remoteSession.url;
  } catch {
    $("#remoteControlButton").disabled = true;
    $("#remoteControlButton").title = "暂时无法创建遥控会话";
  }
  $("#remoteControlButton").onclick = () => {
    if (remoteSession) $("#remoteControlPanel").hidden = false;
  };
  $("#copyRemoteURL").onclick = async () => {
    await navigator.clipboard.writeText(remoteSession.url);
    $("#copyRemoteURL").innerHTML = `${icon("check")}已复制`;
    setTimeout(
      () => ($("#copyRemoteURL").innerHTML = `${icon("copy")}复制`),
      1600,
    );
  };
  function renderAudienceDashboard() {
    if (!audienceSession) return;
    const panel = $("#audienceDashboard"),
      poll = audienceSession.poll,
      feedback = audienceSession.feedback;
    panel.innerHTML = `<div class="audience-connect"><img src="${esc(audienceSession.qr || panel.querySelector("img")?.src || "")}" alt="观众互动二维码"><div><label>互动地址</label><div class="remote-control-link"><input value="${esc(audienceSession.url)}" readonly><button type="button" data-copy-audience>${icon("copy")}复制</button></div><div class="audience-metrics"><span><b>${audienceSession.questionCount}</b> 个问题</span><span><b>${poll?.votes || 0}</b> 人投票</span><span><b>${feedback.count ? feedback.average.toFixed(1) : "—"}</b> 平均评分</span></div></div></div><form id="audiencePollForm" class="audience-poll-form"><label>发起投票<input name="question" maxlength="200" placeholder="输入投票题目" required></label><label>选项（每行一个）<textarea name="options" rows="3" placeholder="选项 A&#10;选项 B" required></textarea></label><button class="dialog-primary" type="submit">${poll?.status === "open" ? "发布新投票" : "发起投票"}</button>${poll?.status === "open" ? '<button type="button" class="audience-close-poll">结束当前投票</button>' : ""}</form>${poll ? `<section class="audience-live-poll"><h3>${esc(poll.question)}</h3>${poll.options.map((option) => `<div><span>${esc(option.label)}</span><b>${option.count}</b></div>`).join("")}</section>` : ""}<section class="audience-questions"><h3>观众问题</h3>${audienceSession.questions.length ? audienceSession.questions.map((question) => `<button type="button" data-question="${question.id}" class="${question.answered ? "answered" : ""}"><span><b>${esc(question.name)}</b>${esc(question.body)}</span>${question.answered ? icon("check") : "标记已回答"}</button>`).join("") : '<p class="empty">还没有收到问题</p>'}</section>`;
    panel.querySelector("[data-copy-audience]").onclick = async () => {
      await navigator.clipboard.writeText(audienceSession.url);
    };
    panel.querySelector("#audiencePollForm").onsubmit = async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      audienceSession = await api(
        `/audience-sessions/${audienceSession.token}/polls`,
        {
          method: "POST",
          body: {
            question: form.get("question"),
            options: String(form.get("options"))
              .split("\n")
              .map((value) => value.trim())
              .filter(Boolean),
          },
        },
      );
      renderAudienceDashboard();
    };
    panel
      .querySelector(".audience-close-poll")
      ?.addEventListener("click", async () => {
        audienceSession = await api(
          `/audience-sessions/${audienceSession.token}/polls/close`,
          { method: "POST", body: {} },
        );
        renderAudienceDashboard();
      });
    panel.querySelectorAll("[data-question]").forEach(
      (button) =>
        (button.onclick = async () => {
          audienceSession = await api(
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
  $("#audienceButton").onclick = () => {
    $("#audiencePanel").hidden = false;
  };
  $("#startAudience").onclick = async () => {
    const button = $("#startAudience");
    button.disabled = true;
    try {
      audienceSession = await api("/audience-sessions", {
        method: "POST",
        body: { deckId: id },
      });
      $("#audienceSetup").hidden = true;
      $("#audienceDashboard").hidden = false;
      renderAudienceDashboard();
      audienceInterval = setInterval(async () => {
        if (!audienceSession || $("#audiencePanel").hidden) return;
        try {
          const next = await api(`/audience-sessions/${audienceSession.token}`);
          next.qr = audienceSession.qr;
          audienceSession = next;
          renderAudienceDashboard();
        } catch {}
      }, 1800);
    } catch (error) {
      button.disabled = false;
      button.textContent = error.message;
    }
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
  function toggleTimer() {
    if (running) {
      settlePage();
      accumulated += performance.now() - startedAt;
    } else {
      startedAt = performance.now();
      pageStartedAt = performance.now();
    }
    running = !running;
    $("#timerToggle").innerHTML = running
      ? `${icon("pause")}暂停计时`
      : `${icon("play")}继续计时`;
  }
  function resetTimer() {
    accumulated = 0;
    startedAt = performance.now();
    pageStartedAt = performance.now();
    pageStats = Array.from({ length: deck.slideCount }, () => ({
      ms: 0,
      visits: 0,
    }));
    pageStats[current - 1].visits = 1;
  }
  $("#timerToggle").onclick = toggleTimer;
  $("#timerReset").onclick = resetTimer;
  function rehearsalReport() {
    settlePage();
    pageStartedAt = performance.now();
    const rows = pageStats.map((row, index) => ({
        ...row,
        page: index + 1,
        title: noteAt(index + 1).title || `第 ${index + 1} 页`,
      })),
      visited = rows.filter((row) => row.visits),
      total = rows.reduce((sum, row) => sum + row.ms, 0),
      longest = [...visited].sort((a, b) => b.ms - a.ms)[0];
    $(".rehearsal-summary").innerHTML =
      `<div><small>总时长</small><strong>${duration(total)}</strong></div><div><small>已讲页面</small><strong>${visited.length} / ${deck.slideCount}</strong></div><div><small>平均每页</small><strong>${duration(visited.length ? total / visited.length : 0)}</strong></div><div><small>停留最久</small><strong>${longest ? `第 ${longest.page} 页` : "—"}</strong></div>`;
    $(".rehearsal-table").innerHTML =
      `<table><thead><tr><th>页面</th><th>访问</th><th>用时</th></tr></thead><tbody>${rows
        .map(
          (row) =>
            `<tr><th><span>${String(row.page).padStart(2, "0")}</span>${row.title}</th><td>${row.visits}</td><td>${duration(row.ms)}</td></tr>`,
        )
        .join("")}</tbody></table>`;
    $("#rehearsalPanel").hidden = false;
  }
  $("#finishRehearsal").onclick = () => {
    if (running) toggleTimer();
    rehearsalReport();
  };
  $("#continueRehearsal").onclick = () => {
    closePresenterDialog($("#rehearsalPanel"));
    if (!running) toggleTimer();
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
  const remoteInterval = setInterval(async () => {
    if (!remoteSession || remoteBusy) return;
    remoteBusy = true;
    try {
      const elapsed =
        accumulated + (running ? performance.now() - startedAt : 0);
      await api(`/presenter-sessions/${remoteSession.token}`, {
        method: "PATCH",
        body: { page: current, running, elapsed },
      });
      const result = await api(
        `/remote/${remoteSession.token}/commands?after=${lastRemoteCommand}`,
      );
      for (const command of result.commands) {
        lastRemoteCommand = Math.max(lastRemoteCommand, command.id);
        if (command.action === "previous") go(current - 1);
        if (command.action === "next") go(current + 1);
        if (command.action === "go") go(command.page);
        if (command.action === "toggleTimer") toggleTimer();
        if (command.action === "resetTimer") resetTimer();
      }
    } catch {}
    remoteBusy = false;
  }, 600);
  addEventListener("beforeunload", () => {
    cancelAnimationFrame(stateFrame);
    previewObserver.disconnect();
    channel.close();
    clearInterval(remoteInterval);
    clearInterval(audienceInterval);
    if (remoteSession)
      fetch(`/api/presenter-sessions/${remoteSession.token}`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": session.csrf },
        keepalive: true,
      }).catch(() => {});
    if (audienceSession)
      fetch(`/api/audience-sessions/${audienceSession.token}`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": session.csrf },
        keepalive: true,
      }).catch(() => {});
  });
  render();
  requestAnimationFrame(sizePreviewFrames);
  channel.postMessage({ type: "request" });
} catch (error) {
  root.innerHTML = `<div class="presenter-error"></div>`;
  root.querySelector(".presenter-error").textContent = error.message;
  root.removeAttribute("aria-busy");
}
