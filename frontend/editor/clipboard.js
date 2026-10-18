import { parseSlides, cloneWithFreshIds } from "./document.js";
import { imageSize } from "./image-size.js";

const type = "application/x-powerdeck-elements+json";
const limit = 4_000_000;
const textInput = (target) =>
  target.closest?.("input,textarea,[contenteditable]");
const link = (value) => {
  try {
    const text = String(value || "").trim();
    if (!/^(https?:\/\/|mailto:|tel:)/i.test(text) || /\s/.test(text))
      return "";
    const url = new URL(text);
    return ["https:", "http:", "mailto:", "tel:"].includes(url.protocol)
      ? url.href
      : "";
  } catch {
    return "";
  }
};

// Properties that define the visible identity of a component when it is
// detached from contextual selectors such as `.stack > div`. Geometry for the
// copied root is set separately from its measured box.
const visualProperties = [
  "display",
  "flex-direction",
  "flex-wrap",
  "align-items",
  "align-content",
  "justify-content",
  "justify-items",
  "gap",
  "row-gap",
  "column-gap",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "background-color",
  "background-image",
  "background-position",
  "background-size",
  "background-repeat",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-radius",
  "box-shadow",
  "opacity",
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "font-variant",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration-line",
  "text-decoration-color",
  "text-decoration-style",
  "text-transform",
  "white-space",
  "overflow-wrap",
  "word-break",
];

function materializeVisualStyles(source, clone, view) {
  const originals = [source, ...source.querySelectorAll("*")],
    copies = [clone, ...clone.querySelectorAll("*")];
  originals.forEach((node, index) => {
    const target = copies[index];
    if (!target) return;
    const computed = view.getComputedStyle(node);
    for (const property of visualProperties) {
      const value = computed.getPropertyValue(property);
      if (value) target.style.setProperty(property, value);
    }
  });
}

