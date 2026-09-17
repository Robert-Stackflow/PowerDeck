import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createStore } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";
import { convertPptx } from "../server/import/pptx.mjs";
import { xmlReader } from "../server/import/archive.mjs";
import { importPowerPoint } from "../server/import/powerpoint.mjs";
import { parseFragment } from "parse5";
const fixture = fs.readFileSync(
  new URL("./fixtures/import.pptx", import.meta.url),
);

test("PowerPoint conversion retains editable text, inherited geometry/theme, notes, assets and links", async () => {
  const result = await convertPptx(fixture);
  assert.equal(result.width, 1600);
  assert.equal(result.height, 900);
  assert.equal(result.sourceSlides, 1);
  assert.equal(result.notes[1].title, "Imported title");
  assert.equal(result.notes[1].notes, "Presenter note");
  assert.match(result.html, /Imported title/);
  assert.match(result.html, /Master logo/);
  assert.doesNotMatch(result.html, /Layout placeholder/);
  assert.match(
    result.html,
    /left:133.33px;top:66.67px;width:1066.67px;height:160px/,
  );
  assert.match(result.html, /background:rgba\(18,52,86,1\)/);
  assert.match(result.html, /font-size:60.96px/);
  const parsed = parseFragment(result.html);
  const spans = [];
  const visit = (n) => {
    if (n.tagName === "span") spans.push(n);
    for (const child of n.childNodes || []) visit(child);
  };
  visit(parsed);
  const titleSpan = spans.find((n) =>
    n.childNodes.some((c) => c.value === "Imported title"),
  );
  const style = titleSpan.attrs.find((a) => a.name === "style").value;
  assert.match(
    style,
    /color:rgba\(244,180,67,1\)/,
    "Run styles survive HTML parsing",
  );
  assert.match(
    titleSpan.parentNode.attrs.find((a) => a.name === "style").value,
    /color:rgba\(244,180,67,1\)/,
    "Paragraph retains representative run style when editing removes spans",
  );
  assert.equal(
    titleSpan.attrs.length,
    1,
    "Quoted font families must not break the style attribute",
  );
  assert.match(result.html, /data-editor-href="https:\/\/example.com"/);
  assert.match(result.html, /<img src="assets\/powerpoint\/image-1.png"/);
  assert.equal(result.assets.length, 1);
  assert.deepEqual(result.warnings, []);
  const master = await convertPptx(fixture, { mode: "masters" });
  assert.equal(master.layouts, 1);
  assert.equal(master.notes[1].title, "Title and image");
  assert.match(master.html, /页面标题/);
  assert.match(master.html, /Master logo/);
  assert.doesNotMatch(master.html, /Imported title|Safe link/);
});

test("invalid, non-PowerPoint and external-entity uploads fail without executing content", async () => {
  await assert.rejects(() => convertPptx(Buffer.from("not zip")), /无法读取/);
  await assert.rejects(
    () =>
      importPowerPoint({
        name: "x.pptx",
        base64: fixture.toString("base64"),
        mode: "invalid",
      }),
    /请选择/,
  );
  await assert.rejects(
    () =>
      importPowerPoint({
        name: "x.pptx",
        base64: "bm90IHBvd2VycG9pbnQ=",
        mode: "slides",
      }),
    /无法识别/,
  );
  const read = xmlReader(
    new Map([
      [
        "ppt/presentation.xml",
        Buffer.from(
          '<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///etc/passwd">]><x>&secret;</x>',
        ),
      ],
    ]),
  );
  assert.throws(() => read("ppt/presentation.xml"), /外部实体/);
  const worker = await importPowerPoint({
    name: "x.pptx",
    base64: fixture.toString("base64"),
    mode: "slides",
  });
  assert.equal(worker.sourceSlides, 1);
});

