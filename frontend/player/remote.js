import { icon } from "../icons.js";

const root = document.querySelector("#remoteApp"),
  token = location.pathname.split("/").filter(Boolean)[1] || "";
const deviceKey = "powerdeck-remote-device",
  deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
localStorage.setItem(deviceKey, deviceId);
let state,
  sending = false,
  lastSuccess = 0;

const duration = (milliseconds = 0) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
const request = async (path = "", options = {}) => {
  const response = await fetch(`/api/remote/${token}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-PowerDeck-Device": deviceId,
      ...options.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "连接失败");
  }
  return response.json();
};

function mount() {
  root.innerHTML = `<header><div><p>PowerDeck 遥控器</p><h1 id="remoteTitle"></h1></div><span id="remoteStatus"><i></i>已连接</span></header><section class="remote-page"><div class="remote-page-heading"><span>当前页面</span><output id="remoteCounter"></output></div><h2 id="remotePageTitle"></h2><div class="remote-progress"><i></i></div></section><section class="remote-notes"><div><span>演讲备注</span><output id="remoteClock">00:00</output></div><p id="remoteNotes"></p></section><section class="remote-jump"><label for="remotePage">跳转页面</label><input id="remotePage" type="range" min="1" step="1"><output></output></section><footer><div class="remote-navigation"><button id="remotePrevious" aria-label="上一页">${icon("prev")}<span>上一页</span></button><button id="remoteNext" class="primary" aria-label="下一页"><span>下一页</span>${icon("next")}</button></div><div class="remote-timer"><button id="remoteTimer">${icon("pause")}<span>暂停计时</span></button><button id="remoteReset" aria-label="重置计时">${icon("rotateCcw")}</button></div></footer>`;
  root.removeAttribute("aria-busy");
  root.querySelector("#remotePrevious").onclick = () => action("previous");
  root.querySelector("#remoteNext").onclick = () => action("next");
  root.querySelector("#remoteTimer").onclick = () => action("toggleTimer");
  root.querySelector("#remoteReset").onclick = () => action("resetTimer");
  root.querySelector("#remotePage").onchange = (event) =>
    action("go", { page: Number(event.target.value) });
}
function render() {
  if (!state) return;
  root.querySelector("#remoteTitle").textContent = state.title;
  root.querySelector("#remoteCounter").textContent =
    `${state.page} / ${state.total}`;
  root.querySelector("#remotePageTitle").textContent = state.pageTitle;
  root.querySelector(".remote-progress i").style.width =
    `${(state.page / state.total) * 100}%`;
  root.querySelector("#remoteNotes").textContent =
    state.notes || "此页没有演讲备注";
  root.querySelector("#remoteNotes").classList.toggle("empty", !state.notes);
  root.querySelector("#remoteClock").textContent = duration(state.elapsed);
  const slider = root.querySelector("#remotePage");
  slider.max = state.total;
  slider.value = state.page;
  slider.nextElementSibling.textContent = `第 ${state.page} 页`;
  root.querySelector("#remotePrevious").disabled = state.page <= 1;
  root.querySelector("#remoteNext").disabled = state.page >= state.total;
  root.querySelector("#remoteTimer").innerHTML = state.running
    ? `${icon("pause")}<span>暂停计时</span>`
    : `${icon("play")}<span>继续计时</span>`;
  const connected = Date.now() - lastSuccess < 3500;
  root.querySelector("#remoteStatus").classList.toggle("offline", !connected);
  root.querySelector("#remoteStatus").lastChild.textContent = connected
    ? "已连接"
    : "正在重连";
}
async function action(name, extra = {}) {
  if (sending) return;
  sending = true;
  try {
    await request("/actions", {
      method: "POST",
      body: JSON.stringify({ action: name, ...extra }),
    });
    await refresh();
  } catch (error) {
    root.querySelector("#remoteStatus").classList.add("offline");
    root.querySelector("#remoteStatus").lastChild.textContent = error.message;
  } finally {
    sending = false;
  }
}
async function refresh() {
  state = await request();
  lastSuccess = Date.now();
  render();
}

try {
  state = await request();
  lastSuccess = Date.now();
  mount();
  render();
  setInterval(() => refresh().catch(render), 700);
} catch (error) {
  root.innerHTML = `<div class="remote-error">${icon("external")}<h1>无法连接遥控会话</h1><p></p></div>`;
  root.querySelector(".remote-error p").textContent = error.message;
  root.removeAttribute("aria-busy");
}
