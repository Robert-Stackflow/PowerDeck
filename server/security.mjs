import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { isIP } from "node:net";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { HttpError, requireValue } from "./content.mjs";
import { hash, token } from "./store.mjs";

export function createSecurity({
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
}) {
  db.exec(`CREATE TABLE IF NOT EXISTS account_security(id INTEGER PRIMARY KEY CHECK(id=1),secret TEXT,last_counter INTEGER NOT NULL DEFAULT -1,recovery TEXT NOT NULL DEFAULT '[]');
    INSERT OR IGNORE INTO account_security(id) VALUES(1);
    CREATE TABLE IF NOT EXISTS passkeys(id TEXT PRIMARY KEY,public_key BLOB NOT NULL,counter INTEGER NOT NULL,transports TEXT NOT NULL,name TEXT NOT NULL,rp_id TEXT NOT NULL,user_id TEXT NOT NULL,created_at INTEGER NOT NULL,last_used INTEGER);`);
  const pending = new Map();
  const state = () =>
    db.prepare("SELECT * FROM account_security WHERE id=1").get();
  const keyPath = path.join(dataDir, "security.key");
  function key(create = false) {
    if (create && !fs.existsSync(keyPath))
      fs.writeFileSync(keyPath, crypto.randomBytes(32), {
        mode: 0o600,
        flag: "wx",
      });
    return fs.readFileSync(keyPath);
  }
  function encrypt(value) {
    const iv = crypto.randomBytes(12),
      c = crypto.createCipheriv("aes-256-gcm", key(true), iv);
    return Buffer.concat([
      iv,
      c.update(value, "utf8"),
      c.final(),
      c.getAuthTag(),
    ]).toString("base64");
  }
  function decrypt(value) {
    const b = Buffer.from(value, "base64"),
      c = crypto.createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
    c.setAuthTag(b.subarray(-16));
    return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString(
      "utf8",
    );
  }
  const totp = (secret) =>
    new OTPAuth.TOTP({
      issuer: site().name,
      label: admin().username,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret,
    });
  const counter = (secret, code) => {
    if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
    const now = Date.now(),
      delta = totp(secret).validate({ token: code, window: 1, timestamp: now });
    return delta === null ? null : Math.floor(now / 30000) + delta;
  };
  function verifyFactor(code) {
    const s = state();
    if (!s.secret) return;
    const normalized = String(code || "")
      .trim()
      .replaceAll("-", "")
      .toLowerCase();
    const recovery = JSON.parse(s.recovery),
      index = recovery.indexOf(hash(normalized));
    if (index !== -1) {
      recovery.splice(index, 1);
      db.prepare("UPDATE account_security SET recovery=? WHERE id=1").run(
        JSON.stringify(recovery),
      );
      return;
    }
    const n = counter(decrypt(s.secret), normalized);
    if (n === null || n <= s.last_counter)
      throw new HttpError(401, "验证码无效或已使用，请使用新的验证码或恢复码");
    db.prepare("UPDATE account_security SET last_counter=? WHERE id=1").run(n);
  }
  function remember(kind, req, value = {}, authenticated = false) {
    for (const [id, v] of pending)
      if (v.expires < Date.now()) pending.delete(id);
    if (pending.size >= 1000) throw new HttpError(429, "请求过多，请稍后重试");
    const id = token();
    pending.set(id, {
      ...value,
      kind,
      expires: Date.now() + 300000,
      owner: authenticated ? session(req)?.hash : null,
      password: admin()?.password,
    });
    return id;
  }
  function take(id, kind, req, consume = true) {
    const v = pending.get(id);
    if (
      !v ||
      v.kind !== kind ||
      v.expires < Date.now() ||
      v.password !== admin()?.password ||
      (v.owner && v.owner !== session(req)?.hash)
    )
      throw new HttpError(401, "验证已失效，请重新开始");
    if (consume) pending.delete(id);
    return v;
  }
  async function confirm(req, data) {
    limit(req.socket.remoteAddress);
    if (!(await verifyPassword(data.currentPassword)))
      throw new HttpError(401, "当前密码不正确");
    verifyFactor(data.code);
    resetLimit(req);
  }
  function finish(req, res, user) {
    if (state().secret)
      return {
        mfaRequired: true,
        challenge: remember("login", req, { userId: user?.id }),
      };
    resetLimit(req);
    return issue(res, user);
  }
  function relyingParty(req) {
    const u = new URL(origin || `http://${req.headers.host}`);
    if (
      isIP(u.hostname.replace(/^\[|\]$/g, "")) ||
      (u.protocol !== "https:" && u.hostname !== "localhost")
    )
      throw new HttpError(400, "通行密钥需要使用 localhost 或 HTTPS 域名访问");
    return { rpID: u.hostname, expectedOrigin: u.origin };
  }
  function recoveryCodes() {
    const codes = Array.from({ length: 10 }, () =>
      crypto
        .randomBytes(10)
        .toString("hex")
        .match(/.{1,5}/g)
        .join("-"),
    );
    db.prepare("UPDATE account_security SET recovery=? WHERE id=1").run(
      JSON.stringify(codes.map((c) => hash(c.replaceAll("-", "")))),
    );
    return codes;
  }
  function invalidateOthers(req) {
    db.prepare("DELETE FROM sessions WHERE hash<>?").run(
      session(req)?.hash || "",
    );
    pending.clear();
  }
  return {
    confirm,
    verifyFactor,
    finish,
    status() {
      return {
        totpEnabled: !!state().secret,
        recoveryRemaining: JSON.parse(state().recovery).length,
        passkeys: db
          .prepare(
            "SELECT id,name,rp_id AS rpID,created_at AS createdAt,last_used AS lastUsed FROM passkeys ORDER BY created_at",
          )
          .all(),
      };
    },
    mfa(req, res, data) {
      limit(req.socket.remoteAddress);
      const pendingLogin = take(data.challenge, "login", req, false);
      verifyFactor(data.code);
      pending.delete(data.challenge);
      resetLimit(req);
      return issue(res, userById(pendingLogin.userId) || undefined);
    },
    async setupTotp(req, data) {
      if (state().secret) throw new HttpError(409, "双因素验证已启用");
      await confirm(req, data);
      const secret = new OTPAuth.Secret({ size: 20 }).base32;
      const challenge = remember("totp", req, { secret }, true);
      const uri = totp(secret).toString();
      return {
        challenge,
        secret,
        qr: await QRCode.toDataURL(uri, { width: 240, margin: 1 }),
      };
    },
    enableTotp(req, data) {
      limit(req.socket.remoteAddress);
      const v = take(data.challenge, "totp", req, false);
      if (state().secret) throw new HttpError(409, "双因素验证已启用");
      const n = counter(v.secret, data.code);
      if (n === null) throw new HttpError(400, "验证码不正确");
      db.prepare(
        "UPDATE account_security SET secret=?,last_counter=? WHERE id=1",
      ).run(encrypt(v.secret), n);
      const codes = recoveryCodes();
      invalidateOthers(req);
      resetLimit(req);
      return { recoveryCodes: codes };
    },
    async disableTotp(req, data) {
      await confirm(req, data);
      db.prepare(
        "UPDATE account_security SET secret=NULL,last_counter=-1,recovery='[]' WHERE id=1",
      ).run();
      invalidateOthers(req);
      return { ok: true };
    },
    async rotateRecovery(req, data) {
      if (!state().secret) throw new HttpError(409, "请先启用双因素验证");
      await confirm(req, data);
      return { recoveryCodes: recoveryCodes() };
    },
    async registrationOptions(req, data) {
      const rp = relyingParty(req);
      const name = typeof data.name === "string" ? data.name.trim() : "";
      requireValue(
        name.length > 0 && name.length <= 60,
        "请填写 1–60 个字符的通行密钥名称",
      );
      const existing = db
        .prepare("SELECT * FROM passkeys WHERE rp_id=?")
        .all(rp.rpID);
      if (db.prepare("SELECT COUNT(*) n FROM passkeys").get().n >= 20)
        throw new HttpError(400, "最多保存 20 个通行密钥");
      const userID = existing[0]?.user_id || token();
      const options = await generateRegistrationOptions({
        rpName: site().name,
        rpID: rp.rpID,
        userID: Buffer.from(userID, "base64url"),
        userName: admin().username,
        userDisplayName: admin().username,
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        excludeCredentials: existing.map((p) => ({
          id: p.id,
          transports: JSON.parse(p.transports),
        })),
      });
      return {
        options,
        challenge: remember(
          "register",
          req,
          { ...rp, expectedChallenge: options.challenge, name, userID },
          true,
        ),
      };
    },
    async register(req, data) {
      const v = take(data.challenge, "register", req);
      if (relyingParty(req).expectedOrigin !== v.expectedOrigin)
        throw new HttpError(401, "验证来源不匹配");
      let result;
      try {
        result = await verifyRegistrationResponse({
          response: data.response,
          expectedChallenge: v.expectedChallenge,
          expectedOrigin: v.expectedOrigin,
          expectedRPID: v.rpID,
          requireUserVerification: true,
        });
      } catch {
        throw new HttpError(400, "通行密钥验证失败，请重试");
      }
      if (!result.verified) throw new HttpError(400, "通行密钥验证失败");
      const c = result.registrationInfo.credential;
      if (db.prepare("SELECT id FROM passkeys WHERE id=?").get(c.id))
        throw new HttpError(409, "此通行密钥已添加");
      db.prepare(
        "INSERT INTO passkeys(id,public_key,counter,transports,name,rp_id,user_id,created_at) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        c.id,
        Buffer.from(c.publicKey),
        c.counter,
        JSON.stringify(c.transports || []),
        v.name,
        v.rpID,
        v.userID,
        Date.now(),
      );
      return { ok: true };
    },
    async authenticationOptions(req) {
      limit(req.socket.remoteAddress);
      const rp = relyingParty(req);
      const options = await generateAuthenticationOptions({
        rpID: rp.rpID,
        userVerification: "required",
      });
      return {
        options,
        challenge: remember("authenticate", req, {
          ...rp,
          expectedChallenge: options.challenge,
        }),
      };
    },
    async authenticate(req, res, data) {
      limit(req.socket.remoteAddress);
      const v = take(data.challenge, "authenticate", req);
      const p = db
        .prepare("SELECT * FROM passkeys WHERE id=? AND rp_id=?")
        .get(String(data.response?.id || ""), v.rpID);
      if (!p || relyingParty(req).expectedOrigin !== v.expectedOrigin)
        throw new HttpError(401, "通行密钥验证失败");
      const userHandle = data.response?.response?.userHandle;
      if (userHandle && userHandle !== p.user_id)
        throw new HttpError(401, "通行密钥验证失败");
      let result;
      try {
        result = await verifyAuthenticationResponse({
          response: data.response,
          expectedChallenge: v.expectedChallenge,
          expectedOrigin: v.expectedOrigin,
          expectedRPID: v.rpID,
          requireUserVerification: true,
          credential: {
            id: p.id,
            publicKey: new Uint8Array(p.public_key),
            counter: p.counter,
            transports: JSON.parse(p.transports),
          },
        });
      } catch {
        throw new HttpError(401, "通行密钥验证失败");
      }
      if (!result.verified || !result.authenticationInfo.userVerified)
        throw new HttpError(401, "通行密钥验证失败");
      // A concurrent assertion must not roll the stored signature counter back.
      const changed = db
        .prepare(
          "UPDATE passkeys SET counter=?,last_used=? WHERE id=? AND counter=?",
        )
        .run(result.authenticationInfo.newCounter, Date.now(), p.id, p.counter);
      if (changed.changes !== 1) throw new HttpError(401, "验证已使用，请重试");
      return finish(req, res);
    },
    async removePasskey(req, id, data) {
      await confirm(req, data);
      const result = db.prepare("DELETE FROM passkeys WHERE id=?").run(id);
      if (!result.changes) throw new HttpError(404, "通行密钥不存在");
      invalidateOthers(req);
      return { ok: true };
    },
    clearPending() {
      pending.clear();
    },
  };
}
