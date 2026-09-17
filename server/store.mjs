import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { templates, templateContent } from "../frontend/templates/catalog.js";
import { DatabaseSync } from "node:sqlite";
import {
  HttpError,
  requireValue,
  normalizeContent,
  assetTypes,
  blankContent,
} from "./content.mjs";
import {
  migrateIdentity,
  slugValue,
  faviconValue,
  ensureSlugAvailable,
} from "./settings.mjs";
export const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const token = () => crypto.randomBytes(32).toString("base64url");
export function createStore(dataDir, seedDir) {
  dataDir = path.resolve(dataDir);
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path.join(dataDir, "library.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
  );
  db.exec(`CREATE TABLE IF NOT EXISTS admin(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL,password TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS decks(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',author TEXT NOT NULL DEFAULT '',width INTEGER NOT NULL,height INTEGER NOT NULL,slide_count INTEGER NOT NULL,visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','shared')),revision TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,deleted_at INTEGER);
 CREATE TABLE IF NOT EXISTS shares(id TEXT PRIMARY KEY,deck_id TEXT NOT NULL REFERENCES decks(id),label TEXT NOT NULL,token TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,allow_notes INTEGER NOT NULL DEFAULT 0,expires_at INTEGER,revoked_at INTEGER,created_at INTEGER NOT NULL);`);
  migrateIdentity(db);
  const columns = db.prepare("PRAGMA table_info(decks)").all();
  if (!columns.some((c) => c.name === "kind"))
    db.exec(
      "ALTER TABLE decks ADD COLUMN kind TEXT NOT NULL DEFAULT 'deck' CHECK(kind IN ('deck','template'))",
    );
  if (!columns.some((c) => c.name === "builtin"))
    db.exec("ALTER TABLE decks ADD COLUMN builtin INTEGER NOT NULL DEFAULT 0");
  db.exec(`CREATE TABLE IF NOT EXISTS deck_revisions(
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS deck_revisions_deck_created
    ON deck_revisions(deck_id, created_at DESC);`);
  db.exec(`INSERT OR IGNORE INTO deck_revisions(id,deck_id,version,created_at)
    SELECT revision,id,version,updated_at FROM decks`);
  const shareColumns = db.prepare("PRAGMA table_info(shares)").all();
  if (!shareColumns.some((column) => column.name === "allow_download"))
    db.exec(
      "ALTER TABLE shares ADD COLUMN allow_download INTEGER NOT NULL DEFAULT 0",
    );
  if (!shareColumns.some((column) => column.name === "view_count"))
    db.exec(
      "ALTER TABLE shares ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0",
    );
  if (!shareColumns.some((column) => column.name === "last_view_at"))
    db.exec("ALTER TABLE shares ADD COLUMN last_view_at INTEGER");
  if (!shareColumns.some((column) => column.name === "download_count"))
    db.exec(
      "ALTER TABLE shares ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0",
    );
  const deckDir = (id) => path.join(dataDir, "decks", id);
  const raw = (id) => db.prepare("SELECT * FROM decks WHERE id=?").get(id);
  const dto = (r) =>
    r && {
      id: r.id,
      kind: r.kind,
      builtin: !!r.builtin,
      slug: r.slug,
      favicon: r.favicon,
      title: r.title,
      description: r.description,
      author: r.author,
      width: r.width,
      height: r.height,
      slideCount: r.slide_count,
      visibility: r.visibility,
      version: r.version,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at,
      activeShares: db
        .prepare(
          "SELECT COUNT(*) n FROM shares WHERE deck_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)",
        )
        .get(r.id, Date.now()).n,
    };
  const get = (id, includeDeleted = false) => {
    const r = raw(id);
    if (!r || (!includeDeleted && r.deleted_at))
      throw new HttpError(404, "演示稿不存在");
    return dto(r);
  };
  const readRevision = (id, revisionId) => {
    const r = raw(id);
    if (!r) throw new HttpError(404, "演示稿不存在");
    const dir = path.join(deckDir(id), "revisions", revisionId || r.revision);
    if (!fs.existsSync(dir)) throw new HttpError(404, "历史版本不存在");
    return {
      html: fs.readFileSync(path.join(dir, "content.html"), "utf8"),
      css: fs.readFileSync(path.join(dir, "styles.css"), "utf8"),
      notes: JSON.parse(fs.readFileSync(path.join(dir, "notes.json"), "utf8")),
    };
  };
  const content = (id) => readRevision(id);
  const revision = (id, c) => {
    const rev = crypto.randomUUID(),
      dir = path.join(deckDir(id), "revisions", rev);
    fs.mkdirSync(dir, { recursive: true });
    try {
      fs.writeFileSync(path.join(dir, "content.html"), c.html);
      fs.writeFileSync(path.join(dir, "styles.css"), c.css);
      fs.writeFileSync(path.join(dir, "notes.json"), JSON.stringify(c.notes));
      return rev;
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw e;
    }
  };
  const meta = (m) => {
    requireValue(
      typeof m.title === "string" &&
        m.title.trim().length > 0 &&
        m.title.length <= 120,
      "标题需为 1–120 个字符",
    );
    requireValue(
      typeof (m.description || "") === "string" &&
        (m.description || "").length <= 1000,
      "简介过长",
    );
    requireValue(
      typeof (m.author || "") === "string" && (m.author || "").length <= 120,
      "作者名称过长",
    );
    const width = Number(m.width || 1600),
      height = Number(m.height || 900);
    requireValue(
      Number.isInteger(width) &&
        width >= 320 &&
        width <= 3840 &&
        Number.isInteger(height) &&
        height >= 240 &&
        height <= 2160,
      "页面尺寸不正确",
    );
    return {
      title: m.title.trim(),
      description: m.description || "",
      author: m.author || "",
      width,
      height,
    };
  };
  function create(input, id = "d_" + crypto.randomBytes(8).toString("hex")) {
    const kind = input.kind ?? "deck";
    requireValue(["deck", "template"].includes(kind), "内容类型不正确");
    const slug = slugValue(
      input.format === "deck-library/v1" ? id : input.slug || id,
    );
    ensureSlugAvailable(db, slug, id);
    const favicon = faviconValue(input.favicon ?? null);
    const m = meta(input),
      c = normalizeContent(input.html ? input : blankContent),
      rev = revision(id, c),
      now = Date.now();
    db.prepare(
      "INSERT INTO decks(id,title,description,author,width,height,slide_count,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      m.title,
      m.description,
      m.author,
      m.width,
      m.height,
      c.slideCount,
      rev,
      now,
      now,
    );
    db.prepare("UPDATE decks SET slug=?,favicon=?,kind=? WHERE id=?").run(
      slug,
      favicon,
      kind,
      id,
    );
    db.prepare(
      "INSERT INTO deck_revisions(id,deck_id,version,created_at) VALUES(?,?,1,?)",
    ).run(rev, id, now);
    return get(id);
  }
  function save(id, input) {
    const current = get(id);
    if (input.version !== current.version)
      throw new HttpError(409, "演示稿已被更新，请重新打开后再保存");
    const slug = slugValue(input.slug ?? current.slug);
    ensureSlugAvailable(db, slug, id);
    const favicon =
      input.favicon === undefined
        ? current.favicon
        : faviconValue(input.favicon);
    const m = meta({ ...current, ...input });
    let rev = raw(id).revision,
      count = current.slideCount;
    if (input.html !== undefined) {
      const c = normalizeContent(input);
      rev = revision(id, c);
      count = c.slideCount;
    }
    const visibility = input.visibility ?? current.visibility;
    requireValue(["private", "shared"].includes(visibility), "权限设置不正确");
    requireValue(
      current.kind !== "template" || visibility === "private",
      "模板仅用于新建文稿，不能设置链接分享",
    );
    const now = Date.now();
    db.exec("BEGIN IMMEDIATE");
    try {
      if (visibility === "private")
        db.prepare(
          "UPDATE shares SET revoked_at=? WHERE deck_id=? AND revoked_at IS NULL",
        ).run(Date.now(), id);
      db.prepare(
        "UPDATE decks SET title=?,description=?,author=?,width=?,height=?,slide_count=?,revision=?,visibility=?,version=version+1,updated_at=? WHERE id=?",
      ).run(
        m.title,
        m.description,
        m.author,
        m.width,
        m.height,
        count,
        rev,
        visibility,
        now,
        id,
      );
      db.prepare("UPDATE decks SET slug=?,favicon=? WHERE id=?").run(
        slug,
        favicon,
        id,
      );
      if (input.html !== undefined)
        db.prepare(
          "INSERT INTO deck_revisions(id,deck_id,version,created_at) VALUES(?,?,?,?)",
        ).run(rev, id, current.version + 1, now);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    return get(id);
  }
  const revisions = (id) => {
    const current = raw(id);
    if (!current || current.deleted_at)
      throw new HttpError(404, "演示稿不存在");
    return db
      .prepare(
        "SELECT id,version,created_at FROM deck_revisions WHERE deck_id=? ORDER BY created_at DESC,id DESC",
      )
      .all(id)
      .map((row) => ({
        id: row.id,
        version: row.version,
        createdAt: row.created_at,
        current: row.id === current.revision,
      }));
  };
  function revisionContent(id, revisionId) {
    get(id);
    const row = db
      .prepare("SELECT id FROM deck_revisions WHERE id=? AND deck_id=?")
      .get(revisionId, id);
    if (!row) throw new HttpError(404, "历史版本不存在");
    return readRevision(id, revisionId);
  }
  function restoreRevision(id, revisionId, version) {
    const current = get(id);
    if (version !== current.version)
      throw new HttpError(409, "演示稿已被更新，请刷新版本历史后重试");
    return save(id, { ...revisionContent(id, revisionId), version });
  }
  function file(id, name) {
    requireValue(
      typeof name === "string" && !name.includes("\\") && !name.includes("\0"),
      "素材路径不正确",
    );
    const root = path.join(deckDir(id), "assets");
    const full = path.resolve(root, name.replace(/^assets\//, ""));
    if (
      !full.startsWith(root + path.sep) ||
      !assetTypes[path.extname(full).toLowerCase()]
    )
      throw new HttpError(404, "素材不存在");
    if (!fs.existsSync(full) || !fs.statSync(full).isFile())
      throw new HttpError(404, "素材不存在");
    if (!fs.realpathSync(full).startsWith(fs.realpathSync(root) + path.sep))
      throw new HttpError(404, "素材不存在");
    return full;
  }
  function upload(id, files) {
    get(id);
    requireValue(
      Array.isArray(files) && files.length > 0 && files.length <= 100,
      "请选择 1–100 个素材",
    );
    const validated = files.map((f) => {
      requireValue(
        typeof f.name === "string" && typeof f.base64 === "string",
        "素材格式不正确",
      );
      const ext = path.extname(f.name).toLowerCase();
      requireValue(assetTypes[ext], "支持图片、SVG 和字体文件");
      const data = Buffer.from(f.base64, "base64");
      requireValue(
        data.length > 0 && data.length <= 12 * 1024 * 1024,
        "单个素材需小于 12 MB",
      );
      const name = (f.path || f.name).replace(/^assets\//, "");
      requireValue(
        !name.includes("\\") &&
          !name.split("/").some((p) => !p || p === ".." || p === ".") &&
          name.length <= 200 &&
          !name.includes("\0"),
        "素材名称不正确",
      );
      requireValue(
        path.extname(name).toLowerCase() === ext,
        "素材扩展名不一致",
      );
      return { name, data };
    });
    requireValue(
      new Set(validated.map((f) => f.name.toLowerCase())).size ===
        validated.length,
      "请勿上传同名素材",
    );
    for (const { name, data } of validated) {
      const full = path.join(deckDir(id), "assets", name);
      if (fs.existsSync(full))
        throw new HttpError(409, "素材已存在，请重命名后上传：" + name);
    }
    for (const { name, data } of validated) {
      const full = path.join(deckDir(id), "assets", name);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, data, { flag: "wx" });
    }
    return assets(id);
  }
  function assets(id) {
    get(id);
    const root = path.join(deckDir(id), "assets"),
      result = [];
    function list(dir, prefix = "") {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) continue;
        const relative = prefix + entry.name,
          full = path.join(dir, entry.name);
        if (entry.isDirectory()) list(full, relative + "/");
        else if (assetTypes[path.extname(entry.name).toLowerCase()])
          result.push({
            name: entry.name,
            path: "assets/" + relative,
            size: fs.statSync(full).size,
            type: assetTypes[path.extname(entry.name).toLowerCase()],
          });
      }
    }
    list(root);
    return result;
  }
  function share(id, input) {
    const d = get(id);
    requireValue(d.kind !== "template", "模板不能创建分享链接");
    requireValue(
      typeof (input.label || "分享链接") === "string" &&
        (input.label || "").length <= 100,
      "链接名称过长",
    );
    if (d.visibility !== "shared")
      throw new HttpError(409, "请先将此 PPT 设为链接分享");
    let expires = null;
    if (input.days !== null && input.days !== undefined) {
      requireValue([1, 7, 30].includes(input.days), "有效期不正确");
      expires = Date.now() + input.days * 86400000;
    }
    const slug = slugValue(input.slug || d.slug);
    const t = token(),
      sid = crypto.randomUUID();
    db.prepare(
      "INSERT INTO shares(id,deck_id,label,token,hash,allow_notes,allow_download,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    ).run(
      sid,
      id,
      input.label || "分享链接",
      t,
      hash(t),
      input.allowNotes === true ? 1 : 0,
      input.allowDownload === true ? 1 : 0,
      expires,
      Date.now(),
    );
    db.prepare("UPDATE shares SET slug=? WHERE id=?").run(slug, sid);
    return shares(id).find((s) => s.id === sid);
  }
  const shares = (id) =>
    db
      .prepare("SELECT * FROM shares WHERE deck_id=? ORDER BY created_at DESC")
      .all(id)
      .map((s) => ({
        id: s.id,
        label: s.label,
        token: s.token,
        slug: s.slug,
        path: "/s/" + s.slug + "/" + s.token,
        allowNotes: !!s.allow_notes,
        allowDownload: !!s.allow_download,
        viewCount: s.view_count,
        lastViewedAt: s.last_view_at,
        downloadCount: s.download_count,
        expiresAt: s.expires_at,
        revokedAt: s.revoked_at,
        createdAt: s.created_at,
      }));
  const publicAccess = (t) => {
    if (typeof t !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(t))
      throw new HttpError(404, "分享链接不存在、已过期或已撤销");
    const s = db.prepare("SELECT * FROM shares WHERE hash=?").get(hash(t)),
      d = s && raw(s.deck_id);
    if (
      !s ||
      s.revoked_at ||
      (s.expires_at && s.expires_at <= Date.now()) ||
      !d ||
      d.kind === "template" ||
      d.deleted_at ||
      d.visibility !== "shared"
    )
      throw new HttpError(404, "分享链接不存在、已过期或已撤销");
    return { deck: dto(d), share: s };
  };
  function trash(id) {
    get(id);
    db.exec("BEGIN");
    try {
      db.prepare(
        "UPDATE decks SET deleted_at=?,updated_at=?,version=version+1 WHERE id=?",
      ).run(Date.now(), Date.now(), id);
      db.prepare(
        "UPDATE shares SET revoked_at=? WHERE deck_id=? AND revoked_at IS NULL",
      ).run(Date.now(), id);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  if (seedDir && !raw("areal")) {
    const m = JSON.parse(
      fs.readFileSync(path.join(seedDir, "metadata.json"), "utf8"),
    );
    create(
      {
        ...m,
        html: fs.readFileSync(path.join(seedDir, "content.html"), "utf8"),
        css: fs.readFileSync(path.join(seedDir, "styles.css"), "utf8"),
        notes: JSON.parse(
          fs.readFileSync(path.join(seedDir, "notes.json"), "utf8"),
        ),
      },
      "areal",
    );
    fs.cpSync(
      path.join(seedDir, "assets"),
      path.join(deckDir("areal"), "assets"),
      { recursive: true },
    );
  }
  for (const entry of templates.filter((t) => t.id !== "blank")) {
    const id = "builtin_" + entry.id;
    if (raw(id)) continue;
    create(
      {
        title: entry.name,
        kind: "template",
        ...templateContent(entry.id, entry.name),
      },
      id,
    );
    db.prepare("UPDATE decks SET builtin=1 WHERE id=?").run(id);
  }
  function clone(id, input = {}) {
    const original = get(id);
    const d = create({
      ...content(id),
      width: original.width,
      height: original.height,
      favicon: original.favicon,
      author: original.author,
      title: input.title || original.title,
      description: input.description ?? original.description,
      slug: input.slug,
      kind: input.kind || "deck",
    });
    try {
      const source = path.join(deckDir(id), "assets");
      if (fs.existsSync(source))
        fs.cpSync(source, path.join(deckDir(d.id), "assets"), {
          recursive: true,
        });
      return d;
    } catch (error) {
      db.prepare("DELETE FROM decks WHERE id=?").run(d.id);
      fs.rmSync(deckDir(d.id), { recursive: true, force: true });
      throw error;
    }
  }
  function importPackage(input) {
    const d = create(input);
    try {
      requireValue(
        input.assets === undefined || Array.isArray(input.assets),
        "素材列表格式不正确",
      );
      const files = input.assets || [];
      requireValue(files.length <= 1000, "素材数量超过 1000 个，请拆分后导入");
      for (let i = 0; i < files.length; i += 100)
        upload(d.id, files.slice(i, i + 100));
      return d;
    } catch (error) {
      db.prepare("DELETE FROM decks WHERE id=?").run(d.id);
      fs.rmSync(deckDir(d.id), { recursive: true, force: true });
      throw error;
    }
  }
  return {
    db,
    get,
    bySlug: (slug) => {
      const r = db.prepare("SELECT id FROM decks WHERE slug=?").get(slug);
      if (!r) throw new HttpError(404, "演示稿不存在");
      return get(r.id);
    },
    updateShare: (id, sid, input) => {
      get(id);
      const row = db
        .prepare("SELECT * FROM shares WHERE id=? AND deck_id=?")
        .get(sid, id);
      if (!row) throw new HttpError(404, "分享链接不存在");
      db.prepare(
        "UPDATE shares SET slug=?,allow_notes=?,allow_download=? WHERE id=? AND deck_id=?",
      ).run(
        slugValue(input.slug ?? row.slug),
        input.allowNotes === undefined
          ? row.allow_notes
          : input.allowNotes === true
            ? 1
            : 0,
        input.allowDownload === undefined
          ? row.allow_download
          : input.allowDownload === true
            ? 1
            : 0,
        sid,
        id,
      );
      return shares(id).find((s) => s.id === sid);
    },
    content,
    create,
    clone,
    importPackage,
    save,
    revisions,
    revisionContent,
    restoreRevision,
    upload,
    assets,
    file,
    share,
    shares,
    publicAccess,
    recordShareView: (shareId) =>
      db
        .prepare(
          "UPDATE shares SET view_count=view_count+1,last_view_at=? WHERE id=?",
        )
        .run(Date.now(), shareId),
    recordShareDownload: (shareId) =>
      db
        .prepare("UPDATE shares SET download_count=download_count+1 WHERE id=?")
        .run(shareId),
    trash,
    list: () =>
      db.prepare("SELECT * FROM decks ORDER BY updated_at DESC").all().map(dto),
    restore: (id) => {
      const d = get(id, true);
      if (!d.deletedAt) throw new HttpError(409, "此演示稿不在回收站");
      db.prepare(
        "UPDATE decks SET deleted_at=NULL,visibility='private',updated_at=?,version=version+1 WHERE id=?",
      ).run(Date.now(), id);
      return get(id);
    },
    revoke: (id, sid) => {
      get(id);
      db.prepare("UPDATE shares SET revoked_at=? WHERE id=? AND deck_id=?").run(
        Date.now(),
        sid,
        id,
      );
    },
    close: () => db.close(),
  };
}
