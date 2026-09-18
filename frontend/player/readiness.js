export function preparePlayerFrame(frame) {
  frame.hidden = false;
  frame.classList.remove("is-ready");
  frame.setAttribute("aria-busy", "true");
}

export async function revealPlayerFrame(frame, loading, timeout = 1800) {
  const contentWindow = frame.contentWindow,
    fonts = frame.contentDocument?.fonts?.ready || Promise.resolve(),
    deadline = new Promise((resolve) => setTimeout(resolve, timeout));
  await Promise.race([fonts.catch(() => {}), deadline]);
  await new Promise((resolve) =>
    contentWindow.requestAnimationFrame(() =>
      contentWindow.requestAnimationFrame(resolve),
    ),
  );
  frame.classList.add("is-ready");
  frame.removeAttribute("aria-busy");
  loading.setAttribute("aria-hidden", "true");
  loading.classList.add("is-leaving");
  const dismiss = () => {
    loading.hidden = true;
  };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) dismiss();
  else {
    loading.addEventListener("transitionend", dismiss, { once: true });
    setTimeout(dismiss, 240);
  }
}
