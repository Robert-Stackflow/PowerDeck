import { icon } from "../icons.js";
export function formulaEditor(root, { onApply, onError }) {
  const dialog = document.createElement("dialog");
  dialog.className = "formula-dialog";
  dialog.setAttribute("aria-label", "编辑公式");
  dialog.innerHTML = `<form><div class="dialog-head"><h2>公式</h2><button type="button" class="icon-button formula-close" aria-label="关闭公式编辑">${icon("x")}</button></div><label>LaTeX<textarea class="formula-source" spellcheck="false" aria-label="公式源码" rows="5"></textarea></label><div class="formula-templates">${[
    ["\\frac{a}{b}", "分式"],
    ["\\sum_{i=1}^{n} x_i", "求和"],
    ["\\sqrt{x}", "根式"],
    [
      "\\mathcal{L} = -\\mathbb{E}\\,[\\log \\pi_\\theta(y\\mid x)]",
      "损失函数",
    ],
  ]
    .map(
      ([tex, label]) =>
        `<button type="button" data-tex="${tex}">${label}</button>`,
    )
    .join(
      "",
    )}</div><div class="formula-preview" aria-label="公式预览"></div><p class="formula-error form-error" role="alert"></p><div class="dialog-footer"><button type="button" class="button subtle formula-close">取消</button><button type="submit" class="button primary formula-apply">应用</button></div></form>`;
  root.append(dialog);
  const source = dialog.querySelector(".formula-source"),
    preview = dialog.querySelector(".formula-preview"),
    error = dialog.querySelector(".formula-error"),
    apply = dialog.querySelector(".formula-apply");
  let renderer,
    markup = "",
    insert = false;
  function render() {
    try {
      if (!source.value.trim()) throw new Error("请输入公式");
      markup = renderer.renderToString(source.value, {
        displayMode: true,
        throwOnError: true,
        trust: false,
        strict: "ignore",
        maxExpand: 1000,
        output: "htmlAndMathml",
      });
      preview.innerHTML = markup;
      error.textContent = "";
      apply.disabled = false;
    } catch (e) {
      preview.replaceChildren();
      error.textContent = e.message.replace(/^KaTeX parse error:\s*/, "");
      apply.disabled = true;
    }
  }
  source.oninput = render;
  dialog
    .querySelectorAll(".formula-close")
    .forEach((b) => (b.onclick = () => dialog.close()));
  dialog.querySelectorAll("[data-tex]").forEach(
    (b) =>
      (b.onclick = () => {
        source.setRangeText(
          b.dataset.tex,
          source.selectionStart,
          source.selectionEnd,
          "end",
        );
        source.focus();
        render();
      }),
  );
  dialog.querySelector("form").onsubmit = (e) => {
    e.preventDefault();
    render();
    if (apply.disabled) return;
    onApply({ tex: source.value, html: markup, insert });
    dialog.close();
  };
  return {
    async open(tex, creating = false) {
      try {
        renderer ||= (await import("/static/katex/katex.mjs")).default;
        insert = creating;
        source.value = tex || "E = mc^2";
        render();
        dialog.showModal();
        source.focus();
        source.select();
      } catch (e) {
        onError(new Error("公式编辑器加载失败，请重试"));
      }
    },
    destroy() {
      dialog.remove();
    },
  };
}
