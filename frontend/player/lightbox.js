// The viewer lives outside slide content. Transforming it never changes the deck.
export function createLightbox({ element, icon, close }) {
  const doc = element.ownerDocument,
    win = doc.defaultView;
  element.innerHTML = `<div class="lightbox-top"><h2 id="figureTitle"></h2><button id="figureClose" type="button" aria-label="关闭图片">${icon("close")}</button></div><div id="figureViewport"><img id="figureImage" alt="" draggable="false"></div><div class="lightbox-controls"><button id="figureZoomOut" aria-label="缩小图片">${icon("zoomOut")}</button><button id="figureZoom" aria-label="适应窗口"><output id="figureScale">100%</output></button><button id="figureZoomIn" aria-label="放大图片">${icon("zoom")}</button><span></span><button id="figureFit" aria-label="适应窗口">${icon("fit")}</button></div>`;
  const $ = (id) => element.querySelector("#" + id),
    image = $("figureImage"),
    viewport = $("figureViewport");
  let scale = 1,
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    drag = null,
    moved = false;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  function paint() {
    const bx = Math.max(0, (width * scale - viewport.clientWidth) / 2 + 28);
    const by = Math.max(0, (height * scale - viewport.clientHeight) / 2 + 28);
    x = clamp(x, -bx, bx);
    y = clamp(y, -by, by);
    image.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
    viewport.dataset.zoomed = String(scale > 1.01);
    $("figureScale").textContent = Math.round(scale * 100) + "%";
    $("figureZoomOut").disabled = scale <= 0.5;
    $("figureZoomIn").disabled = scale >= 8;
  }
  function fit() {
    if (element.hidden || !image.complete || !image.naturalWidth) return;
    const ratio = Math.min(
      (viewport.clientWidth - 64) / image.naturalWidth,
      (viewport.clientHeight - 48) / image.naturalHeight,
      1,
    );
    width = image.naturalWidth * ratio;
    height = image.naturalHeight * ratio;
    image.style.width = width + "px";
    image.style.height = height + "px";
    scale = 1;
    x = y = 0;
    paint();
    image.classList.add("ready");
  }
  function zoom(next, clientX, clientY) {
    const box = viewport.getBoundingClientRect(),
      before = scale;
    scale = clamp(next, 0.5, 8);
    const px = (clientX ?? box.x + box.width / 2) - box.x - box.width / 2;
    const py = (clientY ?? box.y + box.height / 2) - box.y - box.height / 2;
    x = px - ((px - x) * scale) / before;
    y = py - ((py - y) * scale) / before;
    paint();
  }
  image.onload = fit;
  image.onpointerdown = (e) => {
    if (e.button !== 0) return;
    moved = false;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: x, oy: y };
    image.setPointerCapture(e.pointerId);
  };
  image.onpointermove = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x,
      dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) moved = true;
    if (moved && scale > 1) {
      viewport.classList.add("panning");
      x = drag.ox + dx;
      y = drag.oy + dy;
      paint();
    }
  };
  image.onpointerup = image.onpointercancel = () => {
    drag = null;
    viewport.classList.remove("panning");
  };
  image.onclick = (e) => {
    e.stopPropagation();
    if (moved) {
      moved = false;
      return;
    }
    scale > 1.01 ? fit() : zoom(2.5, e.clientX, e.clientY);
  };
  viewport.onclick = (e) => {
    if (e.target === viewport) close();
  };
  viewport.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta =
        e.deltaY *
        (e.deltaMode === 1
          ? 16
          : e.deltaMode === 2
            ? viewport.clientHeight
            : 1);
      zoom(
        scale * Math.exp(-clamp(delta, -240, 240) * 0.003),
        e.clientX,
        e.clientY,
      );
    },
    { passive: false },
  );
  $("figureClose").onclick = close;
  $("figureZoomIn").onclick = () => zoom(scale * 1.35);
  $("figureZoomOut").onclick = () => zoom(scale / 1.35);
  $("figureFit").onclick = $("figureZoom").onclick = fit;
  doc.addEventListener("keydown", (e) => {
    if (element.hidden) return;
    if (["+", "=", "-", "0"].includes(e.key)) {
      e.preventDefault();
      e.key === "0" ? fit() : zoom(scale * (e.key === "-" ? 1 / 1.35 : 1.35));
    }
  });
  win.addEventListener("resize", fit);
  return {
    open(source) {
      image.classList.remove("ready");
      $("figureTitle").textContent = source.alt;
      image.alt = source.alt;
      image.src = source.currentSrc || source.src;
      fit();
      $("figureClose").focus({ preventScroll: true });
    },
  };
}
