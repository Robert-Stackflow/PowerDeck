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
const passwordDigest = (password, salt = crypto.randomBytes(16)) => ({
  salt: salt.toString("base64url"),
  hash: crypto.scryptSync(String(password), salt, 32).toString("base64url"),
});
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
  const rooms = new Map(),
    db = store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS presentation_rooms(
    token TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL,
    state TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    touched_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS presentation_rooms_touched
    ON presentation_rooms(touched_at DESC);`);
  const saveRoom = db.prepare(`INSERT INTO presentation_rooms(
      token,deck_id,state,created_at,touched_at
    ) VALUES(?,?,?,?,?)
    ON CONFLICT(token) DO UPDATE SET
      deck_id=excluded.deck_id,
      state=excluded.state,
      created_at=excluded.created_at,
      touched_at=excluded.touched_at`),
    deleteRoom = db.prepare("DELETE FROM presentation_rooms WHERE token=?"),
    savedRooms = db.prepare(
      "SELECT state FROM presentation_rooms WHERE touched_at>? ORDER BY touched_at",
    );

  function serializable(room) {
    return {
      token: room.token,
      hostToken: room.hostToken,
      deckId: room.deckId,
      title: room.title,
      total: room.total,
      page: room.page,
      permissions: room.permissions,
      interactionToken: room.interactionToken,
      password: room.password,
      admissions: [...room.admissions],
      identities: [...room.identities],
      pointer: room.pointer,
      ink: room.ink,
      createdAt: room.createdAt,
      touchedAt: room.touchedAt,
    };
  }

  function persistNow(room) {
    if (room.persistTimer) clearTimeout(room.persistTimer);
    room.persistTimer = null;
    saveRoom.run(
      room.token,
      room.deckId,
      JSON.stringify(serializable(room)),
      room.createdAt,
      room.touchedAt,
    );
  }

  function persistSoon(room) {
    if (room.persistTimer) return;
    room.persistTimer = setTimeout(() => persistNow(room), 400);
    room.persistTimer.unref?.();
  }

  function forget(roomToken) {
    const room = rooms.get(roomToken);
    if (room?.persistTimer) clearTimeout(room.persistTimer);
    rooms.delete(roomToken);
    deleteRoom.run(roomToken);
  }

  for (const row of savedRooms.all(Date.now() - MAX_AGE)) {
    try {
      const saved = JSON.parse(row.state),
        deck = store.get(saved.deckId),
        room = {
          ...saved,
          title: deck.title,
          total: deck.slideCount,
          page: clampPage(saved.page, deck.slideCount),
          permissions: cleanPermissions(saved.permissions),
          admissions: new Map(saved.admissions || []),
          identities: new Map(saved.identities || []),
          pointer: saved.pointer || null,
          ink: saved.ink && typeof saved.ink === "object" ? saved.ink : {},
          clients: new Set(),
          persistTimer: null,
        };
      room.url = `${publicURL}/room/${room.token}`;
      rooms.set(room.token, room);
    } catch {}
  }
  db.prepare("DELETE FROM presentation_rooms WHERE touched_at<=?").run(
    Date.now() - MAX_AGE,
  );

  function get(roomToken) {
    const room = rooms.get(roomToken);
    if (!room || Date.now() - room.touchedAt > MAX_AGE) {
      if (room) forget(roomToken);
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
      passwordProtected: !!room.password,
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

  function list() {
    const now = Date.now();
    for (const [roomToken, room] of rooms)
      if (now - room.touchedAt > MAX_AGE) forget(roomToken);
    return [...rooms.values()]
      .map((room) => ({
        token: room.token,
        deckId: room.deckId,
        title: room.title,
        url: room.url,
        page: room.page,
        total: room.total,
        permissions: room.permissions,
        participants: connectionList(room).length,
        passwordProtected: !!room.password,
        hostConnected: [...room.clients].some(
          (client) => client.role === "host",
        ),
        createdAt: room.createdAt,
        updatedAt: room.touchedAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function send(client, message) {
    if (client.ws.readyState === 1) client.ws.send(JSON.stringify(message));
  }

  function broadcast(room, message, role = null) {
    for (const client of room.clients)
      if (!role || client.role === role) send(client, message);
  }

  function participantsChanged(room, activity = null) {
    const connections = connectionList(room);
    broadcast(
      room,
      {
        type: "participants",
        count: connections.length,
        connections,
        activity,
      },
      "host",
    );
    broadcast(
      room,
      { type: "participants", count: connections.length, activity },
      "viewer",
    );
  }

  function create({ deckId, page, permissions, interactionToken, password }) {
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
        password: String(password || "").trim()
          ? passwordDigest(String(password).trim())
          : null,
        admissions: new Map(),
        identities: new Map(),
        pointer: null,
        ink: {},
        clients: new Set(),
        persistTimer: null,
        createdAt: Date.now(),
        touchedAt: Date.now(),
      };
    room.url = `${publicURL}/room/${roomToken}`;
    rooms.set(roomToken, room);
    persistNow(room);
    return adminState(room);
  }

  function admission(room, admissionToken) {
    const value = admissionToken && room.admissions.get(admissionToken);
    if (!value || Date.now() - value.joinedAt > MAX_AGE) return null;
    return value;
  }

  function joinInfo(roomToken, admissionToken, connection = {}) {
    const room = get(roomToken);
    if (!room) {
      const error = new Error("房间不存在或已结束");
      error.status = 404;
      throw error;
    }
    const current = admission(room, admissionToken),
      lockedName = room.identities.get(connection.deviceId) || "";
    return {
      title: room.title,
      passwordProtected: !!room.password,
      joined: !!current,
      name: current?.name || lockedName,
      nameLocked: !!lockedName,
    };
  }

  function join(roomToken, { name, password }, connection) {
    const room = get(roomToken);
    if (!room) {
      const error = new Error("房间不存在或已结束");
      error.status = 404;
      throw error;
    }
    const lockedName = room.identities.get(connection.deviceId),
      cleanName =
        lockedName ||
        String(name || "")
          .trim()
          .slice(0, 40);
    if (!cleanName) {
      const error = new Error("请填写称呼");
      error.status = 400;
      throw error;
    }
    if (room.password) {
      const supplied = crypto.scryptSync(
        String(password || ""),
        Buffer.from(room.password.salt, "base64url"),
        32,
      );
      if (
        !crypto.timingSafeEqual(
          supplied,
          Buffer.from(room.password.hash, "base64url"),
        )
      ) {
        const error = new Error("房间密码不正确");
        error.status = 403;
        throw error;
      }
    }
    const admissionToken = token();
    room.identities.set(connection.deviceId, cleanName);
    room.admissions.set(admissionToken, {
      name: cleanName,
      deviceId: connection.deviceId,
      joinedAt: Date.now(),
    });
    room.touchedAt = Date.now();
    persistNow(room);
    return { token: admissionToken, name: cleanName };
  }

  function requireAdmission(roomToken, admissionToken) {
    const room = get(roomToken);
    if (!room) {
      const error = new Error("房间不存在或已结束");
      error.status = 404;
      throw error;
    }
    const value = admission(room, admissionToken);
    if (!value) {
      const error = new Error("请先加入房间");
      error.status = 401;
      throw error;
    }
    return { room, admission: value };
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
    if (Object.hasOwn(input, "password")) {
      const password = String(input.password || "").trim();
      room.password = password ? passwordDigest(password) : null;
      if (room.password) {
        room.admissions.clear();
        for (const client of [...room.clients])
          if (client.role === "viewer") client.ws.close(1008, "access changed");
      }
    }
    room.touchedAt = Date.now();
    persistNow(room);
    broadcast(room, { type: "state", state: publicState(room) });
    return adminState(room);
  }

  function remove(roomToken, hostToken) {
    const room = requireHost(roomToken, hostToken);
    broadcast(room, { type: "ended" });
    for (const client of room.clients) client.ws.close(1000, "room ended");
    forget(roomToken);
    return room;
  }

  function attach(ws, roomToken, hostToken, admissionToken, connection) {
    const room = get(roomToken);
    if (!room) {
      ws.close(1008, "room unavailable");
      return;
    }
    const role = hostToken === room.hostToken ? "host" : "viewer",
      admitted = role === "viewer" ? admission(room, admissionToken) : null;
    if (role === "viewer" && !admitted) {
      ws.close(1008, "join required");
      return;
    }
    const client = {
      ws,
      role,
      connection: {
        ...connection,
        ...(admitted ? { name: admitted.name } : {}),
        connectedAt: Date.now(),
        lastSeen: Date.now(),
      },
    };
    room.clients.add(client);
    room.touchedAt = Date.now();
    persistSoon(room);
    send(client, {
      type: "snapshot",
      role,
      state: role === "host" ? adminState(room) : publicState(room),
    });
    participantsChanged(
      room,
      role === "viewer"
        ? {
            id: crypto.randomUUID(),
            action: "joined",
            name: admitted.name,
            at: Date.now(),
          }
        : null,
    );

    ws.on("message", (raw) => {
      if (raw.length > 2 * 1024 * 1024) return;
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message.type === "ping") {
        send(client, { type: "pong", at: Number(message.at) || Date.now() });
        return;
      }
      if (client.role !== "host") return;
      room.touchedAt = Date.now();
      client.connection.lastSeen = room.touchedAt;
      if (message.type === "page") {
        room.page = clampPage(message.page, room.total);
        persistSoon(room);
        broadcast(room, { type: "page", page: room.page }, "viewer");
      } else if (message.type === "pointer") {
        const point = message.pointer;
        room.pointer =
          point && Number.isFinite(point.x) && Number.isFinite(point.y)
            ? {
                page: clampPage(point.page, room.total),
                x: Math.max(0, Math.min(1, point.x)),
                y: Math.max(0, Math.min(1, point.y)),
                tool: ["pointer", "laser", "pen", "highlighter"].includes(
                  point.tool,
                )
                  ? point.tool
                  : "pointer",
                color: /^#[\da-f]{6}$/i.test(String(point.color || ""))
                  ? point.color
                  : "#ff3b30",
                visible: point.visible !== false,
              }
            : null;
        persistSoon(room);
        broadcast(room, { type: "pointer", pointer: room.pointer }, "viewer");
      } else if (message.type === "ink") {
        const page = clampPage(message.page, room.total);
        if (Array.isArray(message.strokes)) {
          room.ink[page] = message.strokes.slice(0, 300);
          persistSoon(room);
          broadcast(
            room,
            { type: "ink", page, strokes: room.ink[page] },
            "viewer",
          );
        }
      }
    });
    ws.on("close", () => {
      room.clients.delete(client);
      participantsChanged(
        room,
        client.role === "viewer"
          ? {
              id: crypto.randomUUID(),
              action: "left",
              name: client.connection.name || "一位观众",
              at: Date.now(),
            }
          : null,
      );
    });
  }

  const cleanup = setInterval(
    () => {
      for (const [roomToken, room] of rooms)
        if (Date.now() - room.touchedAt > MAX_AGE) {
          for (const client of room.clients) client.ws.close(1001, "expired");
          forget(roomToken);
        }
    },
    10 * 60 * 1000,
  );
  cleanup.unref?.();

  return {
    create,
    get,
    joinInfo,
    join,
    requireAdmission,
    publicState,
    adminState,
    list,
    update,
    remove,
    requireHost,
    attach,
    close() {
      clearInterval(cleanup);
      for (const room of rooms.values()) {
        persistNow(room);
        for (const client of room.clients) client.ws.close(1001, "shutdown");
      }
      rooms.clear();
    },
  };
}
