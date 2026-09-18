import { mountPresenter } from "./runtime.js";
import { playerDocument } from "./document.js";
import { icons, icon } from "../icons.js";
import { loadSite, site, setFavicon } from "../branding.js";
import { preparePlayerFrame, revealPlayerFrame } from "./readiness.js";

const token = location.pathname.split("/").filter(Boolean)[1] || "",
  apiPrefix = `/api/rooms/${encodeURIComponent(token)}`,
  frame = document.querySelector("#playerFrame"),
  loading = document.querySelector("#loading"),
  status = document.querySelector("#roomStatus"),
  joinScreen = document.querySelector("#roomJoin"),
  joinForm = document.querySelector("#roomJoinForm"),
  deviceKey = "powerdeck-room-device",
  deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
localStorage.setItem(deviceKey, deviceId);
let room,
  socket,
  reconnectTimer,
  feedTimer,
  pingTimer,
  socketGeneration = 0,
  participantCount = 1,
  latency = null,
  reconnectDelay = 700,
  stopped = false;

async function read(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "X-PowerDeck-Device": deviceId },
  });
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
  status.hidden = state === "connected";
}

async function joinRoom(prefix, name, password = "") {
  const response = await fetch(`${prefix}/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PowerDeck-Device": deviceId,
    },
    body: JSON.stringify({ name, password }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "无法加入房间");
  localStorage.setItem("powerdeck-room-name", result.name);
  return result;
}

async function ensureJoined(prefix) {
  const info = await read(`${prefix}/join-info`);
  if (info.joined) return;
  const savedName = localStorage.getItem("powerdeck-room-name") || "";
  if (!info.passwordProtected && info.nameLocked && info.name) {
    await joinRoom(prefix, info.name);
    joinScreen.hidden = true;
    loading.hidden = false;
    status.hidden = false;
    return;
  }
  loading.hidden = true;
  status.hidden = true;
  joinScreen.hidden = false;
  document.querySelector("#roomJoinTitle").textContent = info.title;
  const passwordField = document.querySelector("#roomPasswordField"),
    passwordInput = joinForm.elements.password,
    submitButton = joinForm.querySelector('[type="submit"]');
  passwordField.hidden = !info.passwordProtected;
  passwordInput.required = info.passwordProtected;
  passwordInput.value = "";
  joinForm.elements.name.value = info.name || savedName;
  joinForm.elements.name.readOnly = info.nameLocked;
  submitButton.disabled = false;
  await new Promise((resolve) => {
    joinForm.onsubmit = async (event) => {
      event.preventDefault();
      const button = event.submitter,
        error = document.querySelector("#roomJoinError"),
        values = new FormData(joinForm);
      button.disabled = true;
      error.textContent = "";
      try {
        await joinRoom(prefix, values.get("name"), values.get("password"));
        joinScreen.hidden = true;
        loading.hidden = false;
        status.hidden = false;
        resolve();
      } catch (joinError) {
        error.textContent = joinError.message;
        button.disabled = false;
      }
    };
  });
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

async function applyMessage(message) {
  const presentation = window.presentation;
  if (!presentation) return;
  if (message.type === "snapshot" || message.type === "state") {
    const next = message.state;
    if (
      next?.permissions &&
      JSON.stringify(next.permissions) !== JSON.stringify(room.permissions)
    ) {
      try {
        room = await read(apiPrefix);
        presentation.updateRoomAccess(room);
        presentation.updateRoomParticipants(participantCount, latency);
        configureFeed();
      } catch (error) {
        if (error.status !== 401) throw error;
      }
    }
    presentation.applyRoomState(next);
  } else if (message.type === "page") presentation.go(message.page, false);
  else if (message.type === "pointer")
    presentation.applyRoomPointer(message.pointer);
  else if (message.type === "ink")
    presentation.applyRoomInk(message.page, message.strokes);
  else if (message.type === "participants") {
    presentation.updateRoomParticipants(
      (participantCount = message.count),
      latency,
    );
    presentation.addRoomActivity(message.activity);
  } else if (message.type === "pong") {
    latency = Math.max(0, Date.now() - Number(message.at));
    presentation.updateRoomParticipants(participantCount, latency);
  } else if (message.type === "ended") fail(new Error("房主已结束房间"));
}

function connect() {
  if (stopped) return;
  clearTimeout(reconnectTimer);
  const previous = socket;
  if (previous) {
    previous.onclose = null;
    previous.close();
  }
  const generation = ++socketGeneration;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(
    `${protocol}//${location.host}/ws/rooms/${encodeURIComponent(token)}`,
  );
  setStatus("正在连接房间", "reconnecting");
  socket.onopen = () => {
    if (generation !== socketGeneration) return;
    reconnectDelay = 700;
    setStatus("", "connected");
    const ping = () =>
      socket?.readyState === WebSocket.OPEN &&
      socket.send(JSON.stringify({ type: "ping", at: Date.now() }));
    ping();
    clearInterval(pingTimer);
    pingTimer = setInterval(ping, 3000);
  };
  socket.onmessage = ({ data }) => {
    if (generation !== socketGeneration) return;
    try {
      void applyMessage(JSON.parse(data)).catch(() => {});
    } catch {}
  };
  socket.onclose = (event) => {
    if (generation !== socketGeneration) return;
    clearInterval(pingTimer);
    socket = null;
    if (stopped || event.code === 1000) return;
    if (
      event.code === 1008 &&
      ["access changed", "join required"].includes(event.reason)
    ) {
      void rejoinRoom();
      return;
    }
    setStatus("服务恢复中，正在重连", "reconnecting");
    scheduleReconnect(connect);
  };
}

