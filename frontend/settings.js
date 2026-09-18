import { api, esc, session, setSession } from "./api.js";
import { icon } from "./icons.js";
import { selectMarkup, enhanceSelects } from "./components/select.js";
import { toastPositions } from "./components/toast.js";
import { site, brand, setSite, defaultIcon, iconFromFile } from "./branding.js";
import { showDialog, closeDialog, toast, copy } from "./app.js";
import { startRegistration } from "./webauthn/index.js";
import {
  mountPlatformSettings,
  platformSettingsNav,
  platformSettingsPanels,
} from "./platform-settings.js";

export const passkeyAvailable = () =>
  !!window.PublicKeyCredential &&
  isSecureContext &&
  !/^(?:[\d.]+|\[.*\])$/.test(location.hostname);
export const passkeyHint = () =>
  /^(127\.0\.0\.1|\[::1\])$/.test(location.hostname)
    ? `<a href="http://localhost:${location.port || 4173}/">在 localhost 打开以使用通行密钥 ${icon("arrowUpRight")}</a>`
    : "此浏览器或访问地址暂不支持通行密钥，请使用支持的浏览器和 HTTPS 域名。";

const passkeyList = (passkeys) =>
  passkeys.length
    ? passkeys
        .map((passkey) => {
          const activity = passkey.lastUsed
            ? "最近使用 " +
              new Date(passkey.lastUsed).toLocaleDateString("zh-CN")
            : "添加于 " +
              new Date(passkey.createdAt).toLocaleDateString("zh-CN");
          return `<article class="passkey-item"><div class="passkey-identity"><span class="passkey-glyph">${icon("fingerprint")}</span><span class="passkey-copy"><b>${esc(passkey.name)}</b><small><span>${esc(passkey.rpID)}</span><span>${activity}</span></small></span></div><button class="icon-button danger" data-remove-passkey="${esc(passkey.id)}" aria-label="删除 ${esc(passkey.name)}" title="删除通行密钥">${icon("trash2")}</button></article>`;
        })
        .join("")
    : `<div class="passkey-empty">${icon("fingerprint")}<span><b>尚未添加通行密钥</b><small>添加后可使用设备验证快速登录</small></span></div>`;

