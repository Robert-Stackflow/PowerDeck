import { esc } from "../api.js";

export function parseSlides(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc
    .querySelectorAll("script,style,iframe,object,embed,base,meta,link,form")
    .forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((node) => {
    for (const attr of [...node.attributes]) {
      if (
        /^on/i.test(attr.name) ||
        attr.name === "srcdoc" ||
        attr.name.startsWith("data-ve-") ||
        (["href", "src", "xlink:href"].includes(attr.name) &&
          /^\s*(javascript|vbscript):/i.test(attr.value))
      )
        node.removeAttribute(attr.name);
    }
  });
  const slides = [...doc.querySelectorAll(".slide")].filter(
    (slide) => !slide.parentElement.closest(".slide"),
  );
  if (!slides.length || slides.length > 200)
    throw new Error('页面需要包含 1–200 个 class="slide" 的元素。');
  const ids = new Set();
  for (const slide of slides) {
    if (!slide.dataset.slideId || ids.has(slide.dataset.slideId))
      slide.dataset.slideId = "slide-" + crypto.randomUUID().slice(0, 12);
    ids.add(slide.dataset.slideId);
  }
  return slides;
}

export function visualDocument({
  html,
  css,
  baseCSS,
  baseURL,
  width,
  height,
  thumbnail = false,
}) {
  const styles = (baseCSS + "\n" + css).replace(/<\/style/gi, "<\\/style");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline' 'self'; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'"><base href="${esc(baseURL)}"><style>${styles}</style><style>
    html,body{margin:0!important;overflow:hidden!important;width:100%;height:100%;background:${thumbnail ? "transparent" : "var(--editor-stage-bg,#e9edeb)"}!important}
    #stage{position:fixed!important;inset:0!important;display:flex!important;align-items:center!important;justify-content:center!important}
    #deck{position:relative!important;flex:none!important;width:${width}px!important;height:${height}px!important;transform:scale(var(--ve-scale,1))!important;transform-origin:center!important;box-shadow:${thumbnail ? "none" : "0 8px 40px #163b2b15"}}
    #deck>.slide{position:absolute!important;inset:0!important;width:${width}px!important;height:${height}px!important;display:none!important}
    #deck>.slide[data-ve-current]{display:block!important}
    #deck *{animation:none!important;transition:none!important;caret-color:#276455}
    #deck [data-ve-editing]{outline:2px solid #458c78!important;outline-offset:4px;cursor:text!important;user-select:text!important;white-space:pre-wrap}
    ${thumbnail ? `#deck{--ve-scale:calc(100vw / ${width}px)!important}#deck>.slide{display:block!important}` : `#deck{user-select:none;touch-action:none}#deck a{cursor:default!important}#deck [data-ve-selected]{outline:1px solid #3c8a7280!important;outline-offset:2px}#ve-selection{position:fixed;border:1.5px solid #3c8a72;pointer-events:none;z-index:2147483646;box-sizing:border-box}#ve-selection[hidden]{display:none!important}#ve-selection button{all:initial;position:absolute;box-sizing:border-box;width:10px;height:10px;background:#fff;border:1.5px solid #3c8a72;border-radius:2px;pointer-events:auto;touch-action:none}#ve-selection[data-multi=true] button{display:none}#ve-selection [data-handle=nw]{left:-5px;top:-5px;cursor:nwse-resize}#ve-selection [data-handle=ne]{right:-5px;top:-5px;cursor:nesw-resize}#ve-selection [data-handle=sw]{left:-5px;bottom:-5px;cursor:nesw-resize}#ve-selection [data-handle=se]{right:-5px;bottom:-5px;cursor:nwse-resize}`}
  </style></head><body><div id="stage"><div id="deck">${html}</div></div></body></html>`;
}

export function cloneWithFreshIds(element) {
  const clone = element.cloneNode(true),
    ids = new Map();
  [clone, ...clone.querySelectorAll("[id]")].forEach((node) => {
    if (node.id) {
      const id = "copy-" + crypto.randomUUID().slice(0, 12);
      ids.set(node.id, id);
      node.id = id;
    }
  });
  [clone, ...clone.querySelectorAll("*")].forEach((node) => {
    for (const attr of [...node.attributes]) {
      let value = attr.value.replace(/url\(#([^)]*)\)/g, (match, id) =>
        ids.has(id) ? `url(#${ids.get(id)})` : match,
      );
      if (["href", "xlink:href"].includes(attr.name) && ids.has(value.slice(1)))
        value = "#" + ids.get(value.slice(1));
      if (["aria-labelledby", "aria-describedby"].includes(attr.name))
        value = value
          .split(" ")
          .map((id) => ids.get(id) || id)
          .join(" ");
      node.setAttribute(attr.name, value);
    }
    node.removeAttribute("data-ve-current");
  });
  if (clone.classList.contains("slide"))
    clone.dataset.slideId = "slide-" + crypto.randomUUID().slice(0, 12);
  return clone;
}
