import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStore } from "./store.mjs";
import { createSettings } from "./settings.mjs";
import { createAuth, passwordHash } from "./auth.mjs";
import { importPowerPoint } from "./import/powerpoint.mjs";
import { pipeline } from "node:stream/promises";
import { renderExport, exportTypes } from "./render-export.mjs";
import {
  exportPackage,
  importPackageArchive,
  PACKAGE_LIMIT,
} from "./package.mjs";
import { HttpError, requireValue, assetTypes, escapeHTML } from "./content.mjs";
import { parseFragment, serializeOuter } from "parse5";
export const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
};
async function readJSON(req, limit = 48 * 1024 * 1024) {
  if (!(req.headers["content-type"] || "").startsWith("application/json"))
    throw new HttpError(415, "请求需要 JSON 格式");
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit)
      throw new HttpError(413, "上传内容过大，请压缩或拆分文件");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    requireValue(
      value && typeof value === "object" && !Array.isArray(value),
      "请求需要 JSON 对象",
    );
    return value;
  } catch {
    throw new HttpError(400, "JSON 格式不正确");
  }
}
const publicMeta = (d) => ({
  id: d.id,
  kind: d.kind,
  slug: d.slug,
  favicon: d.favicon,
  title: d.title,
  description: d.description,
  author: d.author,
  width: d.width,
  height: d.height,
  slideCount: d.slideCount,
});
export async function createApp({
  dataDir = path.join(projectRoot, "data"),
  seed = true,
  publicURL = process.env.PUBLIC_URL,
  adminPassword = process.env.ADMIN_PASSWORD,
  adminUsername = process.env.ADMIN_USERNAME || "admin",
} = {}) {
  const store = createStore(
    dataDir,
    seed ? path.join(projectRoot, "work/build/presentations/areal") : null,
  );
  if (adminPassword && !store.db.prepare("SELECT id FROM admin").get()) {
    requireValue(
      adminPassword.length >= 10 && adminPassword.length <= 128,
      "ADMIN_PASSWORD 需为 10–128 个字符",
    );
    store.db
      .prepare("INSERT INTO admin VALUES(1,?,?)")
      .run(adminUsername, await passwordHash(adminPassword));
  }
  const origin = publicURL ? new URL(publicURL).origin : null;
  const settings = createSettings(store.db);
  const indexTemplate = fs.readFileSync(
    path.join(projectRoot, "frontend/index.html"),
    "utf8",
  );
  const auth = createAuth(store, {
    secure: origin?.startsWith("https:"),
    dataDir,
    origin,
    site: settings.read,
  });
  const sendFile = (res, file, type) => {
    const data = fs.readFileSync(file);
    res.writeHead(200, { "Content-Type": type, "Content-Length": data.length });
    res.end(data);
  };
  const sendIndex = (res) => {
    const current = settings.read(),
      name = escapeHTML(current.name),
      favicon = escapeHTML(current.favicon || "/static/favicon.svg"),
      html = indexTemplate
        .replace(
          'data-site-name="演示库" data-site-favicon=""',
          `data-site-name="${name}" data-site-favicon="${favicon}"`,
        )
        .replace("<title>演示库</title>", `<title>${name}</title>`)
        .replace(
          '<link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />',
          `<link rel="icon" href="${favicon}" />`,
        )
        .replace(
          '<img src="/static/favicon.svg" alt="" />',
          `<img src="${favicon}" alt="" />`,
        );
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Length": Buffer.byteLength(html),
    });
    res.end(html);
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' about:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
    );
    try {
      const requestURL = new URL(req.url, "http://" + req.headers.host),
        host = requestURL.hostname;
      if (
        origin
          ? req.headers.host !== new URL(origin).host
          : !["127.0.0.1", "localhost", "[::1]"].includes(host)
      )
        throw new HttpError(421, "请求主机不匹配，请配置 PUBLIC_URL");
      if (
        !["GET", "HEAD"].includes(req.method) &&
        req.headers.origin &&
        req.headers.origin !== (origin || requestURL.origin)
      )
        throw new HttpError(403, "不允许跨站请求");
      const pathname = decodeURIComponent(requestURL.pathname),
        parts = pathname.split("/").filter(Boolean),
        method = req.method;
      if (method === "GET" && pathname === "/api/session")
        return json(res, 200, auth.status(req));
      if (
        method === "POST" &&
        ["/api/setup", "/api/login"].includes(pathname)
      ) {
        const data = await readJSON(req, 8192);
        return json(res, 200, await auth[pathname.slice(5)](req, res, data));
      }
      if (pathname === "/api/site" && method === "GET")
        return json(res, 200, settings.read());
      const loginRoutes = {
        "/api/login/mfa": (data) => auth.security.mfa(req, res, data),
        "/api/login/passkey/options": () =>
          auth.security.authenticationOptions(req),
        "/api/login/passkey/verify": (data) =>
          auth.security.authenticate(req, res, data),
      };
      if (method === "POST" && loginRoutes[pathname])
        return json(
          res,
          200,
          await loginRoutes[pathname](await readJSON(req, 131072)),
        );
      if (pathname.startsWith("/api/")) {
        if (parts[1] === "public") {
          requireValue(method === "GET", "分享链接仅允许查看");
          const { deck, share } = store.publicAccess(parts[2]);
          if (parts.length === 3)
            if (requestURL.searchParams.get("view") === "1")
              store.recordShareView(share.id);
          if (parts.length === 3)
            return json(res, 200, {
              ...publicMeta(deck),
              shareSlug: share.slug,
              allowNotes: !!share.allow_notes,
              allowDownload: !!share.allow_download,
              expiresAt: share.expires_at,
            });
          if (parts[3] === "content") {
            const c = store.content(deck.id);
            if (!share.allow_notes)
              c.notes = Object.fromEntries(
                Object.entries(c.notes).map(([n, v]) => [
                  n,
                  { title: v.title, notes: "", refs: [], figures: [] },
                ]),
              );
            return json(res, 200, c);
          }
          if (parts[3] === "files") {
            const file = store.file(deck.id, parts.slice(4).join("/"));
            res.setHeader(
              "Content-Security-Policy",
              "default-src 'none'; sandbox",
            );
            return sendFile(
              res,
              file,
              assetTypes[path.extname(file).toLowerCase()],
            );
          }
          if (parts[3] === "export") {
            if (!share.allow_download)
              throw new HttpError(403, "此分享链接未开放下载权限");
            const format = requestURL.searchParams.get("format") || "pdf";
            requireValue(
              ["zip", "pdf", "pptx"].includes(format),
              "导出格式不正确",
            );
            const name =
              deck.title.replace(/[\x00-\x1f\x7f/\\<>:"|?*]/g, "_") +
              "." +
              format;
            const file =
              format === "zip"
                ? exportPackage(store, deck.id)
                : await renderExport(store, deck.id, format);
            store.recordShareDownload(share.id);
            res.setHeader(
              "Content-Disposition",
              `attachment; filename="${deck.id}.${format}"; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, "%27")}`,
            );
            res.setHeader(
              "Content-Type",
              format === "zip" ? "application/zip" : exportTypes[format],
            );
            if (format === "zip") await pipeline(file, res);
            else res.end(file);
            return;
          }
          throw new HttpError(404, "资源不存在");
        }
        auth.require(req);
        if (pathname === "/api/import/package" && method === "POST") {
          requireValue(
            [
              "application/zip",
              "application/x-zip-compressed",
              "application/octet-stream",
            ].includes((req.headers["content-type"] || "").split(";")[0]),
            "请选择 ZIP 内容包",
          );
          const chunks = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > PACKAGE_LIMIT)
              throw new HttpError(413, "ZIP 内容包需小于 200 MB");
            chunks.push(chunk);
          }
          const pack = await importPackageArchive(Buffer.concat(chunks));
          const title = requestURL.searchParams.get("title"),
            kind = requestURL.searchParams.get("kind");
          const deck = store.importPackage({
            ...pack,
            ...(title !== null ? { title } : {}),
            ...(kind !== null ? { kind } : {}),
          });
          return json(res, 201, { deck, warnings: [] });
        }
        if (pathname === "/api/import/powerpoint" && method === "POST") {
          const input = await readJSON(req, 58 * 1024 * 1024);
          requireValue(
            typeof input.title === "string" &&
              input.title.trim() &&
              input.title.length <= 120,
            "名称需为 1–120 个字符",
          );
          const converted = await importPowerPoint(input);
          const deck = store.importPackage({
            ...converted,
            title: input.title,
            kind: input.mode === "masters" ? "template" : "deck",
          });
          return json(res, 201, { deck, warnings: converted.warnings });
        }
        if (pathname === "/api/site" && method === "PATCH")
          return json(res, 200, settings.save(await readJSON(req, 400000)));
        if (pathname === "/api/security" && method === "GET")
          return json(res, 200, auth.security.status());
        const securityRoutes = {
          "/api/security/totp/setup": "setupTotp",
          "/api/security/totp/enable": "enableTotp",
          "/api/security/totp/disable": "disableTotp",
          "/api/security/recovery": "rotateRecovery",
          "/api/security/passkeys/options": "registrationOptions",
          "/api/security/passkeys/verify": "register",
        };
        if (method === "POST" && securityRoutes[pathname])
          return json(
            res,
            200,
            await auth.security[securityRoutes[pathname]](
              req,
              await readJSON(req, 131072),
            ),
          );
        if (
          method === "DELETE" &&
          parts[1] === "security" &&
          parts[2] === "passkeys" &&
          parts[3]
        )
          return json(
            res,
            200,
            await auth.security.removePasskey(
              req,
              parts[3],
              await readJSON(req, 8192),
            ),
          );
        if (method === "GET" && parts[1] === "resolve" && parts.length === 3)
          return json(res, 200, store.bySlug(parts[2]));
        if (method === "POST" && pathname === "/api/logout")
          return json(res, 200, auth.logout(req, res));
        if (method === "POST" && pathname === "/api/password")
          return json(
            res,
            200,
            await auth.changePassword(req, res, await readJSON(req)),
          );
        if (parts[1] !== "decks") throw new HttpError(404, "接口不存在");
        if (parts.length === 2) {
          if (method === "GET") return json(res, 200, { decks: store.list() });
          if (method === "POST") {
            const input = await readJSON(req);
            if (input.templateId) {
              requireValue(
                store.get(input.templateId).kind === "template",
                "请选择有效模板",
              );
              return json(
                res,
                201,
                store.clone(input.templateId, { ...input, kind: "deck" }),
              );
            }
            const d = store.importPackage(input);
            return json(res, 201, d);
          }
        }
        const id = parts[2];
        requireValue(
          /^[a-zA-Z0-9_-]{1,80}$/.test(id || ""),
          "演示稿编号不正确",
        );
        if (parts[3] === "restore" && method === "POST")
          return json(res, 200, store.restore(id));
        const d = store.get(id);
        if (parts[3] === "clone" && method === "POST")
          return json(res, 201, store.clone(id, await readJSON(req)));
        if (parts.length === 3) {
          if (method === "GET") return json(res, 200, d);
          if (method === "PATCH")
            return json(res, 200, store.save(id, await readJSON(req)));
          if (method === "DELETE") {
            store.trash(id);
            return json(res, 200, { ok: true });
          }
        }
        if (parts[3] === "content") {
          if (method === "GET") return json(res, 200, store.content(id));
          if (method === "PUT")
            return json(res, 200, store.save(id, await readJSON(req)));
        }
        if (parts[3] === "revisions") {
          if (parts.length === 4 && method === "GET")
            return json(res, 200, { revisions: store.revisions(id) });
          if (parts[4] && parts.length === 5 && method === "GET")
            return json(res, 200, store.revisionContent(id, parts[4]));
          if (parts[4] && parts[5] === "restore" && method === "POST")
            return json(
              res,
              200,
              store.restoreRevision(
                id,
                parts[4],
                (await readJSON(req)).version,
              ),
            );
        }
        if (parts[3] === "assets") {
          if (method === "GET")
            return json(res, 200, { assets: store.assets(id) });
          if (method === "POST")
            return json(res, 201, {
              assets: store.upload(id, (await readJSON(req)).files),
            });
        }
        if (parts[3] === "files" && method === "GET") {
          const file = store.file(id, parts.slice(4).join("/"));
          res.setHeader(
            "Content-Security-Policy",
            "default-src 'none'; sandbox",
          );
          return sendFile(
            res,
            file,
            assetTypes[path.extname(file).toLowerCase()],
          );
        }
        if (parts[3] === "shares") {
          if (method === "GET")
            return json(res, 200, { shares: store.shares(id) });
          if (method === "POST")
            return json(res, 201, store.share(id, await readJSON(req)));
          if (method === "PATCH" && parts[4])
            return json(
              res,
              200,
              store.updateShare(id, parts[4], await readJSON(req)),
            );
          if (method === "DELETE" && parts[4]) {
            store.revoke(id, parts[4]);
            return json(res, 200, { ok: true });
          }
        }
        if (parts[3] === "export" && method === "GET") {
          const format = requestURL.searchParams.get("format") || "zip";
          requireValue(
            ["zip", "pdf", "pptx"].includes(format),
            "导出格式不正确",
          );
          const name =
            d.title.replace(/[\x00-\x1f\x7f/\\<>:"|?*]/g, "_") + "." + format;
          const cancel = new AbortController();
          const onClose = () => {
            if (!res.writableEnded) cancel.abort();
          };
          res.once("close", onClose);
          try {
            const file =
              format === "zip"
                ? exportPackage(store, id)
                : await renderExport(store, id, format, {
                    signal: cancel.signal,
                  });
            res.setHeader(
              "Content-Disposition",
              `attachment; filename="${id}.${format}"; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, "%27")}`,
            );
            res.setHeader(
              "Content-Type",
              format === "zip" ? "application/zip" : exportTypes[format],
            );
            if (format === "zip") await pipeline(file, res);
            else {
              res.setHeader("Content-Length", file.length);
              res.end(file);
            }
          } finally {
            res.removeListener("close", onClose);
          }
          return;
        }
        if (parts[3] === "thumbnail" && method === "GET") {
          const c = store.content(id);
          const pages = [];
          const collectPages = (node) => {
            const classes =
              node.attrs?.find((attribute) => attribute.name === "class")
                ?.value || "";
            if (classes.split(/\s+/).includes("slide")) pages.push(node);
            else for (const child of node.childNodes || []) collectPages(child);
          };
          collectPages(parseFragment(c.html));
          const requestedPage = Math.max(
            1,
            Math.min(
              pages.length,
              Number.parseInt(requestURL.searchParams.get("page"), 10) || 1,
            ),
          );
          const allPages = requestURL.searchParams.get("all") === "1",
            preview = allPages
              ? pages.map(serializeOuter).join("")
              : serializeOuter(pages[requestedPage - 1]);
          res.setHeader(
            "Content-Security-Policy",
            "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline' 'self'; font-src 'self' data:; script-src 'none'; frame-ancestors 'self'; sandbox allow-same-origin",
          );
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(
            `<!doctype html><html><head><meta charset="utf-8"><base href="/api/decks/${id}/files/"><style>${c.css}</style><style>body{margin:0;overflow:hidden}#deck{position:absolute;inset:0;transform-origin:0 0;transform:scale(calc(100vw / ${d.width}px));width:${d.width}px;height:${d.height}px}.slide{display:${allPages ? "none" : "block"}!important;position:absolute;width:${d.width}px;height:${d.height}px}#deck>.slide[data-page="${requestedPage}"]{display:block!important}*{animation:none!important;transition:none!important}</style></head><body><div id="deck">${preview}</div></body></html>`,
          );
          return;
        }
        throw new HttpError(404, "接口不存在");
      }
      if (method !== "GET" && method !== "HEAD")
        throw new HttpError(405, "请求方式不支持");
      if (pathname === "/favicon.ico")
        return sendFile(
          res,
          path.join(projectRoot, "frontend/favicon.svg"),
          "image/svg+xml",
        );
      if (pathname === "/static/icons.js")
        return sendFile(
          res,
          path.join(projectRoot, "work/build/icons.js"),
          "text/javascript; charset=utf-8",
        );
      if (pathname.startsWith("/static/katex/")) {
        const root = path.join(projectRoot, "work/build/katex"),
          file = path.resolve(root, pathname.slice(14));
        const types = {
          ".mjs": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".woff2": "font/woff2",
          ".woff": "font/woff",
          ".ttf": "font/ttf",
        };
        if (
          !file.startsWith(root + path.sep) ||
          !types[path.extname(file)] ||
          !fs.existsSync(file) ||
          !fs.statSync(file).isFile()
        )
          throw new HttpError(404, "资源不存在");
        return sendFile(res, file, types[path.extname(file)]);
      }
      if (pathname.startsWith("/static/webauthn/")) {
        const root = path.join(projectRoot, "work/build/webauthn"),
          file = path.resolve(root, pathname.slice(17));
        if (
          !file.startsWith(root + path.sep) ||
          !file.endsWith(".js") ||
          !fs.existsSync(file) ||
          !fs.statSync(file).isFile()
        )
          throw new HttpError(404, "资源不存在");
        return sendFile(res, file, "text/javascript; charset=utf-8");
      }
      if (pathname.startsWith("/static/")) {
        const relative = pathname.slice(8),
          root = path.join(projectRoot, "frontend"),
          file = path.resolve(root, relative);
        if (
          !file.startsWith(root + path.sep) ||
          !fs.existsSync(file) ||
          !fs.statSync(file).isFile()
        )
          throw new HttpError(404, "资源不存在");
        const types = {
          ".css": "text/css; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".svg": "image/svg+xml",
        };
        if (!types[path.extname(file)]) throw new HttpError(404, "资源不存在");
        return sendFile(res, file, types[path.extname(file)]);
      }
      if (
        pathname === "/" ||
        pathname === "/login" ||
        pathname === "/settings" ||
        pathname.startsWith("/edit/")
      )
        return sendIndex(res);
      if (pathname.startsWith("/presenter/"))
        return sendFile(
          res,
          path.join(projectRoot, "frontend/presenter.html"),
          "text/html; charset=utf-8",
        );
      if (pathname.startsWith("/present/") || pathname.startsWith("/s/"))
        return sendFile(
          res,
          path.join(projectRoot, "frontend/player.html"),
          "text/html; charset=utf-8",
        );
      throw new HttpError(404, "页面不存在");
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      const status = e.status || 500;
      if (status === 500) console.error("Request failed:", e.message);
      json(res, status, {
        error: status === 500 ? "服务暂时无法完成请求" : e.message,
      });
    }
  });
  return {
    server,
    store,
    listen: async ({ port = 4173, host = "127.0.0.1" } = {}) => {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      return `http://${host}:${server.address().port}`;
    },
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      store.close();
    },
  };
}
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  const app = await createApp();
  const url = await app.listen({
    port: Number(process.env.PORT || 4173),
    host: process.env.HOST || "127.0.0.1",
  });
  console.log(`演示库已启动：${process.env.PUBLIC_URL || url}`);
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
