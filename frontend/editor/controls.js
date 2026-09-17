import { icon } from "../icons.js";

export function numberField(name, label, min = -10000, max = 10000) {
  return `<label>${label}<span class="number-control"><input type="number" name="${name}" aria-label="${label}" min="${min}" max="${max}" step="1"><span class="number-buttons"><button type="button" data-step="1" aria-label="增加${label}">${icon("chevronUp")}</button><button type="button" data-step="-1" aria-label="减小${label}">${icon("chevronDown")}</button></span></span></label>`;
}
export function enhanceNumbers(root) {
  root.querySelectorAll("[data-step]").forEach((button) => {
    button.onmousedown = (e) => e.preventDefault();
    button.onclick = () => {
      const input = button.closest(".number-control").querySelector("input");
      if (!Number.isFinite(input.valueAsNumber)) input.value = input.min || 0;
      Number(button.dataset.step) > 0 ? input.stepUp() : input.stepDown();
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
  });
}
export function normalizeColor(value) {
  if (!value || value === "transparent" || /rgba\([^)]*,\s*0\)$/.test(value))
    return "transparent";
  if (/^#[a-f\d]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[a-f\d]{3}$/i.test(value))
    return "#" + [...value.slice(1)].map((x) => x + x).join("");
  const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return rgb
    ? "#" +
        rgb
          .slice(1, 4)
          .map((x) => Number(x).toString(16).padStart(2, "0"))
          .join("")
    : "#243d36";
}
export function colorField(name, label) {
  return `<label>${label}<input type="hidden" name="${name}"><button type="button" class="color-control" data-color-field="${name}" aria-label="${label}" aria-haspopup="dialog"><i class="color-chip"></i><span></span>${icon("chevronDown")}</button></label>`;
}
export function setColorField(root, name, value) {
  value = normalizeColor(value);
  root.querySelector(`[name="${name}"]`).value = value;
  const button = root.querySelector(`[data-color-field="${name}"]`);
  button.querySelector(".color-chip").style.setProperty("--swatch", value);
  button.querySelector("span").textContent =
    value === "transparent" ? "无颜色" : value.toUpperCase();
}
const palette = [
  "#ffffff",
  "#111827",
  "#e7e6e6",
  "#44546a",
  "#365f51",
  "#4472c4",
  "#70ad47",
  "#ed7d31",
  "#ffc000",
  "#a855f7",
  "#f2f2f2",
  "#6b7280",
  "#d0cece",
  "#adb9ca",
  "#b5d0c2",
  "#b4c6e7",
  "#c5e0b4",
  "#f8cbad",
  "#ffe699",
  "#e9d5ff",
  "#d9d9d9",
  "#374151",
  "#aeaaaa",
  "#8497b0",
  "#84af99",
  "#8ea9db",
  "#a9d18e",
  "#f4b183",
  "#ffd966",
  "#c084fc",
  "#bfbfbf",
  "#1f2937",
  "#767171",
  "#333f50",
  "#254638",
  "#2f5597",
  "#548235",
  "#c55a11",
  "#bf9000",
  "#7e22ce",
];
const standard = [
  "#c00000",
  "#ff0000",
  "#ff9900",
  "#ffff00",
  "#92d050",
  "#00b050",
  "#00b0f0",
  "#0070c0",
  "#002060",
  "#7030a0",
];
const swatches = (colors) =>
  colors
    .map(
      (color) =>
        `<button type="button" class="color-swatch" style="--swatch:${color}" data-color="${color}" aria-label="${color.toUpperCase()}" title="${color.toUpperCase()}"></button>`,
    )
    .join("");
const hsvToHex = (h, s, v) => {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))))
      .toString(16)
      .padStart(2, "0");
  };
  return "#" + f(5) + f(3) + f(1);
};
const hexToHSV = (hex) => {
  const [r, g, b] = hex.match(/[a-f\d]{2}/gi).map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    d = max - min;
  let h =
    d === 0
      ? 0
      : max === r
        ? ((g - b) / d) % 6
        : max === g
          ? (b - r) / d + 2
          : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max === 0 ? 0 : d / max, max];
};
export function createColorPicker(root, onError) {
  const panel = document.createElement("div");
  panel.className = "editor-popover color-popover";
  panel.setAttribute("popover", "auto");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "选择颜色");
  panel.innerHTML = `<div class="color-picker-heading"><b>颜色</b><button type="button" class="icon-button color-close" aria-label="关闭颜色面板">${icon("x")}</button></div><h3>主题颜色</h3><div class="color-grid">${swatches(palette)}</div><h3>标准颜色</h3><div class="color-grid">${swatches(standard)}</div><div class="recent-colors"><h3>最近使用</h3><div class="color-grid"></div></div><div class="color-picker-actions"><button type="button" data-transparent>${icon("ban")}无颜色</button><button type="button" data-eyedropper>${icon("pipette")}取色器</button></div><div class="color-spectrum" tabindex="0" role="group" aria-label="饱和度与明度，方向键调整"><i></i></div><input class="color-hue" type="range" min="0" max="359" aria-label="色相"><div class="color-custom"><i class="color-chip"></i><input class="color-hex" aria-label="十六进制颜色" maxlength="7" spellcheck="false"><button type="button" class="button primary color-apply">应用</button></div><p class="color-error" role="alert"></p>`;
  root.append(panel);
  const $ = (s) => panel.querySelector(s);
  let commit = null,
    anchor,
    hue = 0,
    saturation = 0,
    brightness = 1,
    picked = "#ffffff",
    controller;
  let recent = [];
  try {
    recent = JSON.parse(localStorage.getItem("editor.recentColors") || "[]")
      .filter((c) => /^#[a-f\d]{6}$/i.test(c))
      .slice(0, 10);
  } catch {}
  const renderRecent = () => {
    $(".recent-colors").hidden = !recent.length;
    $(".recent-colors .color-grid").innerHTML = swatches(recent);
  };
  const close = () => {
    controller?.abort();
    if (panel.matches(":popover-open")) panel.hidePopover();
  };
  function apply(color) {
    if (!commit) return;
    const callback = commit;
    if (color !== "transparent") {
      recent = [color, ...recent.filter((c) => c !== color)].slice(0, 10);
      try {
        localStorage.setItem("editor.recentColors", JSON.stringify(recent));
      } catch {}
    }
    close();
    callback(color);
    anchor?.focus();
  }
  function render() {
    picked = hsvToHex(hue, saturation, brightness);
    $(".color-spectrum").style.backgroundColor = `hsl(${hue} 100% 50%)`;
    $(".color-spectrum i").style.left = saturation * 100 + "%";
    $(".color-spectrum i").style.top = (1 - brightness) * 100 + "%";
    $(".color-spectrum").setAttribute(
      "aria-label",
      `饱和度 ${Math.round(saturation * 100)}%，明度 ${Math.round(brightness * 100)}%，方向键调整`,
    );
    $(".color-hue").value = hue;
    $(".color-custom .color-chip").style.setProperty("--swatch", picked);
    $(".color-hex").value = picked.toUpperCase();
    $(".color-error").textContent = "";
  }
  const eyedropper = $("[data-eyedropper]");
  eyedropper.disabled = !("EyeDropper" in window);
  if (eyedropper.disabled)
    eyedropper.title = "当前浏览器不支持屏幕取色，可使用色板或输入颜色";
  eyedropper.onclick = async () => {
    controller = new AbortController();
    const callback = commit;
    try {
      const result = await new EyeDropper().open({ signal: controller.signal });
      if (commit === callback && panel.matches(":popover-open"))
        apply(result.sRGBHex.toLowerCase());
    } catch (error) {
      if (error.name !== "AbortError")
        onError(new Error("取色失败，请重试或使用色板"));
    }
  };
  panel.addEventListener("toggle", () => {
    if (!panel.matches(":popover-open")) {
      controller?.abort();
      commit = null;
      anchor?.setAttribute("aria-expanded", "false");
    }
  });
  $(".color-close").onclick = close;
  $("[data-transparent]").onclick = () => apply("transparent");
  panel.onclick = (e) => {
    const b = e.target.closest("[data-color]");
    if (b) apply(b.dataset.color);
  };
  $(".color-hue").oninput = (e) => {
    hue = Number(e.target.value);
    render();
  };
  function plane(e) {
    const r = $(".color-spectrum").getBoundingClientRect();
    saturation = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    brightness = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    render();
  }
  $(".color-spectrum").onpointerdown = (e) => {
    e.preventDefault();
    e.currentTarget.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    plane(e);
  };
  $(".color-spectrum").onpointermove = (e) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) plane(e);
  };
  $(".color-spectrum").onkeydown = (e) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
      return;
    e.preventDefault();
    e.stopPropagation();
    saturation = Math.max(
      0,
      Math.min(
        1,
        saturation +
          (e.key === "ArrowRight" ? 0.01 : e.key === "ArrowLeft" ? -0.01 : 0),
      ),
    );
    brightness = Math.max(
      0,
      Math.min(
        1,
        brightness +
          (e.key === "ArrowUp" ? 0.01 : e.key === "ArrowDown" ? -0.01 : 0),
      ),
    );
    render();
  };
  function custom() {
    let value = $(".color-hex").value.trim();
    if (!value.startsWith("#")) value = "#" + value;
    if (!/^#([a-f\d]{3}|[a-f\d]{6})$/i.test(value)) {
      $(".color-error").textContent = "请输入有效的十六进制颜色";
      return;
    }
    apply(normalizeColor(value));
  }
  $(".color-apply").onclick = custom;
  $(".color-hex").onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      custom();
    }
  };
  return {
    open(button, value, onPick) {
      close();
      anchor = button;
      commit = onPick;
      renderRecent();
      [hue, saturation, brightness] = hexToHSV(
        normalizeColor(value) === "transparent"
          ? "#ffffff"
          : normalizeColor(value),
      );
      render();
      panel.showPopover();
      button.setAttribute("aria-expanded", "true");
      const r = button.getBoundingClientRect(),
        box = { width: panel.offsetWidth, height: panel.offsetHeight };
      panel.style.left =
        Math.max(8, Math.min(r.right - box.width, innerWidth - box.width - 8)) +
        "px";
      panel.style.top =
        Math.max(20, Math.min(r.bottom + 6, innerHeight - box.height - 20)) +
        "px";
    },
    close,
    destroy() {
      close();
      panel.remove();
    },
  };
}
