export let session = {};
export async function api(
  url,
  {
    method = "GET",
    body,
    responseType = "json",
    headers = {},
    ...options
  } = {},
) {
  const binary = body instanceof Blob;
  const r = await fetch("/api" + url, {
    method,
    headers: {
      ...(body
        ? {
            "Content-Type": binary
              ? body.type || "application/octet-stream"
              : "application/json",
          }
        : {}),
      ...(session.csrf ? { "X-CSRF-Token": session.csrf } : {}),
      ...headers,
    },
    ...(body ? { body: binary ? body : JSON.stringify(body) } : {}),
    ...options,
  });
  if (!r.ok) {
    const value = await r.json().catch(() => ({}));
    throw Object.assign(new Error(value.error || "请求失败"), {
      status: r.status,
    });
  }
  return responseType === "blob" ? r.blob() : r.json();
}
export async function loadSession() {
  session = await api("/session");
  return session;
}
export function setSession(value) {
  session = value;
}
export const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export async function fileBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768)
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return { name: file.name, base64: btoa(binary) };
}
