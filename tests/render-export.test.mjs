import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";
import { readZip } from "../server/archive.mjs";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "render-export-"));
const app = await createApp({ dataDir: dir, seed: false });
const base = await app.listen({ port: 0 });
try {
  const login = await fetch(base + "/api/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "export-test-82918" }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const deck = app.store.create({ title: "导出验证", width: 960, height: 540 });
  app.store.upload(deck.id, [
    {
      name: "image.png",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfN0AAAAASUVORK5CYII=",
    },
  ]);
  app.store.save(deck.id, {
    version: app.store.get(deck.id).version,
    html: '<section class="slide"><h1>PDF and PPTX</h1><img src="assets/image.png" width="64" height="64"></section><section class="slide"><h1>Second page</h1></section>',
    css: ".slide{background:#eaf1ed;padding:40px;color:#173629}h1{font-size:60px}",
    notes: {
      1: { title: "封面", notes: "speaker notes" },
      2: { title: "内容", notes: "second notes" },
    },
  });
  await test("PDF and PPTX exports require admin access and validate format", async () => {
    assert.equal(
      (await fetch(`${base}/api/decks/${deck.id}/export?format=pdf`)).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${base}/api/decks/${deck.id}/export?format=exe`, {
          headers: { Cookie: cookie },
        })
      ).status,
      400,
    );
  });
  await test("PDF contains exactly one page per slide; PPTX contains slide images and notes", async () => {
    const pdf = await fetch(`${base}/api/decks/${deck.id}/export?format=pdf`, {
      headers: { Cookie: cookie },
    });
    assert.equal(
      pdf.status,
      200,
      await (pdf.status === 200 ? Promise.resolve("") : pdf.text()),
    );
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert.equal(bytes.toString("ascii", 0, 5), "%PDF-");
    assert.equal(
      [...bytes.toString("latin1").matchAll(/\/Type \/Page\b/g)].length,
      2,
    );
    const ppt = await fetch(`${base}/api/decks/${deck.id}/export?format=pptx`, {
      headers: { Cookie: cookie },
    });
    assert.equal(ppt.status, 200);
    assert.match(ppt.headers.get("content-disposition"), /\.pptx/);
    const files = await readZip(Buffer.from(await ppt.arrayBuffer()));
    assert.equal(
      [...files.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
        .length,
      2,
    );
    assert.match(
      files.get("ppt/notesSlides/notesSlide1.xml").toString(),
      /speaker notes/,
    );
    assert.equal(
      [...files.keys()].filter((k) => /^ppt\/media\/.+\.png$/.test(k)).length,
      2,
    );
  });
  await test("rendering refuses external assets without making network requests", async () => {
    app.store.save(deck.id, {
      version: app.store.get(deck.id).version,
      html: '<section class="slide"><img src="http://127.0.0.1:1/private"></section>',
      css: "",
      notes: {},
    });
    const response = await fetch(
      `${base}/api/decks/${deck.id}/export?format=pdf`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(response.status, 422);
  });
} finally {
  await app.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
