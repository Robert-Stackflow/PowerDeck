import crypto from "node:crypto";

const MAX_AGE = 8 * 60 * 60 * 1000;
const DEFAULT_PERMISSIONS = Object.freeze({
  directory: true,
  notes: false,
  interaction: true,
  downloadPdf: false,
  showInteractionFeed: true,
  showOnlineCount: true,
});

const token = () => crypto.randomBytes(24).toString("base64url");
const clampPage = (value, total) =>
  Math.max(1, Math.min(total, Math.trunc(Number(value) || 1)));
const cleanPermissions = (value = {}) =>
  Object.fromEntries(
    Object.keys(DEFAULT_PERMISSIONS).map((key) => [
      key,
      typeof value[key] === "boolean" ? value[key] : DEFAULT_PERMISSIONS[key],
    ]),
  );

export function createRooms(store, publicURL = "") {
  const rooms = new Map();

  function get(roomToken) {
    const room = rooms.get(roomToken);
    if (!room || Date.now() - room.touchedAt > MAX_AGE) {
      rooms.delete(roomToken);
      return null;
    }
    return room;
  }

  function connectionList(room) {
    return [...room.clients]
      .filter((client) => client.role === "viewer")
      .map((client) => client.connection)
      .sort((a, b) => b.connectedAt - a.connectedAt);
  }

  function publicState(room) {
    return {
      token: room.token,
      title: room.title,
      page: room.page,
      total: room.total,
      permissions: room.permissions,
      pointer: room.pointer,
      ink: room.ink,
      interactionToken: room.permissions.interaction
        ? room.interactionToken
        : null,
      participants: connectionList(room).length,
      updatedAt: room.touchedAt,
    };
  }

  function adminState(room) {
    return {
      ...publicState(room),
      hostToken: room.hostToken,
      url: room.url,
      connections: connectionList(room),
    };
  }

  function send(client, message) {
    if (client.ws.readyState === 1) client.ws.send(JSON.stringify(message));
  }

  function broadcast(room, message, role = null) {
    for (const client of room.clients)
      if (!role || client.role === role) send(client, message);
  }

  function participantsChanged(room) {
    const connections = connectionList(room);
    broadcast(
      room,
      { type: "participants", count: connections.length, connections },
      "host",
    );
    broadcast(
      room,
      { type: "participants", count: connections.length },
      "viewer",
    );
  }

  function create({ deckId, page, permissions, interactionToken }) {
    const deck = store.get(deckId),
      roomToken = token(),
      hostToken = token(),
      room = {
        token: roomToken,
        hostToken,
        deckId: deck.id,
        title: deck.title,
        total: deck.slideCount,
        page: clampPage(page, deck.slideCount),
        permissions: cleanPermissions(permissions),
        interactionToken,
        pointer: null,
        ink: {},
        clients: new Set(),
        createdAt: Date.now(),
        touchedAt: Date.now(),
      };
    room.url = `${publicURL}/room/${roomToken}`;
    rooms.set(roomToken, room);
    return adminState(room);
  }

  function requireHost(roomToken, hostToken) {
    const room = get(roomToken);
    if (!room) {
      const error = new Error("房间不存在或已结束");
      error.status = 404;
      throw error;
    }
    if (!hostToken || hostToken !== room.hostToken) {
      const error = new Error("房主凭证不正确");
      error.status = 403;
      throw error;
    }
    return room;
  }

  function update(roomToken, hostToken, input = {}) {
    const room = requireHost(roomToken, hostToken);
    if (Number.isFinite(input.page))
      room.page = clampPage(input.page, room.total);
    if (input.permissions)
      room.permissions = cleanPermissions({
        ...room.permissions,
        ...input.permissions,
      });
    room.touchedAt = Date.now();
    broadcast(room, { type: "state", state: publicState(room) });
    return adminState(room);
  }

  function remove(roomToken, hostToken) {
    const room = requireHost(roomToken, hostToken);
    broadcast(room, { type: "ended" });
    for (const client of room.clients) client.ws.close(1000, "room ended");
    rooms.delete(roomToken);
    return room;
  }

  function attach(ws, roomToken, hostToken, connection) {
    const room = get(roomToken);
    if (!room) {
      ws.close(1008, "room unavailable");
      return;
    }
    const role = hostToken === room.hostToken ? "host" : "viewer",
      client = {
        ws,
        role,
        connection: {
          ...connection,
          connectedAt: Date.now(),
          lastSeen: Date.now(),
        },
      };
    room.clients.add(client);
    room.touchedAt = Date.now();
    send(client, {
      type: "snapshot",
      role,
      state: role === "host" ? adminState(room) : publicState(room),
    });
    participantsChanged(room);

    ws.on("message", (raw) => {
      if (client.role !== "host" || raw.length > 2 * 1024 * 1024) return;
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      room.touchedAt = Date.now();
      client.connection.lastSeen = room.touchedAt;
      if (message.type === "page") {
        room.page = clampPage(message.page, room.total);
        broadcast(room, { type: "page", page: room.page }, "viewer");
      } else if (message.type === "pointer") {
        const point = message.pointer;
        room.pointer =
          point && Number.isFinite(point.x) && Number.isFinite(point.y)
            ? {
                page: clampPage(point.page, room.total),
                x: Math.max(0, Math.min(1, point.x)),
                y: Math.max(0, Math.min(1, point.y)),
                visible: point.visible !== false,
              }
            : null;
        broadcast(room, { type: "pointer", pointer: room.pointer }, "viewer");
      } else if (message.type === "ink") {
        const page = clampPage(message.page, room.total);
        if (Array.isArray(message.strokes)) {
          room.ink[page] = message.strokes.slice(0, 300);
          broadcast(
            room,
            { type: "ink", page, strokes: room.ink[page] },
            "viewer",
          );
        }
      } else if (message.type === "ping") {
        send(client, { type: "pong", at: Date.now() });
      }
    });
    ws.on("close", () => {
      room.clients.delete(client);
      participantsChanged(room);
    });
  }

  const cleanup = setInterval(
    () => {
      for (const [roomToken, room] of rooms)
        if (Date.now() - room.touchedAt > MAX_AGE) {
          for (const client of room.clients) client.ws.close(1001, "expired");
          rooms.delete(roomToken);
        }
    },
    10 * 60 * 1000,
  );
  cleanup.unref?.();

  return {
    create,
    get,
    publicState,
    adminState,
    update,
    remove,
    requireHost,
    attach,
    close() {
      clearInterval(cleanup);
      for (const room of rooms.values())
        for (const client of room.clients) client.ws.close(1001, "shutdown");
      rooms.clear();
    },
  };
}
