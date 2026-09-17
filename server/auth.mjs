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
  const [salt, hex] = encoded.split(":");
  const key = await scrypt(password, salt, 64);
  const expected = Buffer.from(hex, "hex");
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
  const admin = () => db.prepare("SELECT * FROM admin WHERE id=1").get();
  function limit(ip) {
    const now = Date.now();
    for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
    const bucket = attempts.get(ip) || { count: 0, until: now + 300000 };
    if (bucket.count >= 10)
      throw new HttpError(429, "尝试次数过多，请五分钟后再试");
    bucket.count++;
    attempts.set(ip, bucket);
  }
  const session = (req) => {
    const raw = (req.headers.cookie || "")
      .split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith("deck_session="))
      ?.slice(13);
    if (!raw) return null;
    return (
      db
        .prepare("SELECT * FROM sessions WHERE hash=? AND expires>?")
        .get(hash(raw), Date.now()) || null
    );
  };
  function issue(res) {
    const t = token(),
      csrf = token(),
      expires = Date.now() + 7 * 86400000;
    db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      hash(t),
      csrf,
      expires,
    );
    res.setHeader(
      "Set-Cookie",
      `deck_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure ? "; Secure" : ""}`,
    );
    return { authenticated: true, username: admin().username, csrf };
  }
  const credentials = (data) => {
    requireValue(
      typeof data.username === "string" &&
        /^[a-zA-Z0-9_.-]{2,40}$/.test(data.username),
      "账号使用 2–40 位字母、数字、点或下划线",
    );
    requireValue(
      typeof data.password === "string" &&
        data.password.length >= 10 &&
        data.password.length <= 128,
      "密码需为 10–128 个字符",
    );
  };
  const resetLimit = (req) => attempts.delete(req.socket.remoteAddress);
  const verifyPassword = async (password) =>
    typeof password === "string" &&
    password.length <= 128 &&
    !!admin() &&
    verify(password, admin().password);
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
  });
  return {
    security,
    status: (req) => {
      const a = admin(),
        s = session(req);
      return {
        setupRequired: !a,
        authenticated: !!s,
        ...(s ? { username: a.username, csrf: s.csrf } : {}),
      };
    },
    require: (req) => {
      const s = session(req);
      if (!s) throw new HttpError(401, "请先登录");
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.headers["x-csrf-token"] !== s.csrf
      )
        throw new HttpError(403, "请求验证失败，请刷新后重试");
      return s;
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
      return issue(res);
    },
    login: async (req, res, data) => {
      limit(req.socket.remoteAddress);
      requireValue(
        typeof data.username === "string" &&
          typeof data.password === "string" &&
          data.password.length <= 128,
        "账号或密码不正确",
      );
      const a = admin();
      if (
        !a ||
        data.username !== a.username ||
        !(await verify(data.password, a.password))
      )
        throw new HttpError(401, "账号或密码不正确");
      return security.finish(req, res);
    },
    logout: (req, res) => {
      const s = session(req);
      if (s) db.prepare("DELETE FROM sessions WHERE hash=?").run(s.hash);
      res.setHeader(
        "Set-Cookie",
        `deck_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`,
      );
      return { ok: true };
    },
    changePassword: async (req, res, data) => {
      const a = admin();
      credentials({ username: a.username, password: data.password });
      await security.confirm(req, data);
      db.prepare("UPDATE admin SET password=? WHERE id=1").run(
        await passwordHash(data.password),
      );
      db.prepare("DELETE FROM sessions").run();
      security.clearPending();
      return issue(res);
    },
  };
}
