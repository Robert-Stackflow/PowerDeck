import { icon } from "../icons.js";
import { api, fileBase64, esc } from "../api.js";
import { createCanvas } from "./canvas.js";
import { createThumbnails } from "./thumbnails.js";
import { createEditorMenu } from "./menu.js";
import { shapes } from "./shapes.js";
import {
  numberField,
  enhanceNumbers,
  colorField,
  setColorField,
  createColorPicker,
} from "./controls.js";
import {
  selectMarkup,
  enhanceSelects,
  setSelectValue,
} from "../components/select.js";
import { resizePanels } from "./panels.js";
import { pageReordering } from "./reorder.js";
import { formulaEditor } from "./formula.js";
import { parseSlides } from "./document.js";

const tool = (id, glyph, label) =>
  `<button type="button" class="icon-button" id="${id}" aria-label="${label}" title="${label}">${icon(glyph)}</button>`;
export async function mountVisualEditor({
  root,
  id,
  html,
  css,
  notes,
  meta,
  baseCSS,
  baseURL,
  onChange,
  onDirty,
  onSave,
  onError,
  initialPage = 1,
}) {
  const loadingOverlay = root.querySelector(".editor-loading-overlay");
  root.innerHTML = `<div class="visual-toolbar"><div class="visual-tool-group">${tool("visualUndo", "undo", "撤销")}${tool("visualRedo", "redo", "重做")}</div><div class="visual-tool-group"><button class="button subtle" id="insertPage" aria-haspopup="menu" aria-expanded="false">${icon("plus")}新增页面${icon("down")}</button></div><div class="visual-tool-group"><button class="button subtle" id="insertText">${icon("type")}文字</button><button class="button subtle" id="insertImage">${icon("image")}图片</button><button class="button subtle" id="insertShape" aria-haspopup="dialog" aria-expanded="false">${icon("square")}形状${icon("down")}</button><button class="button subtle" id="insertTable">${icon("table2")}表格</button><button class="button subtle" id="insertChart">${icon("chartNoAxesColumn")}图表</button><button class="button subtle" id="insertMedia">${icon("clapperboard")}音视频</button><button class="button subtle" id="insertFormula">${icon("sigma")}公式</button><button class="button subtle" id="insertLink" disabled>${icon("link")}链接</button></div><div class="visual-toolbar-end">${tool("snapToggle", "magnet", "对齐辅助线（按住 Alt 暂停吸附）")}</div></div><div class="visual-layout"><aside class="slide-rail"><div id="slideList" class="slide-list" aria-label="幻灯片页面"></div></aside><div class="visual-center"><div class="visual-stage"><iframe id="visualCanvas" title="可视化编辑画布" sandbox="allow-same-origin"></iframe></div></div><aside class="visual-inspector"><div class="inspector-tabs" role="tablist" aria-label="页面侧边栏"><button type="button" id="inspectorPageTab" role="tab" data-inspector-tab="page" aria-selected="true" aria-controls="inspectorPagePanel">页面</button><button type="button" id="inspectorNotesTab" role="tab" data-inspector-tab="notes" aria-selected="false" aria-controls="inspectorNotesPanel">标题与备注</button><button type="button" id="inspectorReferencesTab" role="tab" data-inspector-tab="references" aria-selected="false" aria-controls="inspectorReferencesPanel">引用</button></div><section id="inspectorPagePanel" class="inspector-tab-panel inspector-page-panel" data-inspector-panel="page" role="tabpanel" aria-labelledby="inspectorPageTab"><div id="elementInspector"></div></section><section id="inspectorNotesPanel" class="inspector-tab-panel inspector-notes-panel" data-inspector-panel="notes" role="tabpanel" aria-labelledby="inspectorNotesTab" hidden><div class="visual-notes-field"><div class="inspector-field-heading"><label for="visualPageTitle">页面标题</label><button type="button" id="visualPageCount" aria-label="当前页面"></button></div><input id="visualPageTitle" aria-label="页面标题" maxlength="200" placeholder="输入页面标题" spellcheck="false"><label for="visualPageNotes">页面备注</label><textarea id="visualPageNotes" aria-label="页面备注" placeholder="添加当前页的演讲备注…"></textarea></div></section><section id="inspectorReferencesPanel" class="inspector-tab-panel inspector-references-panel" data-inspector-panel="references" role="tabpanel" aria-labelledby="inspectorReferencesTab" hidden><section class="visual-page-refs" id="visualPageRefs" aria-label="当前页引用"><header><h2>当前页引用</h2><div><button type="button" class="button subtle reference-library-button" id="openReferenceLibrary">资料库</button><button type="button" class="icon-button" id="addReference" aria-label="添加引用" title="添加引用">${icon("plus")}</button></div></header><div id="referenceList"></div></section></section></aside></div><input id="visualImageFile" type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/svg+xml" hidden><input id="visualMediaFile" type="file" accept="video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg" hidden><div id="pageInsertPopover" class="editor-popover page-insert-popover" popover="auto" role="menu" aria-label="新增页面"></div><div id="referenceLibraryPopover" class="editor-popover reference-library-popover" popover="auto" role="dialog" aria-label="引用资料库"></div><div id="shapePopover" class="editor-popover shape-popover" popover="auto" role="dialog" aria-label="插入形状"><div class="shape-grid">${shapes.map((shape) => `<button type="button" data-shape="${shape.id}" aria-label="${shape.label}" title="${shape.label}">${icon(shape.icon)}<span>${shape.label}</span></button>`).join("")}</div></div><div id="linkPopover" class="editor-popover link-popover" popover="auto" role="dialog" aria-label="超链接"><form id="editorLinkForm"><div class="link-popover-heading"><h2>超链接</h2>${tool("closeLink", "x", "关闭链接设置")}</div><label>链接地址<input id="editorLinkURL" placeholder="https://" autocomplete="off" spellcheck="false" aria-label="链接地址"></label><p id="editorLinkError" class="form-error" role="alert"></p><div class="link-popover-actions"><button type="button" class="button subtle" id="removeEditorLink">移除链接</button><button type="submit" class="button primary">应用</button></div></form></div>`;
  if (loadingOverlay) root.append(loadingOverlay);
  const $ = (selector) => root.querySelector(selector);
  $("#inspectorPageTab").insertAdjacentHTML(
    "afterend",
    '<button type="button" id="inspectorElementTab" role="tab" data-inspector-tab="element" aria-selected="false" aria-controls="inspectorElementPanel">元素</button>',
  );
  $("#inspectorNotesPanel").insertAdjacentHTML(
    "beforebegin",
    '<section id="inspectorElementPanel" class="inspector-tab-panel inspector-element-panel" data-inspector-panel="element" role="tabpanel" aria-labelledby="inspectorElementTab" hidden></section>',
  );
  $("#inspectorElementPanel").append($("#elementInspector"));
  $("#inspectorPagePanel").insertAdjacentHTML(
    "beforeend",
    `<section class="deck-theme-settings"><header><h2>母版主题</h2><span>应用到全部页面</span></header><div class="theme-presets"><button type="button" data-theme-preset="classic">经典</button><button type="button" data-theme-preset="midnight">深色</button><button type="button" data-theme-preset="warm">暖色</button><button type="button" data-theme-preset="minimal">极简</button></div><label>全局字体${selectMarkup(
      {
        id: "deckThemeFont",
        value: "sans",
        label: "全局字体",
        options: [
          ["sans", "现代无衬线"],
          ["serif", "典雅衬线"],
          ["modern", "简洁现代"],
          ["rounded", "圆体"],
        ],
      },
    )}</label><div class="theme-color-fields"><label>强调色<input id="deckThemeAccent" type="color" value="#276455"></label><label>文字色<input id="deckThemeText" type="color" value="#243d36"></label><label>背景色<input id="deckThemeBackground" type="color" value="#ffffff"></label></div><button type="button" class="button primary" id="applyDeckTheme">应用主题</button></section><section class="page-transition-settings"><h2>页面切换效果</h2><label>进入方式${selectMarkup(
      {
        id: "pageTransition",
        value: "none",
        label: "页面进入方式",
        options: [
          ["none", "无"],
          ["fade", "淡入"],
          ["slide", "横向滑入"],
          ["zoom", "轻微缩放"],
        ],
      },
    )}</label></section><section class="layer-panel"><header><h2>图层</h2><span id="layerCount">0</span></header><div id="layerList"></div><footer><button type="button" class="icon-button" data-layer-action="front" title="置于顶层">${icon("arrowUp")}</button><button type="button" class="icon-button" data-layer-action="up" title="上移一层">${icon("chevronUp")}</button><button type="button" class="icon-button" data-layer-action="down" title="下移一层">${icon("chevronDown")}</button><button type="button" class="icon-button" data-layer-action="back" title="置于底层">${icon("arrowDown")}</button></footer></section>`,
  );
  enhanceSelects($("#inspectorPagePanel"));
  let canvas,
    active = 0,
    selectedInfo = null,
    loading = false,
    referenceLibrary = [];
  function loadReferenceLibrary(source = {}) {
    const entries = [
      ...(Array.isArray(source.references) ? source.references : []),
      ...(Array.isArray(source[1]?.referenceLibrary)
        ? source[1].referenceLibrary
        : []),
      ...Object.values(source)
        .filter((value) => value && typeof value === "object")
        .flatMap((value) => (Array.isArray(value.refs) ? value.refs : [])),
    ];
    referenceLibrary = entries.filter(
      (entry, index) =>
        Array.isArray(entry) &&
        /^https?:\/\//i.test(entry[1] || "") &&
        entries.findIndex((other) => other?.[1] === entry[1]) === index,
    );
  }
  function notesWithReferenceLibrary(source) {
    const result = Object.fromEntries(
      Object.entries(source)
        .filter(([key]) => /^\d+$/.test(key))
        .map(([key, value]) => {
          const note = { ...value };
          delete note.referenceLibrary;
          return [key, note];
        }),
    );
    if (referenceLibrary.length) result[1] = { ...result[1], referenceLibrary };
    return result;
  }
  loadReferenceLibrary(notes);
  const thumbnails = createThumbnails($("#slideList"), {
    css,
    baseCSS,
    baseURL,
    width: meta.width,
    height: meta.height,
  });
  const menu = createEditorMenu(root);
  const colors = createColorPicker(root, onError);
  const panels = resizePanels(root);
  const inspectorTabs = [...root.querySelectorAll("[data-inspector-tab]")],
    inspectorPanels = [...root.querySelectorAll("[data-inspector-panel]")];
  function selectInspectorTab(name, focus = false) {
    inspectorTabs.forEach((tab) => {
      const selected = tab.dataset.inspectorTab === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    inspectorPanels.forEach(
      (panel) => (panel.hidden = panel.dataset.inspectorPanel !== name),
    );
  }
  inspectorTabs.forEach((tab, index) => {
    tab.onclick = () => selectInspectorTab(tab.dataset.inspectorTab);
    tab.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? inspectorTabs.length - 1
            : (index +
                (event.key === "ArrowRight" ? 1 : -1) +
                inspectorTabs.length) %
              inspectorTabs.length;
      selectInspectorTab(inspectorTabs[next].dataset.inspectorTab, true);
    };
  });
  selectInspectorTab("page");
  const formula = formulaEditor(root, {
    onApply: (value) => canvas.setFormula(value),
    onError,
  });
  const reordering = pageReordering($("#slideList"), {
    onStart: dismissPanels,
    onMove: (from, slot) => canvas.movePage(from, slot),
  });
  function referenceRow([label = "", url = ""] = []) {
    const row = document.createElement("div");
    row.className = "reference-row";
    row.innerHTML = `<input class="reference-label" maxlength="300" placeholder="资料名称" aria-label="参考资料名称"><input class="reference-url" type="url" maxlength="2048" placeholder="https://" aria-label="参考资料链接"><button type="button" class="icon-button remove-reference" aria-label="删除参考资料" title="删除参考资料">${icon("trash2")}</button>`;
    row.querySelector(".reference-label").value = label;
    row.querySelector(".reference-url").value = url;
    return row;
  }
  function renderReferences(refs = []) {
    const list = $("#referenceList");
    list.replaceChildren(...refs.map(referenceRow));
    if (!refs.length) {
      const empty = document.createElement("p");
      empty.className = "reference-empty";
      empty.textContent = "暂无参考资料";
      list.append(empty);
    }
  }
  function readReferences(validate = false) {
    const refs = [];
    for (const row of $("#referenceList").querySelectorAll(".reference-row")) {
      const labelInput = row.querySelector(".reference-label"),
        urlInput = row.querySelector(".reference-url"),
        label = labelInput.value.trim(),
        url = urlInput.value.trim();
      urlInput.setCustomValidity("");
      if (!label && !url) continue;
      if (!/^https?:\/\//i.test(url)) {
        urlInput.setCustomValidity("请输入以 http:// 或 https:// 开头的链接");
        if (validate) {
          if (document.activeElement.closest("#visualPageRefs")) return null;
          urlInput.reportValidity();
          throw new Error("参考资料链接需要以 http:// 或 https:// 开头");
        }
        return null;
      }
      refs.push([label || url, url]);
    }
    return refs;
  }
  function syncReferences(validate = false) {
    const refs = readReferences(validate),
      current = canvas.getPage().note.refs || [];
    if (refs === null) return current;
    for (const ref of refs)
      if (!referenceLibrary.some((entry) => entry[1] === ref[1]))
        referenceLibrary.push(ref);
    if (JSON.stringify(refs) !== JSON.stringify(current))
      canvas.updateNote({ refs });
    return refs;
  }
  function renderReferenceLibrary(query = "") {
    const panel = $("#referenceLibraryPopover"),
      needle = query.trim().toLowerCase(),
      entries = referenceLibrary.filter((entry) =>
        entry.join(" ").toLowerCase().includes(needle),
      );
    panel.innerHTML = `<div class="popover-heading"><div><h2>引用资料库</h2><small>${referenceLibrary.length} 条资料，可复用到任意页面</small></div>${tool("closeReferenceLibrary", "x", "关闭资料库")}</div><label class="library-search">${icon("search")}<input id="referenceLibrarySearch" placeholder="搜索名称或链接" value="${esc(query)}"></label><div class="reference-library-list">${entries.length ? entries.map(([label, url]) => `<div class="reference-library-item"><div><b>${esc(label)}</b><small>${esc(url)}</small></div><button type="button" class="button subtle" data-use-library="${encodeURIComponent(url)}">引用</button><button type="button" class="icon-button" data-delete-library="${encodeURIComponent(url)}" aria-label="从资料库移除">${icon("trash2")}</button></div>`).join("") : '<p class="reference-empty">没有匹配的资料</p>'}</div>`;
    panel.querySelector("#closeReferenceLibrary").onclick = dismissPanels;
    panel.querySelector("#referenceLibrarySearch").oninput = (event) => {
      const value = event.target.value;
      renderReferenceLibrary(value);
      panel.querySelector("#referenceLibrarySearch").focus();
    };
  }
  function updateNotes() {
    const page = canvas?.getPage();
    $("#visualPageTitle").value =
      page?.note.title ?? notes[active + 1]?.title ?? "";
    $("#visualPageNotes").value =
      page?.note.notes ?? notes[active + 1]?.notes ?? "";
    renderReferences(page?.note.refs ?? notes[active + 1]?.refs ?? []);
    setSelectValue($("#pageTransition"), page?.transition || "none");
  }
  function renderPages(list, index) {
    active = index;
    $("#visualPageCount").textContent = `${index + 1} / ${list.length}`;
    if (location.pathname.startsWith("/edit/"))
      history.replaceState(
        history.state,
        "",
        location.pathname + location.search + "#" + (index + 1),
      );
    thumbnails.render(list, index);
    if (
      document.activeElement !== $("#visualPageTitle") &&
      document.activeElement !== $("#visualPageNotes") &&
      !document.activeElement.closest("#visualPageRefs")
    )
      updateNotes();
  }
  function dismissPanels() {
    menu.close();
    colors.close();
    for (const panel of root.querySelectorAll(".editor-popover:popover-open"))
      panel.hidePopover();
  }
  function openPopover(panel, anchor) {
    dismissPanels();
    const rect = anchor.getBoundingClientRect();
    panel.style.left = "0px";
    panel.style.top = "0px";
    panel.showPopover();
    const box = panel.getBoundingClientRect();
    panel.style.left =
      Math.max(8, Math.min(rect.left, innerWidth - box.width - 8)) + "px";
    panel.style.top =
      Math.max(8, Math.min(rect.bottom + 7, innerHeight - box.height - 8)) +
      "px";
  }
  function bindPopoverToggle(trigger, panel, beforeOpen) {
    let openAtActivationStart = false;
    const rememberState = () => {
      openAtActivationStart = panel.matches(":popover-open");
    };
    trigger.addEventListener("pointerdown", rememberState);
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") rememberState();
    });
    trigger.addEventListener("click", () => {
      const shouldClose =
        openAtActivationStart || panel.matches(":popover-open");
      openAtActivationStart = false;
      if (shouldClose) {
        if (panel.matches(":popover-open")) panel.hidePopover();
        return;
      }
      beforeOpen?.();
      openPopover(panel, trigger);
    });
    panel.addEventListener("toggle", () =>
      trigger.setAttribute(
        "aria-expanded",
        String(panel.matches(":popover-open")),
      ),
    );
  }
  function renderPageInsertMenu() {
    $("#pageInsertPopover").innerHTML =
      `<button type="button" data-insert-page="blank">${icon("plus")}<span><b>空白页</b><small>在当前页后创建空白页面</small></span></button><button type="button" data-insert-page="duplicate">${icon("copy")}<span><b>复制当前页</b><small>保留当前页面的版式和内容</small></span></button><button type="button" data-insert-page="template">${icon("overview")}<span><b>从模板版式插入</b><small>从已有模板选择一个页面</small></span>${icon("chevronRight")}</button>`;
  }
  async function renderTemplateChoices() {
    const panel = $("#pageInsertPopover");
    panel.innerHTML = `<div class="page-insert-heading"><button type="button" class="icon-button" data-insert-back aria-label="返回">${icon("arrowLeft")}</button><div><b>选择模板</b><small>下一步选择其中的版式</small></div></div><p class="page-insert-loading">正在读取模板…</p>`;
    const templates = (await api("/decks")).decks.filter(
      (deck) => deck.kind === "template" && !deck.deletedAt,
    );
    panel.querySelector(".page-insert-loading").outerHTML = templates.length
      ? `<div class="page-insert-list">${templates.map((deck) => `<button type="button" data-layout-template="${deck.id}"><iframe src="/api/decks/${deck.id}/thumbnail" tabindex="-1" title="" sandbox="allow-same-origin"></iframe><span><b>${esc(deck.title)}</b><small>${deck.slideCount} 种版式</small></span>${icon("chevronRight")}</button>`).join("")}</div>`
      : '<p class="page-insert-empty">还没有可用模板</p>';
  }
  async function renderLayoutChoices(templateId) {
    const panel = $("#pageInsertPopover"),
      template = await api(`/decks/${templateId}`),
      content = await api(`/decks/${templateId}/content`),
      pages = parseSlides(content.html);
    panel.dataset.templateId = templateId;
    panel._templateContent = content;
    panel.innerHTML = `<div class="page-insert-heading"><button type="button" class="icon-button" data-layout-back aria-label="返回模板列表">${icon("arrowLeft")}</button><div><b>${esc(template.title)}</b><small>选择要插入的版式</small></div></div><div class="layout-choice-grid">${pages.map((page, index) => `<button type="button" data-layout-index="${index}"><span class="layout-preview"><iframe src="/api/decks/${templateId}/thumbnail?page=${index + 1}" tabindex="-1" title="" sandbox="allow-same-origin"></iframe></span><b>${esc(content.notes?.[index + 1]?.title || `第 ${index + 1} 页`)}</b></button>`).join("")}</div>`;
  }
  const bytesToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let value = "";
    for (let index = 0; index < bytes.length; index += 32768)
      value += String.fromCharCode(...bytes.subarray(index, index + 32768));
    return btoa(value);
  };
  async function copyTemplateAssets(templateId, pageHTML, templateCSS) {
    const [{ assets: sourceAssets }, { assets: targetAssets }] =
      await Promise.all([
        api(`/decks/${templateId}/assets`),
        api(`/decks/${id}/assets`),
      ]);
    if (!sourceAssets.length) return { html: pageHTML, css: templateCSS };
    const prefix = `assets/template-${templateId.replace(/[^a-zA-Z0-9_-]/g, "-")}/`,
      existing = new Set(targetAssets.map((asset) => asset.path)),
      files = [],
      replacements = [];
    for (const asset of sourceAssets) {
      const relative = asset.path.replace(/^assets\//, ""),
        target = prefix + relative;
      replacements.push([asset.path, target]);
      if (existing.has(target)) continue;
      const response = await fetch(
        `/api/decks/${templateId}/files/${asset.path}`,
      );
      if (!response.ok) throw new Error("模板素材读取失败");
      files.push({
        name: asset.name,
        path: target,
        base64: bytesToBase64(await response.arrayBuffer()),
      });
    }
    for (let index = 0; index < files.length; index += 20)
      await api(`/decks/${id}/assets`, {
        method: "POST",
        body: { files: files.slice(index, index + 20) },
      });
    for (const [from, to] of replacements) {
      pageHTML = pageHTML.replaceAll(from, to);
      templateCSS = templateCSS.replaceAll(from, to);
    }
    return { html: pageHTML, css: templateCSS };
  }
  async function insertTemplateLayout(index) {
    const panel = $("#pageInsertPopover"),
      content = panel._templateContent,
      templateId = panel.dataset.templateId,
      pages = parseSlides(content.html),
      page = pages[index];
    if (!page) throw new Error("模板版式不存在");
    panel.inert = true;
    try {
      const copied = await copyTemplateAssets(
        templateId,
        page.outerHTML,
        content.css || "",
      );
      if (
        canvas.insertPage({
          ...copied,
          note: content.notes?.[index + 1],
        })
      ) {
        thumbnails.load(canvas.getContent({ preserveEditing: true }).css);
        dismissPanels();
      }
    } finally {
      panel.inert = false;
    }
  }
  function openLink() {
    if (!selectedInfo) return;
    canvas.finishEdit();
    $("#editorLinkURL").value = selectedInfo.href || "";
    $("#editorLinkError").textContent = "";
    $("#removeEditorLink").hidden = !selectedInfo.href;
    openPopover($("#linkPopover"), $("#insertLink"));
    $("#editorLinkURL").focus();
  }
  function pageMenuItems() {
    const { current, count } = canvas.getPage();
    return [
      {
        id: "add",
        label: "新增页面",
        icon: "plus",
        disabled: count >= 200,
        children: [
          {
            id: "blank",
            label: "空白页",
            icon: "plus",
            action: () => canvas.pageAction("add"),
          },
          {
            id: "template",
            label: "从模板版式插入",
            icon: "overview",
            action: async () => {
              try {
                await renderTemplateChoices();
                openPopover($("#pageInsertPopover"), $("#insertPage"));
              } catch (error) {
                onError(error);
              }
            },
          },
        ],
      },
      {
        id: "duplicate",
        label: "复制页面",
        icon: "copy",
        disabled: count >= 200,
        action: () => canvas.pageAction("duplicate"),
      },
      { separator: true },
      {
        id: "up",
        label: "上移页面",
        icon: "arrowUp",
        disabled: current === 0,
        action: () => canvas.pageAction("up"),
      },
      {
        id: "down",
        label: "下移页面",
        icon: "arrowDown",
        disabled: current === count - 1,
        action: () => canvas.pageAction("down"),
      },
      { separator: true },
      {
        id: "delete",
        label: "删除页面",
        icon: "trash2",
        danger: true,
        disabled: count === 1,
        action: () => canvas.pageAction("delete"),
      },
    ];
  }
  function renderLayers(layers = []) {
    $("#layerCount").textContent = layers.length;
    $("#layerList").innerHTML = [...layers]
      .reverse()
      .map(
        (layer) =>
          `<button type="button" class="layer-row ${layer.selected ? "selected" : ""}" data-layer-index="${layer.index}" title="${esc(layer.label)}">${icon(layer.locked ? "lockKeyhole" : layer.type === "image" || layer.type === "img" ? "image" : layer.type === "shape" || layer.type === "group" ? "square" : "type")}<span>${esc(layer.label)}</span></button>`,
      )
      .join("");
  }
  function showCanvasMenu({ x, y, info, focus }) {
    dismissPanels();
    const items = info
      ? [
          ...(info.canEdit || info.formula
            ? [
                {
                  id: "edit-text",
                  label: info.formula ? "编辑公式" : "编辑文字",
                  icon: "pencil",
                  action: () => canvas.startEdit(),
                },
              ]
            : []),
          {
            id: "element-link",
            label: info.href ? "编辑链接" : "添加链接",
            icon: "link",
            action: openLink,
          },
          { separator: true },
          {
            id: "duplicate-element",
            label: "复制元素",
            icon: "copy",
            action: () => canvas.duplicateSelection(),
          },
          {
            id: "delete-element",
            label: "删除元素",
            icon: "trash2",
            danger: true,
            action: () => canvas.deleteSelection(),
          },
          ...(info.canParent
            ? [
                {
                  id: "parent",
                  label: "选择父组件",
                  icon: "cornerUpLeft",
                  action: () => canvas.selectParent(),
                },
              ]
            : []),
        ]
      : [
          {
            id: "insert-text",
            label: "插入文字",
            icon: "type",
            action: () => canvas.insert("text"),
          },
          {
            id: "insert-shape",
            label: "插入形状",
            icon: "square",
            action: () => openPopover($("#shapePopover"), $("#insertShape")),
          },
          {
            id: "insert-image",
            label: "插入图片",
            icon: "image",
            action: () => $("#visualImageFile").click(),
          },
          { separator: true },
          ...pageMenuItems(),
        ];
    menu.open({ x, y, items, focus });
  }
  function renderInspector(info) {
    selectedInfo = info;
    $("#insertLink").disabled = !info || info.multi;
    const container = $("#elementInspector");
    if (info) selectInspectorTab("element");
    if (!info) {
      colors.close();
      container.innerHTML = `<div class="inspector-empty">${icon("pointer")}<span>选择画布中的元素</span></div>`;
      return;
    }
    if (info.multi) {
      colors.close();
      container.innerHTML = `<div class="visual-panel-head"><h2>${esc(info.type)}</h2></div><div class="multi-selection-panel"><p>按住 Shift 可继续选择或取消选择图层。</p><section class="property-section"><h3>对齐所选图层</h3><div class="alignment-actions">${tool("alignSelectionLeft", "alignLeft", "左对齐")}${tool("alignSelectionCenter", "alignCenter", "水平居中")}${tool("alignSelectionRight", "alignRight", "右对齐")}${tool("alignSelectionTop", "arrowUp", "顶部对齐")}${tool("alignSelectionMiddle", "minus", "垂直居中")}${tool("alignSelectionBottom", "arrowDown", "底部对齐")}</div></section><div class="element-actions stacked"><button type="button" class="button" id="groupElements">${icon("group")}组合</button><button type="button" class="button" id="lockElement">${icon(info.locked ? "unlock" : "lockKeyhole")}${info.locked ? "解锁" : "锁定"}</button><button type="button" class="button" id="duplicateElement">${icon("copy")}复制所选</button><button type="button" class="icon-button danger" id="deleteElement" aria-label="删除所选">${icon("trash2")}</button></div></div>`;
      for (const [id, alignment] of [
        ["alignSelectionLeft", "left"],
        ["alignSelectionCenter", "center"],
        ["alignSelectionRight", "right"],
        ["alignSelectionTop", "top"],
        ["alignSelectionMiddle", "middle"],
        ["alignSelectionBottom", "bottom"],
      ])
        $("#" + id).onclick = () => canvas.alignSelection(alignment);
      $("#duplicateElement").onclick = () => canvas.duplicateSelection();
      $("#deleteElement").onclick = () => canvas.deleteSelection();
      $("#groupElements").onclick = () => canvas.groupSelection();
      $("#lockElement").onclick = () => canvas.toggleLock();
      return;
    }
    if (!container.querySelector("#elementProperties")) {
      container.innerHTML = `<div class="visual-panel-head"><h2 id="elementType"></h2>${tool("selectParent", "cornerUpLeft", "选择父组件")}</div><form id="elementProperties">
      <section class="property-section"><h3>位置与尺寸</h3><div class="inspector-fields">${numberField("x", "X")}${numberField("y", "Y")}${numberField("width", "宽", 16)}${numberField("height", "高", 16)}</div><div class="alignment-actions">${tool("alignSelectionLeft", "alignLeft", "靠左")}${tool("alignSelectionCenter", "alignCenter", "水平居中")}${tool("alignSelectionRight", "alignRight", "靠右")}${tool("alignSelectionTop", "arrowUp", "靠上")}${tool("alignSelectionMiddle", "minus", "垂直居中")}${tool("alignSelectionBottom", "arrowDown", "靠下")}</div></section>
      <section class="property-section"><h3>填充</h3>${colorField("backgroundColor", "填充颜色")}</section>
      <section class="property-section"><h3>边框</h3>${colorField("borderColor", "边框颜色")}<div class="inspector-fields border-options">${numberField("borderWidth", "粗细", 0, 40)}<label>样式${selectMarkup(
        {
          id: "elementBorderStyle",
          name: "borderStyle",
          value: "none",
          label: "边框样式",
          options: [
            ["none", "无边框"],
            ["solid", "实线"],
            ["dashed", "虚线"],
            ["dotted", "点线"],
          ],
        },
      )}</label></div></section>
      <section class="property-section"><h3>文字</h3><div class="inspector-fields text-properties">${numberField("fontSize", "字号", 6, 400)}${colorField("color", "文字颜色")}</div><div class="text-style-actions">${tool("textBold", "bold", "加粗")}${tool("textItalic", "italic", "斜体")}${tool("textUnderline", "underline", "下划线")}${tool("textStrike", "strikethrough", "删除线")}</div><div class="text-style-actions text-align-actions">${tool("textAlignLeft", "alignLeft", "左对齐")}${tool("textAlignCenter", "alignCenter", "居中")}${tool("textAlignRight", "alignRight", "右对齐")}</div><button type="button" class="button" id="editElementText">${icon("pencil")}编辑文字</button></section>
      <section class="property-section"><button type="button" class="button element-link-button" id="editElementLink">${icon("link")}<span>添加链接</span></button><div class="element-actions"><button type="button" class="button" id="lockElement"></button><button type="button" class="button" id="ungroupElement">${icon("ungroup")}取消组合</button><button type="button" class="button" id="duplicateElement">${icon("copy")}复制</button><button type="button" class="icon-button danger" id="deleteElement" aria-label="删除元素" title="删除元素">${icon("trash2")}</button></div></section></form>`;
      enhanceNumbers(container);
      enhanceSelects(container);
      $("#elementProperties").onsubmit = (event) => event.preventDefault();
      $("#elementProperties").onchange = (event) => {
        const input = event.target;
        if (!input.name || !input.checkValidity()) return;
        if (
          input.type === "number" &&
          (input.value === "" || !Number.isFinite(input.valueAsNumber))
        )
          return;
        canvas.updateProperties({
          [input.name]:
            input.type === "number" ? input.valueAsNumber : input.value,
        });
      };
      container.querySelectorAll("[data-color-field]").forEach((button) => {
        button.onclick = () => {
          dismissPanels();
          const name = button.dataset.colorField;
          colors.open(
            button,
            container.querySelector(`[name="${name}"]`).value,
            (value) => canvas.updateProperties({ [name]: value }),
          );
        };
      });
      $("#editElementLink").onclick = openLink;
      $("#selectParent").onclick = () => canvas.selectParent();
      $("#duplicateElement").onclick = () => canvas.duplicateSelection();
      $("#deleteElement").onclick = () => canvas.deleteSelection();
      $("#lockElement").onclick = () => canvas.toggleLock();
      $("#ungroupElement").onclick = () => canvas.ungroupSelection();
      $("#editElementText").onclick = () => canvas.startEdit();
      for (const [id, alignment] of [
        ["alignSelectionLeft", "left"],
        ["alignSelectionCenter", "center"],
        ["alignSelectionRight", "right"],
        ["alignSelectionTop", "top"],
        ["alignSelectionMiddle", "middle"],
        ["alignSelectionBottom", "bottom"],
      ])
        $("#" + id).onclick = () => canvas.alignSelection(alignment);
      $("#textBold").onclick = () =>
        canvas.updateProperties({
          fontWeight: selectedInfo.bold ? "400" : "700",
        });
      $("#textItalic").onclick = () =>
        canvas.updateProperties({
          fontStyle: selectedInfo.italic ? "normal" : "italic",
        });
      for (const [id, field] of [
        ["textUnderline", "underline"],
        ["textStrike", "strike"],
      ])
        $("#" + id).onclick = () => {
          const next = {
            underline: selectedInfo.underline,
            strike: selectedInfo.strike,
          };
          next[field] = !next[field];
          canvas.updateProperties({
            textDecoration:
              [
                next.underline ? "underline" : "",
                next.strike ? "line-through" : "",
              ]
                .filter(Boolean)
                .join(" ") || "none",
          });
        };
      for (const side of ["Left", "Center", "Right"])
        $("#textAlign" + side).onclick = () =>
          canvas.updateProperties({ textAlign: side.toLowerCase() });
    }
    $("#elementType").textContent = info.type;
    $("#editElementText").hidden = !info.canEdit && !info.formula;
    $("#editElementText").innerHTML =
      icon(info.formula ? "sigma" : "pencil") +
      (info.formula ? "编辑公式" : "编辑文字");
    $("#editElementLink span").textContent = info.href
      ? "编辑链接"
      : "添加链接";
    $("#selectParent").disabled = !info.canParent;
    $("#lockElement").innerHTML = info.locked
      ? `${icon("unlock")}解锁`
      : `${icon("lockKeyhole")}锁定`;
    $("#ungroupElement").hidden = !info.group;
    $("#elementProperties")
      .querySelectorAll("input,button")
      .forEach((control) => {
        if (!["lockElement", "selectParent"].includes(control.id))
          control.disabled = info.locked;
      });
    for (const input of container.querySelectorAll('input[type="number"]')) {
      if (input !== document.activeElement) input.value = info[input.name];
    }
    for (const name of ["color", "backgroundColor", "borderColor"])
      setColorField(
        container,
        name,
        name === "backgroundColor" ? info.background : info[name],
      );
    setSelectValue($("#elementBorderStyle"), info.borderStyle);
    for (const [id, key] of [
      ["textBold", "bold"],
      ["textItalic", "italic"],
      ["textUnderline", "underline"],
      ["textStrike", "strike"],
    ])
      $("#" + id).setAttribute("aria-pressed", String(info[key]));
    for (const side of ["Left", "Center", "Right"])
      $("#textAlign" + side).setAttribute(
        "aria-pressed",
        String(info.align === side.toLowerCase()),
      );
  }
  canvas = await createCanvas({
    frame: $("#visualCanvas"),
    html,
    css,
    notes,
    meta,
    baseCSS,
    baseURL,
    onDirty,
    onChange: (content) => {
      content.notes = notesWithReferenceLibrary(content.notes);
      onChange(content);
    },
    onCSSChange: (value) => {
      thumbnails.load(value);
      const content = canvas.getContent({ preserveEditing: true });
      content.css = value;
      content.notes = notesWithReferenceLibrary(content.notes);
      onChange(content);
    },
    onSelect: renderInspector,
    onLayers: renderLayers,
    onPages: renderPages,
    onHistory: (undo, redo) => {
      $("#visualUndo").disabled = !undo;
      $("#visualRedo").disabled = !redo;
    },
    onSave,
    onContextMenu: showCanvasMenu,
    onPointerDown: dismissPanels,
    onLinkRequest: openLink,
    onFormulaRequest: (info) => formula.open(info.tex),
  });
  canvas.go(Math.max(0, Math.trunc(initialPage) - 1));
  updateNotes();
  const themePresets = {
    classic: {
      font: "sans",
      accent: "#276455",
      text: "#243d36",
      background: "#ffffff",
    },
    midnight: {
      font: "modern",
      accent: "#f2b84b",
      text: "#edf3f7",
      background: "#111827",
    },
    warm: {
      font: "serif",
      accent: "#a85132",
      text: "#46352e",
      background: "#fff8ef",
    },
    minimal: {
      font: "modern",
      accent: "#111827",
      text: "#374151",
      background: "#f8fafc",
    },
  };
  function setThemeControls(theme) {
    setSelectValue($("#deckThemeFont"), theme.font);
    $("#deckThemeAccent").value = theme.accent;
    $("#deckThemeText").value = theme.text;
    $("#deckThemeBackground").value = theme.background;
  }
  root.querySelector(".theme-presets").onclick = (event) => {
    const button = event.target.closest("[data-theme-preset]");
    if (!button) return;
    setThemeControls(themePresets[button.dataset.themePreset]);
    root
      .querySelectorAll("[data-theme-preset]")
      .forEach((item) => item.classList.toggle("active", item === button));
  };
  $("#applyDeckTheme").onclick = () => {
    canvas.applyTheme({
      font: $("#deckThemeFont").value,
      accent: $("#deckThemeAccent").value,
      text: $("#deckThemeText").value,
      background: $("#deckThemeBackground").value,
    });
  };
  $("#slideList").onclick = (event) => {
    const button = event.target.closest("[data-page-index]");
    if (button) canvas.go(Number(button.dataset.pageIndex));
  };
  $("#layerList").onclick = (event) => {
    const row = event.target.closest("[data-layer-index]");
    if (row) canvas.selectLayer(Number(row.dataset.layerIndex), event.shiftKey);
  };
  $(".layer-panel footer").onclick = (event) => {
    const button = event.target.closest("[data-layer-action]"),
      selected = [...root.querySelectorAll(".layer-row.selected")].at(-1);
    if (button && selected)
      canvas.reorderLayer(
        Number(selected.dataset.layerIndex),
        button.dataset.layerAction,
      );
  };
  $("#visualUndo").onclick = () => canvas.undo();
  $("#visualRedo").onclick = () => canvas.redo();
  renderPageInsertMenu();
  bindPopoverToggle(
    $("#insertPage"),
    $("#pageInsertPopover"),
    renderPageInsertMenu,
  );
  $("#pageInsertPopover").onclick = async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    try {
      if (button.dataset.insertPage === "blank") {
        canvas.pageAction("add");
        dismissPanels();
      } else if (button.dataset.insertPage === "duplicate") {
        canvas.pageAction("duplicate");
        dismissPanels();
      } else if (button.dataset.insertPage === "template")
        await renderTemplateChoices();
      else if (button.hasAttribute("data-insert-back")) renderPageInsertMenu();
      else if (button.hasAttribute("data-layout-back"))
        await renderTemplateChoices();
      else if (button.dataset.layoutTemplate)
        await renderLayoutChoices(button.dataset.layoutTemplate);
      else if (button.dataset.layoutIndex !== undefined)
        await insertTemplateLayout(Number(button.dataset.layoutIndex));
    } catch (error) {
      onError(error);
    }
  };
  let snapping = true;
  $("#snapToggle").setAttribute("aria-pressed", "true");
  $("#snapToggle").onclick = () => {
    snapping = !snapping;
    canvas.setSnapping(snapping);
    $("#snapToggle").setAttribute("aria-pressed", String(snapping));
  };
  $("#insertFormula").onclick = () => {
    canvas.finishEdit();
    formula.open("", true);
  };
  $("#insertText").onclick = () => canvas.insert("text");
  $("#insertTable").onclick = () => canvas.insert("table");
  $("#insertChart").onclick = () => canvas.insert("chart");
  $("#insertMedia").onclick = () => $("#visualMediaFile").click();
  bindPopoverToggle($("#insertShape"), $("#shapePopover"));
  $("#shapePopover").onclick = (event) => {
    const button = event.target.closest("[data-shape]");
    if (button) {
      dismissPanels();
      canvas.insert("shape", button.dataset.shape);
    }
  };
  $("#insertLink").onclick = openLink;
  $("#closeLink").onclick = dismissPanels;
  $("#editorLinkForm").onsubmit = (event) => {
    event.preventDefault();
    try {
      canvas.setLink($("#editorLinkURL").value);
      dismissPanels();
    } catch (error) {
      $("#editorLinkError").textContent = error.message;
    }
  };
  $("#removeEditorLink").onclick = () => {
    canvas.setLink("");
    dismissPanels();
  };
  $("#slideList").oncontextmenu = (event) => {
    event.preventDefault();
    dismissPanels();
    const button = event.target.closest("[data-page-index]");
    if (button) canvas.go(Number(button.dataset.pageIndex));
    menu.open({
      x: event.clientX,
      y: event.clientY,
      items: pageMenuItems(),
      focus: button || $("#visualCanvas"),
    });
  };
  $("#slideList").addEventListener("scroll", () => menu.close(), {
    passive: true,
  });
  $("#slideList").addEventListener("keydown", (event) => {
    if (
      (event.shiftKey && event.key === "F10") ||
      event.key === "ContextMenu"
    ) {
      const button = event.target.closest("[data-page-index]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      canvas.go(Number(button.dataset.pageIndex));
      const box = button.getBoundingClientRect();
      menu.open({
        x: box.right,
        y: box.top,
        items: pageMenuItems(),
        focus: button,
      });
    }
  });
  $("#insertImage").onclick = () => $("#visualImageFile").click();
  $("#visualImageFile").onchange = async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    $("#insertImage").disabled = true;
    try {
      const name = `image-${crypto.randomUUID().slice(0, 12)}.${file.name.split(".").at(-1).toLowerCase()}`;
      const { assets } = await api(`/decks/${id}/assets`, {
        method: "POST",
        body: { files: [{ ...(await fileBase64(file)), name }] },
      });
      const asset = assets.find((entry) => entry.name === name);
      if (!asset) throw new Error("图片上传失败");
      canvas.insert("image", asset.path);
    } catch (error) {
      onError(error);
    } finally {
      $("#insertImage").disabled = false;
    }
  };
  $("#visualMediaFile").onchange = async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    $("#insertMedia").disabled = true;
    try {
      const extension = file.name.split(".").at(-1).toLowerCase(),
        name = `media-${crypto.randomUUID().slice(0, 12)}.${extension}`,
        { assets } = await api(`/decks/${id}/assets`, {
          method: "POST",
          body: { files: [{ ...(await fileBase64(file)), name }] },
        }),
        asset = assets.find((entry) => entry.name === name);
      if (!asset) throw new Error("媒体上传失败");
      canvas.insert(
        file.type.startsWith("video/") ? "video" : "audio",
        asset.path,
      );
    } catch (error) {
      onError(error);
    } finally {
      $("#insertMedia").disabled = false;
    }
  };
  $("#visualPageTitle").onchange = (event) =>
    canvas.updateNote({ title: event.target.value });
  $("#visualPageNotes").onchange = (event) =>
    canvas.updateNote({ notes: event.target.value });
  $("#pageTransition").onchange = (event) =>
    canvas.updatePage({ transition: event.target.value });
  $("#visualPageTitle").oninput = $("#visualPageNotes").oninput = onDirty;
  $("#addReference").onclick = () => {
    if ($("#referenceList").querySelectorAll(".reference-row").length >= 40)
      return;
    $("#referenceList").querySelector(".reference-empty")?.remove();
    const row = referenceRow();
    $("#referenceList").append(row);
    row.querySelector(".reference-label").focus();
  };
  $("#openReferenceLibrary").onclick = () => {
    renderReferenceLibrary();
    openPopover($("#referenceLibraryPopover"), $("#openReferenceLibrary"));
    $("#referenceLibrarySearch").focus();
  };
  $("#referenceLibraryPopover").onclick = (event) => {
    const useButton = event.target.closest("[data-use-library]"),
      deleteButton = event.target.closest("[data-delete-library]");
    if (useButton) {
      const url = decodeURIComponent(useButton.dataset.useLibrary),
        ref = referenceLibrary.find((entry) => entry[1] === url),
        refs = readReferences() || [];
      if (ref && !refs.some((entry) => entry[1] === url) && refs.length < 40) {
        refs.push(ref);
        renderReferences(refs);
        syncReferences();
      }
      renderReferenceLibrary($("#referenceLibrarySearch")?.value || "");
    }
    if (deleteButton) {
      const url = decodeURIComponent(deleteButton.dataset.deleteLibrary);
      referenceLibrary = referenceLibrary.filter((entry) => entry[1] !== url);
      onDirty();
      renderReferenceLibrary($("#referenceLibrarySearch")?.value || "");
    }
  };
  $("#visualPageRefs").oninput = (event) => {
    if (event.target.matches(".reference-url"))
      event.target.setCustomValidity("");
    if (event.target.matches("input")) onDirty();
  };
  $("#visualPageRefs").onchange = (event) => {
    if (!event.target.matches("input")) return;
    try {
      syncReferences();
    } catch (error) {
      onError(error);
    }
  };
  $("#visualPageRefs").onclick = (event) => {
    const button = event.target.closest(".remove-reference");
    if (!button) return;
    button.closest(".reference-row").remove();
    try {
      syncReferences();
      if (!$("#referenceList").querySelector(".reference-row"))
        renderReferences();
    } catch (error) {
      onError(error);
    }
  };
  const keyboard = (event) => {
    if (
      !root.hidden &&
      !loading &&
      !menu.isOpen &&
      !root.querySelector(":popover-open") &&
      !document.querySelector("dialog[open]")
    )
      canvas.keyboard(event);
  };
  window.addEventListener("keydown", keyboard);
  return {
    getContent: (options) => {
      const page = canvas.getPage();
      const refs = readReferences(true) ?? page.note.refs ?? [];
      if (
        page.note.title !== $("#visualPageTitle").value ||
        page.note.notes !== $("#visualPageNotes").value ||
        JSON.stringify(page.note.refs || []) !== JSON.stringify(refs)
      )
        canvas.updateNote({
          title: $("#visualPageTitle").value,
          notes: $("#visualPageNotes").value,
          refs,
        });
      const content = canvas.getContent(options);
      content.notes = notesWithReferenceLibrary(content.notes);
      return content;
    },
    load: async (value) => {
      loading = true;
      try {
        notes = value.notes;
        loadReferenceLibrary(notes);
        dismissPanels();
        thumbnails.load(value.css);
        await canvas.load(value);
        canvas.setSnapping(snapping);
        updateNotes();
      } finally {
        loading = false;
      }
    },
    isInteracting: () => canvas.isInteracting() || reordering.isDragging(),
    fit: () => canvas.fit(),
    destroy: () => {
      canvas.destroy();
      window.removeEventListener("keydown", keyboard);
      thumbnails.destroy();
      menu.destroy();
      colors.destroy();
      panels.destroy();
      formula.destroy();
      reordering.destroy();
    },
  };
}
