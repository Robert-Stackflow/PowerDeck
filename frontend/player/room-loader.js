import { mountPresenter } from "./runtime.js";
import { playerDocument } from "./document.js";
import { icons, icon } from "../icons.js";
import { loadSite, site, setFavicon } from "../branding.js";

const token = location.pathname.split("/").filter(Boolean)[1] || "",
  frame = document.querySelector("#playerFrame"),
  loading = document.querySelector("#loading"),
  status = document.querySelector("#roomStatus");
let room,
  socket,
  reconnectTimer,
  feedTimer,
  reconnectDelay = 700,
  stopped = false;

async function read(url) {
  const response = await fetch(url, { cache: "no-store" });
  const value = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(new Error(value.error || "无法加入房间"), {
      status: response.status,
    });
  return value;
}

function setStatus(text, state = "") {
  status.className = state;
  status.querySelector("span").textContent = text;
}

function fail(error) {
  stopped = true;
  clearTimeout(reconnectTimer);
  socket?.close();
  frame.remove();
  loading.hidden = true;
  status.hidden = true;
  document.querySelector("#error").hidden = false;
  document.querySelector("#errorIcon").innerHTML = icon("audience");
  document.querySelector("#errorMessage").textContent = error.message;
}

function applyMessage(message) {
  const presentation = window.presentation;
  if (!presentation) return;
  if (message.type === "snapshot" || message.type === "state") {
    const next = message.state;
    if (
      next?.permissions &&
      JSON.stringify(next.permissions) !== JSON.stringify(room.permissions)
    ) {
      location.reload();
      return;
    }
    presentation.applyRoomState(next);
  } else if (message.type === "page") presentation.go(message.page, false);
  else if (message.type === "pointer")
    presentation.applyRoomPointer(message.pointer);
  else if (message.type === "ink")
    presentation.applyRoomInk(message.page, message.strokes);
  else if (message.type === "participants")
    presentation.updateRoomParticipants(message.count);
  else if (message.type === "ended") fail(new Error("房主已结束房间"));
}

function connect() {
  if (stopped) return;
  clearTimeout(reconnectTimer);
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(
    `${protocol}//${location.host}/ws/rooms/${encodeURIComponent(token)}`,
  );
  setStatus("正在连接房间", "reconnecting");
  socket.onopen = () => {
    reconnectDelay = 700;
    setStatus("已同步房主画面", "connected");
  };
  socket.onmessage = ({ data }) => {
    try {
      applyMessage(JSON.parse(data));
    } catch {}
  };
  socket.onclose = (event) => {
    if (stopped || event.code === 1000) return;
    setStatus("连接中断，正在重连", "reconnecting");
    reconnectTimer = setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(6000, reconnectDelay * 1.7);
  };
}

try {
  await loadSite();
  const prefix = `/api/rooms/${encodeURIComponent(token)}`;
  const [roomData, baseCSS, playerCSS] = await Promise.all([
    read(prefix),
    fetch("/static/player/base.css").then((response) => response.text()),
    fetch("/static/player/player.css").then((response) => response.text()),
  ]);
  room = roomData;
  document.title = `${room.meta.title} · ${site.name}`;
  setFavicon(room.meta.favicon || site.favicon);
  frame.addEventListener(
    "load",
    async () => {
      try {
        await frame.contentDocument.fonts.ready;
        frame.hidden = false;
        window.presentation = mountPresenter({
          window: frame.contentWindow,
          hostWindow: window,
          icons,
          deckId: `room:${token}`,
          width: room.meta.width,
          height: room.meta.height,
          allowNotes: room.permissions.notes,
          viewerMode: true,
          viewerPermissions: room.permissions,
          interactionURL: room.interactionURL,
          downloadURL: room.downloadURL,
          initialPage: room.page,
          syncHash: false,
        });
        window.presentation.applyRoomState(room);
        loading.hidden = true;
        frame.contentDocument.querySelector("#stage").focus();
        connect();
        if (
          room.permissions.interaction &&
          room.permissions.showInteractionFeed
        ) {
          const refreshFeed = async () => {
            try {
              window.presentation.applyRoomFeed(await read(`${prefix}/feed`));
            } catch {}
          };
          refreshFeed();
          feedTimer = setInterval(refreshFeed, 1600);
        }
      } catch (error) {
        fail(error);
      }
    },
    { once: true },
  );
  frame.srcdoc = playerDocument({
    ...room.content,
    meta: room.meta,
    baseURL: new URL(`${prefix}/files/`, location.origin).href,
    baseCSS,
    playerCSS,
  });
} catch (error) {
  fail(error);
}

addEventListener("beforeunload", () => {
  stopped = true;
  socket?.close();
  clearInterval(feedTimer);
});
