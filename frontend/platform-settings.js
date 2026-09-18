import { api, esc, fileBase64, session } from "./api.js";
import { icon } from "./icons.js";
import { selectMarkup, enhanceSelects } from "./components/select.js";
import {
  colorField,
  createColorPicker,
  setColorField,
} from "./editor/controls.js";

const roles = {
  owner: "所有者",
  editor: "编辑者",
  reviewer: "审阅者",
  viewer: "查看者",
};
const roleOptions = [
  ["editor", "编辑者"],
  ["reviewer", "审阅者"],
  ["viewer", "查看者"],
];
const formatSize = (bytes) =>
  bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const formatDate = (value) => new Date(value).toLocaleString("zh-CN");

export const platformSettingsNav = (active) =>
  session.role === "owner"
    ? `<button class="nav-item ${active === "brand" ? "active" : ""}" data-settings-tab="brand" aria-pressed="${active === "brand"}">${icon("image")}品牌与素材</button><button class="nav-item ${active === "team" ? "active" : ""}" data-settings-tab="team" aria-pressed="${active === "team"}">${icon("group")}成员与权限</button><button class="nav-item ${active === "backup" ? "active" : ""}" data-settings-tab="backup" aria-pressed="${active === "backup"}">${icon("save")}备份中心</button>`
    : "";

export const platformSettingsPanels = (active) =>
  session.role === "owner"
    ? `<section id="brandSettings" data-settings-panel="brand" ${active !== "brand" ? "hidden" : ""}></section><section id="teamSettings" data-settings-panel="team" ${active !== "team" ? "hidden" : ""}></section><section id="backupSettings" data-settings-panel="backup" ${active !== "backup" ? "hidden" : ""}></section>`
    : "";

