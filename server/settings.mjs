import { HttpError, requireValue } from "./content.mjs";

export function slugValue(value) {
  requireValue(typeof value === "string", "请填写 URL 名称");
  const slug = value.trim().toLowerCase();
  requireValue(
    /^[a-z0-9](?:[a-z0-9_-]{0,78}[a-z0-9])?$/.test(slug),
    "URL 名称使用 1–80 位字母、数字、短横线或下划线，首尾为字母或数字",
  );
  return slug;
}

export function faviconValue(value) {
  if (value === null || value === "") return null;
  requireValue(
    typeof value === "string" &&
      /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value) &&
      value.length < 350000,
    "请上传小于 256 KB 的 PNG 图标",
  );
  const b = Buffer.from(value.split(",")[1], "base64");
  requireValue(
    b.length > 24 &&
      b.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) &&
      b.toString("ascii", 12, 16) === "IHDR" &&
      b.readUInt32BE(16) > 0 &&
      b.readUInt32BE(16) <= 512 &&
      b.readUInt32BE(20) > 0 &&
      b.readUInt32BE(20) <= 512,
    "图标需为不超过 512 × 512 的 PNG 图片",
  );
  return value;
}

export function createSettings(db) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  );
  const read = () => {
    const row = db.prepare("SELECT value FROM settings WHERE key='site'").get();
    return {
      theme: "system",
      toastPosition: "bottom-center",
      ...(row ? JSON.parse(row.value) : { name: "演示库", favicon: null }),
    };
  };
  return {
    read,
    save(input) {
      const current = read();
      requireValue(
        typeof input.name === "string" &&
          input.name.trim().length > 0 &&
          input.name.trim().length <= 40,
        "网站名称需为 1–40 个字符",
      );
      const theme = input.theme ?? current.theme;
      requireValue(
        ["light", "dark", "system"].includes(theme),
        "主题设置不正确",
      );
      const toastPosition = input.toastPosition ?? current.toastPosition;
      requireValue(
        [
          "top-left",
          "top-center",
          "top-right",
          "bottom-left",
          "bottom-center",
          "bottom-right",
        ].includes(toastPosition),
        "提示位置不正确",
      );
      const value = {
        theme,
        toastPosition,
        name: input.name.trim(),
        favicon:
          input.favicon === undefined
            ? current.favicon
            : faviconValue(input.favicon),
      };
      db.prepare(
        "INSERT INTO settings VALUES('site',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).run(JSON.stringify(value));
      return value;
    },
  };
}

export function migrateIdentity(db) {
  for (const [table, column, definition] of [
    ["decks", "slug", "TEXT"],
    ["decks", "favicon", "TEXT"],
    ["shares", "slug", "TEXT"],
  ]) {
    if (
      !db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .some((x) => x.name === column)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  db.exec(
    "UPDATE decks SET slug=id WHERE slug IS NULL; CREATE UNIQUE INDEX IF NOT EXISTS deck_slug_unique ON decks(slug); UPDATE shares SET slug=(SELECT slug FROM decks WHERE decks.id=shares.deck_id) WHERE slug IS NULL",
  );
}

export function ensureSlugAvailable(db, slug, id) {
  if (db.prepare("SELECT id FROM decks WHERE slug=? AND id<>?").get(slug, id))
    throw new HttpError(409, "这个 URL 名称已被其他演示稿使用");
}