const sessionDevice = (userAgent) => {
  const value = String(userAgent || "");
  if (/iPad/i.test(value)) return ["iPad", "smartphone"];
  if (/iPhone/i.test(value)) return ["iPhone", "smartphone"];
  if (/Android/i.test(value)) return ["Android 设备", "smartphone"];
  if (/Windows/i.test(value)) return ["Windows 设备", "monitor"];
  if (/Macintosh|Mac OS/i.test(value)) return ["Mac 设备", "monitor"];
  if (/Linux/i.test(value)) return ["Linux 设备", "monitor"];
  return ["未知设备", "monitor"];
};
const sessionBrowser = (userAgent) => {
  const value = String(userAgent || "");
  if (/Edg\//i.test(value)) return "Microsoft Edge";
  if (/Firefox\//i.test(value)) return "Firefox";
  if (/CriOS|Chrome\//i.test(value)) return "Chrome";
  if (/Safari\//i.test(value)) return "Safari";
  return "浏览器";
};
const sessionTime = (value) =>
  value
    ? new Date(value).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "未知";
const sessionList = (sessions) =>
  sessions
    .map((item) => {
      const [device, glyph] = sessionDevice(item.userAgent),
        browser = sessionBrowser(item.userAgent);
      return `<article class="login-session${item.current ? " current" : ""}"><span class="login-session-icon">${icon(glyph)}</span><div class="login-session-copy"><header><b>${esc(device)}</b>${item.current ? "<em>当前会话</em>" : ""}</header><p>${esc(browser)}${item.ip ? ` · ${esc(item.ip)}` : ""}</p><small>最近活动 ${sessionTime(item.lastSeenAt)} · 登录于 ${sessionTime(item.createdAt)}</small></div>${item.current ? "" : `<button type="button" class="button subtle" data-revoke-session="${esc(item.id)}">退出会话</button>`}</article>`;
    })
    .join("");

let activeTab = sessionStorage.getItem("settingsTab") || "general";
export async function openSettings() {
  const main = document.querySelector("main.library");
  sessionStorage.setItem("libraryView", "settings");
  if (
    session.role !== "owner" &&
    ["brand", "team", "backup"].includes(activeTab)
  )
    activeTab = "general";
  let [security, sessionResult] = await Promise.all([
      session.role === "owner"
        ? api("/security")
        : Promise.resolve({
            passkeys: [],
            totpEnabled: false,
            recoveryRemaining: 0,
          }),
      api("/sessions"),
    ]),
    loginSessions = sessionResult.sessions || [],
    favicon = site.favicon;
  // A category click while the request is in flight must keep its own view.
  if (
    main !== document.querySelector("main.library") ||
    sessionStorage.getItem("libraryView") !== "settings"
  )
    return;
  const tab = activeTab;
  document
    .querySelectorAll(".sidebar [data-filter]")
    .forEach((button) => button.classList.remove("active"));
  const account = document.querySelector("#accountSettings");
  account.classList.add("active");
  account.setAttribute("aria-current", "page");
  document.title = "设置 · " + site.name;
  main.className = "library settings-view";
  main.innerHTML = `<header class="library-header"><h1>设置</h1></header><div class="settings-layout"><aside class="settings-nav settings-card"><nav aria-label="设置分类"><button class="nav-item ${tab === "general" ? "active" : ""}" data-settings-tab="general" aria-pressed="${tab === "general"}">${icon("settings2")}基础设置</button><button class="nav-item ${tab === "sessions" ? "active" : ""}" data-settings-tab="sessions" aria-pressed="${tab === "sessions"}">${icon("monitor")}会话列表</button><button class="nav-item ${tab === "security" ? "active" : ""}" data-settings-tab="security" aria-pressed="${tab === "security"}">${icon("shieldCheck")}安全设置</button>${platformSettingsNav(tab)}</nav></aside><div class="settings-content"><section id="sessionSettings" data-settings-panel="sessions" class="settings-card login-sessions-card" ${tab !== "sessions" ? "hidden" : ""}><div class="login-sessions-heading"><div><h2>登录会话</h2><span>${loginSessions.length} 个设备</span></div><button id="revokeOtherSessions" type="button" class="button subtle" ${loginSessions.length > 1 ? "" : "disabled"}>退出其他会话</button></div><div class="login-session-list">${sessionList(loginSessions)}</div></section><section id="generalSettings" data-settings-panel="general" ${tab !== "general" ? "hidden" : ""}><form id="siteForm" class="settings-card"><div class="settings-card-heading">${icon("globe")}<h2>网站信息</h2></div><div class="icon-setting"><img id="siteIconPreview" src="${esc(favicon || defaultIcon)}" alt="网站图标"><div><label class="button" for="siteIconFile">${icon("upload")}上传图标</label><input type="file" id="siteIconFile" accept="image/*" hidden><button type="button" id="resetSiteIcon" class="button subtle">恢复默认</button></div></div><label>网站名称<input name="name" value="${esc(site.name)}" maxlength="40" required></label><fieldset class="theme-setting"><legend>外观</legend><div class="theme-options">${[
    ["light", "sun", "浅色"],
    ["dark", "moon", "深色"],
    ["system", "monitor", "跟随系统"],
  ]
    .map(
      ([value, glyph, label]) =>
        `<label><input type="radio" name="theme" value="${value}" ${(site.theme || "system") === value ? "checked" : ""}><span>${icon(glyph)}${label}</span></label>`,
    )
    .join(
      "",
    )}</div></fieldset><div class="toast-setting"><label>提示位置${selectMarkup({ id: "toastPosition", value: site.toastPosition || "bottom-center", options: toastPositions, label: "提示位置" })}</label><button type="button" id="previewToast" class="button subtle">预览提示</button></div><div class="settings-card-footer"><button class="button primary" type="submit">保存设置</button></div></form></section><section id="securitySettings" data-settings-panel="security" class="settings-card security-card" ${tab !== "security" ? "hidden" : ""}><div class="security-section"><div class="security-row"><div class="security-symbol">${icon("keyRound")}</div><div class="security-copy"><h2>登录密码</h2><p>更新密码后，其他设备需要重新登录。</p></div><button id="changePassword" class="button">修改密码</button></div></div><div class="security-section owner-security"><div class="security-row"><div class="security-symbol">${icon("fingerprint")}</div><div class="security-copy"><h2>通行密钥</h2><p>通过指纹、面容或设备锁屏密码登录。</p></div><button id="addPasskey" class="button" ${passkeyAvailable() && session.role === "owner" ? "" : "disabled"}>${icon("plus")}添加</button></div>${!passkeyAvailable() ? `<p class="settings-hint">${passkeyHint()}</p>` : ""}<div class="passkey-list" aria-label="已添加的通行密钥">${passkeyList(security.passkeys)}</div></div><div class="security-section owner-security"><div class="security-row"><div class="security-symbol">${icon("shieldCheck")}</div><div class="security-copy"><h2>双因素身份验证 <span class="badge ${security.totpEnabled ? "shared" : ""}">${security.totpEnabled ? "已启用" : "未启用"}</span></h2><p>登录时输入验证器中的 6 位动态验证码。</p></div><button id="toggleTotp" class="button ${security.totpEnabled ? "" : "primary"}" ${session.role === "owner" ? "" : "disabled"}>${security.totpEnabled ? "关闭" : "启用"}</button></div>${security.totpEnabled ? `<div class="recovery-row"><span>恢复码剩余 ${security.recoveryRemaining} 个</span><button id="rotateRecovery" class="button subtle">重新生成恢复码</button></div>` : ""}</div></section>${platformSettingsPanels(tab)}</div></div>`;
  enhanceSelects(main);
  main.querySelector("#previewToast").onclick = () =>
    toast("这是一条提示消息", main.querySelector("#toastPosition").value);
  const selectTab = (name) => {
    activeTab = name;
    sessionStorage.setItem("settingsTab", name);
    document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.settingsPanel !== name;
    });
    document.querySelectorAll("[data-settings-tab]").forEach((b) => {
      b.classList.toggle("active", b.dataset.settingsTab === name);
      b.setAttribute("aria-pressed", String(b.dataset.settingsTab === name));
    });
  };
  document
    .querySelectorAll("[data-settings-tab]")
    .forEach((b) => (b.onclick = () => selectTab(b.dataset.settingsTab)));
  await mountPlatformSettings(main, {
    showDialog,
    closeDialog,
    toast,
  });
  main.querySelectorAll("[data-revoke-session]").forEach(
    (button) =>
      (button.onclick = () =>
        showDialog("退出会话", "<p>该设备需要重新登录后才能继续访问。</p>", {
          submit: "退出会话",
          danger: true,
          onSubmit: async () => {
            await api(`/sessions/${button.dataset.revokeSession}`, {
              method: "DELETE",
            });
            closeDialog();
            await openSettings();
            toast("会话已退出");
          },
        })),
  );
  main.querySelector("#revokeOtherSessions").onclick = () =>
    showDialog(
      "退出其他会话",
      "<p>除当前设备外，其他设备都需要重新登录。</p>",
      {
        submit: "全部退出",
        danger: true,
        onSubmit: async () => {
          await api("/sessions/others", { method: "DELETE" });
          closeDialog();
          await openSettings();
          toast("其他会话已退出");
        },
      },
    );
  if (session.role !== "owner") {
    main
      .querySelectorAll(".owner-security")
      .forEach((section) => (section.hidden = true));
    main
      .querySelectorAll("#siteForm input,#siteForm button")
      .forEach((control) => {
        if (control.id !== "previewToast") control.disabled = true;
      });
  }
  document.querySelector("#siteIconFile").onchange = async (e) => {
    try {
      if (e.target.files[0]) favicon = await iconFromFile(e.target.files[0]);
      document.querySelector("#siteIconPreview").src = favicon || defaultIcon;
    } catch (err) {
      toast(err.message);
    }
    e.target.value = "";
  };
  document.querySelector("#resetSiteIcon").onclick = () => {
    favicon = null;
    document.querySelector("#siteIconPreview").src = defaultIcon;
  };
  document.querySelector("#siteForm").onsubmit = async (e) => {
    e.preventDefault();
    const button = e.submitter;
    button.disabled = true;
    try {
      setSite(
        await api("/site", {
          method: "PATCH",
          body: {
            name: new FormData(e.target).get("name"),
            favicon,
            theme: new FormData(e.target).get("theme"),
            toastPosition: new FormData(e.target).get("toastPosition"),
          },
        }),
      );
      document.querySelector(".brand").innerHTML = brand();
      document.title = "设置 · " + site.name;
      toast("网站设置已保存");
    } catch (err) {
      toast(err.message);
    } finally {
      button.disabled = false;
    }
  };
  const fields = () =>
    `<label>当前密码<input name="currentPassword" type="password" autocomplete="current-password" required maxlength="128"></label>${security.totpEnabled ? '<label>验证码或恢复码<input name="code" autocomplete="one-time-code" required maxlength="40"></label>' : ""}`;
  const reopen = async () => {
    closeDialog();
    await openSettings();
  };
  document.querySelector("#changePassword").onclick = () =>
    showDialog(
      "修改密码",
      `${fields()}<label>新密码<input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label><label>确认新密码<input name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label>`,
      {
        submit: "更新密码",
        onSubmit: async (f) => {
          const data = Object.fromEntries(f);
          if (data.password !== data.confirm)
            throw new Error("两次输入的新密码不一致");
          setSession(await api("/password", { method: "POST", body: data }));
          await reopen();
          toast("密码已更新，其他登录已退出");
        },
      },
    );
  document.querySelector("#addPasskey").onclick = () =>
    showDialog(
      "添加通行密钥",
      `<p class="passkey-dialog-intro">为这枚通行密钥取一个容易识别的名称。继续后，系统会调用设备的指纹、面容或锁屏验证。</p><label>名称<input name="name" placeholder="例如：MacBook" maxlength="60" required autofocus></label>`,
      {
        submit: "继续",
        onSubmit: async (f) => {
          const result = await api("/security/passkeys/options", {
            method: "POST",
            body: Object.fromEntries(f),
          });
          const response = await startRegistration({
            optionsJSON: result.options,
          });
          await api("/security/passkeys/verify", {
            method: "POST",
            body: { challenge: result.challenge, response },
          });
          await reopen();
          toast("通行密钥已添加");
        },
      },
    );
  document.querySelectorAll("[data-remove-passkey]").forEach(
    (b) =>
      (b.onclick = () =>
        showDialog("删除通行密钥", fields(), {
          submit: "删除",
          onSubmit: async (f) => {
            await api(
              "/security/passkeys/" +
                encodeURIComponent(b.dataset.removePasskey),
              { method: "DELETE", body: Object.fromEntries(f) },
            );
            await reopen();
            toast("通行密钥已删除");
          },
        })),
  );
  const showRecovery = async (codes) => {
    await openSettings();
    showDialog(
      "保存恢复码",
      `<p class="recovery-intro">验证器不可用时，每个恢复码可用于登录一次。请保存到安全的位置。</p><div class="recovery-codes">${codes.map((c) => `<code>${esc(c)}</code>`).join("")}</div><div class="recovery-actions"><button id="copyRecovery" type="button" class="button">${icon("copy")}复制</button><button id="downloadRecovery" type="button" class="button primary">${icon("download")}下载</button></div>`,
    );
    document.querySelector("#copyRecovery").onclick = () =>
      copy(codes.join("\n"));
    document.querySelector("#downloadRecovery").onclick = () => {
      const url = URL.createObjectURL(
          new Blob([site.name + " 恢复码\n\n" + codes.join("\n")], {
            type: "text/plain",
          }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = "恢复码.txt";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
  };
  document.querySelector("#toggleTotp").onclick = () => {
    if (security.totpEnabled)
      return showDialog("关闭双因素验证", fields(), {
        submit: "关闭",
        onSubmit: async (f) => {
          await api("/security/totp/disable", {
            method: "POST",
            body: Object.fromEntries(f),
          });
          await reopen();
          toast("双因素验证已关闭");
        },
      });
    showDialog("启用双因素验证", fields(), {
      submit: "继续",
      onSubmit: async (f) => {
        const result = await api("/security/totp/setup", {
          method: "POST",
          body: Object.fromEntries(f),
        });
        showDialog(
          "连接验证器",
          `<div class="totp-setup"><img src="${esc(result.qr)}" alt="验证器设置二维码"><p>用验证器扫描二维码，或手动输入密钥。</p><code class="totp-secret">${esc(result.secret)}</code></div><label>6 位验证码<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required autofocus></label>`,
          {
            submit: "验证并启用",
            onSubmit: async (form) => {
              const enabled = await api("/security/totp/enable", {
                method: "POST",
                body: { challenge: result.challenge, code: form.get("code") },
              });
              await showRecovery(enabled.recoveryCodes);
            },
          },
        );
      },
    });
  };
  document.querySelector("#rotateRecovery")?.addEventListener("click", () =>
    showDialog("重新生成恢复码", `<p>原有恢复码将失效。</p>${fields()}`, {
      submit: "重新生成",
      onSubmit: async (f) => {
        const result = await api("/security/recovery", {
          method: "POST",
          body: Object.fromEntries(f),
        });
        await showRecovery(result.recoveryCodes);
      },
    }),
  );
}
