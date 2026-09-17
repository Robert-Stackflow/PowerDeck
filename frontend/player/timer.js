import { createTiming, duration } from "./timing.js";
export function mountTimer({
  document,
  hostWindow,
  storage,
  deckId,
  pages,
  notes,
  icon,
  openPanel,
  toast,
}) {
  const ids = pages.map((p, i) => p.dataset.slideId || String(i + 1));
  const key = `deck-library:timing:${deckId}:v1`;
  let saved;
  try {
    saved = JSON.parse(storage.getItem(key));
  } catch {}
  const timing = createTiming({ ids, saved });
  const widget = document.createElement("div");
  widget.id = "presentationTimer";
  widget.setAttribute("role", "group");
  widget.setAttribute("aria-label", "演示计时");
  widget.innerHTML = `<button id="timerToggle" type="button" aria-label="开始计时" data-tip="开始计时">${icon("play")}</button><button id="timerDetails" type="button" aria-label="查看逐页用时" data-tip="逐页用时" aria-haspopup="dialog" aria-controls="timingPanel"><span id="timerTotal">00:00</span><small>本页 <span id="timerPage">00:00</span></small></button><button id="timingReset" type="button" aria-label="重置计时" data-tip="重置计时">${icon("rotateCcw")}</button>`;
  const divider = document.createElement("span");
  divider.id = "timerDivider";
  divider.className = "nav-divider";
  divider.setAttribute("aria-hidden", "true");
  const panel = document.createElement("section");
  panel.id = "timingPanel";
  panel.className = "overlay";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "timingTitle");
  panel.innerHTML = `<div class="overlay-head"><div><h2 id="timingTitle">逐页用时</h2><p class="timing-caption">累计 <span id="timingTotal">00:00</span><span class="timing-caption-dot">·</span><span id="timingStatus">未开始</span></p></div><button class="dialog-close" data-close="timingPanel" aria-label="关闭用时记录">${icon("close")}</button></div><div class="timing-table"><table><thead><tr><th>页面</th><th>访问</th><th>用时</th></tr></thead><tbody></tbody></table></div>`;
  document.getElementById("controls").append(divider, widget);
  document.body.append(panel);
  const cells = ids.map((id, i) => {
    const row = document.createElement("tr");
    const name = document.createElement("th");
    name.scope = "row";
    const number = document.createElement("span");
    number.className = "timing-number";
    number.textContent = String(i + 1).padStart(2, "0");
    name.append(
      number,
      document.createTextNode(
        notes[i + 1]?.title || pages[i].dataset.title || `第 ${i + 1} 页`,
      ),
    );
    const visits = document.createElement("td"),
      time = document.createElement("td");
    row.append(name, visits, time);
    panel.querySelector("tbody").append(row);
    return { row, visits, time, id };
  });
  let active = ids[0],
    resetArmed = false,
    resetTimeout,
    saveWarned = false;
  const resetButton = widget.querySelector("#timingReset");
  const save = () => {
    try {
      storage.setItem(key, JSON.stringify(timing.snapshot()));
    } catch {
      if (!saveWarned) {
        saveWarned = true;
        toast("用时记录仅在本次打开期间保留");
      }
    }
  };
  const paint = () => {
    const state = timing.snapshot();
    const total = duration(state.total);
    widget.querySelector("#timerTotal").textContent = total;
    widget.querySelector("#timerPage").textContent = duration(
      state.rows[active].ms,
    );
    document.body.classList.toggle("timer-running", timing.running);
    widget.classList.toggle("running", timing.running);
    const toggle = widget.querySelector("#timerToggle");
    const label = timing.running
      ? "暂停计时"
      : state.total > 0
        ? "继续计时"
        : "开始计时";
    toggle.setAttribute("aria-label", label);
    toggle.dataset.tip = label;
    const glyph = timing.running ? "pause" : "play";
    if (toggle.dataset.state !== glyph) {
      toggle.dataset.state = glyph;
      toggle.innerHTML = icon(glyph);
    }
    resetButton.disabled = !timing.running && state.total === 0;
    if (!panel.hidden) {
      panel.querySelector("#timingTotal").textContent = duration(state.total);
      panel.querySelector("#timingStatus").textContent = timing.running
        ? "计时中"
        : state.total > 0
          ? "已暂停"
          : "未开始";
      cells.forEach(({ row, visits, time, id }) => {
        row.classList.toggle("current", id === active);
        visits.textContent = String(state.rows[id].visits);
        time.textContent = duration(state.rows[id].ms);
      });
    }
  };
  const toggleTiming = () => {
    timing.running ? timing.pause() : timing.start();
    paint();
    save();
  };
  widget.querySelector("#timerToggle").onclick = toggleTiming;
  widget.querySelector("#timerDetails").onclick = () => {
    openPanel("timingPanel");
    paint();
  };
  const disarmReset = () => {
    clearTimeout(resetTimeout);
    resetArmed = false;
    resetButton.classList.remove("confirm-reset");
    resetButton.innerHTML = icon("rotateCcw");
    resetButton.setAttribute("aria-label", "重置计时");
    resetButton.dataset.tip = "重置计时";
  };
  resetButton.addEventListener("blur", disarmReset);
  resetButton.onclick = () => {
    if (!resetArmed) {
      resetArmed = true;
      resetButton.innerHTML = icon("check");
      resetButton.classList.add("confirm-reset");
      resetButton.setAttribute("aria-label", "再次点击确认重置");
      resetButton.dataset.tip = "再次点击确认重置";
      resetTimeout = setTimeout(disarmReset, 3000);
      return;
    }
    disarmReset();
    timing.reset();
    save();
    paint();
  };
  const pause = () => {
    timing.pause();
    save();
    paint();
  };
  let tick, checkpoint;
  const startTicks = () => {
    hostWindow.clearInterval(tick);
    hostWindow.clearInterval(checkpoint);
    tick = hostWindow.setInterval(() => {
      if (timing.running) paint();
    }, 1000);
    checkpoint = hostWindow.setInterval(() => {
      if (timing.running) save();
    }, 5000);
  };
  startTicks();
  hostWindow.addEventListener("pageshow", (event) => {
    if (event.persisted) startTicks();
  });
  hostWindow.document.addEventListener("visibilitychange", () => {
    if (hostWindow.document.hidden) pause();
  });
  hostWindow.addEventListener("pagehide", () => {
    pause();
    hostWindow.clearInterval(tick);
    hostWindow.clearInterval(checkpoint);
  });
  paint();
  return {
    go(index) {
      active = ids[index - 1];
      timing.go(active);
      paint();
      save();
    },
  };
}
