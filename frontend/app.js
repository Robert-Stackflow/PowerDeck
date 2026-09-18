import {
  api,
  loadSession,
  setSession,
  session,
  esc,
  fileBase64,
} from "./api.js";
import { icon } from "./icons.js";
import { createToast } from "./components/toast.js";
import { openEditor } from "./editor.js";
import { selectMarkup, enhanceSelects } from "./components/select.js";
import {
  site,
  brand,
  loadSite,
  defaultIcon,
  iconFromFile,
} from "./branding.js";
import { openSettings, passkeyAvailable, passkeyHint } from "./settings.js";
import { setupImport } from "./library/import.js";
import { startAuthentication } from "./webauthn/index.js";
const app = document.querySelector("#app"),
  modal = document.querySelector("#dialog");
let decks = [],
  dialogBackdropPress = false,
  filter = ["all", "templates", "trash"].includes(
    sessionStorage.getItem("librarySection"),
  )
    ? sessionStorage.getItem("librarySection")
    : "all",
  access = "all",
  query = "",
  sort = "updated";
export const toast = createToast(document.querySelector("#toast"));
export function closeDialog() {
  if (modal.getAttribute("aria-busy") === "true") return;
  modal.classList.add("closing");
  setTimeout(() => {
    modal.close();
    modal.classList.remove("closing");
  }, 130);
}
export function showDialog(
  title,
  body,
  { submit = "保存", onSubmit, wide = false, className = "" } = {},
) {
  dialogBackdropPress = false;
  modal.className = [wide ? "wide" : "", className].filter(Boolean).join(" ");
  modal.innerHTML = `<form id="dialogForm"><div class="dialog-head"><h2 id="dialogTitle">${esc(title)}</h2><button type="button" class="icon-button close-dialog" aria-label="关闭">${icon("x")}</button></div><div class="dialog-body">${body}</div><p class="form-error" id="dialogError" role="alert"></p>${onSubmit ? `<div class="dialog-footer"><button type="button" class="button subtle close-dialog">取消</button><button type="submit" class="button primary">${esc(submit)}</button></div>` : ""}</form>`;
  enhanceSelects(modal);
  if (!modal.open) modal.showModal();
  modal
    .querySelectorAll(".close-dialog")
    .forEach((b) => (b.onclick = closeDialog));
  modal.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    const button = e.submitter;
    button.disabled = true;
    modal.querySelector("#dialogError").textContent = "";
    try {
      await onSubmit(new FormData(e.target));
    } catch (error) {
      modal.querySelector("#dialogError").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
}
const isDialogBackdropPoint = (event) => {
  const rect = modal.getBoundingClientRect();
  return (
    event.clientX < rect.left ||
    event.clientX > rect.right ||
    event.clientY < rect.top ||
    event.clientY > rect.bottom
  );
};
modal.addEventListener("pointerdown", (event) => {
  dialogBackdropPress = event.target === modal && isDialogBackdropPoint(event);
});
modal.addEventListener("click", (e) => {
  const closeFromBackdrop =
    dialogBackdropPress && e.target === modal && isDialogBackdropPoint(e);
  dialogBackdropPress = false;
  if (closeFromBackdrop) closeDialog();
});
modal.addEventListener("pointercancel", () => (dialogBackdropPress = false));
modal.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeDialog();
});
document.addEventListener(
  "pointerdown",
  (event) => {
    const current = event.target.closest(".card-more");
    document.querySelectorAll(".card-more[open]").forEach((menu) => {
      if (menu !== current) menu.removeAttribute("open");
    });
  },
  true,
);
const date = (t) =>
  new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(
    new Date(t),
  );
