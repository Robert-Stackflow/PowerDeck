// A template's contents are inert: moving URLs here before srcdoc is assigned
// prevents hidden slides from entering the browser's eager image fetch queue.
const deferredAttributes = [
  ["srcset", "data-player-srcset"],
  ["src", "data-player-src"],
  ["href", "data-player-href"],
  ["xlink:href", "data-player-xlink-href"],
];
const deferredSelector = deferredAttributes
  .map(([, stored]) => `[${stored}]`)
  .join(",");

export function deferSlideImages(html, document = globalThis.document) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content
    .querySelectorAll(".slide img, .slide picture source, .slide svg image")
    .forEach((image) => {
      for (const [attribute, stored] of deferredAttributes) {
        if (!image.hasAttribute(attribute)) continue;
        image.setAttribute(stored, image.getAttribute(attribute));
        image.removeAttribute(attribute);
      }
    });
  return template.innerHTML;
}

export function loadSlideImages(slide, priority = "high") {
  if (!slide) return;
  // Sources appear before their img in a picture; restore them first so the
  // browser chooses the responsive resource without fetching a fallback first.
  slide.querySelectorAll("img").forEach((image) => {
    image.fetchPriority = priority;
    image.decoding = "async";
    image.loading = "eager";
  });
  slide.querySelectorAll(deferredSelector).forEach((image) => {
    for (const [attribute, stored] of deferredAttributes) {
      if (!image.hasAttribute(stored)) continue;
      const value = image.getAttribute(stored);
      if (attribute === "xlink:href")
        image.setAttributeNS("http://www.w3.org/1999/xlink", attribute, value);
      else image.setAttribute(attribute, value);
      image.removeAttribute(stored);
    }
  });
}

export async function waitForSlideImages(slide, timeout = 1800) {
  if (!slide) return;
  let timer;
  try {
    await Promise.race([
      Promise.all(
        [...slide.querySelectorAll("img")].map((image) =>
          image.decode().catch(() => {}),
        ),
      ),
      new Promise((resolve) => (timer = setTimeout(resolve, timeout))),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
