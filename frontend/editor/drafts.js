// A browser refresh/close cannot host a custom confirmation dialog. Keep a local
// recovery copy instead; restoring always requires an explicit choice.
export function localDraft(id, read, isDirty) {
  const key = "presentation.draft." + id;
  let timer,
    writing = false,
    discarded = false;
  const clear = () => {
    try {
      localStorage.removeItem(key);
    } catch {}
  };
  const persist = () => {
    clearTimeout(timer);
    if (discarded || writing) return;
    if (!isDirty()) {
      clear();
      return;
    }
    writing = true;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ ...read(), savedAt: Date.now() }),
      );
    } catch {
    } finally {
      writing = false;
    }
  };
  const schedule = () => {
    if (writing) return;
    clearTimeout(timer);
    timer = setTimeout(persist, 350);
  };
  const visibility = () => {
    if (document.visibilityState === "hidden") persist();
  };
  window.addEventListener("pagehide", persist);
  document.addEventListener("visibilitychange", visibility);
  return {
    read() {
      try {
        return JSON.parse(localStorage.getItem(key));
      } catch {
        return null;
      }
    },
    schedule,
    persist,
    clear,
    discard() {
      discarded = true;
      clear();
      clearTimeout(timer);
    },
    destroy() {
      clearTimeout(timer);
      window.removeEventListener("pagehide", persist);
      document.removeEventListener("visibilitychange", visibility);
    },
  };
}
export function leaveGuard({ dirty, save, pause, discard, dialog }) {
  let bypass = false,
    restoring = false,
    pending = false;
  const ask = (leave) => {
    if (pending) return;
    pending = true;
    pause(true);
    dialog({
      cancel() {
        pending = false;
        pause(false);
      },
      async save() {
        await save();
        pending = false;
        bypass = true;
        discard();
        leave();
      },
      discard() {
        pending = false;
        bypass = true;
        discard();
        leave();
      },
    });
  };
  const click = (e) => {
    const link = e.target.closest("a[href]");
    if (
      !link ||
      link.target === "_blank" ||
      link.hasAttribute("download") ||
      e.ctrlKey ||
      e.metaKey ||
      e.shiftKey ||
      e.altKey ||
      e.button !== 0 ||
      bypass ||
      !dirty()
    )
      return;
    const url = new URL(link.href, location.href);
    if (
      url.href === location.href ||
      (url.hash && url.pathname === location.pathname)
    )
      return;
    e.preventDefault();
    e.stopImmediatePropagation();
    ask(() => location.assign(url.href));
  };
  // A same-document history entry lets browser Back use the same in-app guard.
  if (!history.state?.editorGuard)
    history.pushState({ editorGuard: true }, "", location.href);
  const pop = () => {
    if (bypass) return;
    if (restoring) {
      restoring = false;
      return;
    }
    if (!dirty()) {
      bypass = true;
      history.length > 2 ? history.back() : location.assign("/");
      return;
    }
    restoring = true;
    history.forward();
    ask(() => (history.length > 2 ? history.go(-2) : location.assign("/")));
  };
  document.addEventListener("click", click, true);
  window.addEventListener("popstate", pop);
  return {
    destroy() {
      document.removeEventListener("click", click, true);
      window.removeEventListener("popstate", pop);
    },
  };
}