const counts = () => ({
  all: decks.filter((d) => !d.deletedAt && d.kind !== "template").length,
  templates: decks.filter((d) => !d.deletedAt && d.kind === "template").length,
  trash: decks.filter((d) => d.deletedAt).length,
});
function loginView(status) {
  sessionStorage.removeItem("libraryView");
  const setup = status.setupRequired;
  app.innerHTML = `<div class="auth-page"><a class="brand auth-brand" href="/">${brand()}</a><section class="auth-card"><div class="auth-symbol">${icon(setup ? "shieldCheck" : "lockKeyhole")}</div><h1>${setup ? "创建管理员" : "欢迎回来"}</h1><p>${setup ? "设置一个账号，用来管理你的演示文稿。" : "登录以管理演示文稿和分享链接。"}</p><form id="authForm"><label>账号<input name="username" autocomplete="username" value="admin" required maxlength="40"></label><label>密码<input name="password" type="password" autocomplete="${setup ? "new-password" : "current-password"}" ${setup ? 'minlength="10"' : ""} maxlength="128" placeholder="${setup ? "至少 10 个字符" : "输入密码"}" required></label>${setup ? '<label>确认密码<input name="confirm" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label>' : ""}<p class="form-error" id="authError" role="alert"></p><button type="submit" class="button primary">${setup ? "创建并进入" : "登录"}${icon("chevronRight")}</button></form></section></div>`;
  if (!setup) {
    const form = document.querySelector("#authForm");
    form.insertAdjacentHTML(
      "afterend",
      `<button type="button" id="passkeyLogin" class="button auth-passkey">${icon("fingerprint")}使用通行密钥登录</button>`,
    );
    document.querySelector("#passkeyLogin").onclick = async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        if (!passkeyAvailable()) {
          showDialog(
            "通行密钥",
            `<p class="settings-hint">${passkeyHint()}</p>`,
          );
          return;
        }
        const result = await api("/login/passkey/options", {
          method: "POST",
          body: {},
        });
        const response = await startAuthentication({
          optionsJSON: result.options,
        });
        await finishLogin(
          await api("/login/passkey/verify", {
            method: "POST",
            body: { challenge: result.challenge, response },
          }),
        );
      } catch (error) {
        document.querySelector("#authError").textContent =
          error.name === "NotAllowedError"
            ? "已取消通行密钥验证"
            : error.message;
      } finally {
        btn.disabled = false;
      }
    };
  }
  document.querySelector("#authForm").onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const btn = e.submitter;
    btn.disabled = true;
    try {
      if (setup && data.password !== data.confirm)
        throw new Error("两次输入的密码不一致");
      await finishLogin(
        await api(setup ? "/setup" : "/login", { method: "POST", body: data }),
      );
    } catch (error) {
      document.querySelector("#authError").textContent = error.message;
    } finally {
      btn.disabled = false;
    }
  };
}
async function finishLogin(result) {
  if (!result.mfaRequired) {
    setSession(result);
    return render();
  }
  const card = document.querySelector(".auth-card");
  card.innerHTML = `<div class="auth-symbol">${icon("shieldCheck")}</div><h1>验证身份</h1><p>输入验证器中的验证码，或使用一个恢复码。</p><form id="mfaForm"><label>验证码或恢复码<input name="code" autocomplete="one-time-code" maxlength="40" required autofocus></label><p class="form-error" id="authError" role="alert"></p><button class="button primary" type="submit">继续${icon("chevronRight")}</button></form><a href="/login" class="auth-link">返回登录</a>`;
  document.querySelector("#mfaForm").onsubmit = async (e) => {
    e.preventDefault();
    const b = e.submitter;
    b.disabled = true;
    try {
      const value = await api("/login/mfa", {
        method: "POST",
        body: {
          challenge: result.challenge,
          code: new FormData(e.target).get("code"),
        },
      });
      setSession(value);
      await render();
    } catch (err) {
      document.querySelector("#authError").textContent = err.message;
    } finally {
      b.disabled = false;
    }
  };
}
function shell() {
  sessionStorage.removeItem("libraryView");
  sessionStorage.setItem("librarySection", filter);
  document.title = site.name;
  const n = counts();
  const markup = `<aside class="sidebar"><a class="brand" href="/">${brand()}</a><nav aria-label="演示稿分类">${[
    ["all", "library", "文稿"],
    ["templates", "overview", "模板"],
    ["trash", "trash2", "回收站"],
  ]
    .map(
      ([id, ic, label]) =>
        `<button class="nav-item ${filter === id ? "active" : ""}" data-filter="${id}">${icon(ic)}<span>${label}</span><small>${n[id]}</small></button>`,
    )
    .join(
      "",
    )}</nav><div class="account"><button id="accountSettings" class="account-name" aria-label="账号设置"><span class="avatar">${esc(session.username[0].toUpperCase())}</span><span>${esc(session.username)}<small>管理员</small></span></button><button id="logout" class="icon-button" aria-label="退出登录" title="退出登录">${icon("logOut")}</button></div></aside><main class="library"><header class="library-header"><div><p class="eyebrow">我的空间</p><h1>${{ all: "文稿", templates: "模板", trash: "回收站" }[filter]}</h1></div><div class="header-actions"><button class="button" id="importBtn">${icon("upload")}导入</button><button class="button primary" id="newBtn">${icon("plus")}${filter === "templates" ? "新建模板" : "新建文稿"}</button></div></header><div class="library-toolbar"><label class="search">${icon("search")}<input id="search" type="search" aria-label="搜索演示稿" placeholder="${filter === "templates" ? "搜索模板" : "搜索文稿"}" value="${esc(query)}"></label>${
    filter === "all"
      ? selectMarkup({
          id: "visibilityFilter",
          label: "访问权限筛选",
          value: access,
          options: [
            ["all", "全部"],
            ["private", "私有"],
            ["shared", "链接分享"],
          ],
        })
      : ""
  }${selectMarkup({
    id: "sort",
    label: "排序",
    value: sort,
    options: [
      ["updated", "最近更新"],
      ["title", "按标题"],
    ],
  })}</div><div id="deckGrid" class="deck-grid"></div></main>`;
  const sidebar = app.querySelector(".sidebar");
  if (sidebar) {
    const template = document.createElement("template");
    template.innerHTML = markup;
    app
      .querySelector("main")
      .replaceWith(template.content.querySelector("main"));
    sidebar.querySelectorAll("[data-filter]").forEach((button) => {
      button.classList.toggle("active", button.dataset.filter === filter);
      button.querySelector("small").textContent = n[button.dataset.filter];
    });
    const account = sidebar.querySelector("#accountSettings");
    account.classList.remove("active");
    account.removeAttribute("aria-current");
  } else app.innerHTML = markup;
  enhanceSelects(app);
  app.querySelectorAll("[data-filter]").forEach(
    (b) =>
      (b.onclick = () => {
        filter = b.dataset.filter;
        query = "";
        shell();
      }),
  );
  document.querySelector("#search").oninput = (e) => {
    query = e.target.value;
    renderCards();
  };
  document.querySelector("#sort").onchange = (e) => {
    sort = e.target.value;
    renderCards();
  };
  document
    .querySelector("#visibilityFilter")
    ?.addEventListener("change", (e) => {
      access = e.target.value;
      renderCards();
    });
  document.querySelector("#newBtn").onclick = () =>
    filter === "templates" ? createTemplateDialog() : createDialog();
  document.querySelector("#importBtn").onclick = () =>
    document.querySelector("#importFile").click();
  document.querySelector("#logout").onclick = async () => {
    await api("/logout", { method: "POST" });
    setSession({});
    sessionStorage.removeItem("libraryView");
    location.href = "/";
  };
  document.querySelector("#accountSettings").onclick = () =>
    openSettings().catch((e) => toast(e.message));
  renderCards();
}
function cardMarkup(d) {
  const template = d.kind === "template",
    type = template ? "模板" : "文稿";
  const present = `/present/${d.slug}`,
    edit = `/edit/${d.slug}`;
  const open = edit;
  const menu = d.deletedAt
    ? `<button data-action="restore" data-id="${d.id}">${icon("rotateCcw")}恢复</button>`
    : `<button data-action="settings" data-id="${d.id}">${icon("settings2")}${type}设置</button><button data-action="history" data-id="${d.id}">${icon("clock3")}版本历史</button><button data-action="${template ? "duplicate-template" : "save-template"}" data-id="${d.id}">${icon("copy")}${template ? "复制模板" : "另存为模板"}</button><button data-action="export" data-id="${d.id}">${icon("download")}导出</button><button class="danger" data-action="trash" data-id="${d.id}">${icon("trash2")}移至回收站</button>`;
  const actions = d.deletedAt
    ? `<button class="button subtle" data-action="restore" data-id="${d.id}">${icon("rotateCcw")}恢复${type}</button>`
    : template
      ? `<button class="present-link" data-action="use-template" data-id="${d.id}">${icon("plus")}使用模板</button><div><a href="${edit}" class="icon-button" aria-label="编辑模板 ${esc(d.title)}" title="编辑模板">${icon("pencil")}</a><a href="${present}" target="_blank" rel="noopener" class="icon-button" aria-label="预览模板 ${esc(d.title)}" title="预览">${icon("presentation")}</a></div>`
      : `<a href="${present}" class="present-link" target="_blank" rel="noopener noreferrer" aria-label="演示 ${esc(d.title)}（新标签页）">${icon("presentation")}演示</a><div><a href="${edit}" class="icon-button" aria-label="编辑 ${esc(d.title)}" title="编辑">${icon("pencil")}</a><button class="icon-button" data-action="share" data-id="${d.id}" aria-label="分享 ${esc(d.title)}" title="权限与分享">${icon("link")}</button></div>`;
  return `<article class="deck-card" data-id="${d.id}">${d.deletedAt ? "" : `<a class="preview-link" href="${open}" aria-label="${template ? "编辑模板：" : "编辑文稿："}${esc(d.title)}"></a>`}<div class="deck-preview">${d.deletedAt ? `<div class="archived-cover">${icon(template ? "overview" : "presentation")}<h2>${esc(d.title)}</h2></div>` : `<iframe src="/api/decks/${d.id}/thumbnail" title="${esc(d.title)}封面" tabindex="-1" loading="lazy" sandbox="allow-same-origin"></iframe>`}<span class="page-count">${d.slideCount} ${template ? "种版式" : "页"}</span></div><div class="card-info"><div class="card-title-row"><h2 title="${esc(d.title)}">${esc(d.title)}</h2><details class="card-more"><summary aria-label="更多操作">${icon("more")}</summary><div class="card-menu">${menu}</div></details></div><div class="card-meta"><span class="badge ${d.visibility === "shared" ? "shared" : ""}">${icon(template ? "overview" : d.visibility === "shared" ? "link" : "lockKeyhole")}${template ? (d.builtin ? "内置模板" : "自定义模板") : d.visibility === "shared" ? "链接分享" : "私有"}</span><span>${date(d.updatedAt)} 更新</span></div><div class="card-actions">${actions}</div></div></article>`;
}
function renderCards() {
  const list = decks.filter(
    (d) =>
      (filter === "trash"
        ? !!d.deletedAt
        : !d.deletedAt &&
          (filter === "templates"
            ? d.kind === "template"
            : d.kind !== "template" &&
              (access === "all" || d.visibility === access))) &&
      (d.title + " " + d.description)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (sort === "title")
    list.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  document.querySelector("#deckGrid").innerHTML = list.length
    ? list.map(cardMarkup).join("")
    : `<div class="empty-state">${icon(query ? "search" : "folderOpen")}<h2>${query ? "没有找到匹配的内容" : filter === "trash" ? "回收站是空的" : filter === "templates" ? "这里还没有模板" : "这里还没有文稿"}</h2></div>`;
  document.querySelector("#deckGrid").onclick = async (e) => {
    const b = e.target.closest("[data-action]");
    if (!b) return;
    const { action, id } = b.dataset;
    b.closest(".card-more")?.removeAttribute("open");
    b.disabled = true;
    try {
      if (action === "share") await shareDialog(id);
      if (action === "settings") await deckSettingsDialog(id, refresh);
      if (action === "history") await versionHistoryDialog(id, refresh);
      if (action === "use-template") await createDialog(id);
      if (action === "save-template" || action === "duplicate-template")
        await cloneTemplateDialog(id);
      if (action === "trash") {
        await api("/decks/" + id, { method: "DELETE" });
        await refresh();
        toast("已移至回收站");
      }
      if (action === "restore") {
        await api("/decks/" + id + "/restore", { method: "POST" });
        await refresh();
        toast("已恢复");
      }
      if (action === "export")
        exportDialog(decks.find((deck) => deck.id === id));
    } catch (error) {
      toast(error.message);
    } finally {
      b.disabled = false;
    }
  };
}
export async function versionHistoryDialog(id, onRestored = () => {}) {
  let deck = await api("/decks/" + id),
    history = (await api(`/decks/${id}/revisions`)).revisions,
    selected = history[0],
    previewPage = 1,
    previewSlides = [],
    requestId = 0;
  const formatDate = (value) =>
    new Intl.DateTimeFormat("zh-CN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  showDialog(
    "版本历史",
    `<div class="version-history"><div class="revision-list" role="list"></div><section class="revision-preview"><header class="revision-preview-heading"><div><b id="revisionVersion"></b><small id="revisionDate"></small></div><a id="presentRevision" class="button" target="_blank" rel="noopener">${icon("presentation")}演示此版本</a></header><div class="revision-preview-stage" aria-busy="true"><iframe title="历史版本预览" sandbox="allow-same-origin"></iframe><div class="revision-preview-loading">正在准备预览…</div></div><footer class="revision-preview-footer"><div class="revision-page-controls"><button type="button" class="icon-button" id="revisionPrevious" aria-label="上一页">${icon("prev")}</button><span id="revisionPage"></span><button type="button" class="icon-button" id="revisionNext" aria-label="下一页">${icon("next")}</button></div><span class="revision-current" id="revisionCurrent">正在使用</span><button type="button" class="button primary" id="restoreRevision">${icon("rotateCcw")}恢复此版本</button></footer></section></div>`,
    { wide: true, className: "version-dialog" },
  );
  const list = modal.querySelector(".revision-list"),
    frame = modal.querySelector(".revision-preview iframe"),
    stage = modal.querySelector(".revision-preview-stage"),
    restoreButton = modal.querySelector("#restoreRevision"),
    currentLabel = modal.querySelector("#revisionCurrent"),
    previousButton = modal.querySelector("#revisionPrevious"),
    nextButton = modal.querySelector("#revisionNext"),
    pageLabel = modal.querySelector("#revisionPage");
  const renderList = () => {
    list.innerHTML = history
      .map(
        (item, index) =>
          `<button type="button" class="revision-item ${item.id === selected?.id ? "active" : ""}" data-revision="${item.id}" role="listitem"><span><b>${item.current ? "当前版本" : `版本 ${item.version}`}</b><small>${formatDate(item.createdAt)}</small></span>${item.current ? "<em>当前</em>" : index === history.length - 1 ? "<em>最早</em>" : ""}</button>`,
      )
      .join("");
  };
  const showPreviewPage = (page) => {
    previewPage = Math.max(1, Math.min(previewSlides.length || 1, page));
    previewSlides.forEach((slide, index) => {
      slide.style.setProperty(
        "display",
        index === previewPage - 1 ? "block" : "none",
        "important",
      );
      slide.setAttribute("aria-hidden", String(index !== previewPage - 1));
    });
    pageLabel.textContent = `${previewPage} / ${previewSlides.length || 1}`;
    previousButton.disabled = previewPage <= 1;
    nextButton.disabled = previewPage >= previewSlides.length;
  };
  const selectRevision = async (revisionId) => {
    selected = history.find((item) => item.id === revisionId) || history[0];
    renderList();
    list
      .querySelectorAll("[data-revision]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            selectRevision(button.dataset.revision).catch((error) =>
              toast(error.message),
            )),
      );
    modal.querySelector("#revisionVersion").textContent = selected.current
      ? "当前版本"
      : `版本 ${selected.version}`;
    modal.querySelector("#revisionDate").textContent = formatDate(
      selected.createdAt,
    );
    modal.querySelector("#presentRevision").href =
      `/present/${encodeURIComponent(deck.slug)}?revision=${encodeURIComponent(selected.id)}#1`;
    currentLabel.hidden = !selected.current;
    restoreButton.hidden = selected.current;
    previewSlides = [];
    previewPage = 1;
    showPreviewPage(1);
    stage.setAttribute("aria-busy", "true");
    const activeRequest = ++requestId;
    const content = await api(`/decks/${id}/revisions/${selected.id}`);
    if (!modal.open || activeRequest !== requestId) return;
    frame.onload = () => {
      if (activeRequest !== requestId) return;
      previewSlides = [
        ...frame.contentDocument.querySelectorAll("#deck > .slide"),
      ];
      showPreviewPage(1);
      stage.setAttribute("aria-busy", "false");
    };
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><base href="/api/decks/${id}/files/"><style>${content.css}</style><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#e9eeeb}#deck{position:absolute;left:50%;top:50%;width:${deck.width}px;height:${deck.height}px;transform-origin:center;transform:translate(-50%,-50%) scale(min(calc(100vw / ${deck.width}),calc(100vh / ${deck.height})))}#deck>.slide{display:none!important;position:absolute!important;inset:0!important}</style></head><body><div id="deck">${content.html}</div></body></html>`;
  };
  previousButton.onclick = () => showPreviewPage(previewPage - 1);
  nextButton.onclick = () => showPreviewPage(previewPage + 1);
  restoreButton.onclick = async () => {
    restoreButton.disabled = true;
    try {
      deck = await api(`/decks/${id}/revisions/${selected.id}/restore`, {
        method: "POST",
        body: { version: deck.version },
      });
      await onRestored(deck);
      history = (await api(`/decks/${id}/revisions`)).revisions;
      selected = history[0];
      toast("历史版本已恢复，并保留了恢复前的版本");
      await selectRevision(selected.id);
    } catch (error) {
      toast(error.message);
    } finally {
      restoreButton.disabled = false;
    }
  };
  await selectRevision(selected.id);
}
export function exportDialog(deck, { prepare = async () => deck } = {}) {
  showDialog(
    "导出文稿",
    `<fieldset class="export-options"><legend class="sr-only">文件格式</legend>${[
      [
        "zip",
        "fileCode2",
        "ZIP 内容包",
        "保留内容与素材，可重新导入并继续编辑",
      ],
      ["pdf", "notes", "PDF 文档", "便于阅读、打印和发送"],
      [
        "pptx",
        "presentation",
        "PowerPoint",
        "保留版式与备注，页面以高清图片保存（.pptx）",
      ],
    ]
      .map(
        ([value, glyph, label, description]) =>
          `<label><input type="radio" name="format" value="${value}" ${value === "zip" ? "checked" : ""}><span>${icon(glyph)}<span><b>${label}</b><small>${description}</small></span>${icon("check")}</span></label>`,
      )
      .join("")}</fieldset>`,
    {
      submit: "导出",
      onSubmit: async (form) => {
        const format = form.get("format"),
          button = modal.querySelector('[type="submit"]');
        modal.setAttribute("aria-busy", "true");
        button.innerHTML = icon("loaderCircle", "spin") + "正在生成";
        try {
          const current = await prepare();
          const blob = await api(
            `/decks/${current.id}/export?format=${format}`,
            {
              responseType: "blob",
            },
          );
          downloadFile(blob, current.title + "." + format);
          modal.removeAttribute("aria-busy");
          closeDialog();
          toast("文件已导出");
        } finally {
          modal.removeAttribute("aria-busy");
          button.textContent = "导出";
        }
      },
    },
  );
}
async function cloneTemplateDialog(id) {
  const source = decks.find((d) => d.id === id);
  showDialog(
    source.kind === "template" ? "复制模板" : "另存为模板",
    `<label>名称<input name="title" value="${esc(source.title + (source.kind === "template" ? " 副本" : " 模板"))}" required maxlength="120"></label>`,
    {
      submit: "创建模板",
      onSubmit: async (f) => {
        const d = await api("/decks/" + id + "/clone", {
          method: "POST",
          body: { kind: "template", title: f.get("title") },
        });
        sessionStorage.setItem("librarySection", "templates");
        location.href = "/edit/" + d.slug;
      },
    },
  );
}
async function createTemplateDialog() {
  showDialog(
    "新建模板",
    `<label>名称<input name="title" placeholder="模板名称" required maxlength="120" autofocus></label>`,
    {
      submit: "创建模板",
      onSubmit: async (f) => {
        const { templateContent } = await import("./templates/catalog.js");
        const d = await api("/decks", {
          method: "POST",
          body: {
            title: f.get("title"),
            kind: "template",
            ...templateContent("blank", f.get("title")),
          },
        });
        location.href = "/edit/" + d.slug;
      },
    },
  );
}
async function refresh() {
  decks = (await api("/decks")).decks;
  shell();
}
async function createDialog(selected = "") {
  const options = decks.filter((d) => d.kind === "template" && !d.deletedAt);
  const { templates, templatePreview, templateContent } = await import(
    "./templates/catalog.js"
  );
  const option = (id, title, preview, pages) =>
    `<label class="template-option"><input type="radio" name="templateId" value="${id}" ${id === selected ? "checked" : ""}><span class="template-choice">${preview}<span class="template-caption"><strong>${esc(title)}</strong><small>${pages} 页</small></span></span></label>`;
  showDialog(
    "新建文稿",
    `<fieldset class="template-picker"><legend>选择模板</legend><div class="template-grid">${option("", "空白演示", templatePreview(templates[0]), 1)}${options.map((d) => option(d.id, d.title, `<span class="template-preview template-live-preview"><iframe loading="lazy" src="/api/decks/${d.id}/thumbnail" title="${esc(d.title)}预览" tabindex="-1" sandbox="allow-same-origin"></iframe></span>`, d.slideCount)).join("")}</div></fieldset><div class="create-deck-fields"><label>名称<input name="title" required maxlength="120" placeholder="为这份文稿起个名字" autofocus></label><label>URL 名称（可选）<input name="slug" placeholder="例如：team-update" maxlength="80" pattern="[a-zA-Z0-9][a-zA-Z0-9_-]*"></label></div><label>简介<textarea name="description" rows="2" maxlength="1000" placeholder="可选"></textarea></label>`,
    {
      submit: "创建文稿",
      className: "create-deck-dialog",
      onSubmit: async (form) => {
        const { templateId, ...metadata } = Object.fromEntries(form);
        const body = templateId
          ? { ...metadata, templateId }
          : { ...metadata, ...templateContent("blank", metadata.title) };
        const d = await api("/decks", { method: "POST", body });
        sessionStorage.setItem("librarySection", "all");
        location.href = "/edit/" + d.slug;
      },
    },
  );
}
export async function shareDialog(id, onUpdated = null) {
  let d = await api("/decks/" + id),
    links = (await api("/decks/" + id + "/shares")).shares;
  const shareItems = links
    .map((s) => {
      const expired = Boolean(s.expiresAt && s.expiresAt <= Date.now()),
        active = !s.revokedAt && !expired && d.visibility === "shared",
        status = s.revokedAt
          ? "已撤销"
          : expired || d.visibility !== "shared"
            ? "已失效"
            : "有效",
        expiry = s.expiresAt ? `${date(s.expiresAt)}到期` : "长期有效";
      return `<article class="share-item${active ? " is-active" : " is-inactive"}"><div class="share-item-main"><div class="share-item-title"><b>${esc(s.label)}</b><span class="share-status${active ? " active" : ""}">${status}</span></div><p class="share-path">/s/${esc(s.slug)}/…</p><div class="share-tags"><span>${icon("clock3")}${expiry}</span>${s.allowNotes ? `<span>${icon("notes")}含备注</span>` : ""}${s.allowDownload ? `<span>${icon("download")}可下载</span>` : ""}</div><div class="share-metrics"><span>${icon("eye")}<strong>${s.viewCount || 0}</strong> 次访问</span><span>${icon("download")}<strong>${s.downloadCount || 0}</strong> 次下载</span>${s.lastViewedAt ? `<span>${icon("clock3")}最近访问 ${date(s.lastViewedAt)}</span>` : ""}</div></div><div class="share-item-actions">${active ? `<button class="icon-button" type="button" data-copy="${s.token}" data-path="${esc(s.path)}" aria-label="复制链接" title="复制链接">${icon("copy")}</button><button class="icon-button" type="button" data-rename-share="${s.id}" aria-label="修改分享链接" title="修改设置">${icon("pencil")}</button><button class="icon-button danger" type="button" data-revoke="${s.id}" aria-label="撤销链接" title="撤销链接">${icon("x")}</button>` : ""}</div></article>`;
    })
    .join("");
  showDialog(
    "权限与分享",
    `<div class="share-deck"><img src="${esc(d.favicon || site.favicon || defaultIcon)}" alt=""><strong>${esc(d.title)}</strong></div><label>访问权限${selectMarkup(
      {
        id: "visibility",
        label: "访问权限",
        value: d.visibility,
        options: [
          ["private", "私有 · 仅管理员可见"],
          ["shared", "链接分享 · 持有有效链接者可见"],
        ],
      },
    )}</label>${
      d.visibility === "private"
        ? ""
        : `<div class="new-link"><div class="two-fields"><label>链接名称<input id="linkLabel" maxlength="100" placeholder="例如：团队分享"></label><label>有效期${selectMarkup(
            {
              id: "expiry",
              label: "有效期",
              value: "7",
              options: [
                ["7", "7 天"],
                ["1", "1 天"],
                ["30", "30 天"],
                ["", "长期有效"],
              ],
            },
          )}</label></div><label>分享地址<div class="slug-prefix"><span>/s/</span><input id="shareSlug" autocapitalize="none" spellcheck="false" autocomplete="off" value="${esc(d.slug)}" maxlength="80" required></div></label><div class="share-permissions"><label class="checkbox"><input id="allowNotes" type="checkbox">允许查看备注与参考资料</label><label class="checkbox"><input id="allowDownload" type="checkbox">允许下载 PDF</label></div><button type="button" id="generateLink" class="button primary">${icon("plus")}生成分享链接</button></div>`
    }<section class="share-list-section"><div class="share-list-head"><div><h3>分享链接</h3><p>管理链接权限与访问情况</p></div>${links.length ? `<span>${links.length} 个</span>` : ""}</div><div class="share-list">${shareItems || `<div class="share-empty">${icon("link")}<p>还没有分享链接</p><span>生成后可在这里复制、修改或撤销</span></div>`}</div></section>`,
    { className: "share-dialog" },
  );
  modal.querySelector("#visibility").onchange = async (e) => {
    try {
      d = await api("/decks/" + id, {
        method: "PATCH",
        body: { visibility: e.target.value, version: d.version },
      });
      await shareDialog(id, onUpdated);
      if (onUpdated) onUpdated(d);
      else {
        decks = (await api("/decks")).decks;
        shell();
      }
      toast(
        d.visibility === "private"
          ? "已设为私有，旧链接已撤销"
          : "已启用链接分享",
      );
    } catch (error) {
      toast(error.message);
    }
  };
  modal.querySelector("#generateLink")?.addEventListener("click", async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      const days = modal.querySelector("#expiry").value;
      const s = await api("/decks/" + id + "/shares", {
        method: "POST",
        body: {
          label: modal.querySelector("#linkLabel").value || "分享链接",
          days: days ? Number(days) : null,
          slug: modal.querySelector("#shareSlug").value,
          allowNotes: modal.querySelector("#allowNotes").checked,
          allowDownload: modal.querySelector("#allowDownload").checked,
        },
      });
      await shareDialog(id, onUpdated);
      toast("分享链接已生成");
      const item = modal.querySelector(`[data-copy="${s.token}"]`);
      item?.focus();
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });
  modal
    .querySelectorAll("[data-copy]")
    .forEach((b) => (b.onclick = () => copy(location.origin + b.dataset.path)));
  modal.querySelectorAll("[data-rename-share]").forEach(
    (b) =>
      (b.onclick = () => {
        const link = links.find((s) => s.id === b.dataset.renameShare);
        showDialog(
          "分享链接设置",
          `<label>URL 名称<div class="slug-prefix"><span>/s/</span><input name="slug" autocapitalize="none" spellcheck="false" autocomplete="off" value="${esc(link.slug)}" maxlength="80" required></div></label><div class="share-permissions"><label class="checkbox"><input name="allowNotes" type="checkbox" ${link.allowNotes ? "checked" : ""}>允许查看备注</label><label class="checkbox"><input name="allowDownload" type="checkbox" ${link.allowDownload ? "checked" : ""}>允许下载 PDF</label></div>`,
          {
            onSubmit: async (f) => {
              await api("/decks/" + id + "/shares/" + link.id, {
                method: "PATCH",
                body: {
                  slug: f.get("slug"),
                  allowNotes: f.has("allowNotes"),
                  allowDownload: f.has("allowDownload"),
                },
              });
              await shareDialog(id, onUpdated);
              toast("分享链接设置已更新");
            },
          },
        );
      }),
  );
  modal.querySelectorAll("[data-revoke]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api("/decks/" + id + "/shares/" + b.dataset.revoke, {
            method: "DELETE",
          });
          await shareDialog(id, onUpdated);
          toast("链接已撤销");
        } catch (error) {
          toast(error.message);
        }
      }),
  );
}
export async function copy(value) {
  try {
    await navigator.clipboard.writeText(value);
    toast("已复制");
  } catch {
    showDialog(
      "复制内容",
      `<label><input readonly value="${esc(value)}" id="copyFallback"></label>`,
    );
    modal.querySelector("input").select();
  }
}
export async function deckSettingsDialog(id, onSaved = () => {}) {
  const deck = await api("/decks/" + id);
  let favicon = deck.favicon;
  showDialog(
    deck.kind === "template" ? "模板设置" : "演示稿设置",
    `<div class="icon-setting deck-settings-icon"><img id="deckIconPreview" src="${esc(favicon || site.favicon || defaultIcon)}" alt="演示稿图标"><div><label class="button" for="deckIconFile">${icon("upload")}上传图标</label><input id="deckIconFile" type="file" accept="image/*" hidden><button id="resetDeckIcon" class="button subtle" type="button">使用网站图标</button></div></div><div class="deck-metadata-fields"><label>名称<input name="title" value="${esc(deck.title)}" maxlength="120" required></label><label>作者<input name="author" value="${esc(deck.author)}" maxlength="120"></label><label class="metadata-description">简介<textarea name="description" maxlength="1000" rows="3">${esc(deck.description)}</textarea></label></div><label>URL 名称<div class="slug-prefix"><span>/present/</span><input name="slug" autocapitalize="none" spellcheck="false" autocomplete="off" value="${esc(deck.slug)}" maxlength="80" required></div></label>`,
    {
      onSubmit: async (f) => {
        const d = await api("/decks/" + id, {
          method: "PATCH",
          body: {
            version: deck.version,
            slug: f.get("slug"),
            favicon,
            title: f.get("title"),
            author: f.get("author"),
            description: f.get("description"),
          },
        });
        closeDialog();
        await onSaved(d);
        toast("演示稿设置已保存");
      },
    },
  );
  modal.querySelector("#deckIconFile").onchange = async (e) => {
    try {
      if (e.target.files[0]) favicon = await iconFromFile(e.target.files[0]);
      modal.querySelector("#deckIconPreview").src =
        favicon || site.favicon || defaultIcon;
    } catch (err) {
      toast(err.message);
    }
    e.target.value = "";
  };
  modal.querySelector("#resetDeckIcon").onclick = () => {
    favicon = null;
    modal.querySelector("#deckIconPreview").src = site.favicon || defaultIcon;
  };
}
function downloadFile(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
setupImport({
  onImported: async (d) => {
    filter = d.kind === "template" ? "templates" : "all";
    access = "all";
    query = "";
    await refresh();
  },
  getSection: () => filter,
});
async function render() {
  if (location.pathname.startsWith("/edit/"))
    return openEditor(
      (
        await api(
          "/resolve/" +
            encodeURIComponent(
              decodeURIComponent(location.pathname.split("/")[2]),
            ),
        )
      ).id,
    );
  if (location.pathname === "/settings") {
    history.replaceState(null, "", "/");
    sessionStorage.setItem("libraryView", "settings");
  }
  const settingsSelected = sessionStorage.getItem("libraryView") === "settings";
  await refresh();
  if (settingsSelected) await openSettings();
}
try {
  await loadSite();
  const s = await loadSession();
  if (!s.authenticated) loginView(s);
  else await render();
} catch (error) {
  app.innerHTML = `<div class="boot"><h1>暂时无法打开</h1><p>${esc(error.message)}</p><a href="/">重试</a></div>`;
}
