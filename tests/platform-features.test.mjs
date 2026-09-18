import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp, projectRoot } from "../server/app.mjs";

const dir = path.join(projectRoot, "work/qa/platform-features-data");
fs.rmSync(dir, { recursive: true, force: true });
const app = await createApp({ dataDir: dir, seed: true }),
  base = await app.listen({ port: 0 });
let owner;
async function request(route, { method = "GET", body, auth = owner } = {}) {
  const binary = body instanceof Buffer;
  const response = await fetch(base + route, {
    method,
    headers: {
      ...(body
        ? { "Content-Type": binary ? "application/zip" : "application/json" }
        : {}),
      ...(auth ? { Cookie: auth.cookie, "X-CSRF-Token": auth.csrf } : {}),
    },
    body: body ? (binary ? body : JSON.stringify(body)) : undefined,
  });
  const type = response.headers.get("content-type") || "";
  return {
    status: response.status,
    data: type.includes("json")
      ? await response.json()
      : Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
  };
}
const login = async (username, password) => {
  const response = await request("/api/login", {
    method: "POST",
    body: { username, password },
    auth: null,
  });
  assert.equal(response.status, 200);
  return {
    cookie: response.headers.get("set-cookie").split(";")[0],
    csrf: response.data.csrf,
    role: response.data.role,
  };
};

try {
  await test("workspace roles migrate the owner and enforce mutation permissions", async () => {
    const setup = await request("/api/setup", {
      method: "POST",
      body: { username: "owner", password: "owner-password-123" },
      auth: null,
    });
    assert.equal(setup.status, 200);
    owner = {
      cookie: setup.headers.get("set-cookie").split(";")[0],
      csrf: setup.data.csrf,
    };
    assert.equal(setup.data.role, "owner");
    const users = await request("/api/workspace-users");
    assert.equal(users.data.users[0].role, "owner");
    assert.equal(
      (
        await request("/api/workspace-users", {
          method: "POST",
          body: {
            username: "editor",
            password: "editor-password-123",
            role: "editor",
          },
        })
      ).status,
      201,
    );
    await request("/api/workspace-users", {
      method: "POST",
      body: {
        username: "viewer",
        password: "viewer-password-123",
        role: "viewer",
      },
    });
    const editor = await login("editor", "editor-password-123"),
      viewer = await login("viewer", "viewer-password-123");
    assert.equal(editor.role, "editor");
    assert.equal(
      (
        await request("/api/decks", {
          method: "POST",
          body: { title: "Editor deck" },
          auth: editor,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await request("/api/decks", {
          method: "POST",
          body: { title: "Viewer deck" },
          auth: viewer,
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await request("/api/site", {
          method: "PATCH",
          body: { name: "Nope" },
          auth: editor,
        })
      ).status,
      403,
    );
  });

  await test("brand assets copy into decks and brand kit persists", async () => {
    const image =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfN0AAAAASUVORK5CYII=";
    const uploaded = await request("/api/brand-assets", {
      method: "POST",
      body: { name: "logo.png", base64: image },
    });
    assert.equal(uploaded.status, 201);
    const used = await request(`/api/brand-assets/${uploaded.data.id}/use`, {
      method: "POST",
      body: { deckId: "areal" },
    });
    assert.equal(used.status, 200);
    assert.match(used.data.path, /^assets\/brand\//);
    assert.equal(
      (
        await request("/api/brand-kit", {
          method: "PATCH",
          body: { primary: "#112233", secondary: "#abcdef", font: "Inter" },
        })
      ).data.primary,
      "#112233",
    );
  });

  await test("audience questions, polls, votes and feedback are live", async () => {
    const created = await request("/api/audience-sessions", {
      method: "POST",
      body: { deckId: "areal" },
    });
    assert.equal(created.status, 201);
    const token = created.data.token;
    assert.equal(
      (
        await request(`/api/audience/${token}/questions`, {
          method: "POST",
          body: { name: "访客", body: "这个方法适合哪些任务？" },
          auth: null,
        })
      ).status,
      201,
    );
    const poll = await request(`/api/audience-sessions/${token}/polls`, {
      method: "POST",
      body: { question: "听懂了吗？", options: ["懂了", "再讲一次"] },
    });
    const voted = await request(`/api/audience/${token}/vote`, {
      method: "POST",
      body: { pollId: poll.data.poll.id, option: 0, visitor: "v1" },
      auth: null,
    });
    assert.equal(voted.data.poll.votes, 1);
    await request(`/api/audience/${token}/feedback`, {
      method: "POST",
      body: { rating: 5, visitor: "v1" },
      auth: null,
    });
    const state = await request(`/api/audience-sessions/${token}`);
    assert.equal(state.data.questionCount, 1);
    assert.equal(state.data.feedback.average, 5);
  });

  await test("backup center creates and downloads a complete archive", async () => {
    const created = await request("/api/backups", {
      method: "POST",
      body: {},
    });
    assert.equal(created.status, 201);
    assert(created.data.size > 0);
    const downloaded = await request(
      `/api/backups/${encodeURIComponent(created.data.name)}/download`,
    );
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.data.subarray(0, 2).toString(), "PK");
  });
} finally {
  await app.close();
}
