import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import yazl from "yazl";
import { parseFragment } from "parse5";
import { createStore } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
import { exportPackage, importPackageArchive } from "../server/package.mjs";
import { readZip } from "../server/archive.mjs";
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfN0AAAAASUVORK5CYII=",
  "base64",
);
const collect = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
};
const markup = (html) => {
  const visit = (n) => ({
    tag: n.tagName,
    value: n.value,
    attrs: (n.attrs || []).slice().sort((a, b) => a.name.localeCompare(b.name)),
    children: (n.childNodes || []).map(visit),
  });
  return visit(parseFragment(html));
};
const zipBytes = async (files, modes = {}) => {
  const zip = new yazl.ZipFile();
  for (const [name, bytes] of Object.entries(files))
    zip.addBuffer(Buffer.from(bytes), name, { mode: modes[name] || 0o100644 });
  zip.end();
  return collect(zip.outputStream);
};
const packageFiles = {
  "metadata.json": JSON.stringify({
    format: "deck-library/zip-v1",
    title: "测试模板",
    description: "简介",
    author: "作者",
    kind: "template",
    width: 1280,
    height: 720,
    favicon: "favicon.png",
  }),
  "content.html":
    '<section class="slide"><h1>Title</h1><img src="assets/图片/a.png"></section>',
  "styles.css": ".slide{color:#123456}",
  "notes.json": JSON.stringify({
    1: {
      title: "页面名称",
      notes: "备注内容",
      refs: [["Source", "https://example.com"]],
      figures: [{ src: "assets/图片/a.png", title: "附图" }],
    },
  }),
  "favicon.png": image,
  "assets/图片/a.png": image,
  "assets/fonts/test.woff2": Buffer.from("font-binary"),
};

