import { parseSlides, visualDocument, cloneWithFreshIds } from "./document.js";
import { shapeMarkup, shapes, safeLink } from "./shapes.js";
import { createGuides } from "./guides.js";
import { wheelNavigation } from "../components/wheel-navigation.js";

const atomic = ".math,[data-tex],.katex,svg,img,video,audio,canvas";
const textTags = "h1,h2,h3,h4,h5,h6,p,li,td,th,figcaption,blockquote";
const round = (n) => Math.round(n * 10) / 10;
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));

export async function createCanvas({
  frame,
  html,
  css,
  notes,
  meta,
  baseCSS,
  baseURL,
  onChange,
  onDirty,
  onSelect,
  onPages,
  onHistory,
  onLayers = () => {},
  onCSSChange = () => {},
  onSave,
  onContextMenu = () => {},
  onPointerDown = () => {},
  onLinkRequest = () => {},
  onFormulaRequest = () => {},
}) {
  let doc,
    win,
    deck,
    selectionBox,
    selected = null,
    selectedNodes = new Set(),
    editing = null,
    drag = null,
    composing = false,
    guides;
  let current = 0,
    scale = 1,
    undoIndex = -1,
    history = [],
    historyBytes = 0,
    activeSlide = null;
  let pageCache = new WeakMap();
  let pageNotes = [],
    observer;
  const slides = () =>
    [...deck.children].filter((node) => node.classList.contains("slide"));
  const slide = () => slides()[current];
  const layerNodes = () =>
    [
      ...slide().querySelectorAll(
        "[data-editor-element],h1,h2,h3,h4,h5,h6,p,blockquote,img,svg,video,audio,canvas,.math,[data-tex]",
      ),
    ].filter((node) => {
      const component = node.parentElement?.closest(
        "[data-editor-element],.math,[data-tex],svg",
      );
      return !component || component === node;
    });
  function layerLabel(node, index) {
    const text = node.textContent?.replace(/\s+/g, " ").trim();
    if (node.matches("img")) return node.alt || `图片 ${index + 1}`;
    if (node.matches("svg")) return `图形 ${index + 1}`;
    if (node.dataset.editorElement === "shape") return `形状 ${index + 1}`;
    return text?.slice(0, 24) || `${node.tagName.toLowerCase()} ${index + 1}`;
  }
  function layersChanged() {
    onLayers(
      layerNodes().map((node, index) => ({
        index,
        label: layerLabel(node, index),
        type: node.dataset.editorElement || node.tagName.toLowerCase(),
        selected: selectedNodes.has(node),
        locked: node.dataset.editorLocked === "true",
      })),
    );
  }
  const getNotes = () =>
    Object.fromEntries(pageNotes.map((note, i) => [i + 1, note]));
  function cachedPage(node) {
    let cached = pageCache.get(node);
    if (!cached) {
      const id =
        node.dataset.slideId ||
        (node.dataset.slideId = "slide-" + crypto.randomUUID().slice(0, 12));
      let content = node;
      // Snapshot a clone while typing; never blur the live node or move its caret.
      if (editing && node.contains(editing.node)) {
        content = node.cloneNode(true);
        const text = content.querySelector("[data-ve-editing]");
        for (const key of ["contenteditable", "spellcheck"])
          editing[key] === null
            ? text.removeAttribute(key)
            : text.setAttribute(key, editing[key]);
        text.removeAttribute("data-ve-editing");
      }
      cached = {
        id,
        html: content.outerHTML
          .replace(/ data-ve-current(?:="")?/g, "")
          .replace(/ data-ve-selected(?:="")?/g, ""),
      };
      pageCache.set(node, cached);
    }
    return cached;
  }
  const serialize = () =>
    slides()
      .map((node) => cachedPage(node).html)
      .join("\n");
  const snapshot = () => ({
    pages: slides().map(cachedPage),
    notes: pageNotes.slice(),
    current,
  });
  function pagesChanged() {
    onPages(
      slides().map((el, i) => ({
        ...cachedPage(el),
        title: pageNotes[i]?.title || `第 ${i + 1} 页`,
      })),
      current,
    );
    layersChanged();
  }
  function pushHistory(contentChanged = true) {
    if (contentChanged) pageCache.delete(slide());
    const value = snapshot(),
      prev = history[undoIndex];
    if (
      prev &&
      prev.pages.length === value.pages.length &&
      prev.pages.every(
        (page, i) =>
          page.id === value.pages[i].id && page.html === value.pages[i].html,
      ) &&
      prev.notes.every((note, i) => note === value.notes[i])
    )
      return;
    history = history.slice(0, undoIndex + 1);
    history.push(value);
    // Unchanged page objects/strings are shared between history entries.
    const unique = new Set(history.flatMap((entry) => entry.pages));
    historyBytes = [...unique].reduce((sum, page) => sum + page.html.length, 0);
    while (
      history.length > 2 &&
      (history.length > 50 || historyBytes > 24_000_000)
    ) {
      history.shift();
      historyBytes = [
        ...new Set(history.flatMap((entry) => entry.pages)),
      ].reduce((sum, page) => sum + page.html.length, 0);
    }
    undoIndex = history.length - 1;
    onHistory(undoIndex > 0, false);
    onChange({ html: serialize(), notes: getNotes() });
    pagesChanged();
  }
  function boxUpdate() {
    selectionBox.hidden = !selected || !!editing;
    if (!selected || editing) return;
    const boxes = [...selectedNodes].map((node) =>
        node.getBoundingClientRect(),
      ),
      box = {
        left: Math.min(...boxes.map((value) => value.left)),
        top: Math.min(...boxes.map((value) => value.top)),
        right: Math.max(...boxes.map((value) => value.right)),
        bottom: Math.max(...boxes.map((value) => value.bottom)),
      };
    Object.assign(selectionBox.style, {
      left: box.left + "px",
      top: box.top + "px",
      width: box.right - box.left + "px",
      height: box.bottom - box.top + "px",
    });
    selectionBox.dataset.multi = String(selectedNodes.size > 1);
  }
  function info() {
    if (!selected) return null;
    if (selectedNodes.size > 1) {
      const boxes = [...selectedNodes].map((node) =>
          node.getBoundingClientRect(),
        ),
        parent = slide().getBoundingClientRect(),
        left = Math.min(...boxes.map((value) => value.left)),
        top = Math.min(...boxes.map((value) => value.top)),
        right = Math.max(...boxes.map((value) => value.right)),
        bottom = Math.max(...boxes.map((value) => value.bottom));
      return {
        type: `已选择 ${selectedNodes.size} 个图层`,
        multi: true,
        count: selectedNodes.size,
        locked: [...selectedNodes].every(
          (node) => node.dataset.editorLocked === "true",
        ),
        x: round((left - parent.left) / scale),
        y: round((top - parent.top) / scale),
        width: round((right - left) / scale),
        height: round((bottom - top) / scale),
      };
    }
    const style = win.getComputedStyle(selected),
      r = selected.getBoundingClientRect(),
      parent = slide().getBoundingClientRect();
    return {
      type: selected.matches("[data-editor-element=shape]")
        ? "形状"
        : selected.matches("img")
          ? "图片"
          : selected.matches("svg")
            ? "SVG 图表"
            : selected.matches(".math,[data-tex],.katex")
              ? "公式"
              : canEdit(selected)
                ? "文字"
                : "组件",
      canEdit: canEdit(selected),
      canParent: selected.parentElement !== slide(),
      x: round((r.x - parent.x) / scale),
      y: round((r.y - parent.y) / scale),
      width: round(r.width / scale),
      height: round(r.height / scale),
      fontSize: round(parseFloat(style.fontSize)),
      formula: selected.matches(".math,[data-tex],.katex,.katex-display"),
      tex:
        selected.dataset.tex ||
        selected.querySelector('annotation[encoding="application/x-tex"]')
          ?.textContent ||
        "",
      color: style.color,
      borderColor: selected.dataset.shape
        ? style.getPropertyValue("--shape-stroke").trim() || "#658e7c"
        : style.borderTopColor,
      borderWidth: selected.dataset.shape
        ? Number(style.getPropertyValue("--shape-stroke-width").trim() || 2)
        : parseFloat(style.borderTopWidth),
      borderStyle: selected.dataset.shape
        ? style.getPropertyValue("--shape-border-style").trim() || "solid"
        : style.borderTopStyle,
      italic: style.fontStyle === "italic",
      underline: style.textDecorationLine.includes("underline"),
      strike: style.textDecorationLine.includes("line-through"),
      shape: selected.dataset.shape,
      background: selected.dataset.shape
        ? style.getPropertyValue("--shape-fill").trim() || "#dceae3"
        : style.backgroundColor,
      href:
        linkNode()?.getAttribute(
          linkNode()?.matches("a") ? "href" : "data-editor-href",
        ) || "",
      bold: Number(style.fontWeight) >= 600 || style.fontWeight === "bold",
      align: style.textAlign,
      image: selected.matches("img"),
      group: selected.dataset.editorElement === "group",
      locked: selected.dataset.editorLocked === "true",
    };
  }
  function select(node, additive = false) {
    if (selected !== node) finishEdit();
    if (!additive) selectedNodes.clear();
    if (node && additive && selectedNodes.has(node)) selectedNodes.delete(node);
    else if (node) selectedNodes.add(node);
    selected =
      node && selectedNodes.has(node)
        ? node
        : [...selectedNodes].at(-1) || null;
    doc
      ?.querySelectorAll("[data-ve-selected]")
      .forEach((item) => item.removeAttribute("data-ve-selected"));
    selectedNodes.forEach((item) => item.setAttribute("data-ve-selected", ""));
    boxUpdate();
    onSelect(info());
    layersChanged();
  }
  function canEdit(node) {
    if (
      !node ||
      node.namespaceURI !== "http://www.w3.org/1999/xhtml" ||
      node.matches(
        "img,video,audio,canvas,hr,[data-editor-element=shape],[data-editor-element=table],[data-editor-element=chart],.math,[data-tex],.katex",
      ) ||
      node.querySelector(atomic)
    )
      return false;
    if (node.matches('[data-editor-element="text"]')) return true;
    return ![...node.querySelectorAll("*")].some(
      (child) =>
        !/^(SPAN|STRONG|EM|B|I|U|S|BR|A|SMALL|SUB|SUP|MARK|DIV|P)$/.test(
          child.tagName,
        ),
    );
  }
  function linkNode() {
    if (!selected) return null;
    const ancestor = selected.closest("a[href],[data-editor-href]");
    if (ancestor && slide().contains(ancestor)) return ancestor;
    return selected.childElementCount === 1 &&
      selected.firstElementChild.matches("a[href]")
      ? selected.firstElementChild
      : null;
  }
  function setLink(value) {
    finishEdit();
    if (!selected) return;
    const href = safeLink(value),
      existing = linkNode();
    const target = existing || selected;
    if (target.matches("a")) {
      if (href) {
        target.setAttribute("href", href);
        target.setAttribute("target", "_blank");
        target.setAttribute("rel", "noopener noreferrer");
      } else {
        target.removeAttribute("href");
        target.removeAttribute("target");
        target.removeAttribute("rel");
      }
    } else if (href) target.setAttribute("data-editor-href", href);
    else target.removeAttribute("data-editor-href");
    pushHistory();
    onSelect(info());
  }
  function pick(target) {
    if (!target || target === slide() || !slide().contains(target)) return null;
    const component = target.closest(
      "[data-editor-element=text],[data-editor-element=shape]",
    );
    if (component) return component;
    const math = target.closest(".math,[data-tex]") || target.closest(".katex");
    if (math) return math;
    const graphic = target.closest("svg,img,video,audio,canvas");
    if (graphic) return graphic;
    const paragraph = target.closest(textTags);
    if (paragraph && canEdit(paragraph)) return paragraph;
    return target;
  }
  function fit() {
    if (!win || !deck) return;
    scale = Math.max(
      0.05,
      Math.min(
        (win.innerWidth - 64) / meta.width,
        (win.innerHeight - 64) / meta.height,
      ),
    );
    deck.style.setProperty("--ve-scale", scale);
    boxUpdate();
  }
  function translations(node) {
    const value = win.getComputedStyle(node).translate;
    const [x = "0", y = "0", z = "0px"] =
      value === "none" ? [] : value.split(/\s+/);
    const convert = (v, size) =>
      v.endsWith("%") ? (parseFloat(v) * size) / 100 : parseFloat(v) || 0;
    return {
      x: convert(
        x,
        node.offsetWidth || node.getBoundingClientRect().width / scale,
      ),
      y: convert(
        y,
        node.offsetHeight || node.getBoundingClientRect().height / scale,
      ),
      z,
    };
  }
  function move(node, x, y, origin = translations(node)) {
    node.style.setProperty(
      "translate",
      `${round(origin.x + x)}px ${round(origin.y + y)}px ${origin.z}`,
      "important",
    );
  }
  function down(event) {
    onPointerDown();
    if (event.button !== 0 || editing?.node.contains(event.target)) return;
    if (event.target.closest("#ve-selection")) return;
    const node = pick(event.target);
    if (
      !(
        node &&
        !event.shiftKey &&
        selectedNodes.size > 1 &&
        selectedNodes.has(node)
      )
    )
      select(node, event.shiftKey);
    if (!node) return;
    if (!selectedNodes.has(node)) return;
    if ([...selectedNodes].some((item) => item.dataset.editorLocked === "true"))
      return;
    event.preventDefault();
    if (event.detail >= 2) return;
    const origin = translations(node);
    guides.begin(node);
    drag = {
      node,
      nodes: [...selectedNodes].map((item) => ({
        node: item,
        origin: translations(item),
        style: item.getAttribute("style"),
      })),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin,
      kind: "move",
      changed: false,
      style: node.getAttribute("style"),
    };
  }
  function startResize(event) {
    if (
      !selected ||
      selected.dataset.editorLocked === "true" ||
      selectedNodes.size > 1 ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    finishEdit();
    const r = selected.getBoundingClientRect();
    guides.begin(selected);
    drag = {
      node: selected,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: translations(selected),
      width: r.width / scale,
      height: r.height / scale,
      kind: event.target.dataset.handle,
      changed: false,
      style: selected.getAttribute("style"),
    };
    doc.documentElement.setPointerCapture(event.pointerId);
  }
  function dragMove(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    let dx = (event.clientX - drag.startX) / scale,
      dy = (event.clientY - drag.startY) / scale;
    if (!drag.changed && Math.hypot(dx, dy) * scale < 3) return;
    if (!drag.changed) doc.documentElement.setPointerCapture(event.pointerId);
    drag.changed = true;
    if (drag.kind === "move") {
      if (event.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      ({ dx, dy } = guides.snap(dx, dy, event));
      for (const item of drag.nodes || [drag])
        move(item.node, dx, dy, item.origin);
    } else {
      if (!drag.node.matches("img,svg") && !event.shiftKey)
        ({ dx, dy } = guides.snap(dx, dy, event, drag.kind));
      const left = drag.kind.includes("w"),
        top = drag.kind.includes("n");
      let width = Math.max(16, drag.width + (left ? -dx : dx)),
        height = Math.max(16, drag.height + (top ? -dy : dy));
      if (drag.node.matches("img,svg") || event.shiftKey)
        height = (width * drag.height) / drag.width;
      setStyle(drag.node, {
        width: width + "px",
        height: height + "px",
        minWidth: "0",
        minHeight: "0",
        maxWidth: "none",
        maxHeight: "none",
        boxSizing: "border-box",
        flexShrink: "0",
      });
      move(
        drag.node,
        left ? drag.width - width : 0,
        top ? drag.height - height : 0,
        drag.origin,
      );
    }
    onDirty();
    boxUpdate();
  }
  function dragEnd(event, cancel = false) {
    if (!drag || (event && drag.pointerId !== event.pointerId)) return;
    const last = drag;
    drag = null;
    guides.clear();
    if (doc.documentElement.hasPointerCapture(last.pointerId))
      doc.documentElement.releasePointerCapture(last.pointerId);
    if (cancel)
      for (const item of last.nodes || [last])
        item.style === null
          ? item.node.removeAttribute("style")
          : item.node.setAttribute("style", item.style);
    else if (last.changed) pushHistory();
    boxUpdate();
    onSelect(info());
  }
  function startEdit() {
    if (selected?.dataset.editorLocked === "true") return;
    if (selected?.matches(".math,[data-tex],.katex,.katex-display")) {
      onFormulaRequest(info());
      return;
    }
    if (!canEdit(selected) || editing) return;
    editing = {
      node: selected,
      contenteditable: selected.getAttribute("contenteditable"),
      spellcheck: selected.getAttribute("spellcheck"),
    };
    selected.setAttribute("contenteditable", "true");
    selected.setAttribute("spellcheck", "false");
    selected.setAttribute("data-ve-editing", "");
    selected.focus();
    boxUpdate();
    const range = doc.createRange();
    range.selectNodeContents(selected);
    const selection = win.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
  function finishEdit() {
    if (!editing) return;
    const previous = editing;
    editing = null;
    for (const key of ["contenteditable", "spellcheck"])
      previous[key] === null
        ? previous.node.removeAttribute(key)
        : previous.node.setAttribute(key, previous[key]);
    previous.node.removeAttribute("data-ve-editing");
    win.getSelection()?.removeAllRanges();
    pushHistory();
    boxUpdate();
  }
  function paste(event) {
    if (!editing) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain"),
      selection = win.getSelection();
    if (!selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editing.node.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const fragment = doc.createDocumentFragment();
    text.split(/\r?\n/).forEach((line, i) => {
      if (i) fragment.append(doc.createElement("br"));
      fragment.append(doc.createTextNode(line));
    });
    const last = fragment.lastChild;
    range.insertNode(fragment);
    range.setStartAfter(last);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    onDirty();
  }
  function setStyle(node, values) {
    for (const [key, value] of Object.entries(values))
      node.style.setProperty(
        key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()),
        value,
        "important",
      );
  }
  function updateProperties(values) {
    finishEdit();
    if (
      !selected ||
      selected.dataset.editorLocked === "true" ||
      selectedNodes.size > 1
    )
      return;
    const before = info();
    let dx = 0,
      dy = 0;
    const textKeys = [
      "fontSize",
      "fontWeight",
      "fontStyle",
      "textDecoration",
      "color",
      "textAlign",
    ];
    for (const [key, raw] of Object.entries(values)) {
      let value = raw;
      if (key === "x") {
        dx = value - before.x;
        continue;
      }
      if (key === "y") {
        dy = value - before.y;
        continue;
      }
      if (["width", "height", "fontSize", "borderWidth"].includes(key)) {
        value = clamp(
          Number(value),
          key === "fontSize" ? 6 : key === "borderWidth" ? 0 : 16,
          key === "fontSize" ? 400 : key === "borderWidth" ? 40 : 10000,
        );
        if (!Number.isFinite(value)) continue;
        if (key === "width" || key === "height")
          setStyle(selected, {
            boxSizing: "border-box",
            maxWidth: "none",
            maxHeight: "none",
          });
      }
      if (
        selected.dataset.shape &&
        [
          "backgroundColor",
          "borderColor",
          "borderWidth",
          "borderStyle",
        ].includes(key)
      ) {
        const properties = {
          backgroundColor: "--shape-fill",
          borderColor: "--shape-stroke",
          borderWidth: "--shape-stroke-width",
          borderStyle: "--shape-border-style",
        };
        selected.style.setProperty(properties[key], value);
        // Upgrade existing vector shapes without replacing their content or IDs.
        const group = selected.querySelector("svg > g");
        group?.setAttribute("stroke-width", "var(--shape-stroke-width,2)");
        group?.setAttribute("stroke-dasharray", "var(--shape-dash,none)");
        group?.setAttribute("stroke-opacity", "var(--shape-stroke-opacity,1)");
        const width = Number(
          selected.style.getPropertyValue("--shape-stroke-width") ||
            before.borderWidth,
        );
        const style =
          selected.style.getPropertyValue("--shape-border-style") ||
          before.borderStyle;
        selected.style.setProperty(
          "--shape-dash",
          style === "dashed"
            ? `${width * 4} ${width * 3}`
            : style === "dotted"
              ? `${width} ${width * 2}`
              : "none",
        );
        selected.style.setProperty(
          "--shape-stroke-opacity",
          style === "none" ? "0" : "1",
        );
        group
          ?.querySelectorAll("*")
          .forEach((node) =>
            node.setAttribute("vector-effect", "non-scaling-stroke"),
          );
        continue;
      }
      if (["width", "height", "fontSize", "borderWidth"].includes(key))
        value += "px";
      if (
        key.startsWith("border") &&
        key !== "borderStyle" &&
        before.borderStyle === "none"
      )
        setStyle(selected, { borderStyle: "solid" });
      setStyle(selected, { [key]: value });
      if (textKeys.includes(key)) {
        for (const child of selected.querySelectorAll("*")) {
          // Preserve formula internals and their relative sizing.
          if (child.closest(".math,[data-tex],.katex")) continue;
          if (child.namespaceURI === "http://www.w3.org/2000/svg") {
            if (child.matches("text,tspan"))
              setStyle(child, { [key === "color" ? "fill" : key]: value });
          } else if (canEdit(child)) setStyle(child, { [key]: value });
        }
      }
    }
    if (dx || dy) move(selected, dx, dy);
    pushHistory();
    boxUpdate();
    onSelect(info());
  }
  function go(index, notify = true) {
    finishEdit();
    dragEnd(null);
    current = clamp(index, 0, slides().length - 1);
    selected = null;
    selectedNodes.clear();
    if (activeSlide !== slide()) {
      activeSlide?.removeAttribute("data-ve-current");
      activeSlide = slide();
      activeSlide.setAttribute("data-ve-current", "");
    }
    boxUpdate();
    onSelect(null);
    if (notify) pagesChanged();
  }
  function restore(step) {
    finishEdit();
    const index = undoIndex + step;
    if (index < 0 || index >= history.length) return;
    undoIndex = index;
    const value = history[index],
      existing = new Map(slides().map((node) => [cachedPage(node).id, node]));
    value.pages.forEach((page, i) => {
      let node = existing.get(page.id);
      if (!node || cachedPage(node).html !== page.html) {
        const template = doc.createElement("template");
        template.innerHTML = page.html;
        const replacement = template.content.firstElementChild;
        if (node) node.replaceWith(replacement);
        node = replacement;
        pageCache.set(node, page);
      }
      if (deck.children[i] !== node)
        deck.insertBefore(node, deck.children[i] || null);
      existing.delete(page.id);
    });
    for (const node of existing.values()) node.remove();
    pageNotes = value.notes.slice();
    go(value.current);
    onHistory(index > 0, index < history.length - 1);
    onChange({ html: serialize(), notes: getNotes() });
  }
  function deleteSelection() {
    finishEdit();
    if (
      !selected ||
      [...selectedNodes].some((node) => node.dataset.editorLocked === "true")
    )
      return;
    const nodes = [...selectedNodes];
    selected = null;
    selectedNodes.clear();
    nodes.forEach((node) => node.remove());
    pushHistory();
    boxUpdate();
    onSelect(null);
  }
  function duplicateSelection() {
    finishEdit();
    if (!selected) return;
    const clones = [...selectedNodes].map((node) => {
      const clone = cloneWithFreshIds(node);
      node.after(clone);
      move(clone, 24, 24);
      return clone;
    });
    selectedNodes.clear();
    clones.forEach((clone) => selectedNodes.add(clone));
    selected = clones.at(-1);
    doc
      .querySelectorAll("[data-ve-selected]")
      .forEach((item) => item.removeAttribute("data-ve-selected"));
    selectedNodes.forEach((item) => item.setAttribute("data-ve-selected", ""));
    boxUpdate();
    onSelect(info());
    layersChanged();
    pushHistory();
  }
  function toggleLock() {
    finishEdit();
    if (!selectedNodes.size) return;
    const lock = ![...selectedNodes].every(
      (node) => node.dataset.editorLocked === "true",
    );
    for (const node of selectedNodes)
      if (lock) node.dataset.editorLocked = "true";
      else delete node.dataset.editorLocked;
    pushHistory();
    onSelect(info());
  }
  function groupSelection() {
    finishEdit();
    const nodes = [...selectedNodes];
    if (
      nodes.length < 2 ||
      nodes.some((node) => node.dataset.editorLocked === "true")
    )
      return;
    const slideBox = slide().getBoundingClientRect(),
      boxes = nodes.map((node) => ({
        node,
        box: node.getBoundingClientRect(),
      })),
      left = Math.min(...boxes.map(({ box }) => box.left)),
      top = Math.min(...boxes.map(({ box }) => box.top)),
      right = Math.max(...boxes.map(({ box }) => box.right)),
      bottom = Math.max(...boxes.map(({ box }) => box.bottom)),
      group = doc.createElement("div");
    group.dataset.editorElement = "group";
    setStyle(group, {
      position: "absolute",
      left: `${round((left - slideBox.left) / scale)}px`,
      top: `${round((top - slideBox.top) / scale)}px`,
      width: `${round((right - left) / scale)}px`,
      height: `${round((bottom - top) / scale)}px`,
      margin: "0",
      zIndex: String(
        Math.max(
          ...nodes.map(
            (node) => Number(win.getComputedStyle(node).zIndex) || 0,
          ),
        ),
      ),
    });
    slide().append(group);
    for (const { node, box } of boxes) {
      setStyle(node, {
        position: "absolute",
        left: `${round((box.left - left) / scale)}px`,
        top: `${round((box.top - top) / scale)}px`,
        width: `${round(box.width / scale)}px`,
        height: `${round(box.height / scale)}px`,
        margin: "0",
        translate: "none",
      });
      group.append(node);
    }
    select(group);
    pushHistory();
  }
  function ungroupSelection() {
    finishEdit();
    if (
      selectedNodes.size !== 1 ||
      selected?.dataset.editorElement !== "group" ||
      selected.dataset.editorLocked === "true"
    )
      return;
    const group = selected,
      slideBox = slide().getBoundingClientRect(),
      children = [...group.children],
      boxes = children.map((node) => ({
        node,
        box: node.getBoundingClientRect(),
      }));
    selected = null;
    selectedNodes.clear();
    for (const { node, box } of boxes) {
      setStyle(node, {
        position: "absolute",
        left: `${round((box.left - slideBox.left) / scale)}px`,
        top: `${round((box.top - slideBox.top) / scale)}px`,
        width: `${round(box.width / scale)}px`,
        height: `${round(box.height / scale)}px`,
        translate: "none",
      });
      slide().append(node);
      selectedNodes.add(node);
    }
    group.remove();
    selected = children.at(-1) || null;
    selectedNodes.forEach((node) => node.setAttribute("data-ve-selected", ""));
    pushHistory();
    boxUpdate();
    onSelect(info());
  }
  function applyTheme(theme) {
    const colors = [theme.accent, theme.text, theme.background];
    if (!colors.every((value) => /^#[0-9a-f]{6}$/i.test(value))) return;
    const fonts = {
      sans: 'Inter,"PingFang SC","Microsoft YaHei",sans-serif',
      serif: 'Georgia,"Songti SC","SimSun",serif',
      modern: 'Arial,"PingFang SC","Microsoft YaHei",sans-serif',
      rounded: '"Arial Rounded MT Bold","PingFang SC",sans-serif',
    };
    const font = fonts[theme.font] || fonts.sans,
      marker =
        /\/\* PowerDeck Theme Start \*\/[\s\S]*?\/\* PowerDeck Theme End \*\//,
      block = `/* PowerDeck Theme Start */\n#deck{--pd-accent:${theme.accent};--pd-text:${theme.text};--pd-background:${theme.background};--pd-font:${font}}\n#deck>.slide{background-color:var(--pd-background)!important;color:var(--pd-text);font-family:var(--pd-font)!important}\n#deck>.slide :where(h1,h2,h3,h4,h5,h6){color:var(--pd-accent);font-family:var(--pd-font)!important}\n#deck>.slide :where(p,li,blockquote,td,th){font-family:var(--pd-font)!important}\n/* PowerDeck Theme End */`;
    css = marker.test(css) ? css.replace(marker, block) : `${css}\n${block}`;
    const documentStyles = doc.head.querySelector("style");
    if (documentStyles) documentStyles.textContent = baseCSS + "\n" + css;
    onCSSChange(css);
    onDirty();
  }
  function insert(kind, src) {
    finishEdit();
    const node = doc.createElement(
      kind === "image"
        ? "img"
        : ["video", "audio"].includes(kind)
          ? kind
          : "div",
    );
    node.dataset.editorElement = kind;
    const styles = {
      position: "absolute",
      left: "120px",
      top: "180px",
      margin: "0",
      zIndex: "10",
      boxSizing: "border-box",
    };
    if (kind === "text") {
      node.textContent = "双击编辑文字";
      Object.assign(styles, {
        width: "600px",
        fontSize: "40px",
        lineHeight: "1.4",
        color: "#243d36",
        fontFamily: '"PingFang SC", "Microsoft YaHei", sans-serif',
        fontWeight: "400",
      });
    } else if (kind === "image") {
      node.src = src;
      node.alt = "";
      Object.assign(styles, {
        width: "480px",
        height: "320px",
        objectFit: "contain",
      });
      node.onload = () => {
        boxUpdate();
        onSelect(info());
      };
    } else if (kind === "video" || kind === "audio") {
      node.src = src;
      node.controls = true;
      node.preload = "metadata";
      Object.assign(styles, {
        width: kind === "video" ? "640px" : "520px",
        height: kind === "video" ? "360px" : "64px",
        background: "#111827",
        borderRadius: "12px",
      });
    } else if (kind === "table") {
      node.innerHTML = `<table><tbody>${Array.from({ length: 4 }, (_, row) => `<tr>${Array.from({ length: 4 }, (_, column) => `<td>${row === 0 ? `标题 ${column + 1}` : "内容"}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
      Object.assign(styles, {
        width: "760px",
        height: "300px",
        fontSize: "24px",
      });
      node.querySelector("table").style.cssText =
        "width:100%;height:100%;border-collapse:collapse;background:#fff;color:#243d36";
      node.querySelectorAll("td").forEach((cell, index) => {
        cell.style.cssText = `border:1px solid #b9c9c2;padding:12px;${index < 4 ? "font-weight:600;background:#eaf1ed" : ""}`;
      });
    } else if (kind === "chart") {
      node.innerHTML = `<div class="pd-chart-title">数据图表</div><div class="pd-chart-bars">${[62, 84, 46, 72, 92].map((value, index) => `<div><i style="height:${value}%"></i><span>${String.fromCharCode(65 + index)}</span></div>`).join("")}</div>`;
      Object.assign(styles, {
        width: "720px",
        height: "400px",
        padding: "24px",
        background: "#fff",
        color: "#243d36",
        borderRadius: "14px",
      });
      node.querySelector(".pd-chart-title").style.cssText =
        "font-size:28px;font-weight:600;margin-bottom:18px";
      node.querySelector(".pd-chart-bars").style.cssText =
        "height:300px;display:flex;align-items:flex-end;gap:24px;border-bottom:2px solid #c8d4ce";
      node
        .querySelectorAll(".pd-chart-bars>div")
        .forEach(
          (bar) =>
            (bar.style.cssText =
              "height:100%;flex:1;display:flex;flex-direction:column;justify-content:flex-end;text-align:center;gap:8px"),
        );
      node
        .querySelectorAll(".pd-chart-bars i")
        .forEach(
          (bar) =>
            (bar.style.cssText +=
              ";display:block;background:#3f806a;border-radius:8px 8px 0 0"),
        );
    } else {
      const shape = shapes.find((item) => item.id === src) || shapes[1];
      node.dataset.shape = shape.id;
      node.innerHTML = shapeMarkup(shape.id);
      Object.assign(styles, {
        width: "320px",
        height: (shape.height || 180) + "px",
        background: "transparent",
      });
      node.style.setProperty("--shape-fill", "#dceae3");
      node.style.setProperty("--shape-stroke", "#658e7c");
    }
    setStyle(node, styles);
    slide().append(node);
    select(node);
    pushHistory();
  }
  function pageAction(action) {
    finishEdit();
    const list = slides();
    if (["add", "duplicate"].includes(action) && list.length >= 200) return;
    if (action === "add" || action === "duplicate") {
      const node =
        action === "duplicate"
          ? cloneWithFreshIds(slide())
          : doc.createElement("section");
      if (action === "add") {
        node.className = "slide";
        node.dataset.slideId = "slide-" + crypto.randomUUID().slice(0, 12);
        node.style.background = "#fff";
      }
      slide().after(node);
      const note =
        action === "duplicate"
          ? structuredClone(pageNotes[current])
          : { title: "新页面", notes: "", refs: [] };
      pageNotes.splice(current + 1, 0, note);
      current++;
    } else if (action === "delete" && list.length > 1) {
      slide().remove();
      pageNotes.splice(current, 1);
      current = Math.min(current, list.length - 2);
    } else if (action === "up" && current > 0) {
      list[current - 1].before(slide());
      [pageNotes[current - 1], pageNotes[current]] = [
        pageNotes[current],
        pageNotes[current - 1],
      ];
      current--;
    } else if (action === "down" && current < list.length - 1) {
      list[current + 1].after(slide());
      [pageNotes[current + 1], pageNotes[current]] = [
        pageNotes[current],
        pageNotes[current + 1],
      ];
      current++;
    } else return;
    go(current, false);
    pushHistory(false);
  }
  function insertPage({ html: pageHTML, note, css: addedCSS = "" }) {
    finishEdit();
    if (slides().length >= 200) return false;
    const source = parseSlides(pageHTML)[0];
    if (!source) throw new Error("模板版式中没有可插入的页面");
    const node = doc.importNode(cloneWithFreshIds(source), true);
    slide().after(node);
    pageNotes.splice(
      current + 1,
      0,
      structuredClone(
        note || {
          title: source.querySelector("h1,h2")?.textContent?.trim() || "新页面",
          notes: "",
          refs: [],
        },
      ),
    );
    if (addedCSS.trim()) {
      css += `\n/* 插入的模板版式 */\n${addedCSS}`;
      const documentStyles = doc.head.querySelector("style");
      if (documentStyles) documentStyles.textContent = baseCSS + "\n" + css;
      onCSSChange(css);
    }
    current++;
    go(current, false);
    pushHistory(false);
    return true;
  }
  function alignSelection(kind) {
    finishEdit();
    const nodes = [...selectedNodes];
    if (!nodes.length) return;
    const slideBox = slide().getBoundingClientRect(),
      boxes = nodes.map((node) => ({
        node,
        box: node.getBoundingClientRect(),
      })),
      group = {
        left: Math.min(...boxes.map(({ box }) => box.left)),
        right: Math.max(...boxes.map(({ box }) => box.right)),
        top: Math.min(...boxes.map(({ box }) => box.top)),
        bottom: Math.max(...boxes.map(({ box }) => box.bottom)),
      },
      reference = nodes.length === 1 ? slideBox : group;
    for (const { node, box } of boxes) {
      let dx = 0,
        dy = 0;
      if (kind === "left") dx = reference.left - box.left;
      if (kind === "center")
        dx = (reference.left + reference.right - box.left - box.right) / 2;
      if (kind === "right") dx = reference.right - box.right;
      if (kind === "top") dy = reference.top - box.top;
      if (kind === "middle")
        dy = (reference.top + reference.bottom - box.top - box.bottom) / 2;
      if (kind === "bottom") dy = reference.bottom - box.bottom;
      move(node, dx / scale, dy / scale);
    }
    pushHistory();
    boxUpdate();
    onSelect(info());
  }
  function selectLayer(index, additive = false) {
    select(layerNodes()[index] || null, additive);
  }
  function reorderLayer(index, direction) {
    const nodes = layerNodes(),
      node = nodes[index],
      siblings = node
        ? nodes.filter(
            (candidate) => candidate.parentElement === node.parentElement,
          )
        : [],
      siblingIndex = siblings.indexOf(node);
    if (!node) return;
    if (direction === "front") node.parentElement.append(node);
    else if (direction === "back") node.parentElement.prepend(node);
    else if (direction === "up" && siblings[siblingIndex + 1])
      siblings[siblingIndex + 1].after(node);
    else if (direction === "down" && siblings[siblingIndex - 1])
      siblings[siblingIndex - 1].before(node);
    else return;
    pushHistory();
    layersChanged();
  }
  function keyboard(event) {
    if (event.isComposing) return;
    const target = event.target;
    const inInput = target.closest?.("input,textarea,[contenteditable]");
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "s") {
      event.preventDefault();
      finishEdit();
      onSave();
      return;
    }
    if (mod && event.key.toLowerCase() === "k" && selected) {
      event.preventDefault();
      finishEdit();
      onLinkRequest();
      return;
    }
    if (inInput && !editing) return;
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      restore(event.shiftKey ? 1 : -1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (drag) dragEnd(null, true);
      else if (editing) finishEdit();
      else select(null);
      return;
    }
    if (editing) return;
    if (mod && event.key.toLowerCase() === "d" && selected) {
      event.preventDefault();
      duplicateSelection();
    } else if (["Delete", "Backspace"].includes(event.key) && selected) {
      event.preventDefault();
      deleteSelection();
    } else if (event.key === "Enter" && selected) {
      event.preventDefault();
      startEdit();
    } else if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    ) {
      event.preventDefault();
      if (selected) {
        const step = event.shiftKey ? 10 : 1;
        for (const node of selectedNodes)
          move(
            node,
            (event.key === "ArrowRight"
              ? 1
              : event.key === "ArrowLeft"
                ? -1
                : 0) * step,
            (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0) *
              step,
          );
        pushHistory();
        boxUpdate();
        onSelect(info());
      } else
        go(
          current + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1),
        );
    }
  }
  async function load(value) {
    finishEdit();
    const nodes = parseSlides(value.html);
    delete frame.dataset.ready;
    css = value.css;
    const sourceNotes = value.notes || {};
    pageNotes = nodes.map((node, i) =>
      structuredClone(
        sourceNotes[i + 1] || {
          title: node.querySelector("h1,h2")?.textContent || `第 ${i + 1} 页`,
          notes: "",
          refs: [],
        },
      ),
    );
    await new Promise((resolve) => {
      frame.onload = () => {
        if (frame.contentDocument?.querySelector("#deck")) resolve();
      };
      frame.srcdoc = visualDocument({
        html: nodes.map((node) => node.outerHTML).join("\n"),
        css,
        baseCSS,
        baseURL,
        ...meta,
      });
    });
    win = frame.contentWindow;
    doc = frame.contentDocument;
    deck = doc.querySelector("#deck");
    guides?.destroy();
    guides = createGuides(doc, meta, () => scale, slide);
    updateTheme();
    pageCache = new WeakMap();
    activeSlide = null;
    selected = null;
    selectedNodes.clear();
    editing = null;
    drag = null;
    selectionBox = doc.createElement("div");
    selectionBox.id = "ve-selection";
    selectionBox.hidden = true;
    selectionBox.innerHTML = ["nw", "ne", "sw", "se"]
      .map(
        (handle) =>
          `<button type="button" data-handle="${handle}" tabindex="-1" aria-label="缩放元素"></button>`,
      )
      .join("");
    doc.body.append(selectionBox);
    selectionBox.addEventListener("pointerdown", startResize);
    doc.addEventListener("pointerdown", down);
    doc.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      finishEdit();
      const node = pick(event.target);
      select(node);
      const box = frame.getBoundingClientRect();
      onContextMenu({
        x: box.left + event.clientX,
        y: box.top + event.clientY,
        info: info(),
        focus: frame,
      });
    });
    doc.addEventListener("pointermove", dragMove);
    doc.addEventListener("pointerup", dragEnd);
    doc.addEventListener("pointercancel", (event) => dragEnd(event, true));
    doc.addEventListener("dblclick", (event) => {
      const node = pick(event.target);
      if (node) {
        event.preventDefault();
        select(node);
        startEdit();
      }
    });
    doc.addEventListener("click", (event) => {
      if (event.target.closest("a,button")) event.preventDefault();
    });
    doc.addEventListener("dragstart", (event) => event.preventDefault());
    doc.addEventListener("compositionstart", () => {
      composing = true;
    });
    doc.addEventListener("compositionend", () => {
      composing = false;
      onDirty();
    });
    doc.addEventListener("input", () => {
      if (editing) {
        pageCache.delete(slide());
        onDirty();
        boxUpdate();
      }
    });
    doc.addEventListener("paste", paste);
    doc.addEventListener("focusout", (event) => {
      if (editing && event.target === editing.node) finishEdit();
    });
    doc.addEventListener("keydown", keyboard);
    const wheelStep = wheelNavigation((direction) => go(current + direction));
    doc.addEventListener(
      "wheel",
      (event) => {
        if (
          editing ||
          drag ||
          composing ||
          event.target.closest("input,textarea,[contenteditable=true]")
        )
          return;
        // Scrollable components retain their own native scrolling.
        for (
          let node = event.target;
          node && node !== doc.body;
          node = node.parentElement
        ) {
          if (
            node.scrollHeight > node.clientHeight + 1 &&
            /auto|scroll/.test(win.getComputedStyle(node).overflowY)
          )
            return;
        }
        if (wheelStep(event)) event.preventDefault();
      },
      { passive: false },
    );

    doc.addEventListener(
      "load",
      () => {
        fit();
        if (selected) onSelect(info());
      },
      true,
    );
    observer?.disconnect();
    observer = new ResizeObserver(fit);
    observer.observe(frame);
    fit();
    go(Math.min(current, nodes.length - 1));
    await doc.fonts.ready;
    fit();
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    frame.dataset.ready = "true";
    history = [snapshot()];
    undoIndex = 0;
    onHistory(false, false);
  }
  function updateTheme() {
    doc?.documentElement.style.setProperty(
      "--editor-stage-bg",
      document.documentElement.dataset.theme === "dark" ? "#111b15" : "#e9edeb",
    );
  }
  window.addEventListener("themechange", updateTheme);
  function movePage(from, slot) {
    finishEdit();
    const list = slides(),
      to = slot > from ? slot - 1 : slot;
    if (
      from === to ||
      from < 0 ||
      from >= list.length ||
      to < 0 ||
      to >= list.length
    )
      return;
    const node = list[from];
    node.remove();
    deck.insertBefore(node, slides()[to] || null);
    const [note] = pageNotes.splice(from, 1);
    pageNotes.splice(to, 0, note);
    go(to, false);
    pushHistory(false);
  }
  function setFormula({ tex, html, insert: creating }) {
    finishEdit();
    if (creating) {
      const node = doc.createElement("div");
      node.className = "math";
      node.dataset.editorElement = "formula";
      setStyle(node, {
        position: "absolute",
        left: "180px",
        top: "200px",
        fontSize: "36px",
        minWidth: "120px",
        zIndex: "10",
      });
      slide().append(node);
      select(node);
    }
    if (!selected) return;
    selected.dataset.tex = tex;
    if (selected.classList.contains("katex")) {
      selected.classList.remove("katex");
      selected.classList.add("math");
    }
    selected.innerHTML = html;
    pushHistory();
    boxUpdate();
    onSelect(info());
  }
  await load({ html, css, notes });
  return {
    load,
    fit,
    go,
    insert,
    insertPage,
    pageAction,
    movePage,
    alignSelection,
    selectLayer,
    reorderLayer,
    setFormula,
    setSnapping: (enabled) => guides.setEnabled(enabled),
    setLink,
    updateProperties,
    keyboard,
    undo: () => restore(-1),
    redo: () => restore(1),
    startEdit,
    finishEdit,
    duplicateSelection,
    deleteSelection,
    toggleLock,
    groupSelection,
    ungroupSelection,
    applyTheme,
    selectParent: () => {
      if (selected && selected.parentElement !== slide())
        select(selected.parentElement);
    },
    getContent: ({ preserveEditing = false } = {}) => {
      if (preserveEditing) {
        if (editing) pushHistory();
      } else finishEdit();
      return { html: serialize(), css, notes: getNotes() };
    },
    isInteracting: () => !!drag || composing,
    getPage: () => ({
      current,
      count: slides().length,
      note: structuredClone(pageNotes[current]),
      transition: slide().dataset.transition || "none",
    }),
    updatePage: ({ transition }) => {
      const allowed = new Set(["none", "fade", "slide", "zoom"]);
      slide().dataset.transition = allowed.has(transition)
        ? transition
        : "none";
      pushHistory();
    },
    updateAllPages: ({ transition }) => {
      const allowed = new Set(["none", "fade", "slide", "zoom"]),
        value = allowed.has(transition) ? transition : "none";
      for (const page of slides()) page.dataset.transition = value;
      pushHistory();
    },
    updateNote: (values) => {
      if (
        Object.entries(values).every(
          ([key, value]) => pageNotes[current][key] === value,
        )
      )
        return;
      pageNotes[current] = { ...pageNotes[current], ...values };
      pushHistory(false);
    },
    destroy: () => {
      observer?.disconnect();
      guides?.destroy();
      window.removeEventListener("themechange", updateTheme);
    },
  };
}
