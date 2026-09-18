import { createSecurity } from "./security.mjs";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { HttpError, requireValue } from "./content.mjs";
import { hash, token } from "./store.mjs";
const scrypt = promisify(crypto.scrypt);

export async function passwordHash(password) {
  const salt = token();
  const key = await scrypt(password, salt, 64);
  return salt + ":" + key.toString("hex");
}
async function verify(password, encoded) {
  const [salt, hex] = String(encoded || "").split(":");
  if (!salt || !hex) return false;
  const key = await scrypt(password, salt, 64),
    expected = Buffer.from(hex, "hex");
  return (
    expected.length === key.length && crypto.timingSafeEqual(expected, key)
  );
}

export function createAuth(
  store,
  { secure = false, dataDir, origin, site } = {},
) {
  const { db } = store,
    attempts = new Map();
  db.exec(`CREATE TABLE IF NOT EXISTS workspace_users(
      id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE,password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','editor','reviewer','viewer')),
      created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,disabled_at INTEGER
    );`);
  const sessionColumns = db.prepare("PRAGMA table_info(sessions)").all();
  if (!sessionColumns.some((column) => column.name === "user_id"))
    db.exec("ALTER TABLE sessions ADD COLUMN user_id TEXT");
  if (!sessionColumns.some((column) => column.name === "role"))
    db.exec("ALTER TABLE sessions ADD COLUMN role TEXT");
  if (!sessionColumns.some((column) => column.name === "created_at"))
    db.exec("ALTER TABLE sessions ADD COLUMN created_at INTEGER");
  if (!sessionColumns.some((column) => column.name === "last_seen_at"))
    db.exec("ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER");
  if (!sessionColumns.some((column) => column.name === "ip"))
    db.exec("ALTER TABLE sessions ADD COLUMN ip TEXT");
  if (!sessionColumns.some((column) => column.name === "user_agent"))
    db.exec("ALTER TABLE sessions ADD COLUMN user_agent TEXT");
  db.exec(`UPDATE sessions SET
    created_at=COALESCE(created_at,expires-604800000),
    last_seen_at=COALESCE(last_seen_at,created_at,expires-604800000),
    ip=COALESCE(ip,''),user_agent=COALESCE(user_agent,'')`);
  const admin = () => db.prepare("SELECT * FROM admin WHERE id=1").get();
  const syncOwner = () => {
    const legacy = admin();
    if (!legacy) return null;
    let value = db
      .prepare("SELECT * FROM workspace_users WHERE role='owner' LIMIT 1")
      .get();
    if (!value) {
      const id = crypto.randomUUID(),
        now = Date.now();
      db.prepare(
        "INSERT INTO workspace_users(id,username,password,role,created_at,updated_at) VALUES(?,?,?,'owner',?,?)",
      ).run(id, legacy.username, legacy.password, now, now);
      value = db.prepare("SELECT * FROM workspace_users WHERE id=?").get(id);
    } else if (
      value.username !== legacy.username ||
      value.password !== legacy.password
    ) {
      db.prepare(
        "UPDATE workspace_users SET username=?,password=?,updated_at=? WHERE id=?",
      ).run(legacy.username, legacy.password, Date.now(), value.id);
      value = db
        .prepare("SELECT * FROM workspace_users WHERE id=?")
        .get(value.id);
    }
    db.prepare(
      "UPDATE sessions SET user_id=?,role='owner' WHERE user_id IS NULL",
    ).run(value.id);
    return value;
  };
  syncOwner();
  const userById = (id) =>
    id
      ? db
          .prepare(
            "SELECT * FROM workspace_users WHERE id=? AND disabled_at IS NULL",
          )
          .get(id)
      : null;
  const owner = () => syncOwner();
  const userDTO = (row) =>
    row && {
      id: row.id,
      username: row.username,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      disabledAt: row.disabled_at,
    };
  function limit(ip) {
    const now = Date.now();
    for (const [key, value] of attempts)
      if (value.until < now) attempts.delete(key);
    const bucket = attempts.get(ip) || { count: 0, until: now + 300000 };
    if (bucket.count >= 10)
      throw new HttpError(429, "尝试次数过多，请五分钟后再试");
    bucket.count++;
    attempts.set(ip, bucket);
  }
  const requestIP = (req) =>
    String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
      .split(",")[0]
      .trim()
      .slice(0, 80);
  const requestAgent = (req) =>
    String(req.headers["user-agent"] || "").slice(0, 500);
  const session = (req) => {
    const raw = (req.headers.cookie || "")
      .split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith("deck_session="))
      ?.slice(13);
    if (!raw) return null;
    const value = db
      .prepare("SELECT * FROM sessions WHERE hash=? AND expires>?")
      .get(hash(raw), Date.now());
    if (!value) return null;
    if (!value.last_seen_at || value.last_seen_at < Date.now() - 60000) {
      value.last_seen_at = Date.now();
      value.ip = requestIP(req);
      value.user_agent = requestAgent(req);
      db.prepare(
        "UPDATE sessions SET last_seen_at=?,ip=?,user_agent=? WHERE hash=?",
      ).run(value.last_seen_at, value.ip, value.user_agent, value.hash);
    }
    const user = userById(value.user_id) || (value.user_id ? null : owner());
    return user ? { ...value, user } : null;
  };
  function issue(req, res, selected = owner()) {
    requireValue(selected && !selected.disabled_at, "账号不可用");
    const value = token(),
      csrf = token(),
      now = Date.now(),
      expires = now + 7 * 86400000;
    db.prepare("DELETE FROM sessions WHERE expires<=?").run(now);
    db.prepare(
      "INSERT INTO sessions(hash,csrf,expires,user_id,role,created_at,last_seen_at,ip,user_agent) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      hash(value),
      csrf,
      expires,
      selected.id,
      selected.role,
      now,
      now,
      requestIP(req),
      requestAgent(req),
    );
    res.setHeader(
      "Set-Cookie",
      `deck_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure ? "; Secure" : ""}`,
    );
    return {
      authenticated: true,
      userId: selected.id,
      username: selected.username,
      role: selected.role,
      csrf,
    };
  }
  const normalizeUsername = (value) => {
    const username = typeof value === "string" ? value.trim() : "";
    requireValue(
      /^[a-zA-Z0-9_.-]{2,40}$/.test(username),
      "账号使用 2–40 位字母、数字、点或下划线",
    );
    return username;
  };
  const usernameExists = (username, excludedId = "") =>
    !!db
      .prepare(
        "SELECT 1 FROM workspace_users WHERE username=? COLLATE NOCASE AND id<>? LIMIT 1",
      )
      .get(username, excludedId);
  const credentials = (data) => {
    data.username = normalizeUsername(data.username);
    requireValue(
      typeof data.password === "string" &&
        data.password.length >= 10 &&
        data.password.length <= 128,
      "密码需为 10–128 个字符",
    );
  };
  const resetLimit = (req) => attempts.delete(req.socket.remoteAddress);
  const verifyPassword = async (password) => {
    const selected = owner();
    return (
      typeof password === "string" &&
      password.length <= 128 &&
      !!selected &&
      verify(password, selected.password)
    );
  };
  const security = createSecurity({
    db,
    dataDir,
    origin,
    site,
    admin,
    session,
    issue,
    limit,
    resetLimit,
    verifyPassword,
    userById,
  });
  const requireSession = (req) => {
    const value = session(req);
    if (!value) throw new HttpError(401, "请先登录");
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers["x-csrf-token"] !== value.csrf
    )
      throw new HttpError(403, "请求验证失败，请刷新后重试");
    return value;
  };
  return {
    security,
    status(req) {
      const value = session(req);
      return {
        setupRequired: !admin(),
        authenticated: !!value,
        ...(value
          ? {
              userId: value.user.id,
              username: value.user.username,
              role: value.user.role,
              csrf: value.csrf,
            }
          : {}),
      };
    },
    require: requireSession,
    requireRole(req, ...roles) {
      const value = requireSession(req);
      if (!roles.includes(value.user.role))
        throw new HttpError(403, "当前账号没有执行此操作的权限");
      return value;
    },
    setup: async (req, res, data) => {
      if (admin()) throw new HttpError(409, "管理员已设置");
      if (
        !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
          req.socket.remoteAddress,
        )
      )
        throw new HttpError(403, "首次设置需在服务器本机完成");
      limit(req.socket.remoteAddress);
      credentials(data);
      const encoded = await passwordHash(data.password);
      if (admin()) throw new HttpError(409, "管理员已设置");
      db.prepare("INSERT INTO admin VALUES(1,?,?)").run(data.username, encoded);
      return issue(req, res, syncOwner());
    },
    login: async (req, res, data) => {
      limit(req.socket.remoteAddress);
      requireValue(
        typeof data.username === "string" &&
          typeof data.password === "string" &&
          data.password.length <= 128,
        "账号或密码不正确",
      );
      syncOwner();
      const username =
          typeof data.username === "string" ? data.username.trim() : "",
        selected = db
          .prepare(
            "SELECT * FROM workspace_users WHERE username=? COLLATE NOCASE AND disabled_at IS NULL",
          )
          .get(username);
      if (!selected || !(await verify(data.password, selected.password)))
        throw new HttpError(401, "账号或密码不正确");
      if (selected.role === "owner") return security.finish(req, res, selected);
      resetLimit(req);
      return issue(req, res, selected);
    },
    logout: (req, res) => {
      const value = session(req);
      if (value)
        db.prepare("DELETE FROM sessions WHERE hash=?").run(value.hash);
      res.setHeader(
        "Set-Cookie",
        `deck_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`,
      );
      return { ok: true };
    },
    changePassword: async (req, res, data) => {
      const value = requireSession(req),
        selected = value.user;
      credentials({ username: selected.username, password: data.password });
      if (selected.role === "owner") await security.confirm(req, data);
      else if (!(await verify(data.currentPassword, selected.password)))
        throw new HttpError(401, "当前密码不正确");
      const encoded = await passwordHash(data.password);
      db.prepare(
        "UPDATE workspace_users SET password=?,updated_at=? WHERE id=?",
      ).run(encoded, Date.now(), selected.id);
      if (selected.role === "owner")
        db.prepare("UPDATE admin SET password=? WHERE id=1").run(encoded);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(selected.id);
      security.clearPending();
      return issue(req, res, userById(selected.id));
    },
    users() {
      syncOwner();
      return db
        .prepare(
          "SELECT * FROM workspace_users ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END,created_at",
        )
        .all()
        .map(userDTO);
    },
    sessions(req) {
      const current = requireSession(req);
      db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
      return db
        .prepare(
          "SELECT * FROM sessions WHERE user_id=? ORDER BY last_seen_at DESC,created_at DESC",
        )
        .all(current.user.id)
        .map((row) => ({
          id: hash(row.hash).slice(0, 24),
          current: row.hash === current.hash,
          ip: row.ip || "",
          userAgent: row.user_agent || "",
          createdAt: row.created_at,
          lastSeenAt: row.last_seen_at,
          expiresAt: row.expires,
        }));
    },
    deleteSession(req, id) {
      const current = requireSession(req),
        selected = db
          .prepare("SELECT hash FROM sessions WHERE user_id=?")
          .all(current.user.id)
          .find((row) => hash(row.hash).slice(0, 24) === id);
      if (!selected) throw new HttpError(404, "会话不存在");
      if (selected.hash === current.hash)
        throw new HttpError(409, "当前会话请使用退出登录");
      db.prepare("DELETE FROM sessions WHERE hash=?").run(selected.hash);
      return { ok: true };
    },
    deleteOtherSessions(req) {
      const current = requireSession(req),
        result = db
          .prepare("DELETE FROM sessions WHERE user_id=? AND hash<>?")
          .run(current.user.id, current.hash);
      return { ok: true, deleted: Number(result.changes || 0) };
    },
    async createUser(input) {
      credentials(input);
      requireValue(
        ["editor", "reviewer", "viewer"].includes(input.role),
        "角色不正确",
      );
      const id = crypto.randomUUID(),
        now = Date.now(),
        encoded = await passwordHash(input.password);
      if (usernameExists(input.username))
        throw new HttpError(409, "用户名已存在");
      try {
        db.prepare(
          "INSERT INTO workspace_users(id,username,password,role,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        ).run(id, input.username, encoded, input.role, now, now);
      } catch (error) {
        if (String(error.message).includes("UNIQUE"))
          throw new HttpError(409, "用户名已存在");
        throw error;
      }
      return userDTO(userById(id));
    },
    updateUser(id, input) {
      const selected = db
        .prepare("SELECT * FROM workspace_users WHERE id=?")
        .get(id);
      if (!selected) throw new HttpError(404, "成员不存在");
      const username = Object.hasOwn(input, "username")
          ? normalizeUsername(input.username)
          : selected.username,
        role = Object.hasOwn(input, "role") ? input.role : selected.role,
        disabledAt = Object.hasOwn(input, "disabled")
          ? input.disabled === true
            ? Date.now()
            : null
          : selected.disabled_at;
      if (usernameExists(username, id))
        throw new HttpError(409, "用户名已存在");
      if (selected.role === "owner") {
        requireValue(
          role === "owner" && !disabledAt,
          "不能修改所有者角色或状态",
        );
      } else {
        requireValue(
          ["editor", "reviewer", "viewer"].includes(role),
          "角色不正确",
        );
      }
      const accessChanged =
        role !== selected.role || disabledAt !== selected.disabled_at;
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "UPDATE workspace_users SET username=?,role=?,disabled_at=?,updated_at=? WHERE id=?",
        ).run(username, role, disabledAt, Date.now(), id);
        if (selected.role === "owner")
          db.prepare("UPDATE admin SET username=? WHERE id=1").run(username);
        if (accessChanged)
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        if (String(error.message).includes("UNIQUE"))
          throw new HttpError(409, "用户名已存在");
        throw error;
      }
      return userDTO(
        db.prepare("SELECT * FROM workspace_users WHERE id=?").get(id),
      );
    },
    deleteUser(id) {
      const selected = db
        .prepare("SELECT * FROM workspace_users WHERE id=?")
        .get(id);
      if (!selected) throw new HttpError(404, "成员不存在");
      if (selected.role === "owner")
        throw new HttpError(409, "不能删除工作区所有者");
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
      db.prepare("DELETE FROM workspace_users WHERE id=?").run(id);
      return { ok: true };
    },
  };
}
