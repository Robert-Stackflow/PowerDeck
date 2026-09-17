const escape = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function playerDocument({
  html,
  css,
  notes,
  meta,
  baseURL,
  baseCSS,
  playerCSS,
}) {
  const text = Object.entries(notes)
    .map(
      ([n, s]) =>
        `<button class="toc-item" data-goto="${n}"><b>${String(n).padStart(2, "0")}</b><span>${escape(s.title)}</span></button>`,
    )
    .join("");
  const styles = (baseCSS + "\n" + css + "\n" + playerCSS).replace(
    /<\/style/gi,
    "<\\/style",
  );
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline' 'self'; img-src 'self' data: blob:; font-src 'self' data:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'"><base href="${escape(baseURL)}"><title>${escape(meta.title)}</title><style>${styles}</style><style>:root{--slide-width:${Number(meta.width)}px;--slide-height:${Number(meta.height)}px}#deck,.slide{width:var(--slide-width);height:var(--slide-height)}@media print{@page{size:${Number(meta.width)}px ${Number(meta.height)}px;margin:0}#deck{width:var(--slide-width)}}</style><link rel="stylesheet" href="/static/components/scrollbars.css"><link rel="stylesheet" href="/static/components/toast.css"><link rel="stylesheet" href="/static/player/timer.css"></head><body><div id="stage"><div id="deck">${html}</div></div><nav id="controls" aria-label="演示控制"></nav><div id="progress"><i></i></div><div id="panelBackdrop" hidden></div><div id="overview" class="overlay" role="dialog" aria-modal="true" aria-labelledby="overviewTitle" hidden><div class="overlay-head"><h2 id="overviewTitle">目录</h2><button class="dialog-close" data-close="overview" aria-label="关闭目录"></button></div><div class="overview-list">${text}</div></div><aside id="notes" class="overlay" role="dialog" aria-modal="true" aria-labelledby="notesTitle" hidden><div class="overlay-head"><h2 id="notesTitle"></h2><button class="dialog-close" data-close="notes" aria-label="关闭备注"></button></div><div id="notesBody"></div></aside><div id="toast" role="status"></div><template id="notesData">${escape(JSON.stringify(notes))}</template></body></html>`;
}
