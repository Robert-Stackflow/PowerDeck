import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as OTPAuth from "otpauth";
import { createApp, projectRoot } from "../server/app.mjs";
const dir = path.join(projectRoot, "work/qa/settings-api");
fs.rmSync(dir, { recursive: true, force: true });
const app = await createApp({ dataDir: dir, seed: false });
const base = (await app.listen({ port: 0 })).replace("127.0.0.1", "localhost");
const password = "settings-test-password-8029";
let auth, deck, share, recovery, totp;
const req = async (route, method = "GET", body, as = auth) => {
  const r = await fetch(base + "/api" + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(as ? { Cookie: as.cookie, "X-CSRF-Token": as.csrf } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const value = await r.json();
  return {
    status: r.status,
    value,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
};
const ok = async (...args) => {
  const r = await req(...args);
  assert(r.status < 300, JSON.stringify(r));
  return r.value;
};
const login = () =>
  req("/login", "POST", { username: "admin", password }, null);
const toSession = (r) => ({ cookie: r.cookie, csrf: r.value.csrf });
try {
  auth = toSession(
    await req("/setup", "POST", { username: "admin", password }, null),
  );
  await test("site branding is public, but settings and security writes require authentication and CSRF", async () => {
    assert.equal((await ok("/site", "GET", undefined, null)).name, "演示库");
    assert.equal(
      (await req("/site", "PATCH", { name: "evil" }, null)).status,
      401,
    );
    assert.equal((await req("/security", "GET", undefined, null)).status, 401);
    assert.equal(
      (
        await req(
          "/site",
          "PATCH",
          { name: "evil" },
          { ...auth, csrf: "wrong" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await ok("/site", "PATCH", { name: "工作室" })).name,
      "工作室",
    );
    assert.equal(
      (
        await req("/site", "PATCH", {
          name: "工作室",
          favicon: "data:image/svg+xml,<svg onload=alert(1)>",
        })
      ).status,
      400,
    );
  });
  await test("theme preferences persist, reject unknown values and preserve branding", async () => {
    assert.equal((await ok("/site")).theme, "system");
    for (const theme of ["dark", "light", "system"]) {
      const updated = await ok("/site", "PATCH", { name: "工作室", theme });
      assert.equal(updated.theme, theme);
      assert.equal(updated.name, "工作室");
      assert.equal((await ok("/site", "GET", undefined, null)).theme, theme);
    }
    assert.equal(
      (await req("/site", "PATCH", { name: "工作室", theme: "unknown" }))
        .status,
      400,
    );
    for (const asset of [
      "/static/katex/katex.mjs",
      "/static/katex/katex.min.css",
      "/static/katex/fonts/KaTeX_Main-Regular.woff2",
    ]) {
      const response = await fetch(base + asset);
      assert.equal(response.status, 200, asset);
      assert((await response.arrayBuffer()).byteLength > 0);
    }
  });
  await test("toast positions persist and reject unknown positions", async () => {
    assert.equal((await ok("/site")).toastPosition, "bottom-center");
    for (const toastPosition of [
      "top-left",
      "top-center",
      "top-right",
      "bottom-left",
      "bottom-center",
      "bottom-right",
    ]) {
      assert.equal(
        (await ok("/site", "PATCH", { name: "工作室", toastPosition }))
          .toastPosition,
        toastPosition,
      );
      assert.equal(
        (await ok("/site", "GET", undefined, null)).toastPosition,
        toastPosition,
      );
    }
    assert.equal(
      (
        await req("/site", "PATCH", {
          name: "工作室",
          toastPosition: "elsewhere",
        })
      ).status,
      400,
    );
    assert.equal(
      (await ok("/site", "PATCH", { name: "工作室" })).toastPosition,
      "bottom-right",
    );
  });
  await test("mutable unique slugs keep IDs, content, assets and share capabilities stable", async () => {
    const favicon =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfN0AAAAASUVORK5CYII=";
    deck = await ok("/decks", "POST", {
      title: "Demo",
      slug: "my-talk",
      favicon,
    });
    assert.equal((await ok("/resolve/my-talk")).id, deck.id);
    assert.equal(
      (await req("/resolve/my-talk", "GET", undefined, null)).status,
      401,
    );
    assert.equal(
      (await req("/decks", "POST", { title: "Another", slug: "MY-TALK" }))
        .status,
      409,
    );
    assert.equal(
      (
        await req("/decks/" + deck.id, "PATCH", {
          version: deck.version,
          slug: "../bad",
        })
      ).status,
      400,
    );
    const before = await ok("/decks/" + deck.id + "/content");
    deck = await ok("/decks/" + deck.id, "PATCH", {
      version: deck.version,
      slug: "renamed",
      visibility: "shared",
    });
    assert.equal((await req("/resolve/my-talk")).status, 404);
    assert.equal((await ok("/resolve/renamed")).id, deck.id);
    assert.deepEqual(await ok("/decks/" + deck.id + "/content"), before);
    assert.equal(deck.favicon, favicon);
    share = await ok("/decks/" + deck.id + "/shares", "POST", {
      slug: "team-review",
      days: 7,
    });
    assert.equal(share.path, "/s/team-review/" + share.token);
    assert.equal(
      (await ok("/public/" + share.token, "GET", undefined, null)).favicon,
      favicon,
    );
    await ok("/decks/" + deck.id + "/shares/" + share.id, "PATCH", {
      slug: "review-2026",
    });
    assert.equal(
      (await ok("/public/" + share.token, "GET", undefined, null)).shareSlug,
      "review-2026",
    );
    assert.equal(
      (await req("/public/team-review", "GET", undefined, null)).status,
      404,
    );
    await ok("/decks/" + deck.id + "/shares/" + share.id, "DELETE");
    assert.equal(
      (await req("/public/" + share.token, "GET", undefined, null)).status,
      404,
    );
  });
  await test("TOTP requires password, verified enrollment and session-bound challenge", async () => {
    assert.equal(
      (await req("/security/totp/setup", "POST", { currentPassword: "wrong" }))
        .status,
      401,
    );
    const setup = await ok("/security/totp/setup", "POST", {
      currentPassword: password,
    });
    assert.match(setup.qr, /^data:image\/png;base64,/);
    totp = new OTPAuth.TOTP({
      secret: setup.secret,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });
    const other = toSession(await login());
    assert.equal(
      (
        await req(
          "/security/totp/enable",
          "POST",
          { challenge: setup.challenge, code: totp.generate() },
          other,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await req("/security/totp/enable", "POST", {
          challenge: setup.challenge,
          code: "xxxxxx",
        })
      ).status,
      400,
    );
    const result = await ok("/security/totp/enable", "POST", {
      challenge: setup.challenge,
      code: totp.generate(),
    });
    recovery = result.recoveryCodes;
    assert.equal(recovery.length, 10);
    assert.equal((await req("/decks", "GET", undefined, other)).status, 401);
    const stored = app.store.db
      .prepare("SELECT secret,recovery FROM account_security WHERE id=1")
      .get();
    assert(!stored.secret.includes(setup.secret));
    assert(!stored.recovery.includes(recovery[0].replaceAll("-", "")));
    assert.equal(
      fs.statSync(path.join(dir, "security.key")).mode & 0o777,
      0o600,
    );
  });
  await test("password login never issues a session before MFA; TOTP and recovery codes resist replay", async () => {
    const first = await login();
    assert(first.value.mfaRequired);
    assert.equal(first.cookie, undefined);
    assert.equal((await req("/decks", "GET", undefined, null)).status, 401);
    assert.equal(
      (
        await req(
          "/login/mfa",
          "POST",
          { challenge: first.value.challenge, code: totp.generate() },
          null,
        )
      ).status,
      401,
    );
    const verified = await req(
      "/login/mfa",
      "POST",
      { challenge: first.value.challenge, code: recovery[0] },
      null,
    );
    assert.equal(verified.status, 200);
    assert(verified.cookie);
    assert.equal(
      (
        await req(
          "/login/mfa",
          "POST",
          { challenge: first.value.challenge, code: recovery[1] },
          null,
        )
      ).status,
      401,
    );
    const second = await login();
    assert.equal(
      (
        await req(
          "/login/mfa",
          "POST",
          { challenge: second.value.challenge, code: recovery[0] },
          null,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await req(
          "/login/mfa",
          "POST",
          {
            challenge: second.value.challenge,
            code: totp.generate({ timestamp: Date.now() + 30000 }),
          },
          null,
        )
      ).status,
      200,
    );
  });
  await test("security changes require both factors and invalidate other sessions and pending logins", async () => {
    assert.equal(
      (
        await req("/password", "POST", {
          currentPassword: password,
          password: "new-valid-password-8029",
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await req("/security/totp/disable", "POST", {
          currentPassword: password,
          code: "xxxxxx",
        })
      ).status,
      401,
    );
    const waiting = await login();
    await ok("/security/totp/disable", "POST", {
      currentPassword: password,
      code: recovery[1],
    });
    assert.equal(
      (
        await req(
          "/login/mfa",
          "POST",
          { challenge: waiting.value.challenge, code: recovery[2] },
          null,
        )
      ).status,
      401,
    );
    assert.equal((await ok("/security")).totpEnabled, false);
    assert((await login()).cookie);
  });
  await test("passkey options use the authenticated session and origin; challenges cannot cross sessions or accept forged attestations", async () => {
    assert.equal(
      (
        await req(
          "/security/passkeys/options",
          "POST",
          {
            name: "Laptop",
          },
          null,
        )
      ).status,
      401,
    );
    const ceremony = await ok("/security/passkeys/options", "POST", {
      name: "Laptop",
    });
    assert.equal(ceremony.options.rp.id, "localhost");
    assert.equal(
      ceremony.options.authenticatorSelection.userVerification,
      "required",
    );
    const other = toSession(await login());
    assert.equal(
      (
        await req(
          "/security/passkeys/verify",
          "POST",
          { challenge: ceremony.challenge, response: {} },
          other,
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await req("/security/passkeys/verify", "POST", {
          challenge: ceremony.challenge,
          response: {},
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("/security/passkeys/verify", "POST", {
          challenge: ceremony.challenge,
          response: {},
        })
      ).status,
      401,
    );
    assert.deepEqual((await ok("/security")).passkeys, []);
  });
} finally {
  await app.close();
}
