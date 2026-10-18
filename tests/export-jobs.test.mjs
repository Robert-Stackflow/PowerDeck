import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../server/app.mjs";

const pause = (duration) =>
  new Promise((resolve) => setTimeout(resolve, duration));

test("background export jobs return immediately, report readiness and download later", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "export-jobs-")),
    initialApp = await createApp({ dataDir: directory, seed: false });
  let app = initialApp,
    base;
  try {
    base = await app.listen({ port: 0 });
    const setup = await fetch(base + "/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "admin",
          password: "background-export-2026",
        }),
      }),
      cookie = setup.headers.get("set-cookie").split(";")[0],
      session = await fetch(base + "/api/session", {
        headers: { Cookie: cookie },
      }).then((response) => response.json()),
      deck = app.store.create({
        title: "Background export",
        width: 960,
        height: 540,
      });
    app.store.save(deck.id, {
      version: app.store.get(deck.id).version,
      html: '<section class="slide"><h1>Background export</h1></section>',
      css: ".slide{background:#fff;color:#111}",
      notes: { 1: { title: "Cover", notes: "Offline note", refs: [] } },
    });
    const privateVersion = app.store.get(deck.id),
      privateContent = app.store.content(deck.id);
    app.store.save(deck.id, {
      ...privateContent,
      version: privateVersion.version,
      visibility: "shared",
    });

    const started = performance.now(),
      createdResponse = await fetch(`${base}/api/decks/${deck.id}/exports`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf,
        },
        body: JSON.stringify({ format: "html" }),
      }),
      elapsed = performance.now() - started,
      created = await createdResponse.json();
    assert.equal(createdResponse.status, 202);
    assert(elapsed < 1000, `job creation took ${Math.round(elapsed)}ms`);
    assert(["queued", "running"].includes(created.status));

    const activeCache = await fetch(`${base}/api/export-cache`, {
      headers: { Cookie: cookie },
    }).then((response) => response.json());
    assert(
      activeCache.decks.some(
        (item) =>
          item.id === deck.id && item.versions.includes(created.version),
      ),
    );
    assert(
      activeCache.files.some(
        (file) =>
          file.deckId === deck.id &&
          file.version === created.version &&
          ["queued", "running", "ready"].includes(file.status),
      ),
    );
    assert.equal(
      activeCache.cachedCount + activeCache.activeCount,
      activeCache.files.length,
    );

    let job = created;
    for (let attempt = 0; attempt < 80 && job.status !== "ready"; attempt++) {
      await pause(100);
      const response = await fetch(
        `${base}/api/decks/${deck.id}/exports/${job.id}`,
        { headers: { Cookie: cookie } },
      );
      assert.equal(response.status, 200);
      job = await response.json();
      if (job.status === "error") assert.fail(job.error);
    }
    assert.equal(job.status, "ready");
    assert.match(job.downloadURL, /\/download$/);
    const download = await fetch(base + job.downloadURL, {
      headers: { Cookie: cookie },
    });
    assert.equal(download.status, 200);
    assert.equal(
      download.headers.get("content-type"),
      "text/html; charset=utf-8",
    );
    assert.match(download.headers.get("content-disposition"), /\.html/);
    assert.match(await download.text(), /mountPresenter/);

    const reusedResponse = await fetch(`${base}/api/decks/${deck.id}/exports`, {
        method: "POST",
        headers: {
          Cookie: cookie,
          "Content-Type": "application/json",
          "X-CSRF-Token": session.csrf,
        },
        body: JSON.stringify({ format: "html" }),
      }),
      reused = await reusedResponse.json();
    assert.equal(reused.id, job.id);
    assert.equal(reused.status, "ready");
    assert.equal(reused.version, app.store.get(deck.id).version);
    assert.equal(reused.retentionMinutes, 60);

    const share = app.store.share(deck.id, {
        slug: app.store.get(deck.id).slug,
        days: 1,
        allowNotes: true,
        allowDownload: true,
      }),
      shared = await fetch(`${base}/api/public/${share.token}/exports`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format: "html" }),
      }).then((response) => response.json());
    assert.equal(shared.id, job.id);
    assert.equal(shared.status, "ready");
    assert.match(shared.downloadURL, /\/api\/public\//);

    const listed = await fetch(`${base}/api/decks/${deck.id}/exports`, {
      headers: { Cookie: cookie },
    }).then((response) => response.json());
    assert.equal(listed.jobs.length, 1);
    assert.equal(listed.jobs[0].id, job.id);

    const cache = await fetch(`${base}/api/export-cache`, {
      headers: { Cookie: cookie },
    }).then((response) => response.json());
    assert.equal(cache.files.length, 1);
    assert.equal(cache.files[0].deckId, deck.id);
    assert.equal(cache.files[0].version, app.store.get(deck.id).version);
    assert.equal(cache.files[0].downloadCount, 1);
    assert.equal(cache.decks[0].latestVersion, app.store.get(deck.id).version);
    assert(cache.decks[0].versions.includes(app.store.get(deck.id).version));

    const cachedDownload = await fetch(
      `${base}/api/export-cache/${cache.files[0].id}/download`,
      { headers: { Cookie: cookie } },
    );
    assert.equal(cachedDownload.status, 200);
    assert.match(await cachedDownload.text(), /mountPresenter/);
    const cacheAfterDownload = await fetch(`${base}/api/export-cache`, {
      headers: { Cookie: cookie },
    }).then((response) => response.json());
    assert.equal(cacheAfterDownload.files[0].downloadCount, 2);

    await app.close();
    app = await createApp({ dataDir: directory, seed: false });
    base = await app.listen({ port: 0 });
    const afterRestart = await fetch(`${base}/api/decks/${deck.id}/exports`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrf,
      },
      body: JSON.stringify({ format: "html" }),
    }).then((response) => response.json());
    assert.equal(afterRestart.id, job.id);
    assert.equal(afterRestart.status, "ready");

    const current = app.store.get(deck.id);
    app.store.save(deck.id, {
      version: current.version,
      html: '<section class="slide"><h1>New version</h1></section>',
      css: ".slide{background:#fff;color:#222}",
      notes: {},
    });
    const nextVersion = await fetch(`${base}/api/decks/${deck.id}/exports`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        "X-CSRF-Token": session.csrf,
      },
      body: JSON.stringify({ format: "html" }),
    }).then((response) => response.json());
    assert.notEqual(nextVersion.id, job.id);
    assert.equal(nextVersion.version, current.version + 1);

    const deletedJobResponse = await fetch(
        `${base}/api/export-cache/${nextVersion.id}`,
        {
          method: "DELETE",
          headers: {
            Cookie: cookie,
            "X-CSRF-Token": session.csrf,
          },
        },
      ),
      deletedJob = await deletedJobResponse.json();
    assert.equal(deletedJobResponse.status, 200);
    assert.equal(deletedJob.removed + Number(deletedJob.canceled), 1);
    await pause(150);
    const cacheAfterDelete = await fetch(`${base}/api/export-cache`, {
      headers: { Cookie: cookie },
    }).then((response) => response.json());
    assert.equal(
      cacheAfterDelete.files.some((file) => file.id === nextVersion.id),
      false,
    );

    const clearedResponse = await fetch(`${base}/api/export-cache`, {
        method: "DELETE",
        headers: {
          Cookie: cookie,
          "X-CSRF-Token": session.csrf,
          "Content-Type": "application/json",
        },
      }),
      cleared = await clearedResponse.json();
    assert.equal(clearedResponse.status, 200);
    assert(cleared.removed >= 1);
  } finally {
    await app?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
