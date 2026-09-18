import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import yazl from "yazl";
import { readZip } from "./archive.mjs";
import { assetTypes, HttpError, requireValue } from "./content.mjs";

const safeName = (value) =>
  String(value || "素材")
    .replace(/[\x00-\x1f\x7f/\\<>:"|?*]/g, "_")
    .slice(0, 100);

export function createPlatform(store, dataDir, publicURL) {
  const { db } = store;
  dataDir = path.resolve(dataDir);
  const brandDir = path.join(dataDir, "brand-assets"),
    backupDir = path.join(dataDir, "backups");
  fs.mkdirSync(brandDir, { recursive: true });
  fs.mkdirSync(backupDir, { recursive: true });
  db.exec(`CREATE TABLE IF NOT EXISTS brand_assets(
      id TEXT PRIMARY KEY,name TEXT NOT NULL,file_name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,size INTEGER NOT NULL,created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audience_sessions(
      token TEXT PRIMARY KEY,deck_id TEXT NOT NULL,title TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audience_questions(
      id TEXT PRIMARY KEY,session_token TEXT NOT NULL REFERENCES audience_sessions(token) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT '',body TEXT NOT NULL,author_role TEXT NOT NULL DEFAULT 'audience',answered INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audience_polls(
      id TEXT PRIMARY KEY,session_token TEXT NOT NULL REFERENCES audience_sessions(token) ON DELETE CASCADE,
      question TEXT NOT NULL,options TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audience_votes(
      id TEXT PRIMARY KEY,poll_id TEXT NOT NULL REFERENCES audience_polls(id) ON DELETE CASCADE,
      visitor TEXT NOT NULL,option_index INTEGER NOT NULL,created_at INTEGER NOT NULL,
      UNIQUE(poll_id,visitor)
    );
    CREATE TABLE IF NOT EXISTS audience_feedback(
      id TEXT PRIMARY KEY,session_token TEXT NOT NULL REFERENCES audience_sessions(token) ON DELETE CASCADE,
      visitor TEXT NOT NULL,rating INTEGER NOT NULL,created_at INTEGER NOT NULL,
      UNIQUE(session_token,visitor)
    );
    CREATE TABLE IF NOT EXISTS audience_connections(
      session_token TEXT NOT NULL REFERENCES audience_sessions(token) ON DELETE CASCADE,
      device_id TEXT NOT NULL,user_agent TEXT NOT NULL DEFAULT '',ip TEXT NOT NULL DEFAULT '',
      first_seen INTEGER NOT NULL,last_seen INTEGER NOT NULL,
      PRIMARY KEY(session_token,device_id)
    );`);
  if (
    !db
      .prepare("PRAGMA table_info(audience_questions)")
      .all()
      .some((column) => column.name === "author_role")
  )
    db.exec(
      "ALTER TABLE audience_questions ADD COLUMN author_role TEXT NOT NULL DEFAULT 'audience'",
    );

  const brandKit = () => {
    const row = db
      .prepare("SELECT value FROM settings WHERE key='brand-kit'")
      .get();
    return row
      ? JSON.parse(row.value)
      : { primary: "#276455", secondary: "#f2b84b", font: "" };
  };
  const saveBrandKit = (input) => {
    const color = (value, fallback) =>
      /^#[0-9a-f]{6}$/i.test(value || "") ? value.toLowerCase() : fallback;
    const value = {
      primary: color(input.primary, "#276455"),
      secondary: color(input.secondary, "#f2b84b"),
      font: String(input.font || "")
        .trim()
        .slice(0, 80),
    };
    db.prepare(
      "INSERT INTO settings(key,value) VALUES('brand-kit',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    ).run(JSON.stringify(value));
    return value;
  };
  const listBrandAssets = () =>
    db
      .prepare(
        "SELECT id,name,type,size,created_at AS createdAt FROM brand_assets ORDER BY created_at DESC",
      )
      .all();
  const brandAsset = (id) => {
    const row = db.prepare("SELECT * FROM brand_assets WHERE id=?").get(id);
    if (!row) throw new HttpError(404, "品牌素材不存在");
    const file = path.join(brandDir, row.file_name);
    if (!fs.existsSync(file)) throw new HttpError(404, "品牌素材文件不存在");
    return { row, file };
  };
  const uploadBrandAsset = (input) => {
    requireValue(
      typeof input.name === "string" && typeof input.base64 === "string",
      "素材格式不正确",
    );
    const ext = path.extname(input.name).toLowerCase(),
      type = assetTypes[ext],
      bytes = Buffer.from(input.base64, "base64");
    requireValue(type && type.startsWith("image/"), "品牌素材需为图片或 SVG");
    requireValue(
      bytes.length > 0 && bytes.length <= 30 * 1024 * 1024,
      "素材需小于 30 MB",
    );
    requireValue(listBrandAssets().length < 200, "品牌素材最多保存 200 个");
    const id = crypto.randomUUID(),
      fileName = id + ext,
      name = safeName(input.label || path.basename(input.name, ext));
    fs.writeFileSync(path.join(brandDir, fileName), bytes, { flag: "wx" });
    db.prepare(
      "INSERT INTO brand_assets(id,name,file_name,type,size,created_at) VALUES(?,?,?,?,?,?)",
    ).run(id, name, fileName, type, bytes.length, Date.now());
    return listBrandAssets().find((item) => item.id === id);
  };
  const deleteBrandAsset = (id) => {
    const asset = brandAsset(id);
    db.prepare("DELETE FROM brand_assets WHERE id=?").run(id);
    fs.rmSync(asset.file, { force: true });
    return { ok: true };
  };
  const useBrandAsset = (id, deckId) => {
    const asset = brandAsset(id),
      ext = path.extname(asset.row.file_name),
      name = `brand/${safeName(asset.row.name)}-${id.slice(0, 8)}${ext}`;
    const assets = store.assets(deckId);
    if (!assets.some((entry) => entry.path === `assets/${name}`))
      store.upload(deckId, [
        {
          name: path.basename(name),
          path: name,
          base64: fs.readFileSync(asset.file).toString("base64"),
        },
      ]);
    return store
      .assets(deckId)
      .find((entry) => entry.path === `assets/${name}`);
  };

  const audienceURL = (token) =>
    `${publicURL || ""}/audience/${encodeURIComponent(token)}`.replace(
      /([^:]\/)\/+/,
      "$1",
    );
  const audienceSession = (token) => {
    const session = db
      .prepare("SELECT * FROM audience_sessions WHERE token=?")
      .get(token);
    if (!session || !session.active)
      throw new HttpError(404, "互动会话不存在或已结束");
    return session;
  };
  const pollDTO = (row) => {
    if (!row) return null;
    const options = JSON.parse(row.options),
      counts = db
        .prepare(
          "SELECT option_index AS optionIndex,COUNT(*) AS count FROM audience_votes WHERE poll_id=? GROUP BY option_index",
        )
        .all(row.id),
      countMap = new Map(
        counts.map((entry) => [entry.optionIndex, entry.count]),
      );
    return {
      id: row.id,
      question: row.question,
      status: row.status,
      createdAt: row.created_at,
      options: options.map((label, index) => ({
        label,
        count: countMap.get(index) || 0,
      })),
      votes: counts.reduce((sum, entry) => sum + entry.count, 0),
    };
  };
  const audienceState = (token, admin = false) => {
    const session = audienceSession(token),
      poll = db
        .prepare(
          "SELECT * FROM audience_polls WHERE session_token=? ORDER BY created_at DESC LIMIT 1",
        )
        .get(token),
      questions = admin
        ? db
            .prepare(
              "SELECT id,name,body,author_role AS authorRole,answered,created_at AS createdAt FROM audience_questions WHERE session_token=? ORDER BY created_at DESC",
            )
            .all(token)
            .map((item) => ({ ...item, answered: !!item.answered }))
        : undefined,
      feedback = db
        .prepare(
          "SELECT COUNT(*) AS count,AVG(rating) AS average FROM audience_feedback WHERE session_token=?",
        )
        .get(token),
      connections = admin
        ? db
            .prepare(
              "SELECT device_id AS deviceId,user_agent AS userAgent,ip,first_seen AS firstSeen,last_seen AS lastSeen FROM audience_connections WHERE session_token=? ORDER BY last_seen DESC",
            )
            .all(token)
        : undefined;
    return {
      token,
      title: session.title,
      active: !!session.active,
      poll: pollDTO(poll),
      questionCount: db
        .prepare(
          "SELECT COUNT(*) AS count FROM audience_questions WHERE session_token=?",
        )
        .get(token).count,
      feedback: {
        count: feedback.count,
        average: Number(feedback.average || 0),
      },
      ...(admin ? { questions, connections, url: audienceURL(token) } : {}),
    };
  };
  const audienceFeed = (token) => {
    const state = audienceState(token),
      comments = db
        .prepare(
          "SELECT id,name,body,author_role AS authorRole,created_at AS createdAt FROM audience_questions WHERE session_token=? ORDER BY created_at DESC LIMIT 30",
        )
        .all(token);
    return { poll: state.poll, comments, updatedAt: Date.now() };
  };
  const recordAudienceConnection = (token, connection) => {
    audienceSession(token);
    const now = Date.now(),
      deviceId = String(connection.deviceId || "anonymous").slice(0, 80),
      userAgent = String(connection.userAgent || "").slice(0, 300),
      ip = String(connection.ip || "").slice(0, 80);
    db.prepare(
      "INSERT INTO audience_connections(session_token,device_id,user_agent,ip,first_seen,last_seen) VALUES(?,?,?,?,?,?) ON CONFLICT(session_token,device_id) DO UPDATE SET user_agent=excluded.user_agent,ip=excluded.ip,last_seen=excluded.last_seen",
    ).run(token, deviceId, userAgent, ip, now, now);
  };
  const createAudience = (deckId) => {
    const deck = store.get(deckId),
      token = crypto.randomBytes(24).toString("base64url"),
      now = Date.now();
    db.prepare(
      "INSERT INTO audience_sessions(token,deck_id,title,created_at,updated_at) VALUES(?,?,?,?,?)",
    ).run(token, deck.id, deck.title, now, now);
    return audienceState(token, true);
  };
  const visitor = (value) =>
    crypto
      .createHash("sha256")
      .update(String(value || "anonymous"))
      .digest("hex");
  const askQuestion = (token, input, authorRole = "audience") => {
    audienceSession(token);
    const body = String(input.body || "").trim(),
      name = String(input.name || "匿名观众")
        .trim()
        .slice(0, 40),
      role = ["host", "system"].includes(authorRole) ? authorRole : "audience";
    requireValue(
      body.length >= 1 && body.length <= 500,
      "评论需为 1–500 个字符",
    );
    db.prepare(
      "INSERT INTO audience_questions(id,session_token,name,body,author_role,answered,created_at) VALUES(?,?,?,?,?,?,?)",
    ).run(
      crypto.randomUUID(),
      token,
      role === "host"
        ? "房主"
        : role === "system"
          ? "系统"
          : name || "匿名观众",
      body,
      role,
      role === "system" ? 1 : 0,
      Date.now(),
    );
    return { ok: true };
  };
  const createPoll = (token, input) => {
    audienceSession(token);
    const question = String(input.question || "").trim(),
      options = (Array.isArray(input.options) ? input.options : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean);
    requireValue(
      question.length >= 1 && question.length <= 200,
      "投票题目需为 1–200 个字符",
    );
    requireValue(
      options.length >= 2 && options.length <= 8,
      "投票需要 2–8 个选项",
    );
    db.prepare(
      "UPDATE audience_polls SET status='closed' WHERE session_token=? AND status='open'",
    ).run(token);
    const id = crypto.randomUUID();
    db.prepare(
      "INSERT INTO audience_polls(id,session_token,question,options,created_at) VALUES(?,?,?,?,?)",
    ).run(id, token, question, JSON.stringify(options), Date.now());
    return audienceState(token, true);
  };
  const vote = (token, input) => {
    audienceSession(token);
    const poll = db
      .prepare("SELECT * FROM audience_polls WHERE id=? AND session_token=?")
      .get(input.pollId, token);
    if (!poll || poll.status !== "open")
      throw new HttpError(409, "投票已经结束");
    const options = JSON.parse(poll.options),
      option = Number(input.option);
    requireValue(
      Number.isInteger(option) && option >= 0 && option < options.length,
      "投票选项不正确",
    );
    try {
      db.prepare(
        "INSERT INTO audience_votes(id,poll_id,visitor,option_index,created_at) VALUES(?,?,?,?,?)",
      ).run(
        crypto.randomUUID(),
        poll.id,
        visitor(input.visitor),
        option,
        Date.now(),
      );
    } catch (error) {
      if (String(error.message).includes("UNIQUE"))
        throw new HttpError(409, "你已经参与过这次投票");
      throw error;
    }
    return audienceState(token);
  };
  const feedback = (token, input) => {
    audienceSession(token);
    const rating = Number(input.rating);
    requireValue(
      Number.isInteger(rating) && rating >= 1 && rating <= 5,
      "评分不正确",
    );
    db.prepare(
      "INSERT INTO audience_feedback(id,session_token,visitor,rating,created_at) VALUES(?,?,?,?,?) ON CONFLICT(session_token,visitor) DO UPDATE SET rating=excluded.rating,created_at=excluded.created_at",
    ).run(
      crypto.randomUUID(),
      token,
      visitor(input.visitor),
      rating,
      Date.now(),
    );
    return { ok: true };
  };

  const walk = (dir, prefix, zip) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name),
        name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(full, name + "/", zip);
      else zip.addFile(full, name);
    }
  };
  const createBackup = async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-"),
      name = `powerdeck-${stamp}.zip`,
      output = path.join(backupDir, name),
      snapshot = path.join(
        backupDir,
        `.snapshot-${crypto.randomUUID()}.sqlite`,
      ),
      escaped = snapshot.replaceAll("'", "''");
    db.exec(`VACUUM INTO '${escaped}'`);
    const zip = new yazl.ZipFile(),
      stream = fs.createWriteStream(output, { flags: "wx" });
    zip.addBuffer(
      Buffer.from(
        JSON.stringify(
          { format: "powerdeck-backup/v1", createdAt: Date.now() },
          null,
          2,
        ),
      ),
      "manifest.json",
    );
    zip.addFile(snapshot, "library.sqlite");
    walk(path.join(dataDir, "decks"), "decks/", zip);
    walk(brandDir, "brand-assets/", zip);
    if (fs.existsSync(path.join(dataDir, "security.key")))
      zip.addFile(path.join(dataDir, "security.key"), "security.key");
    zip.outputStream.pipe(stream);
    zip.end();
    await new Promise((resolve, reject) => {
      stream.on("close", resolve);
      stream.on("error", reject);
      zip.outputStream.on("error", reject);
    });
    fs.rmSync(snapshot, { force: true });
    return { name, size: fs.statSync(output).size, createdAt: Date.now() };
  };
  const backups = () =>
    fs
      .readdirSync(backupDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && /^powerdeck-[\w.-]+\.zip$/.test(entry.name),
      )
      .map((entry) => {
        const stat = fs.statSync(path.join(backupDir, entry.name));
        return { name: entry.name, size: stat.size, createdAt: stat.mtimeMs };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  const backupFile = (name) => {
    requireValue(/^powerdeck-[\w.-]+\.zip$/.test(name || ""), "备份名称不正确");
    const file = path.join(backupDir, name);
    if (!fs.existsSync(file)) throw new HttpError(404, "备份不存在");
    return file;
  };
  const deleteBackup = (name) => {
    fs.rmSync(backupFile(name), { force: true });
    return { ok: true };
  };
  const restoreBackup = async (bytes) => {
    const files = await readZip(bytes, {
      label: "PowerDeck 备份",
      maxCompressed: 512 * 1024 * 1024,
      maxTotal: 1024 * 1024 * 1024,
      maxEntry: 512 * 1024 * 1024,
      maxEntries: 20000,
    });
    let manifest;
    try {
      manifest = JSON.parse(files.get("manifest.json")?.toString("utf8"));
    } catch {}
    requireValue(
      manifest?.format === "powerdeck-backup/v1" && files.has("library.sqlite"),
      "不是有效的 PowerDeck 备份",
    );
    const stage = path.join(dataDir, `.restore-${crypto.randomUUID()}`);
    fs.mkdirSync(stage, { recursive: true });
    try {
      for (const [name, value] of files) {
        if (name === "manifest.json") continue;
        requireValue(
          name === "library.sqlite" ||
            name === "security.key" ||
            name.startsWith("decks/") ||
            name.startsWith("brand-assets/"),
          "备份包含未知文件",
        );
        const target = path.join(stage, ...name.split("/"));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, value);
      }
      store.close();
      for (const name of [
        "library.sqlite",
        "library.sqlite-wal",
        "library.sqlite-shm",
        "decks",
        "brand-assets",
        "security.key",
      ])
        fs.rmSync(path.join(dataDir, name), { recursive: true, force: true });
      for (const entry of fs.readdirSync(stage))
        fs.renameSync(path.join(stage, entry), path.join(dataDir, entry));
      fs.rmSync(stage, { recursive: true, force: true });
      return { ok: true, restart: true };
    } catch (error) {
      fs.rmSync(stage, { recursive: true, force: true });
      throw error;
    }
  };

  return {
    brandKit,
    saveBrandKit,
    listBrandAssets,
    uploadBrandAsset,
    deleteBrandAsset,
    brandAsset,
    useBrandAsset,
    createAudience,
    audienceState,
    audienceFeed,
    recordAudienceConnection,
    askQuestion,
    createPoll,
    vote,
    feedback,
    closePoll: (token) => {
      audienceSession(token);
      db.prepare(
        "UPDATE audience_polls SET status='closed' WHERE session_token=? AND status='open'",
      ).run(token);
      return audienceState(token, true);
    },
    answerQuestion: (token, id, answered = true) => {
      audienceSession(token);
      const result = db
        .prepare(
          "UPDATE audience_questions SET answered=? WHERE id=? AND session_token=?",
        )
        .run(answered ? 1 : 0, id, token);
      if (!result.changes) throw new HttpError(404, "评论不存在");
      return audienceState(token, true);
    },
    endAudience: (token) => {
      audienceSession(token);
      db.prepare(
        "UPDATE audience_sessions SET active=0,updated_at=? WHERE token=?",
      ).run(Date.now(), token);
      return { ok: true };
    },
    createBackup,
    backups,
    backupFile,
    deleteBackup,
    restoreBackup,
  };
}