function configureFeed() {
  clearInterval(feedTimer);
  feedTimer = 0;
  if (!room?.permissions.interaction) return;
  const refreshFeed = async () => {
    try {
      window.presentation?.applyRoomFeed(await read(`${apiPrefix}/feed`));
    } catch {}
  };
  void refreshFeed();
  feedTimer = setInterval(refreshFeed, 1600);
}

function scheduleReconnect(action = connect) {
  if (stopped) return;
  clearTimeout(reconnectTimer);
  const delay = reconnectDelay + Math.random() * 180;
  reconnectDelay = Math.min(8000, reconnectDelay * 1.65);
  reconnectTimer = setTimeout(action, delay);
}

async function rejoinRoom() {
  clearInterval(feedTimer);
  setStatus("房间口令已更新，请重新加入", "reconnecting");
  joinScreen.classList.add("reauth");
  try {
    await ensureJoined(apiPrefix);
    joinScreen.classList.remove("reauth");
    room = await read(apiPrefix);
    window.presentation?.updateRoomAccess(room);
    window.presentation?.applyRoomState(room);
    window.presentation?.updateRoomParticipants(participantCount, latency);
    configureFeed();
    connect();
  } catch (error) {
    joinScreen.classList.remove("reauth");
    setStatus("服务恢复中，正在重连", "reconnecting");
    scheduleReconnect(rejoinRoom);
  }
}

async function initialize() {
  while (!stopped) {
    try {
      await loadSite();
      await ensureJoined(apiPrefix);
      const [roomData, baseCSS, playerCSS] = await Promise.all([
        read(apiPrefix),
        fetch("/static/player/base.css").then((response) => response.text()),
        fetch("/static/player/player.css").then((response) => response.text()),
      ]);
      room = roomData;
      reconnectDelay = 700;
      document.title = `${room.meta.title} · ${site.name}`;
      setFavicon(room.meta.favicon || site.favicon);
      frame.addEventListener(
        "load",
        async () => {
          try {
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
            await revealPlayerFrame(frame, loading);
            frame.contentDocument.querySelector("#stage").focus();
            connect();
            configureFeed();
          } catch (error) {
            fail(error);
          }
        },
        { once: true },
      );
      preparePlayerFrame(frame);
      frame.srcdoc = playerDocument({
        ...room.content,
        meta: room.meta,
        baseURL: new URL(`${apiPrefix}/files/`, location.origin).href,
        baseCSS,
        playerCSS,
      });
      return;
    } catch {
      if (stopped) return;
      loading.hidden = false;
      joinScreen.hidden = true;
      setStatus("服务恢复中，正在重连", "reconnecting");
      await new Promise((resolve) => {
        const delay = reconnectDelay + Math.random() * 180;
        reconnectDelay = Math.min(8000, reconnectDelay * 1.65);
        reconnectTimer = setTimeout(resolve, delay);
      });
    }
  }
}

void initialize();

addEventListener("beforeunload", () => {
  stopped = true;
  socketGeneration += 1;
  socket?.close();
  clearTimeout(reconnectTimer);
  clearInterval(feedTimer);
  clearInterval(pingTimer);
});
