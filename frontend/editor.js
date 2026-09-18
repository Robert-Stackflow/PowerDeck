import { api, esc, fileBase64 } from "./api.js";
import { icon } from "./icons.js";
import { site, setFavicon } from "./branding.js";
import {
  toast,
  copy,
  deckSettingsDialog,
  exportDialog,
  versionHistoryDialog,
  shareDialog,
  showDialog,
  closeDialog,
} from "./app.js";
import { mountVisualEditor } from "./editor/visual.js";
import { createAutosave } from "./editor/autosave.js";
import { loadingMarkup } from "./components/loading.js";
import { localDraft, leaveGuard } from "./editor/drafts.js";
export async function openEditor(id) {
  const requestedPage = Number.parseInt(location.hash.slice(1), 10),
    initialPage =
      Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  document.querySelector("#app").innerHTML = loadingMarkup(true);
  const [deck, content, baseCSS] = await Promise.all([
    api("/decks/" + id),
    api("/decks/" + id + "/content"),
    fetch("/static/player/base.css").then((r) => r.text()),
  ]);
  sessionStorage.setItem(
    "librarySection",
    deck.kind === "template" ? "templates" : "all",
  );
  let current = deck,
    active = "html",
    visual = null,
    mode = "visual",
    visualLoading = false,
    visualContentStale = false;
  const draft = { ...content, notes: JSON.stringify(content.notes, null, 2) };
  document.title = deck.title + " · 编辑";
  setFavicon(deck.favicon || site.favicon);
  document.querySelector("#app").innerHTML =
    `<main class="editor" aria-busy="true"><header class="editor-header"><a class="icon-button" href="/" aria-label="返回演示库">${icon("arrowLeft")}</a><div class="editor-title"><h1>${esc(deck.title)}</h1><button type="button" id="saveState" class="save-indicator" data-state="saved" title="所有更改已保存" aria-label="所有更改已保存">${icon("check")}</button></div><div class="editor-mode-switch" role="tablist" aria-label="编辑模式"><button type="button" role="tab" data-editor-mode="visual" aria-selected="true">可视化</button><button type="button" role="tab" data-editor-mode="source" aria-selected="false">源码</button></div><div class="editor-actions"><button id="deckSettings" class="button editor-settings-button" aria-label="${deck.kind === "template" ? "模板设置" : "演示稿设置"}">${icon("settings2")}</button><button id="deckHistory" class="button editor-settings-button" aria-label="版本历史" title="版本历史">${icon("clock3")}</button><div class="present-split"><a id="presentDeck" class="button present-main" href="/present/${encodeURIComponent(deck.slug)}#${initialPage}" target="_blank" rel="noopener" aria-label="从当前页开始演示">${icon("presentation")}演示</a><button id="presentOptions" class="button present-options" type="button" aria-label="选择演示起始页" aria-haspopup="menu" aria-expanded="false" aria-controls="presentMenu">${icon("chevronDown")}</button><div id="presentMenu" class="editor-context-menu present-menu" popover="auto" role="menu" aria-label="选择演示模式"><p class="present-menu-label">普通演示</p><a href="/present/${encodeURIComponent(deck.slug)}#${initialPage}" target="_blank" rel="noopener" role="menuitem" data-present-from="current" data-present-mode="standard">${icon("play")}<span>从当前页开始</span><small id="presentCurrentPage">第 ${initialPage} 页</small></a><a href="/present/${encodeURIComponent(deck.slug)}#1" target="_blank" rel="noopener" role="menuitem" data-present-from="start" data-present-mode="standard">${icon("presentation")}<span>从头开始</span><small>第 1 页</small></a><div class="editor-menu-divider" role="separator"></div><p class="present-menu-label">演讲者模式</p><a href="/presenter/${encodeURIComponent(deck.slug)}#${initialPage}" target="_blank" rel="noopener" role="menuitem" data-present-from="current" data-present-mode="presenter">${icon("monitor")}<span>从当前页开始</span><small id="presenterCurrentPage">第 ${initialPage} 页</small></a><a href="/presenter/${encodeURIComponent(deck.slug)}#1" target="_blank" rel="noopener" role="menuitem" data-present-from="start" data-present-mode="presenter">${icon("monitor")}<span>从头开始</span><small>第 1 页</small></a></div></div><button id="exportDeck" class="button">${icon("download")}导出</button><button id="saveDeck" class="button primary">${icon("save")}保存</button></div></header><section class="visual-workspace" id="visualWorkspace" aria-label="可视化编辑器"></section><div class="editor-workspace" id="sourceWorkspace" hidden><section class="source-panel"><div class="editor-tabs" role="tablist">${[
      ["html", "页面 HTML"],
      ["css", "样式 CSS"],
      ["notes", "备注 JSON"],
      ["assets", "素材"],
    ]
      .map(
        ([key, label]) =>
          `<button data-tab="${key}" role="tab" aria-selected="${key === "html"}">${label}</button>`,
      )
      .join(
        "",
      )}</div><label for="sourceInput" class="sr-only">编辑页面内容</label><textarea id="sourceInput" class="code-editor" spellcheck="false" autocapitalize="off"></textarea><div id="assetPanel" hidden><div class="asset-toolbar"><button id="uploadAssets" class="button">${icon("upload")}上传素材</button><input id="assetFiles" type="file" multiple accept="image/*,.woff,.woff2,.ttf" hidden></div><div id="assetList"></div></div></section></div></main>`;
  if (deck.kind !== "template") {
    const shareButton = document.createElement("button");
    shareButton.id = "shareDeck";
    shareButton.className = "button editor-share-button";
    shareButton.type = "button";
    shareButton.innerHTML = `${icon("link")}分享`;
    document.querySelector("#exportDeck").before(shareButton);
  }
  const source = document.querySelector("#sourceInput");
  source.value = draft.html;
  const indicator = document.querySelector("#saveState");
  const presentDeck = document.querySelector("#presentDeck"),
    presentOptions = document.querySelector("#presentOptions"),
    presentMenu = document.querySelector("#presentMenu"),
    presentLinks = [...presentMenu.querySelectorAll("[data-present-from]")];
  const currentPage = () => {
    const page = Number.parseInt(location.hash.slice(1), 10);
    return Number.isFinite(page) && page > 0 ? page : 1;
  };
  const presentationURL = (page) =>
    `/present/${encodeURIComponent(current.slug)}#${page}`;
  const presenterURL = (page) =>
    `/presenter/${encodeURIComponent(current.slug)}#${page}`;
  function updatePresentLinks() {
    const page = currentPage();
    presentDeck.href = presentationURL(page);
    for (const link of presentLinks)
      link.href =
        link.dataset.presentMode === "presenter"
          ? presenterURL(link.dataset.presentFrom === "current" ? page : 1)
          : presentationURL(link.dataset.presentFrom === "current" ? page : 1);
    document.querySelector("#presentCurrentPage").textContent = `第 ${page} 页`;
    document.querySelector("#presenterCurrentPage").textContent =
      `第 ${page} 页`;
  }
  function positionPresentMenu() {
    const rect = presentOptions.getBoundingClientRect(),
      width = 208;
    presentMenu.style.width = width + "px";
    presentMenu.style.left =
      Math.max(12, Math.min(rect.right - width, innerWidth - width - 12)) +
      "px";
    presentMenu.style.top = Math.min(rect.bottom + 6, innerHeight - 292) + "px";
  }
  function openPresentMenu() {
    updatePresentLinks();
    positionPresentMenu();
    presentMenu.showPopover();
    presentOptions.setAttribute("aria-expanded", "true");
    presentLinks[0].focus({ preventScroll: true });
  }
  presentDeck.addEventListener("click", updatePresentLinks);
  let presentMenuOpenOnPointerDown = false;
  presentOptions.onpointerdown = () => {
    presentMenuOpenOnPointerDown = presentMenu.matches(":popover-open");
  };
  presentOptions.onclick = () => {
    if (presentMenuOpenOnPointerDown) {
      if (presentMenu.matches(":popover-open")) presentMenu.hidePopover();
      presentOptions.setAttribute("aria-expanded", "false");
    } else openPresentMenu();
    presentMenuOpenOnPointerDown = false;
  };
  presentOptions.onkeydown = (event) => {
    if (["Enter", " "].includes(event.key)) {
      presentMenuOpenOnPointerDown = presentMenu.matches(":popover-open");
      return;
    }
    if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    if (!presentMenu.matches(":popover-open")) openPresentMenu();
    presentLinks[event.key === "ArrowUp" ? presentLinks.length - 1 : 0].focus({
      preventScroll: true,
    });
  };
  presentMenu.addEventListener("toggle", () => {
    presentOptions.setAttribute(
      "aria-expanded",
      String(presentMenu.matches(":popover-open")),
    );
  });
  presentMenu.addEventListener("beforetoggle", (event) => {
    presentOptions.setAttribute(
      "aria-expanded",
      String(event.newState === "open"),
    );
  });
  presentMenu.onclick = (event) => {
    if (!event.target.closest("[data-present-from]")) return;
    presentMenu.hidePopover();
    presentOptions.setAttribute("aria-expanded", "false");
  };
  presentMenu.onkeydown = (event) => {
    const index = presentLinks.indexOf(document.activeElement);
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? presentLinks.length - 1
            : (index +
                (event.key === "ArrowDown" ? 1 : -1) +
                presentLinks.length) %
              presentLinks.length;
      presentLinks[next].focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      presentMenu.hidePopover();
      presentOptions.focus();
    }
  };
  window.addEventListener("resize", () => {
    if (presentMenu.matches(":popover-open")) positionPresentMenu();
  });
  let recovery;
  const saver = createAutosave({
    capture: () => {
      if (mode === "visual") syncVisual({ preserveEditing: true });
      return {
        html: draft.html,
        css: draft.css,
        notes: JSON.parse(draft.notes),
      };
    },
    write: async (payload) => {
      current = await api("/decks/" + id + "/content", {
        method: "PUT",
        body: { ...payload, version: current.version },
      });
    },
    isInteracting: () =>
      mode === "visual" && (visualLoading || visual?.isInteracting()),
    onState: (state, error) => {
      if (state === "saved") recovery?.clear();
      else recovery?.schedule();
      const labels = {
        saved: "所有更改已保存",
        pending: "等待自动保存",
        saving: "正在保存",
        error: "保存失败，点击重试",
      };
      const stateChanged = indicator.dataset.state !== state;
      indicator.dataset.state = state;
      indicator.setAttribute("aria-busy", String(state === "saving"));
      if (stateChanged)
        indicator.innerHTML = icon(
          state === "saved"
            ? "check"
            : state === "error"
              ? "circleAlert"
              : state === "saving"
                ? "loaderCircle"
                : "clock3",
        );
      indicator.title = error
        ? `${labels.error}：${error.message}`
        : labels[state];
      indicator.setAttribute("aria-label", indicator.title);
    },
  });
  recovery = localDraft(
    id,
    () => {
      if (mode === "visual") syncVisual({ preserveEditing: true });
      return {
        version: current.version,
        html: draft.html,
        css: draft.css,
        notes: draft.notes,
      };
    },
    () => saver.dirty,
  );
  const mark = () => saver.mark();
  document.querySelector("#deckSettings").onclick = async () => {
    const button = document.querySelector("#deckSettings");
    button.disabled = true;
    saver.pause(true);
    try {
      if (mode === "visual") syncVisual();
      await saver.flush();
      await deckSettingsDialog(id, (d) => {
        current = d;
        history.replaceState(
          history.state,
          "",
          "/edit/" + d.slug + location.search + location.hash,
        );
        updatePresentLinks();
        document.querySelector(".editor-header h1").textContent = d.title;
        document.title = d.title + " · 编辑";
        setFavicon(d.favicon || site.favicon);
      });
      document
        .querySelector("#dialog")
        .addEventListener("close", () => saver.pause(false), { once: true });
    } catch (error) {
      saver.pause(false);
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  };
  document.querySelector("#deckHistory").onclick = async () => {
    const button = document.querySelector("#deckHistory");
    button.disabled = true;
    saver.pause(true);
    try {
      if (mode === "visual") syncVisual();
      await saver.flush();
      await versionHistoryDialog(id, async (restoredDeck) => {
        current = restoredDeck;
        const restored = await api(`/decks/${id}/content`);
        Object.assign(draft, {
          html: restored.html,
          css: restored.css,
          notes: JSON.stringify(restored.notes, null, 2),
        });
        source.value = draft[active] || "";
        await visual.load(restored);
        visualContentStale = false;
      });
      document
        .querySelector("#dialog")
        .addEventListener("close", () => saver.pause(false), { once: true });
    } catch (error) {
      saver.pause(false);
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  };
  source.oninput = () => {
    draft[active] = source.value;
    visualContentStale = true;
    mark();
  };
  document.querySelectorAll("[data-tab]").forEach(
    (b) =>
      (b.onclick = () => {
        active = b.dataset.tab;
        document
          .querySelectorAll("[data-tab]")
          .forEach((x) => x.setAttribute("aria-selected", String(x === b)));
        source.hidden = active === "assets";
        document.querySelector("#assetPanel").hidden = active !== "assets";
        if (active !== "assets") source.value = draft[active];
        else loadAssets().catch((e) => toast(e.message));
      }),
  );
  leaveGuard({
    dirty: () => saver.dirty,
    save: () => saver.flush(),
    pause: (value) => saver.pause(value),
    discard: () => {
      saver.destroy();
      recovery.discard();
    },
    dialog: (actions) => {
      showDialog(
        "保存修改后离开？",
        `<p class="leave-message">当前修改尚未同步到服务器。</p><div class="leave-actions"><button type="button" class="button subtle" id="discardEdits">放弃并离开</button><button type="button" class="button" id="continueEditing">继续编辑</button><button type="button" class="button primary" id="saveAndLeave">保存并离开</button></div>`,
      );
      const modal = document.querySelector("#dialog");
      let acted = false;
      modal.addEventListener(
        "close",
        () => {
          if (!acted) actions.cancel();
        },
        { once: true },
      );
      document.querySelector("#continueEditing").onclick = closeDialog;
      document.querySelector("#discardEdits").onclick = () => {
        acted = true;
        actions.discard();
      };
      document.querySelector("#saveAndLeave").onclick = async (e) => {
        const button = e.currentTarget;
        button.disabled = true;
        try {
          await actions.save();
          acted = true;
        } catch (error) {
          modal.querySelector("#dialogError").textContent = error.message;
        } finally {
          button.disabled = false;
        }
      };
    },
  });
  async function saveNow() {
    if (visualLoading) return;
    const button = document.querySelector("#saveDeck");
    button.disabled = true;
    try {
      if (mode === "visual") syncVisual({ preserveEditing: true });
      await saver.flush();
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  }
  document.querySelector("#saveDeck").onclick = saveNow;
  indicator.onclick = saveNow;
  document.querySelector("#exportDeck").onclick = () => {
    exportDialog(current, {
      prepare: async () => {
        if (mode === "visual") syncVisual();
        await saver.flush();
        return current;
      },
    });
  };
  document.querySelector("#shareDeck")?.addEventListener("click", async () => {
    const button = document.querySelector("#shareDeck");
    button.disabled = true;
    try {
      if (mode === "visual") syncVisual({ preserveEditing: true });
      await saver.flush();
      await shareDialog(id, (updated) => {
        current = updated;
      });
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });
  async function loadAssets() {
    const { assets } = await api("/decks/" + id + "/assets");
    document.querySelector("#assetList").innerHTML = assets.length
      ? assets
          .map(
            (a) =>
              `<div class="asset-item">${a.type.startsWith("image/") ? `<img src="/api/decks/${id}/files/${a.path.split("/").map(encodeURIComponent).join("/")}" alt="">` : `<span class="font-asset">Aa</span>`}<div><b title="${esc(a.name)}">${esc(a.name)}</b><small>${(a.size / 1024).toFixed(0)} KB</small></div><button class="icon-button" data-asset="${esc(a.path)}" aria-label="复制素材路径" title="复制引用">${icon("copy")}</button></div>`,
          )
          .join("")
      : '<div class="asset-empty">上传图片或字体后即可在页面中引用。</div>';
    document
      .querySelectorAll("[data-asset]")
      .forEach((b) => (b.onclick = () => copy(b.dataset.asset)));
  }
  document.querySelector("#uploadAssets").onclick = () =>
    document.querySelector("#assetFiles").click();
  document.querySelector("#assetFiles").onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    try {
      await api("/decks/" + id + "/assets", {
        method: "POST",
        body: { files: await Promise.all(files.map(fileBase64)) },
      });
      await loadAssets();
      toast("素材已上传");
    } catch (error) {
      toast(error.message);
    }
  };
  function syncVisual(options) {
    if (!visual || visualLoading) return;
    const content = visual.getContent(options);
    draft.html = content.html;
    draft.css = content.css;
    draft.notes = JSON.stringify(content.notes, null, 2);
  }
  const visualWorkspace = document.querySelector("#visualWorkspace"),
    sourceWorkspace = document.querySelector("#sourceWorkspace"),
    modeButtons = [...document.querySelectorAll("[data-editor-mode]")],
    loading = document.createElement("div");
  loading.className = "editor-loading-overlay";
  loading.innerHTML = loadingMarkup(true, { header: false });
  function setVisualLoading(value) {
    visualLoading = value;
    visualWorkspace.inert = value;
    visualWorkspace.setAttribute("aria-busy", String(value));
    document.querySelector(".editor").setAttribute("aria-busy", String(value));
    if (value) visualWorkspace.append(loading);
    else loading.remove();
    modeButtons.forEach((button) => (button.disabled = value));
    document.querySelector("#saveDeck").disabled = value;
    document.querySelector("#exportDeck").disabled = value;
    if (document.querySelector("#shareDeck"))
      document.querySelector("#shareDeck").disabled = value;
    document.querySelector("#deckSettings").disabled = value;
    document.querySelector("#deckHistory").disabled = value;
  }
  function showMode(next) {
    mode = next;
    visualWorkspace.hidden = next !== "visual";
    sourceWorkspace.hidden = next !== "source";
    modeButtons.forEach((button) =>
      button.setAttribute(
        "aria-selected",
        String(button.dataset.editorMode === next),
      ),
    );
  }
  // Give the selected tab and loading overlay a paint before parsing slide HTML.
  const paintLoading = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  async function switchMode(next) {
    if (next === mode || visualLoading) return;
    if (next === "source") {
      syncVisual();
      visualContentStale = false;
      showMode(next);
      if (active !== "assets") source.value = draft[active];
      return;
    }
    if (!visualContentStale) {
      showMode("visual");
      requestAnimationFrame(() => visual.fit());
      return;
    }
    setVisualLoading(true);
    showMode("visual");
    try {
      await paintLoading();
      await visual.load({
        html: draft.html,
        css: draft.css,
        notes: JSON.parse(draft.notes),
      });
      visualContentStale = false;
      visual.fit();
    } catch (error) {
      // Keep the user's source intact and return to it for correction.
      showMode("source");
      toast(error.message);
    } finally {
      setVisualLoading(false);
    }
  }
  modeButtons.forEach((button) => {
    button.onclick = () => switchMode(button.dataset.editorMode);
  });
  setVisualLoading(true);
  await paintLoading();
  visual = await mountVisualEditor({
    root: document.querySelector("#visualWorkspace"),
    id,
    ...draft,
    notes: JSON.parse(draft.notes),
    meta: deck,
    baseCSS,
    baseURL: new URL("/api/decks/" + id + "/files/", location.origin).href,
    onDirty: mark,
    onChange: (content) => {
      draft.html = content.html;
      if (content.css !== undefined) draft.css = content.css;
      draft.notes = JSON.stringify(content.notes, null, 2);
      mark();
    },
    onSave: () => document.querySelector("#saveDeck").click(),
    onError: (error) => toast(error.message),
    initialPage,
  });
  setVisualLoading(false);
  const backup = recovery.read();
  if (
    backup?.html &&
    (backup.html !== content.html ||
      backup.css !== content.css ||
      backup.notes !== JSON.stringify(content.notes, null, 2))
  ) {
    saver.pause(true);
    showDialog(
      "恢复本地草稿？",
      `<p class="leave-message">${backup.version === current.version ? "发现尚未同步的修改。" : "服务器内容已有更新，恢复草稿将替换当前服务器内容。"}</p><div class="leave-actions"><button type="button" class="button" id="skipRecovery">使用服务器内容</button><button type="button" class="button primary" id="restoreDraft">恢复草稿</button></div>`,
    );
    document
      .querySelector("#dialog")
      .addEventListener("close", () => saver.pause(false), { once: true });
    document.querySelector("#skipRecovery").onclick = () => {
      recovery.clear();
      closeDialog();
    };
    document.querySelector("#restoreDraft").onclick = async (e) => {
      e.currentTarget.disabled = true;
      try {
        let notes;
        try {
          notes = JSON.parse(backup.notes);
        } catch {}
        if (!notes) await switchMode("source");
        Object.assign(draft, {
          html: backup.html,
          css: backup.css,
          notes: backup.notes,
        });
        visualContentStale = true;
        if (notes) {
          await visual.load({ ...draft, notes });
          visualContentStale = false;
        } else {
          await switchMode("source");
          active = "notes";
          source.value = draft.notes;
          document.querySelector("[data-tab=notes]").click();
        }
        mark();
        closeDialog();
      } catch (error) {
        document.querySelector("#dialogError").textContent = error.message;
        e.currentTarget.disabled = false;
      }
    };
  } else recovery.clear();
}
