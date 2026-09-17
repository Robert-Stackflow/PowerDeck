import { esc } from "../api.js";
import { icon } from "../icons.js";

export function selectMarkup({ id, value, options, label, name = id }) {
  const selected = options.find((o) => o[0] === value) || options[0];
  return `<div class="custom-select"><input type="hidden" id="${esc(id)}" name="${esc(name)}" value="${esc(selected[0])}"><button id="${esc(id)}Trigger" type="button" class="select-trigger" role="combobox" aria-label="${esc(label)}" aria-expanded="false" aria-haspopup="listbox" aria-controls="${esc(id)}Options"><span>${esc(selected[1])}</span>${icon("chevronDown")}</button><div id="${esc(id)}Options" class="select-menu" role="listbox" aria-label="${esc(label)}" popover="auto">${options.map(([v, text], i) => `<button type="button" role="option" tabindex="-1" id="${esc(id)}Option${i}" data-value="${esc(v)}" aria-selected="${v === selected[0]}"><span>${esc(text)}</span>${icon("check")}</button>`).join("")}</div></div>`;
}
export function enhanceSelects(root = document) {
  root.querySelectorAll(".custom-select").forEach((el) => {
    if (el.dataset.ready) return;
    el.dataset.ready = "true";
    const input = el.querySelector("input"),
      trigger = el.querySelector(".select-trigger"),
      menu = el.querySelector(".select-menu"),
      options = [...menu.querySelectorAll('[role="option"]')];
    let active = options.findIndex((o) => o.dataset.value === input.value),
      search = "",
      lastKey = 0;
    const highlight = () => {
      options.forEach((o, i) =>
        o.classList.toggle("highlighted", i === active),
      );
      trigger.setAttribute("aria-activedescendant", options[active].id);
      options[active].scrollIntoView({ block: "nearest" });
    };
    const open = () => {
      if (menu.matches(":popover-open")) return;
      const r = trigger.getBoundingClientRect(),
        width = Math.min(Math.max(r.width, 170), innerWidth - 24);
      menu.style.width = width + "px";
      menu.style.left =
        Math.max(12, Math.min(r.left, innerWidth - width - 12)) + "px";
      menu.style.top =
        Math.min(
          r.bottom + 6,
          innerHeight - Math.min(options.length * 42 + 12, 250) - 12,
        ) + "px";
      menu.showPopover();
      trigger.setAttribute("aria-expanded", "true");
      active = Math.max(
        0,
        options.findIndex((o) => o.dataset.value === input.value),
      );
      highlight();
    };
    const close = () => {
      if (menu.matches(":popover-open")) menu.hidePopover();
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
    };
    menu.addEventListener("toggle", () => {
      trigger.setAttribute(
        "aria-expanded",
        String(menu.matches(":popover-open")),
      );
      if (!menu.matches(":popover-open"))
        trigger.removeAttribute("aria-activedescendant");
    });
    const choose = (i) => {
      input.value = options[i].dataset.value;
      trigger.querySelector("span").textContent =
        options[i].querySelector("span").textContent;
      options.forEach((o, n) =>
        o.setAttribute("aria-selected", String(n === i)),
      );
      close();
      trigger.focus();
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    let openOnPointerDown = false;
    trigger.onpointerdown = () => {
      openOnPointerDown = menu.matches(":popover-open");
    };
    trigger.onclick = () => {
      if (openOnPointerDown) close();
      else open();
      openOnPointerDown = false;
    };
    options.forEach((o, i) => {
      o.onclick = () => choose(i);
      o.onpointermove = () => {
        active = i;
        highlight();
      };
      o.onmousedown = (e) => e.preventDefault();
    });
    trigger.onkeydown = (e) => {
      if (e.key === "Tab" || e.key === "Escape") {
        if (e.key === "Escape" && menu.matches(":popover-open")) {
          e.preventDefault();
          e.stopPropagation();
        }
        close();
        return;
      }
      if (
        ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(e.key)
      ) {
        e.preventDefault();
        if (!menu.matches(":popover-open")) {
          open();
          return;
        }
        if (e.key === "Enter" || e.key === " ") {
          choose(active);
          return;
        }
        active =
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? options.length - 1
              : (active + (e.key === "ArrowDown" ? 1 : -1) + options.length) %
                options.length;
        highlight();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        open();
        search = Date.now() - lastKey > 700 ? e.key : search + e.key;
        lastKey = Date.now();
        const i = options.findIndex((o) =>
          o.textContent.trim().toLowerCase().startsWith(search.toLowerCase()),
        );
        if (i >= 0) {
          active = i;
          highlight();
        }
      }
    };
  });
}
window.addEventListener("resize", () =>
  document
    .querySelectorAll(".select-menu:popover-open")
    .forEach((m) => m.hidePopover()),
);

export function setSelectValue(input, value) {
  input.value = value;
  const root = input.closest(".custom-select"),
    options = root.querySelectorAll("[role=option]");
  for (const option of options) {
    option.setAttribute(
      "aria-selected",
      String(option.dataset.value === value),
    );
    if (option.dataset.value === value)
      root.querySelector(".select-trigger span").textContent =
        option.querySelector("span").textContent;
  }
}