test("ZIP exports use separate content/metadata/notes and binary assets; templates reimport independently", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-package-"));
  const store = createStore(dir, false);
  try {
    const input = await importPackageArchive(await zipBytes(packageFiles));
    const original = store.importPackage(input),
      bytes = await collect(exportPackage(store, original.id));
    const files = await readZip(bytes);
    assert.deepEqual(
      [...files.keys()].sort(),
      Object.keys(packageFiles).sort(),
    );
    assert.deepEqual(files.get("assets/图片/a.png"), image);
    assert.deepEqual(files.get("favicon.png"), image);
    assert.deepEqual(
      files.get("assets/fonts/test.woff2"),
      Buffer.from("font-binary"),
    );
    const meta = JSON.parse(files.get("metadata.json"));
    assert.equal(meta.format, "deck-library/zip-v1");
    assert.equal(meta.kind, "template");
    assert.equal(meta.favicon, "favicon.png");
    for (const excluded of [
      "html",
      "css",
      "notes",
      "assets",
      "id",
      "visibility",
      "token",
      "activeShares",
    ])
      assert.equal(meta[excluded], undefined);
    assert(!files.get("metadata.json").includes("base64"));
    const pack = await importPackageArchive(bytes),
      copy = store.importPackage(pack);
    assert.notEqual(copy.id, original.id);
    assert.notEqual(copy.slug, original.slug);
    assert.equal(copy.visibility, "private");
    assert.equal(copy.kind, "template");
    assert.equal(copy.author, "作者");
    assert.equal(copy.width, 1280);
    assert.equal(copy.favicon, original.favicon);
    assert.deepEqual(
      store.content(copy.id).notes,
      store.content(original.id).notes,
    );
    assert.equal(
      store.content(copy.id).css.trim(),
      store.content(original.id).css.trim(),
    );
    assert.deepEqual(
      markup(store.content(copy.id).html),
      markup(store.content(original.id).html),
    );
    assert.deepEqual(
      fs.readFileSync(store.file(copy.id, "assets/图片/a.png")),
      image,
    );
  } finally {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("ZIP validation rejects missing files, unknown versions, traversal, duplicates, symlinks and decompression limits", async () => {
  await assert.rejects(
    () => importPackageArchive(Buffer.from("json, not zip")),
    /无法读取/,
  );
  const missing = { ...packageFiles };
  delete missing["content.html"];
  await assert.rejects(
    () => zipBytes(missing).then(importPackageArchive),
    /缺少 content.html/,
  );
  await assert.rejects(
    () =>
      zipBytes({
        ...packageFiles,
        "metadata.json": '{"format":"future"}',
      }).then(importPackageArchive),
    /不支持此内容包版本/,
  );
  await assert.rejects(
    () =>
      zipBytes({ ...packageFiles, "notes.json": "{" }).then(
        importPackageArchive,
      ),
    /notes.json/,
  );
  await assert.rejects(
    () =>
      zipBytes({ ...packageFiles, "assets/evil.js": "alert(1)" }).then(
        importPackageArchive,
      ),
    /不支持的素材/,
  );
  const duplicate = await zipBytes({
    ...packageFiles,
    "assets/图片/A.png": image,
  });
  await assert.rejects(() => importPackageArchive(duplicate), /重复/);
  const symlink = await zipBytes(
    { "assets/link.png": "/etc/passwd" },
    { "assets/link.png": 0o120777 },
  );
  await assert.rejects(() => importPackageArchive(symlink), /路径/);
  const safe = await zipBytes({ "aaa/x.png": "x" }),
    bad = Buffer.from(safe);
  for (let pos = 0; (pos = bad.indexOf("aaa/x.png", pos)) !== -1; pos += 9)
    bad.write("../xx.png", pos, "utf8");
  await assert.rejects(() => importPackageArchive(bad), /路径/);
  await assert.rejects(
    () =>
      zipBytes({ "large.txt": Buffer.alloc(256) }).then((b) =>
        readZip(b, { maxEntry: 128 }),
      ),
    /解压后过大/,
  );
});

test("ZIP HTTP download and upload enforce auth/CSRF; old JSON import still works", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-api-"));
  const app = await createApp({ dataDir: dir, seed: false });
  const base = await app.listen({ port: 0 });
  let auth = {};
  const req = (route, body, headers = auth) =>
    fetch(base + "/api" + route, {
      method: body ? "POST" : "GET",
      headers: {
        ...(body
          ? {
              "Content-Type": Buffer.isBuffer(body)
                ? "application/zip"
                : "application/json",
            }
          : {}),
        ...headers,
      },
      ...(body
        ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }
        : {}),
    });
  try {
    const bytes = await zipBytes(packageFiles);
    assert.equal((await req("/import/package", bytes)).status, 401);
    assert.equal((await req("/decks/builtin_report/export")).status, 401);
    const setup = await req("/setup", {
        username: "admin",
        password: "zip-test-password-83263",
      }),
      session = await setup.json();
    auth = {
      Cookie: setup.headers.get("set-cookie").split(";")[0],
      "X-CSRF-Token": session.csrf,
    };
    assert.equal(
      (await req("/import/package", bytes, { ...auth, "X-CSRF-Token": "bad" }))
        .status,
      403,
    );
    const upload = await req("/import/package", bytes);
    assert.equal(upload.status, 201);
    const { deck } = await upload.json();
    assert.equal(deck.kind, "template");
    assert.equal(deck.visibility, "private");
    const response = await req("/decks/" + deck.id + "/export");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.match(
      response.headers.get("content-disposition"),
      /filename\*=UTF-8''/,
    );
    assert(
      response.headers
        .get("content-disposition")
        .includes(encodeURIComponent("测试模板") + ".zip"),
    );
    const exported = Buffer.from(await response.arrayBuffer());
    const copy = await req("/import/package?kind=deck&title=Copy", exported);
    assert.equal(copy.status, 201);
    const copyDeck = (await copy.json()).deck;
    assert.equal(copyDeck.kind, "deck");
    assert.equal(copyDeck.title, "Copy");
    assert.notEqual(copyDeck.slug, deck.slug);
    // Existing exported JSON packages remain accepted, including embedded base64 assets.
    const old = await req("/decks", {
      format: "deck-library/v1",
      title: "Legacy",
      html: packageFiles["content.html"],
      css: packageFiles["styles.css"],
      notes: JSON.parse(packageFiles["notes.json"]),
      assets: [
        {
          name: "a.png",
          path: "assets/图片/a.png",
          base64: image.toString("base64"),
        },
      ],
    });
    assert.equal(old.status, 201);
    const count = app.store.list().length;
    const broken = await req(
      "/import/package",
      await zipBytes({ ...packageFiles, "content.html": "not slides" }),
    );
    assert.equal(broken.status, 400);
    assert.equal(app.store.list().length, count);
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
