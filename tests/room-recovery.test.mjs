import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";

test("active rooms remain owned and recoverable after a server restart", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "room-recovery-"));
  let app = await createApp({ dataDir: directory, seed: false }),
    base;
  try {
    base = await app.listen({ port: 0 });
    const setup = await fetch(base + "/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "admin",
          password: "room-recovery-2026",
        }),
      }),
      cookie = setup.headers.get("set-cookie").split(";")[0],
      session = await fetch(base + "/api/session", {
        headers: { Cookie: cookie },
      }).then((response) => response.json()),
      deck = app.store.create({ title: "Persistent room" });
    const createdResponse = await fetch(base + "/api/rooms", {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf,
        },
        body: JSON.stringify({ deckId: deck.id, page: 1, permissions: {} }),
      }),
      created = await createdResponse.json();
    assert.equal(createdResponse.status, 201);

    await app.close();
    app = await createApp({ dataDir: directory, seed: false });
    base = await app.listen({ port: 0 });
    const restoredResponse = await fetch(
        `${base}/api/rooms/active?deckId=${encodeURIComponent(deck.id)}`,
        { headers: { Cookie: cookie } },
      ),
      restored = await restoredResponse.json();
    assert.equal(restoredResponse.status, 200);
    assert.equal(restored.room.token, created.token);
    assert.equal(restored.room.hostToken, created.hostToken);
    assert.equal(restored.room.url, created.url);
  } finally {
    await app?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
