import { icon } from "../icons.js";
export function pageReordering(container, { onMove, onStart }) {
  let pending = null,
    drag = null,
    raf = 0,
    suppress = false;
  function finish(commit = false) {
    pending = null;
    cancelAnimationFrame(raf);
    raf = 0;
    if (!drag) return;
    const current = drag;
    drag = null;
    current.ghost.remove();
    current.line.remove();
    current.button.classList.remove("slide-dragging");
    if (container.hasPointerCapture(current.pointerId))
      container.releasePointerCapture(current.pointerId);
    if (commit) onMove(current.from, current.slot);
    suppress = true;
    setTimeout(() => (suppress = false), 0);
  }
  function draw() {
    if (!drag) return;
    const r = container.getBoundingClientRect();
    if (drag.y < r.top + 40) container.scrollTop -= 12;
    if (drag.y > r.bottom - 40) container.scrollTop += 12;
    const buttons = [...container.querySelectorAll(".slide-thumb")];
    const slot = buttons.findIndex(
      (b) => drag.y < b.getBoundingClientRect().top + b.offsetHeight / 2,
    );
    drag.slot = slot < 0 ? buttons.length : slot;
    const at = buttons[drag.slot],
      last = buttons.at(-1);
    let top = at
      ? at.getBoundingClientRect().top - 4
      : last.getBoundingClientRect().bottom + 4;
    top = Math.max(r.top + 4, Math.min(r.bottom - 4, top));
    Object.assign(drag.line.style, {
      left: r.left + 18 + "px",
      top: top + "px",
      width: r.width - 32 + "px",
    });
    drag.line.hidden = drag.slot === drag.from || drag.slot === drag.from + 1;
    Object.assign(drag.ghost.style, {
      left: Math.min(innerWidth - 190, drag.x + 15) + "px",
      top: Math.min(innerHeight - 46, drag.y + 12) + "px",
    });
    raf = requestAnimationFrame(draw);
  }
  const down = (e) => {
    const button = e.target.closest(".slide-thumb");
    if (e.button !== 0 || !button) return;
    pending = {
      button,
      from: Number(button.dataset.pageIndex),
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
    };
  };
  const move = (e) => {
    if (!pending && !drag) return;
    if (!drag) {
      if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < 6) return;
      onStart();
      container.setPointerCapture(e.pointerId);
      const ghost = document.createElement("div"),
        line = document.createElement("div");
      ghost.className = "slide-drag-ghost";
      ghost.innerHTML = icon("presentation") + "<span></span>";
      ghost.querySelector("span").textContent = `第 ${pending.from + 1} 页`;
      line.className = "slide-insert-indicator";
      document.body.append(ghost, line);
      drag = { ...pending, ghost, line, slot: pending.from };
      pending.button.classList.add("slide-dragging");
      pending = null;
    }
    e.preventDefault();
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!raf) draw();
  };
  const up = () => finish(true),
    cancel = () => finish(false);
  const key = (e) => {
    if (e.key === "Escape" && drag) {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  };
  const click = (e) => {
    if (suppress) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };
  container.addEventListener("pointerdown", down);
  container.addEventListener("pointermove", move);
  container.addEventListener("pointerup", up);
  container.addEventListener("pointercancel", cancel);
  container.addEventListener("click", click, true);
  window.addEventListener("keydown", key, true);
  window.addEventListener("blur", cancel);
  return {
    isDragging: () => !!drag,
    destroy() {
      cancel();
      container.removeEventListener("pointerdown", down);
      container.removeEventListener("pointermove", move);
      container.removeEventListener("pointerup", up);
      container.removeEventListener("pointercancel", cancel);
      container.removeEventListener("click", click, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("blur", cancel);
    },
  };
}
