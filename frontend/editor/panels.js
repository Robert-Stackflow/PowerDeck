// Dimensions belong to the workspace, never to the presentation content.
export function resizePanels(root) {
  const layout = root.querySelector(".visual-layout");
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem("editor.panelSizes") || "{}");
  } catch {}
  const definitions = [
    {
      key: "left",
      label: "页面列表宽度",
      orientation: "vertical",
      host: layout,
      before: root.querySelector(".visual-center"),
      variable: "--rail-width",
      measure: () => root.querySelector(".slide-rail").offsetWidth,
      min: 130,
      max: 400,
      sign: 1,
    },
    {
      key: "right",
      label: "属性面板宽度",
      orientation: "vertical",
      host: layout,
      before: root.querySelector(".visual-inspector"),
      variable: "--inspector-width",
      measure: () => root.querySelector(".visual-inspector").offsetWidth,
      min: 280,
      max: 480,
      sign: -1,
    },
  ];
  let drag = null;
  function limit(d) {
    const other = d.key === "left" ? definitions[1] : definitions[0];
    return Math.max(
      d.min,
      Math.min(d.max, layout.clientWidth - other.measure() - 290),
    );
  }
  function set(d, n) {
    const value = Math.round(Math.max(d.min, Math.min(limit(d), n)));
    root.style.setProperty(d.variable, value + "px");
    saved[d.key] = value;
    d.handle.setAttribute("aria-valuenow", value);
    d.handle.setAttribute("aria-valuemax", limit(d));
  }
  const persist = () => {
    try {
      localStorage.setItem("editor.panelSizes", JSON.stringify(saved));
    } catch {}
  };
  function end() {
    if (!drag) return;
    const { d, shield } = drag;
    drag = null;
    shield.remove();
    d.handle.classList.remove("dragging");
    persist();
  }
  for (const d of definitions) {
    const h = document.createElement("div");
    d.handle = h;
    h.className = "panel-resizer panel-resizer-" + d.key;
    h.tabIndex = 0;
    h.setAttribute("role", "separator");
    h.setAttribute("aria-label", d.label);
    h.setAttribute("aria-orientation", d.orientation);
    h.setAttribute("aria-valuemin", d.min);
    h.setAttribute("aria-valuemax", d.max);
    d.host.insertBefore(h, d.before);
    h.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      h.focus();
      const shield = document.createElement("div");
      shield.className = "panel-resize-shield " + d.orientation;
      document.body.append(shield);
      drag = {
        d,
        shield,
        start: e.clientX,
        size: d.measure(),
      };
      h.classList.add("dragging");
      shield.setPointerCapture(e.pointerId);
      shield.onpointermove = (event) => {
        if (drag) set(d, drag.size + d.sign * (event.clientX - drag.start));
      };
      shield.onpointerup = shield.onpointercancel = end;
    };
    h.onkeydown = (e) => {
      const keys = ["ArrowLeft", "ArrowRight"];
      if (!keys.includes(e.key) && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      e.stopPropagation();
      set(
        d,
        e.key === "Home"
          ? d.min
          : e.key === "End"
            ? limit(d)
            : d.measure() +
              (keys.indexOf(e.key) === 0 ? -1 : 1) *
                d.sign *
                (e.shiftKey ? 32 : 8),
      );
      persist();
    };
    h.ondblclick = () => {
      delete saved[d.key];
      root.style.removeProperty(d.variable);
      h.setAttribute("aria-valuenow", d.measure());
      persist();
    };
  }
  for (const d of definitions) {
    if (Number.isFinite(saved[d.key])) set(d, saved[d.key]);
    d.handle.setAttribute("aria-valuenow", d.measure());
  }
  window.addEventListener("blur", end);
  const observer = new ResizeObserver(() => {
    if (innerWidth <= 760) return;
    for (const d of definitions)
      if (d.measure() > limit(d)) set(d, d.measure());
  });
  observer.observe(layout);
  return {
    destroy() {
      end();
      observer.disconnect();
      window.removeEventListener("blur", end);
      definitions.forEach((d) => d.handle.remove());
    },
  };
}