test("templates persist edits, copy assets independently, retain type through recycle and reject sharing", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "template-store-"));
  let store;
  try {
    store = createStore(dir, false);
    const builtins = store.list().filter((d) => d.kind === "template");
    assert.equal(builtins.length, 3);
    assert(builtins.every((d) => d.builtin));
    const chosen = builtins[0];
    store.save(chosen.id, {
      ...store.content(chosen.id),
      title: "Custom built-in",
      version: chosen.version,
    });
    const imported = store.importPackage({
      ...(await convertPptx(fixture)),
      kind: "template",
      title: "Master",
    });
    const deck = store.clone(imported.id, { title: "Independent deck" });
    assert.equal(deck.kind, "deck");
    assert.equal(deck.builtin, false);
    assert.equal(deck.visibility, "private");
    const originalFile = store.file(
      imported.id,
      "assets/powerpoint/image-1.png",
    );
    const copiedFile = store.file(deck.id, "assets/powerpoint/image-1.png");
    assert.notEqual(originalFile, copiedFile);
    assert.deepEqual(
      fs.readFileSync(originalFile),
      fs.readFileSync(copiedFile),
    );
    store.save(imported.id, {
      ...store.content(imported.id),
      html: '<section class="slide"><h1>Changed</h1></section>',
      version: imported.version,
    });
    assert.match(store.content(deck.id).html, /Imported title/);
    const updated = store.get(imported.id);
    assert.throws(
      () =>
        store.save(imported.id, {
          visibility: "shared",
          version: updated.version,
        }),
      /模板/,
    );
    assert.throws(() => store.share(imported.id, {}), /模板/);
    store.trash(imported.id);
    store.restore(imported.id);
    assert.equal(store.get(imported.id).kind, "template");
    const count = store.list().length;
    assert.throws(
      () =>
        store.importPackage({
          title: "Bad asset",
          assets: [{ name: "a.png", path: "../a.png", base64: "eA==" }],
        }),
      /素材/,
    );
    assert.equal(store.list().length, count);
    store.db.close();
    store = createStore(dir, false);
    assert.equal(store.get(chosen.id).title, "Custom built-in");
    assert.equal(store.list().filter((d) => d.builtin).length, 3);
  } finally {
    store?.db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PowerPoint import and template creation APIs require authorization and produce independent private decks", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "template-api-"));
  const app = await createApp({ dataDir: dir, seedDir: false });
  const base = await app.listen({ port: 0 });
  let auth = {};
  const req = async (route, body, headers = auth) => {
    const response = await fetch(base + "/api" + route, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      data: await response.json(),
      headers: response.headers,
    };
  };
  try {
    const input = {
      name: "reference.pptx",
      title: "Import",
      base64: fixture.toString("base64"),
      mode: "masters",
    };
    assert.equal((await req("/import/powerpoint", input)).status, 401);
    const setup = await req("/setup", {
      username: "admin",
      password: "fixture-password-strong-9342",
    });
    auth = {
      Cookie: setup.headers.get("set-cookie").split(";")[0],
      "X-CSRF-Token": setup.data.csrf,
    };
    assert.equal(
      (
        await req("/import/powerpoint", input, {
          ...auth,
          "X-CSRF-Token": "bad",
        })
      ).status,
      403,
    );
    const result = await req("/import/powerpoint", input);
    assert.equal(result.status, 201);
    assert.equal(result.data.deck.kind, "template");
    const template = result.data.deck;
    const deck = await req("/decks", {
      templateId: template.id,
      title: "Copy",
      slug: "template-copy",
    });
    assert.equal(deck.status, 201);
    assert.equal(deck.data.kind, "deck");
    assert.equal(deck.data.visibility, "private");
    assert.notEqual(deck.data.id, template.id);
    assert.equal(
      (await req("/decks", { templateId: deck.data.id, title: "Wrong" }))
        .status,
      400,
    );
    const slides = await req("/import/powerpoint", {
      ...input,
      mode: "slides",
    });
    assert.equal(slides.status, 201);
    assert.equal(slides.data.deck.slideCount, 1);
    assert.equal(slides.data.deck.kind, "deck");
  } finally {
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
