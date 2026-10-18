import { waitForSlideImages } from "./media.js";

export function preparePlayerFrame(frame) {
  frame.hidden = false;
  frame.classList.remove("is-ready");
  frame.setAttribute("aria-busy", "true");
}

export async function revealPlayerFrame(frame, loading, timeout = 1800) {
  const contentWindow = frame.contentWindow,
    fonts = frame.contentDocument?.fonts?.ready || Promise.resolve();
  let timer;
  try {
    await Promise.race([
      Promise.all([
        fonts.catch(() => {}),
        waitForSlideImages(
          frame.contentDocument?.querySelector(".slide.active"),
          timeout,
        ),
      ]),
      new Promise((resolve) => (timer = setTimeout(resolve, timeout))),
    ]);
  } finally {
    clearTimeout(timer);
  }
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
