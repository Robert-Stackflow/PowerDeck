import fs from "node:fs";
import path from "node:path";
import { projectRoot } from "../server/app.mjs";
import { createStore } from "../server/store.mjs";
await import("./build.mjs");
const source = path.join(projectRoot, "work/build/presentations/areal");
const metadata = JSON.parse(
  fs.readFileSync(path.join(source, "metadata.json"), "utf8"),
);
const store = createStore(path.join(projectRoot, "data"), source);
try {
  const current = store.get("areal");
  store.save("areal", {
    ...metadata,
    version: current.version,
    html: fs.readFileSync(path.join(source, "content.html"), "utf8"),
    css: fs.readFileSync(path.join(source, "styles.css"), "utf8"),
    notes: JSON.parse(fs.readFileSync(path.join(source, "notes.json"), "utf8")),
  });
  fs.cpSync(
    path.join(source, "assets"),
    path.join(projectRoot, "data/decks/areal/assets"),
    { recursive: true },
  );
  console.log("已同步 AReaL 内容，保留当前权限设置。");
} finally {
  store.close();
}