// Uses native clipboard events: no background clipboard reads or permission prompts.
export function createCanvasClipboard({
  doc,
  baseURL,
  getSlide,
  getSelected,
  isEditing,
  getScale,
  setStyle,
  commit,
  remove,
  uploadImages,
  onError,
}) {
  let lastId,
    count = 0,
    lastPayload = null,
    lastPlainText = "";
  function copy(event) {
    if (isEditing() || textInput(event.target) || !event.clipboardData) return;
    const selection = [...getSelected()];
    const nodes = selection.filter(
      (node) =>
        !selection.some((other) => other !== node && other.contains(node)),
    );
    if (!nodes.length) return;
    const parent = getSlide().getBoundingClientRect(),
      scale = getScale();
    const payload = {
      format: "powerdeck-elements",
      version: 1,
      id: crypto.randomUUID(),
      baseURL,
      nodes: nodes.map((node) => {
        const box = node.getBoundingClientRect();
        const template = doc.createElement("template");
        template.innerHTML = node.outerHTML;
        const clone = template.content.firstElementChild;
        for (const item of [clone, ...clone.querySelectorAll("*")]) {
          if (item.hasAttribute("data-ve-image-options"))
            for (const [name, value] of Object.entries(
              JSON.parse(item.getAttribute("data-ve-image-options")),
            ))
              value === null
                ? item.removeAttribute(name)
                : item.setAttribute(name, value);
          for (const attr of [...item.attributes])
            if (attr.name.startsWith("data-ve-"))
              item.removeAttribute(attr.name);
        }
        materializeVisualStyles(node, clone, doc.defaultView);
        setStyle(clone, {
          position: "absolute",
          left: `${(box.left - parent.left) / scale}px`,
          top: `${(box.top - parent.top) / scale}px`,
          width: `${box.width / scale}px`,
          height: `${box.height / scale}px`,
          margin: "0",
          translate: "none",
          boxSizing: "border-box",
        });
        return clone.outerHTML;
      }),
    };
    const json = JSON.stringify(payload);
    if (json.length > limit) {
      onError(new Error("所选组件过大，请分批复制"));
      return;
    }
    const wrapper = doc.createElement("div");
    wrapper.setAttribute("data-powerdeck-elements", json);
    wrapper.innerHTML = payload.nodes.join("");
    lastPayload = payload;
    lastPlainText =
      nodes
        .map((node) => node.innerText || node.getAttribute("alt") || "")
        .join("\n") || "PowerDeck components";
    event.clipboardData.setData(type, json);
    event.clipboardData.setData("text/html", wrapper.outerHTML);
    event.clipboardData.setData("text/plain", lastPlainText);
    event.preventDefault();
    if (event.type === "cut") remove();
  }
  async function paste(event) {
    if (isEditing() || textInput(event.target) || !event.clipboardData) return;
    const data = event.clipboardData,
      target = getSlide();
    try {
      const html = data.getData("text/html");
      if (html.length > limit) throw new Error("粘贴内容过大，请分批粘贴");
      const template = doc.createElement("template");
      template.innerHTML = html;
      let encoded =
        data.getData(type) ||
        template.content
          .querySelector("[data-powerdeck-elements]")
          ?.getAttribute("data-powerdeck-elements");
      // Some Windows clipboard paths keep only text/plain. When it still
      // matches the most recent in-editor copy, use the in-memory structured
      // payload rather than degrading the component into plain text.
      if (
        !encoded &&
        lastPayload &&
        data.getData("text/plain") === lastPlainText &&
        !data.files.length
      )
        encoded = JSON.stringify(lastPayload);
      if (encoded) {
        event.preventDefault();
        if (encoded.length > limit) throw new Error("复制的组件过大");
        const payload = JSON.parse(encoded);
        if (
          payload.format !== "powerdeck-elements" ||
          payload.version !== 1 ||
          !Array.isArray(payload.nodes) ||
          !payload.nodes.length ||
          payload.nodes.length > 200 ||
          payload.nodes.some((node) => typeof node !== "string")
        )
          throw new Error("无法识别复制的组件");
        const source = parseSlides(
          `<section class="slide">${payload.nodes.join("")}</section>`,
        )[0];
        const clean = cloneWithFreshIds(source);
        count = lastId === payload.id ? count + 1 : 1;
        lastId = payload.id;
        for (const image of clean.querySelectorAll("img[src]")) {
          const sourceURL = new URL(
            image.getAttribute("src"),
            payload.baseURL || baseURL,
          );
          if (
            payload.baseURL !== baseURL &&
            sourceURL.origin === location.origin
          )
            image.setAttribute("src", sourceURL.href);
        }
        const nodes = [...clean.children];
        for (const node of nodes)
          setStyle(node, {
            left: `${(parseFloat(node.style.left) || 0) + 24 * Math.min(count, 12)}px`,
            top: `${(parseFloat(node.style.top) || 0) + 24 * Math.min(count, 12)}px`,
          });
        commit(nodes, target);
        return;
      }
      const files = [...data.files].filter((file) =>
        file.type.startsWith("image/"),
      );
      if (files.length) {
        event.preventDefault();
        const paths = await uploadImages(files);
        const nodes = await Promise.all(
          paths.map(async (src, i) => {
            const image = doc.createElement("img");
            image.dataset.editorElement = "image";
            image.src = src;
            image.alt = "";
            setStyle(image, {
              position: "absolute",
              left: `${120 + i * 24}px`,
              top: `${180 + i * 24}px`,
              ...(await imageSize(image)),
              zIndex: "10",
            });
            return image;
          }),
        );
        if (nodes.length) commit(nodes, target);
        return;
      }
      const uri = data
          .getData("text/uri-list")
          .split(/\r?\n/)
          .find((line) => line && !line.startsWith("#")),
        text =
          data.getData("text/plain") ||
          uri ||
          template.content.textContent ||
          "";
      if (!text.trim()) return;
      if (text.length > 100_000) throw new Error("粘贴文字过长，请分段粘贴");
      event.preventDefault();
      const node = doc.createElement("div");
      node.dataset.editorElement = "text";
      node.textContent = text;
      setStyle(node, {
        position: "absolute",
        left: "120px",
        top: "180px",
        width: "700px",
        maxHeight: "650px",
        overflow: "auto",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        fontSize: "32px",
        lineHeight: "1.4",
        color: "#243d36",
        zIndex: "10",
      });
      const href =
        link(uri || text) ||
        link(template.content.querySelector("a[href]")?.getAttribute("href"));
      if (href) node.setAttribute("data-editor-href", href);
      commit([node], target);
    } catch (error) {
      event.preventDefault();
      onError(error);
    }
  }
  return { copy, paste };
}
