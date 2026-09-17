import test from "node:test";
import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp, projectRoot } from "../server/app.mjs";
const dir = path.join(projectRoot, "work/qa/platform-api");
fs.rmSync(dir, { recursive: true, force: true });
const app = await createApp({ dataDir: dir });
const base = await app.listen({ port: 0 });
let auth, deck, link;
async function request(
  route,
  { method = "GET", body, as = auth, headers = {} } = {},
) {
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(body
        ? {
            "Content-Type": Buffer.isBuffer(body)
              ? "application/zip"
              : "application/json",
          }
        : {}),
      ...(as ? { Cookie: as.cookie, "X-CSRF-Token": as.csrf } : {}),
      ...headers,
    },
    ...(body
      ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }
      : {}),
  });
  if (response.headers.get("content-type") === "application/zip")
    return {
      status: response.status,
      data: Buffer.from(await response.arrayBuffer()),
      headers: response.headers,
    };
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data, headers: response.headers };
}
const ok = async (route, options) => {
  const r = await request(route, options);
  assert(r.status < 300, JSON.stringify(r));
  return r.data;
};
const password = "private-test-password-9327";
const image =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfN0AAAAASUVORK5CYII=";
try {
  await test("first setup, authentication, origin checks and session cookies", async () => {
    assert.equal((await ok("/api/session")).setupRequired, true);
    assert.equal((await request("/api/decks", { as: null })).status, 401);
    assert.equal(
      (
        await request("/api/setup", {
          method: "POST",
          body: { username: "admin", password },
          headers: { Origin: "https://attacker.example" },
        })
      ).status,
      403,
    );
    const r = await request("/api/setup", {
      method: "POST",
      body: { username: "admin", password },
    });
    assert.equal(r.status, 200);
    assert(r.headers.get("set-cookie").includes("HttpOnly"));
    assert(r.headers.get("set-cookie").includes("SameSite=Strict"));
    auth = {
      cookie: r.headers.get("set-cookie").split(";")[0],
      csrf: r.data.csrf,
    };
    assert.equal(
      (
        await request("/api/setup", {
          method: "POST",
          body: { username: "other", password },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request("/api/login", {
          method: "POST",
          body: { username: "admin", password: "wrong" },
        })
      ).status,
      401,
    );
    const status = await new Promise((resolve, reject) => {
      const req = http.get(
        base + "/api/session",
        { headers: { Host: "evil.example" } },
        (r) => {
          r.resume();
          resolve(r.statusCode);
        },
      );
      req.on("error", reject);
    });
    assert.equal(status, 421);
  });
  await test("seed is private; content, notes, assets and package are all protected", async () => {
    const seeded = (await ok("/api/decks")).decks.filter(
      (d) => d.kind === "deck",
    );
    assert.equal(seeded.length, 1);
    assert.equal(seeded[0].slideCount, 27);
    assert.equal(seeded[0].visibility, "private");
    for (const url of [
      "/api/decks/areal",
      "/api/decks/areal/content",
      "/api/decks/areal/thumbnail",
      "/api/decks/areal/files/assets/brand/areal.png",
      "/api/decks/areal/export",
      "/api/decks/areal/assets",
    ])
      assert.equal((await request(url, { as: null })).status, 401, url);
    assert.equal(
      (
        await request("/work/build/presentations/areal/content.html", {
          as: null,
        })
      ).status,
      404,
    );
    assert.equal(
      (await request("/outputs/实习分享_后训练与AReaL.html", { as: null }))
        .status,
      404,
    );
    assert.equal(
      (await request("/api/decks/areal/files/assets/brand/areal.png")).status,
      200,
    );
    const c = await ok("/api/decks/areal/content");
    assert.equal((c.html.match(/class="slide custom/g) || []).length, 27);
    assert(!c.html.includes("<script"));
    assert(!c.html.includes('id="controls"'));
    assert(!c.html.includes("data:image"));
    assert(!c.css.includes("#controls"));
    assert(c.notes[7].title.includes("DPO"));
  });
  await test("content CRUD, sanitization, validation and optimistic concurrency", async () => {
    deck = await ok("/api/decks", {
      method: "POST",
      body: {
        title: "API 测试演示",
        html: '<section class="slide"><h1>One</h1><script>window.pwned=1</script><img src="assets/a.png" onerror="parent.pwned=1"><iframe src="/"></iframe></section>',
        css: ".slide{color:red}",
        notes: {
          1: {
            title: "One",
            notes: "SECRET NOTE",
            refs: [
              ["unsafe", "javascript:alert(1)"],
              ["Paper", "https://example.com"],
            ],
          },
        },
      },
    });
    assert.equal(deck.visibility, "private");
    const c = await ok("/api/decks/" + deck.id + "/content");
    assert(!c.html.includes("<script"));
    assert(!c.html.includes("onerror"));
    assert(!c.html.includes("<iframe"));
    assert.equal(c.notes[1].refs.length, 1);
    const oldVersion = deck.version;
    deck = await ok("/api/decks/" + deck.id, {
      method: "PATCH",
      body: { title: "Renamed", version: deck.version },
    });
    assert.equal(deck.version, oldVersion + 1);
    assert.equal(
      (
        await request("/api/decks/" + deck.id, {
          method: "PATCH",
          body: { title: "stale", version: oldVersion },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request("/api/decks/" + deck.id, {
          method: "PATCH",
          body: { title: "unauthorized", version: deck.version },
          headers: { "X-CSRF-Token": "wrong" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/api/decks/" + deck.id + "/content", {
          method: "PUT",
          body: { html: "<p>no slides</p>", version: deck.version },
        })
      ).status,
      400,
    );
    assert.equal((await ok("/api/decks/" + deck.id)).title, "Renamed");
  });
  await test("asset uploads reject traversal and duplicates, serve verified files", async () => {
    await ok("/api/decks/" + deck.id + "/assets", {
      method: "POST",
      body: { files: [{ name: "a.png", base64: image }] },
    });
    assert.equal(
      (await request("/api/decks/" + deck.id + "/files/assets/a.png")).status,
      200,
    );
    for (const name of [
      "../outside.png",
      "/outside.png",
      "a/../../outside.png",
      "a\\outside.png",
    ])
      assert.equal(
        (
          await request("/api/decks/" + deck.id + "/assets", {
            method: "POST",
            body: { files: [{ name, base64: image }] },
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await request("/api/decks/" + deck.id + "/assets", {
          method: "POST",
          body: { files: [{ name: "a.png", base64: image }] },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(
          "/api/decks/" +
            deck.id +
            "/files/assets/%2e%2e%2f%2e%2e%2flibrary.sqlite",
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request("/api/decks/" + deck.id + "/files/assets/a.png", {
          as: null,
        })
      ).status,
      401,
    );
  });
  await test("scoped share capability; viewing cannot mutate, notes opt-in", async () => {
    assert.equal(
      (
        await request("/api/decks/" + deck.id + "/shares", {
          method: "POST",
          body: { days: 7 },
        })
      ).status,
      409,
    );
    deck = await ok("/api/decks/" + deck.id, {
      method: "PATCH",
      body: { visibility: "shared", version: deck.version },
    });
    link = await ok("/api/decks/" + deck.id + "/shares", {
      method: "POST",
      body: { days: 7, label: "Test viewer" },
    });
    const shared = await ok("/api/public/" + link.token, { as: null });
    assert.equal(shared.title, "Renamed");
    assert.equal(shared.allowNotes, false);
    const c = await ok("/api/public/" + link.token + "/content", { as: null });
    assert.equal(c.notes[1].notes, "");
    assert.deepEqual(c.notes[1].refs, []);
    assert.equal(
      (
        await request("/api/public/" + link.token + "/files/assets/a.png", {
          as: null,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(
          "/api/public/" + link.token + "/files/assets/brand/areal.png",
          { as: null },
        )
      ).status,
      404,
    );
    assert.equal(
      (
        await request("/api/public/" + link.token + "/content", {
          method: "POST",
          body: { title: "hack" },
          as: null,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/api/decks/" + deck.id, {
          method: "PATCH",
          body: { title: "hack", version: deck.version },
          as: null,
        })
      ).status,
      401,
    );
    const withNotes = await ok("/api/decks/" + deck.id + "/shares", {
      method: "POST",
      body: { days: null, allowNotes: true },
    });
    assert.equal(
      (await ok("/api/public/" + withNotes.token + "/content", { as: null }))
        .notes[1].notes,
      "SECRET NOTE",
    );
    app.store.db
      .prepare("UPDATE shares SET expires_at=? WHERE id=?")
      .run(Date.now() - 1000, withNotes.id);
    assert.equal(
      (await request("/api/public/" + withNotes.token, { as: null })).status,
      404,
    );
  });
  await test("revocation and private mode revoke all old links including assets", async () => {
    await ok("/api/decks/" + deck.id + "/shares/" + link.id, {
      method: "DELETE",
    });
    for (const suffix of ["", "/content", "/files/assets/a.png"])
      assert.equal(
        (await request("/api/public/" + link.token + suffix, { as: null }))
          .status,
        404,
      );
    const s = await ok("/api/decks/" + deck.id + "/shares", {
      method: "POST",
      body: { days: 1 },
    });
    deck = await ok("/api/decks/" + deck.id, {
      method: "PATCH",
      body: { visibility: "private", version: deck.version },
    });
    assert.equal(
      (await request("/api/public/" + s.token, { as: null })).status,
      404,
    );
    deck = await ok("/api/decks/" + deck.id, {
      method: "PATCH",
      body: { visibility: "shared", version: deck.version },
    });
    assert.equal(
      (await request("/api/public/" + s.token, { as: null })).status,
      404,
    );
  });
  await test("export/import round trip; recycle bin invalidates shares; restore remains private", async () => {
    const pack = await ok("/api/decks/" + deck.id + "/export");
    assert.equal(pack.subarray(0, 2).toString(), "PK");
    const { deck: imported } = await ok("/api/import/package?title=Imported", {
      method: "POST",
      body: pack,
    });
    assert.notEqual(imported.id, deck.id);
    assert.equal(
      (await ok("/api/decks/" + imported.id + "/content")).notes[1].notes,
      "SECRET NOTE",
    );
    assert.equal(
      (await request("/api/decks/" + imported.id + "/files/assets/a.png"))
        .status,
      200,
    );
    const s = await ok("/api/decks/" + deck.id + "/shares", {
      method: "POST",
      body: { days: null },
    });
    await ok("/api/decks/" + deck.id, { method: "DELETE" });
    assert.equal(
      (await request("/api/public/" + s.token, { as: null })).status,
      404,
    );
    assert.equal(
      (await request("/api/decks/" + deck.id + "/content")).status,
      404,
    );
    const restored = await ok("/api/decks/" + deck.id + "/restore", {
      method: "POST",
    });
    assert.equal(restored.visibility, "private");
    assert.equal(
      (await request("/api/public/" + s.token, { as: null })).status,
      404,
    );
  });
  await test("password change invalidates old sessions; logout and expiry enforced", async () => {
    const old = auth;
    const r = await request("/api/password", {
      method: "POST",
      body: { currentPassword: password, password: "new-test-password-8834" },
    });
    assert.equal(r.status, 200);
    auth = {
      cookie: r.headers.get("set-cookie").split(";")[0],
      csrf: r.data.csrf,
    };
    assert.equal((await request("/api/decks", { as: old })).status, 401);
    await ok("/api/logout", { method: "POST" });
    assert.equal((await request("/api/decks")).status, 401);
    const login = await request("/api/login", {
      method: "POST",
      body: { username: "admin", password: "new-test-password-8834" },
      as: null,
    });
    assert.equal(login.status, 200);
    auth = {
      cookie: login.headers.get("set-cookie").split(";")[0],
      csrf: login.data.csrf,
    };
    app.store.db.prepare("UPDATE sessions SET expires=?").run(Date.now() - 1);
    assert.equal((await request("/api/decks")).status, 401);
  });
  await test("content revisions survive reopening the database", async () => {
    await app.close();
    const reopened = await createApp({ dataDir: dir });
    try {
      const d = reopened.store.get(deck.id);
      assert.equal(d.title, "Renamed");
      assert.equal(d.visibility, "private");
      assert.equal(
        reopened.store.content(deck.id).notes[1].notes,
        "SECRET NOTE",
      );
      assert(reopened.store.assets(deck.id).length === 1);
    } finally {
      reopened.store.close();
    }
  });
} finally {
  try {
    await app.close();
  } catch {}
}
