import { icon } from "../icons.js";
import { esc } from "../api.js";

export function createEditorMenu(root) {
  const panel = document.createElement("div");
  const submenu = document.createElement("div");
  panel.className = "editor-context-menu";
  panel.id = "editorContextMenu";
  // A contextmenu event may precede the right-button pointerup. Automatic
  // popover dismissal can close a newly opened menu on that same pointerup.
  panel.setAttribute("popover", "manual");
  panel.setAttribute("role", "menu");
  submenu.className = "editor-context-menu editor-context-submenu";
  submenu.setAttribute("popover", "manual");
  submenu.setAttribute("role", "menu");
  root.append(panel, submenu);
  let returnFocus = null;
  function close(restoreFocus = false) {
    if (submenu.matches(":popover-open")) submenu.hidePopover();
    if (panel.matches(":popover-open")) panel.hidePopover();
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
  }
  const outside = (event) => {
    if (!panel.contains(event.target) && !submenu.contains(event.target))
      close();
  };
  document.addEventListener("pointerdown", outside);
  window.addEventListener("resize", close);
  function open({ x, y, items, focus = document.activeElement }) {
    close();
    returnFocus = focus;
    panel.innerHTML = items
      .map((item) =>
        item.separator
          ? '<div class="editor-menu-divider" role="separator"></div>'
          : `<button type="button" role="menuitem" data-menu-action="${esc(item.id)}" ${item.disabled ? "disabled" : ""} ${item.children ? 'aria-haspopup="menu"' : ""} class="${item.danger ? "danger" : ""}">${icon(item.icon)}<span>${esc(item.label)}</span>${item.children ? icon("chevronRight") : item.shortcut ? `<kbd>${esc(item.shortcut)}</kbd>` : ""}</button>`,
      )
      .join("");
    const openSubmenu = (item, button, focusFirst = false) => {
      if (!item?.children?.length) return;
      submenu.innerHTML = item.children
        .map(
          (child) =>
            `<button type="button" role="menuitem" data-submenu-action="${esc(child.id)}" ${child.disabled ? "disabled" : ""}>${icon(child.icon)}<span>${esc(child.label)}</span></button>`,
        )
        .join("");
      submenu.onclick = (event) => {
        const target = event.target.closest("[data-submenu-action]");
        if (!target || target.disabled) return;
        const child = item.children.find(
          (entry) => entry.id === target.dataset.submenuAction,
        );
        close();
        child?.action();
      };
      if (!submenu.matches(":popover-open")) submenu.showPopover();
      const box = button.getBoundingClientRect(),
        menuBox = submenu.getBoundingClientRect(),
        left =
          box.right + menuBox.width <= innerWidth - 8
            ? box.right + 5
            : box.left - menuBox.width - 5;
      submenu.style.left = Math.max(8, left) + "px";
      submenu.style.top =
        Math.max(8, Math.min(box.top, innerHeight - menuBox.height - 8)) + "px";
      if (focusFirst)
        submenu
          .querySelector("button:not(:disabled)")
          ?.focus({ preventScroll: true });
    };
    panel.onclick = (event) => {
      const button = event.target.closest("[data-menu-action]");
      if (!button || button.disabled) return;
      const item = items.find((item) => item.id === button.dataset.menuAction);
      if (item.children) return openSubmenu(item, button, true);
      close();
      item.action();
    };
    panel.onpointerover = (event) => {
      const button = event.target.closest("[data-menu-action]");
      if (!button) return;
      const item = items.find(
        (entry) => entry.id === button.dataset.menuAction,
      );
      if (item?.children) openSubmenu(item, button);
      else if (submenu.matches(":popover-open")) submenu.hidePopover();
    };
    panel.style.left = "0px";
    panel.style.top = "0px";
    panel.showPopover();
    const box = panel.getBoundingClientRect();
    panel.style.left =
      Math.max(8, Math.min(x, innerWidth - box.width - 8)) + "px";
    panel.style.top =
      Math.max(8, Math.min(y, innerHeight - box.height - 8)) + "px";
    panel
      .querySelector("button:not(:disabled)")
      ?.focus({ preventScroll: true });
  }
  panel.addEventListener("contextmenu", (event) => event.preventDefault());
  panel.addEventListener("keydown", (event) => {
    const buttons = [...panel.querySelectorAll("button:not(:disabled)")];
    const index = buttons.indexOf(document.activeElement);
    if (
      [
        "ArrowDown",
        "ArrowUp",
        "ArrowRight",
        "Home",
        "End",
        "Escape",
        "Tab",
      ].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (["Escape", "Tab"].includes(event.key)) return close(true);
      if (event.key === "ArrowRight") {
        const button = document.activeElement,
          item = items.find((entry) => entry.id === button?.dataset.menuAction);
        return openSubmenu(item, button, true);
      }
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length;
      buttons[next]?.focus();
    }
  });
  submenu.addEventListener("keydown", (event) => {
    const buttons = [...submenu.querySelectorAll("button:not(:disabled)")],
      index = buttons.indexOf(document.activeElement);
    if (event.key === "ArrowLeft" || event.key === "Escape") {
      event.preventDefault();
      submenu.hidePopover();
      panel.querySelector('[aria-haspopup="menu"]')?.focus();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
              buttons.length;
      buttons[next]?.focus();
    }
  });
  return {
    open,
    close,
    get isOpen() {
      return panel.matches(":popover-open");
    },
    destroy: () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", close);
      panel.remove();
      submenu.remove();
    },
  };
}