export async function mountPlatformSettings(
  main,
  { showDialog, closeDialog, toast },
) {
  if (session.role !== "owner") return;
  const brandPanel = main.querySelector("#brandSettings"),
    teamPanel = main.querySelector("#teamSettings"),
    backupPanel = main.querySelector("#backupSettings");

  async function renderBrand() {
    const [kit, assetResult] = await Promise.all([
      api("/brand-kit"),
      api("/brand-assets"),
    ]);
    brandPanel.innerHTML = `<form id="brandKitForm" class="settings-card"><div class="settings-card-heading">${icon("image")}<div><h2>品牌规范</h2><p>编辑器素材库会使用这里保存的品牌资源。</p></div></div><div class="brand-kit-fields">${colorField("primary", "主品牌色")}${colorField("secondary", "辅助色")}<label>品牌字体<input name="font" value="${esc(kit.font)}" maxlength="80" placeholder="例如：Inter, 思源黑体"></label></div><div class="settings-card-footer"><button class="button primary" type="submit">保存品牌规范</button></div></form><section class="settings-card brand-assets-card"><div class="settings-card-heading">${icon("library")}<div><h2>品牌素材库</h2><p>Logo、图标与常用图片可直接从编辑器插入。</p></div><label class="button primary" for="brandAssetFile">${icon("upload")}上传素材</label><input id="brandAssetFile" type="file" accept="image/*,.svg" multiple hidden></div><div class="brand-settings-grid">${assetResult.assets.length ? assetResult.assets.map((asset) => `<article><img src="/api/brand-assets/${asset.id}/file" alt=""><div><b title="${esc(asset.name)}">${esc(asset.name)}</b><small>${formatSize(asset.size)}</small></div><button type="button" class="icon-button danger" data-delete-brand="${asset.id}" aria-label="删除素材">${icon("trash2")}</button></article>`).join("") : '<p class="settings-empty">尚未上传品牌素材</p>'}</div></section>`;
    const colorPicker = createColorPicker(brandPanel, toast);
    brandPanel.querySelector("[data-transparent]").hidden = true;
    for (const [name, value] of [
      ["primary", kit.primary],
      ["secondary", kit.secondary],
    ]) {
      setColorField(brandPanel, name, value);
      const button = brandPanel.querySelector(`[data-color-field="${name}"]`);
      button.onclick = () =>
        colorPicker.open(
          button,
          brandPanel.querySelector(`[name="${name}"]`).value,
          (color) => {
            if (color !== "transparent") setColorField(brandPanel, name, color);
          },
        );
    }
    brandPanel.querySelector("#brandKitForm").onsubmit = async (event) => {
      event.preventDefault();
      await api("/brand-kit", {
        method: "PATCH",
        body: Object.fromEntries(new FormData(event.currentTarget)),
      });
      toast("品牌规范已保存");
    };
    brandPanel.querySelector("#brandAssetFile").onchange = async (event) => {
      const files = [...event.target.files].slice(0, 20);
      event.target.value = "";
      try {
        for (const file of files)
          await api("/brand-assets", {
            method: "POST",
            body: await fileBase64(file),
          });
        await renderBrand();
        toast(`已上传 ${files.length} 个素材`);
      } catch (error) {
        toast(error.message);
      }
    };
    brandPanel.querySelectorAll("[data-delete-brand]").forEach(
      (button) =>
        (button.onclick = () =>
          showDialog(
            "删除品牌素材",
            "<p>删除后不会影响已经插入文稿的副本。</p>",
            {
              submit: "删除",
              danger: true,
              onSubmit: async () => {
                await api(`/brand-assets/${button.dataset.deleteBrand}`, {
                  method: "DELETE",
                });
                closeDialog();
                await renderBrand();
                toast("素材已删除");
              },
            },
          )),
    );
  }

  async function renderTeam() {
    const { users } = await api("/workspace-users");
    const rows = users
      .map((user) => {
        const renameButton = `<button type="button" class="icon-button" data-rename-user="${user.id}" aria-label="修改 ${esc(user.username)} 的用户名" title="修改用户名">${icon("pencil")}</button>`,
          actions =
            user.role === "owner"
              ? `${renameButton}<span class="badge shared">所有者</span>`
              : `${renameButton}${selectMarkup({ id: `workspaceRole-${user.id}`, value: user.role, options: roleOptions, label: `${user.username}的角色` })}<button type="button" class="button subtle" data-toggle-user="${user.id}" data-disabled="${Boolean(user.disabledAt)}">${user.disabledAt ? "启用" : "停用"}</button><button type="button" class="icon-button danger" data-delete-user="${user.id}" aria-label="删除成员">${icon("trash2")}</button>`;
        return `<article class="workspace-user${user.disabledAt ? " disabled" : ""}"><span class="avatar">${esc(user.username[0].toUpperCase())}</span><div class="workspace-user-copy"><b>${esc(user.username)}</b><small>${user.disabledAt ? "已停用" : "正常使用"}</small></div><div class="workspace-user-actions">${actions}</div></article>`;
      })
      .join("");
    teamPanel.innerHTML = `<section class="settings-card"><div class="settings-card-heading">${icon("group")}<div><h2>工作区成员</h2><p>管理成员角色与账号状态。</p></div><button id="addWorkspaceUser" class="button primary">${icon("plus")}添加成员</button></div><div class="workspace-user-list">${rows}</div></section>`;
    enhanceSelects(teamPanel);
    teamPanel.querySelectorAll('[id^="workspaceRole-"]').forEach((input) => {
      input.dataset.userRole = input.id.slice("workspaceRole-".length);
    });
    teamPanel.querySelector("#addWorkspaceUser").onclick = () =>
      showDialog(
        "添加工作区成员",
        `<label>用户名<input name="username" required maxlength="40" pattern="[a-zA-Z0-9_.\\-]{2,40}" autofocus></label><label>初始密码<input name="password" type="password" required minlength="10" maxlength="128"></label><label>角色${selectMarkup({ id: "newWorkspaceRole", name: "role", value: "editor", options: roleOptions, label: "成员角色" })}</label>`,
        {
          submit: "添加",
          onSubmit: async (form) => {
            await api("/workspace-users", {
              method: "POST",
              body: Object.fromEntries(form),
            });
            closeDialog();
            await renderTeam();
            toast("成员已添加");
          },
        },
      );
    teamPanel.querySelectorAll("[data-rename-user]").forEach((button) => {
      const user = users.find((item) => item.id === button.dataset.renameUser);
      button.onclick = () =>
        showDialog(
          "修改用户名",
          `<label>用户名<input name="username" value="${esc(user.username)}" required maxlength="40" pattern="[a-zA-Z0-9_.\\-]{2,40}" autofocus></label>`,
          {
            submit: "保存",
            onSubmit: async (form) => {
              const updated = await api(`/workspace-users/${user.id}`, {
                method: "PATCH",
                body: { username: form.get("username") },
              });
              if (updated.id === session.userId) {
                session.username = updated.username;
                const account = document.querySelector("#accountSettings"),
                  name = account?.querySelector(".account-copy");
                if (name?.firstChild)
                  name.firstChild.nodeValue = updated.username;
              }
              closeDialog();
              await renderTeam();
              toast("用户名已更新");
            },
          },
        );
    });
    teamPanel.querySelectorAll("[data-user-role]").forEach(
      (select) =>
        (select.onchange = async () => {
          await api(`/workspace-users/${select.dataset.userRole}`, {
            method: "PATCH",
            body: { role: select.value, disabled: false },
          });
          await renderTeam();
          toast("成员角色已更新");
        }),
    );
    teamPanel.querySelectorAll("[data-toggle-user]").forEach(
      (button) =>
        (button.onclick = async () => {
          const role = teamPanel.querySelector(
            `[data-user-role="${button.dataset.toggleUser}"]`,
          ).value;
          await api(`/workspace-users/${button.dataset.toggleUser}`, {
            method: "PATCH",
            body: { role, disabled: button.dataset.disabled === "false" },
          });
          await renderTeam();
        }),
    );
    teamPanel.querySelectorAll("[data-delete-user]").forEach(
      (button) =>
        (button.onclick = () =>
          showDialog("删除成员", "<p>该成员的所有登录会话会立即失效。</p>", {
            submit: "删除",
            danger: true,
            onSubmit: async () => {
              await api(`/workspace-users/${button.dataset.deleteUser}`, {
                method: "DELETE",
              });
              closeDialog();
              await renderTeam();
              toast("成员已删除");
            },
          })),
    );
  }

  async function renderBackups() {
    const { backups } = await api("/backups");
    backupPanel.innerHTML = `<section class="settings-card"><div class="settings-card-heading">${icon("save")}<div><h2>整站备份</h2><p>备份账户、设置、文稿、版本与素材。</p></div><button id="createBackup" class="button primary">${icon("plus")}立即备份</button></div><div class="backup-actions"><span class="backup-restore-icon">${icon("upload")}</span><div><b>从备份恢复</b><p>上传备份会替换当前全部数据，并自动重启服务。</p></div><label class="button" for="restoreBackupFile">选择文件</label><input id="restoreBackupFile" type="file" accept=".zip,application/zip" hidden></div><div class="backup-list"><header><span>备份文件</span><span>${backups.length} 个</span></header>${backups.length ? backups.map((backup) => `<article><span class="backup-symbol">${icon("save")}</span><div class="backup-copy"><b>完整备份</b><small>${formatDate(backup.createdAt)} · ${formatSize(backup.size)}</small><code>${esc(backup.name)}</code></div><div class="backup-item-actions"><a class="button subtle" href="/api/backups/${encodeURIComponent(backup.name)}/download">${icon("download")}下载</a><button type="button" class="icon-button danger" data-delete-backup="${esc(backup.name)}" aria-label="删除备份">${icon("trash2")}</button></div></article>`).join("") : '<p class="settings-empty">还没有备份</p>'}</div></section>`;
    backupPanel.querySelector("#createBackup").onclick = async (event) => {
      event.currentTarget.disabled = true;
      try {
        await api("/backups", { method: "POST", body: {} });
        await renderBackups();
        toast("备份已创建");
      } catch (error) {
        event.currentTarget.disabled = false;
        toast(error.message);
      }
    };
    backupPanel.querySelector("#restoreBackupFile").onchange = async (
      event,
    ) => {
      const file = event.target.files[0];
      event.target.value = "";
      if (!file) return;
      showDialog(
        "恢复整站备份",
        `<p>将使用 <b>${esc(file.name)}</b> 替换当前账户、文稿、设置及素材。建议先创建当前数据的备份。</p>`,
        {
          submit: "恢复并重启",
          danger: true,
          onSubmit: async () => {
            await api("/backups/restore", {
              method: "POST",
              body: file,
              responseType: "json",
            });
            location.href = "/login";
          },
        },
      );
    };
    backupPanel.querySelectorAll("[data-delete-backup]").forEach(
      (button) =>
        (button.onclick = async () => {
          await api(
            `/backups/${encodeURIComponent(button.dataset.deleteBackup)}`,
            { method: "DELETE" },
          );
          await renderBackups();
          toast("备份已删除");
        }),
    );
  }

  await Promise.all([renderBrand(), renderTeam(), renderBackups()]);
}
