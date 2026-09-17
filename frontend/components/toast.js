export const toastPositions = [
  ["top-left", "左上角"],
  ["top-center", "顶部居中"],
  ["top-right", "右上角"],
  ["bottom-left", "左下角"],
  ["bottom-center", "底部居中"],
  ["bottom-right", "右下角"],
];
export function createToast(element) {
  const doc = element.ownerDocument;
  let timer;
  element.setAttribute("popover", "manual");
  element.setAttribute("aria-live", "polite");
  element.setAttribute("aria-atomic", "true");
  const raise = () => {
    if (!element.classList.contains("visible")) return;
    if (element.showPopover) {
      if (element.matches(":popover-open")) element.hidePopover();
      element.showPopover();
    } else (doc.querySelector("dialog[open]") || doc.body).append(element);
  };
  const observer = new doc.defaultView.MutationObserver((records) => {
    if (records.some((r) => r.target.matches("dialog[open]"))) raise();
  });
  observer.observe(doc.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["open"],
  });
  return (
    message,
    position = doc.documentElement.dataset.toastPosition || "bottom-center",
  ) => {
    element.textContent = message;
    element.dataset.position = toastPositions.some(([v]) => v === position)
      ? position
      : "bottom-center";
    element.classList.add("visible");
    raise();
    clearTimeout(timer);
    timer = setTimeout(() => {
      element.classList.remove("visible");
      if (element.matches(":popover-open")) element.hidePopover();
    }, 2800);
  };
}
