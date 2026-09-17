import { api, esc, fileBase64 } from "../api.js";
import { icon } from "../icons.js";
import { showDialog, closeDialog, toast } from "../app.js";
import { selectMarkup } from "../components/select.js";
export function setupImport({ onImported, getSection }) {
  const input = document.querySelector("#importFile"),
    modal = document.querySelector("#dialog");
  input.accept = ".zip,.html,.htm,.json,.pptx,.ppt";
  input.onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const zip = /\.zip$/i.test(file.name);
      const limit = zip ? 200 : 40;
      if (file.size > limit * 1024 * 1024)
        throw new Error(`导入文件需小于 ${limit} MB`);
      const ppt = /\.pptx?$/i.test(file.name),
        json = /\.json$/i.test(file.name);
      if (!zip && !ppt && !json && !/\.html?$/i.test(file.name))
        throw new Error(
          "请选择 ZIP 内容包、PowerPoint、HTML 或旧版 .deck.json 文件",
        );
      let pack = {
        title: file.name.replace(/\.(pptx?|html?|deck\.json|json|zip)$/i, ""),
      };
      if (json) {
        pack = JSON.parse(await file.text());
        if (pack.format !== "deck-library/v1")
          throw new Error("请选择演示库导出的 .deck.json 内容包");
      }
      if (!zip && !ppt && !json) pack.html = await file.text();
      showDialog(
        ppt ? "导入 PowerPoint" : zip ? "导入 ZIP 内容包" : "导入内容",
        `<div class="import-file">${icon(ppt ? "presentation" : "fileCode2")}<span>${esc(file.name)}</span><small>${(file.size / 1024 / 1024).toFixed(1)} MB</small></div><label>名称<input name="title" value="${esc(pack.title)}" maxlength="120" required></label><label>导入为${selectMarkup(
          {
            id: "importMode",
            name: "mode",
            label: "导入方式",
            value:
              getSection() === "templates"
                ? ppt
                  ? "masters"
                  : "template"
                : "slides",
            options: ppt
              ? [
                  ["slides", "文稿 · 导入全部幻灯片"],
                  ["masters", "模板 · 提取母版和版式"],
                ]
              : [
                  ["slides", "文稿"],
                  ["template", "模板"],
                ],
          },
        )}</label>${ppt || zip ? "" : `<label>配套图片 / 字体（可选）<input id="importAssets" type="file" multiple accept="image/*,.woff,.woff2,.ttf"></label>${json ? "" : '<label>样式文件（可选）<input id="importCSS" type="file" accept=".css"></label>'}`}<div id="importProgress" class="import-progress" role="status" hidden>${icon("loaderCircle")}<span>${ppt ? "正在解析 PowerPoint…" : "正在导入…"}</span></div>`,
        {
          submit: "导入",
          className: "import-dialog",
          onSubmit: async (f) => {
            const progress = modal.querySelector("#importProgress"),
              buttons = [...modal.querySelectorAll(".close-dialog")];
            const mode = modal.querySelector("#importMode").value;
            progress.hidden = false;
            modal.setAttribute("aria-busy", "true");
            buttons.forEach((b) => (b.disabled = true));
            const block = (e) => e.preventDefault();
            modal.addEventListener("cancel", block);
            let result;
            try {
              if (ppt)
                result = await api("/import/powerpoint", {
                  method: "POST",
                  body: {
                    ...(await fileBase64(file)),
                    title: f.get("title"),
                    mode,
                  },
                });
              else if (zip) {
                const params = new URLSearchParams({
                  title: f.get("title"),
                  kind: mode === "template" ? "template" : "deck",
                });
                result = await api("/import/package?" + params, {
                  method: "POST",
                  body: file,
                  headers: { "Content-Type": "application/zip" },
                });
              } else {
                const assets = await Promise.all(
                  [...modal.querySelector("#importAssets").files].map(
                    fileBase64,
                  ),
                );
                const css = modal.querySelector("#importCSS")?.files[0];
                const deck = await api("/decks", {
                  method: "POST",
                  body: {
                    ...pack,
                    title: f.get("title"),
                    kind: mode === "template" ? "template" : "deck",
                    css:
                      (pack.css || "") + (css ? "\n" + (await css.text()) : ""),
                    assets: [...(pack.assets || []), ...assets],
                  },
                });
                result = { deck, warnings: [] };
              }
              await onImported(result.deck);
            } finally {
              progress.hidden = true;
              modal.removeAttribute("aria-busy");
              buttons.forEach((b) => (b.disabled = false));
              modal.removeEventListener("cancel", block);
            }
            if (result.warnings.length) {
              showDialog(
                "导入完成",
                `<div class="import-result">${icon("check")}<strong>${esc(result.deck.title)}</strong><span>${result.deck.slideCount} ${result.deck.kind === "template" ? "种版式" : "页"}</span></div><div class="import-notes"><h3>需要检查的内容</h3><ul>${result.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div><div class="dialog-footer"><button type="button" class="button close-dialog">完成</button><a class="button primary" href="/edit/${result.deck.slug}">打开编辑器</a></div>`,
              );
            } else {
              closeDialog();
              toast(
                `已导入 ${result.deck.slideCount} ${result.deck.kind === "template" ? "种版式" : "页"}`,
              );
            }
          },
        },
      );
    } catch (error) {
      toast(error.message);
    }
  };
}
