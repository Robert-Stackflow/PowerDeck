import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { HttpError, requireValue } from "./content.mjs";
import { exportPackage } from "./package.mjs";
import { renderExport, exportTypes } from "./render-export.mjs";
import { exportStandalone } from "./standalone-export.mjs";

const formatList = ["zip", "pdf", "pptx", "html"],
  formats = new Set(formatList),
  types = {
    zip: "application/zip",
    html: "text/html; charset=utf-8",
    ...exportTypes,
  },
  defaultRetention = 60 * 60 * 1000;

const ordered = (value) => {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, ordered(item)]),
  );
};
const safeTitle = (value) => value.replace(/[\x00-\x1f\x7f/\\<>:"|?*]/g, "_");

export function createExportJobs(
  store,
  {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "powerdeck-export-")),
    retention = () => defaultRetention,
  } = {},
) {
  directory = path.resolve(directory);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  store.db.exec(`CREATE TABLE IF NOT EXISTS export_cache(
    id TEXT PRIMARY KEY,
    deck_id TEXT NOT NULL,
    deck_title TEXT NOT NULL,
    version INTEGER NOT NULL,
    format TEXT NOT NULL,
    scope TEXT NOT NULL,
    export_options TEXT NOT NULL,
    file_name TEXT NOT NULL,
    download_name TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    ready_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS export_cache_deck_version
    ON export_cache(deck_id,version);
  CREATE INDEX IF NOT EXISTS export_cache_expires
    ON export_cache(expires_at);`);
  const cacheColumns = store.db
    .prepare("PRAGMA table_info(export_cache)")
    .all();
  if (!cacheColumns.some((column) => column.name === "download_count"))
    store.db.exec(
      "ALTER TABLE export_cache ADD COLUMN download_count INTEGER NOT NULL DEFAULT 0",
    );

  const jobs = new Map(),
    queue = [];
  let running = false,
    closed = false,
    drainPromise = Promise.resolve();

  const retentionMs = () => {
      const value = Number(retention());
      return Number.isFinite(value) && value > 0 ? value : defaultRetention;
    },
    contextFor = (deckId, value = {}) => ({
      scope: value.scope || `deck:${deckId}`,
      downloadBase:
        value.downloadBase ||
        `/api/decks/${encodeURIComponent(deckId)}/exports`,
      exportOptions: ordered({
        ...(value.exportOptions || {}),
        allowNotes: value.exportOptions?.allowNotes !== false,
      }),
    }),
    identity = (deckId, version, format, context) =>
      crypto
        .createHash("sha256")
        .update(
          JSON.stringify([
            "powerdeck-export-v2",
            deckId,
            version,
            format,
            context.exportOptions,
          ]),
        )
        .digest("base64url")
        .slice(0, 30),
    fileFor = (id, format) => path.join(directory, `${id}.${format}`),
    publicJob = (job, context = job) => ({
      id: job.id,
      format: job.format,
      status: job.status,
      error: job.error || null,
      version: job.version,
      createdAt: job.createdAt,
      readyAt: job.readyAt || null,
      retentionMinutes: job.readyAt
        ? Math.max(1, Math.round((job.expiresAt - job.readyAt) / 60000))
        : Math.round(retentionMs() / 60000),
      expiresAt: job.expiresAt || null,
      ...(job.status === "ready"
        ? { downloadURL: `${context.downloadBase}/${job.id}/download` }
        : {}),
    }),
    rowJob = (row, context) => ({
      id: row.id,
      deckId: row.deck_id,
      deckTitle: row.deck_title,
      version: row.version,
      format: row.format,
      scope: row.scope,
      exportOptions: JSON.parse(row.export_options),
      downloadBase: context.downloadBase,
      status: "ready",
      createdAt: row.created_at,
      readyAt: row.ready_at,
      expiresAt: row.expires_at,
      file: path.join(directory, row.file_name),
      name: row.download_name,
      type: types[row.format],
      size: row.size,
      downloadCount: row.download_count || 0,
    }),
    removeRow = (row) => {
      if (!row) return;
      fs.rmSync(path.join(directory, row.file_name), { force: true });
      store.db.prepare("DELETE FROM export_cache WHERE id=?").run(row.id);
      jobs.delete(row.id);
    },
    prune = () => {
      const expired = store.db
        .prepare("SELECT * FROM export_cache WHERE expires_at<=?")
        .all(Date.now());
      for (const row of expired) removeRow(row);
      for (const row of store.db.prepare("SELECT * FROM export_cache").all())
        if (!fs.existsSync(path.join(directory, row.file_name)))
          store.db.prepare("DELETE FROM export_cache WHERE id=?").run(row.id);
      const activeParts = new Set(
        [...jobs.values()].map((job) => job.temporary).filter(Boolean),
      );
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (
          entry.isFile() &&
          entry.name.includes(".part-") &&
          !activeParts.has(file)
        )
          fs.rmSync(file, { force: true });
      }
    },
    cachedJob = (deck, format, context) => {
      const id = identity(deck.id, deck.version, format, context),
        active = jobs.get(id);
      if (active) return active;
      const row = store.db
        .prepare("SELECT * FROM export_cache WHERE id=? AND expires_at>?")
        .get(id, Date.now());
      if (!row) return null;
      const job = rowJob(row, context);
      if (!fs.existsSync(job.file)) {
        removeRow(row);
        return null;
      }
      jobs.set(id, job);
      return job;
    },
    persist = (job) => {
      const stat = fs.statSync(job.file);
      job.size = stat.size;
      job.expiresAt = job.readyAt + retentionMs();
      store.db
        .prepare(
          `INSERT INTO export_cache(
            id,deck_id,deck_title,version,format,scope,export_options,
            file_name,download_name,size,created_at,ready_at,expires_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
            deck_title=excluded.deck_title,file_name=excluded.file_name,
            download_name=excluded.download_name,size=excluded.size,
            created_at=excluded.created_at,ready_at=excluded.ready_at,
            expires_at=excluded.expires_at`,
        )
        .run(
          job.id,
          job.deckId,
          job.deckTitle,
          job.version,
          job.format,
          job.scope,
          JSON.stringify(job.exportOptions),
          path.basename(job.file),
          job.name,
          job.size,
          job.createdAt,
          job.readyAt,
          job.expiresAt,
        );
    },
    generate = async (job) => {
      job.temporary = `${job.file}.part-${crypto.randomBytes(6).toString("hex")}`;
      if (job.format === "zip")
        await pipeline(
          exportPackage(store, job.deckId, job.exportOptions),
          fs.createWriteStream(job.temporary),
        );
      else {
        const bytes =
          job.format === "html"
            ? exportStandalone(store, job.deckId, job.exportOptions)
            : await renderExport(
                store,
                job.deckId,
                job.format,
                job.exportOptions,
              );
        await fs.promises.writeFile(job.temporary, bytes);
      }
      await fs.promises.rename(job.temporary, job.file);
      job.temporary = null;
    },
    drain = async () => {
      if (running || closed) return;
      running = true;
      try {
        for (let job; (job = queue.shift());) {
          job.status = "running";
          try {
            await generate(job);
            if (job.cancelRequested) {
              job.status = "canceled";
              fs.rmSync(job.file, { force: true });
              jobs.delete(job.id);
              continue;
            }
            job.status = "ready";
            job.readyAt = Date.now();
            persist(job);
          } catch (error) {
            job.status = "error";
            job.error = error.message || "导出失败，请重试";
            job.readyAt = Date.now();
            fs.rmSync(job.file, { force: true });
            if (job.temporary) fs.rmSync(job.temporary, { force: true });
          }
        }
      } finally {
        running = false;
        prune();
      }
    },
    findJob = (deckId, id, value = {}) => {
      prune();
      const context = contextFor(deckId, value),
        deck = store.get(deckId),
        format = formatList.find(
          (candidate) =>
            identity(deckId, deck.version, candidate, context) === id,
        ),
        job = format ? jobs.get(id) || cachedJob(deck, format, context) : null;
      if (!job || job.deckId !== deckId || job.version !== deck.version)
        throw new HttpError(404, "导出任务不存在或已经过期");
      return job;
    };

  prune();
  const pruneTimer = setInterval(prune, 60 * 1000);
  pruneTimer.unref?.();

  return {
    create(deckId, format, value = {}) {
      requireValue(formats.has(format), "导出格式不正确");
      const deck = store.get(deckId),
        context = contextFor(deckId, value);
      prune();
      const existing = cachedJob(deck, format, context);
      if (existing && existing.status !== "error")
        return publicJob(existing, context);
      if (existing) jobs.delete(existing.id);
      if (queue.length + (running ? 1 : 0) >= 50)
        throw new HttpError(429, "后台导出任务较多，请稍后再试");
      const id = identity(deckId, deck.version, format, context),
        job = {
          id,
          deckId,
          deckTitle: deck.title,
          version: deck.version,
          ...context,
          format,
          status: "queued",
          createdAt: Date.now(),
          file: fileFor(id, format),
          name: `${safeTitle(deck.title)}.${format}`,
          type: types[format],
        };
      jobs.set(id, job);
      queue.push(job);
      setImmediate(() => {
        drainPromise = drainPromise.then(drain, drain);
      });
      return publicJob(job, context);
    },
    list(deckId, value = {}) {
      const deck = store.get(deckId),
        context = contextFor(deckId, value);
      prune();
      return {
        version: deck.version,
        retentionMinutes: Math.round(retentionMs() / 60000),
        jobs: formatList
          .map((format) => cachedJob(deck, format, context))
          .filter(Boolean)
          .map((job) => publicJob(job, context)),
      };
    },
    get(deckId, id, value = {}) {
      const context = contextFor(deckId, value);
      return publicJob(findJob(deckId, id, context), context);
    },
    download(deckId, id, value = {}) {
      const job = findJob(deckId, id, value);
      if (job.status !== "ready")
        throw new HttpError(409, "文件仍在生成，请稍后再试");
      store.db
        .prepare(
          "UPDATE export_cache SET download_count=download_count+1 WHERE id=?",
        )
        .run(job.id);
      job.downloadCount = (job.downloadCount || 0) + 1;
      return job;
    },
    downloadCache(id) {
      prune();
      const row = store.db
        .prepare("SELECT * FROM export_cache WHERE id=? AND expires_at>?")
        .get(id, Date.now());
      if (!row) throw new HttpError(404, "缓存文件不存在或已经过期");
      const job = rowJob(row, { downloadBase: "/api/export-cache" });
      if (!fs.existsSync(job.file)) {
        removeRow(row);
        throw new HttpError(404, "缓存文件不存在或已经过期");
      }
      store.db
        .prepare(
          "UPDATE export_cache SET download_count=download_count+1 WHERE id=?",
        )
        .run(id);
      job.downloadCount += 1;
      return job;
    },
    cache({ deckId = "", version = "" } = {}) {
      prune();
      const clauses = [],
        values = [];
      if (deckId) {
        clauses.push("deck_id=?");
        values.push(deckId);
      }
      if (version !== "" && version !== undefined) {
        const parsed = Number(version);
        requireValue(Number.isInteger(parsed) && parsed > 0, "版本号不正确");
        clauses.push("version=?");
        values.push(parsed);
      }
      const rows = store.db
        .prepare(
          `SELECT * FROM export_cache${clauses.length ? ` WHERE ${clauses.join(" AND ")}` : ""} ORDER BY ready_at DESC`,
        )
        .all(...values);
      const active = [...jobs.values()].filter(
          (job) =>
            ["queued", "running"].includes(job.status) &&
            !job.cancelRequested &&
            (!deckId || job.deckId === deckId) &&
            (version === "" ||
              version === undefined ||
              job.version === Number(version)),
        ),
        readyFiles = rows.map((row) => ({
          id: row.id,
          deckId: row.deck_id,
          deckTitle: row.deck_title,
          version: row.version,
          format: row.format,
          status: "ready",
          size: row.size,
          downloadCount: row.download_count || 0,
          createdAt: row.created_at,
          readyAt: row.ready_at,
          expiresAt: row.expires_at,
        })),
        activeFiles = active.map((job) => ({
          id: job.id,
          deckId: job.deckId,
          deckTitle: job.deckTitle,
          version: job.version,
          format: job.format,
          status: job.status,
          size: 0,
          downloadCount: 0,
          createdAt: job.createdAt,
          readyAt: null,
          expiresAt: null,
        })),
        decks = store
          .list()
          .filter((deck) => deck.kind === "deck" && !deck.deletedAt)
          .map((deck) => ({
            id: deck.id,
            title: deck.title,
            latestVersion: deck.version,
            versions: [
              ...new Set([
                deck.version,
                ...store.revisions(deck.id).map((item) => item.version),
              ]),
            ].sort((a, b) => b - a),
          }));
      return {
        retentionMinutes: Math.round(retentionMs() / 60000),
        totalSize: rows.reduce((sum, row) => sum + row.size, 0),
        cachedCount: readyFiles.length,
        activeCount: activeFiles.length,
        decks,
        files: [...activeFiles, ...readyFiles].sort(
          (a, b) => b.createdAt - a.createdAt,
        ),
      };
    },
    clearCache({ deckId = "", version = "" } = {}) {
      const result = this.cache({ deckId, version });
      const readyFiles = result.files.filter((file) => file.status === "ready");
      for (const file of readyFiles) {
        const row = store.db
          .prepare("SELECT * FROM export_cache WHERE id=?")
          .get(file.id);
        removeRow(row);
      }
      return { removed: readyFiles.length, freedBytes: result.totalSize };
    },
    deleteCache(id) {
      const active = jobs.get(id);
      if (active && ["queued", "running"].includes(active.status)) {
        active.cancelRequested = true;
        if (active.status === "queued") {
          const index = queue.indexOf(active);
          if (index >= 0) queue.splice(index, 1);
          active.status = "canceled";
          jobs.delete(id);
        }
        return { removed: 0, canceled: true };
      }
      const row = store.db
        .prepare("SELECT * FROM export_cache WHERE id=?")
        .get(id);
      if (!row) throw new HttpError(404, "缓存文件不存在或已经过期");
      removeRow(row);
      return { removed: 1, canceled: false };
    },
    async close() {
      closed = true;
      clearInterval(pruneTimer);
      queue.length = 0;
      await drainPromise.catch(() => {});
      jobs.clear();
    },
  };
}
