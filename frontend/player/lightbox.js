// The viewer lives outside slide content. Transforming it never changes the deck.
export function createLightbox({ element, icon, close }) {
  const doc = element.ownerDocument,
    win = doc.defaultView;
  element.innerHTML = `<div class="lightbox-backdrop" id="figureBackdrop"></div><div class="lightbox-top"><button id="figureClose" type="button" aria-label="关闭图片">${icon("close")}</button></div><div id="figureViewport"><img id="figureImage" alt="" draggable="false"></div><div class="lightbox-caption" id="figureCaption" hidden></div><div class="lightbox-controls"><button id="figureZoomOut" aria-label="缩小图片">${icon("zoomOut")}</button><button id="figureZoom" aria-label="适应窗口"><output id="figureScale">100%</output></button><button id="figureZoomIn" aria-label="放大图片">${icon("zoom")}</button><span></span><button id="figureFit" aria-label="适应窗口">${icon("fit")}</button></div>`;
  const $ = (id) => element.querySelector("#" + id),
    image = $("figureImage"),
    viewport = $("figureViewport"),
    backdrop = $("figureBackdrop"),
    caption = $("figureCaption"),
    chrome = [
      element.querySelector(".lightbox-top"),
      caption,
      element.querySelector(".lightbox-controls"),
    ];
  let scale = 1,
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    drag = null,
    moved = false,
    source = null,
    sourceRect = null,
    pendingHero = false,
    closing = false,
    animationToken = 0;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)),
    reduceMotion = () =>
      win.matchMedia("(prefers-reduced-motion: reduce)").matches,
    baseTransform = (tx = x, ty = y, nextScale = scale) =>
      `translate(-50%, -50%) translate(${tx}px, ${ty}px) scale(${nextScale})`;

  function cancelAnimations() {
    for (const node of [element, backdrop, image, ...chrome])
      node.getAnimations().forEach((animation) => animation.cancel());
  }

  function clearGestureStyles() {
    backdrop.style.removeProperty("opacity");
    for (const node of chrome) node.style.removeProperty("opacity");
    element.style.removeProperty("--lightbox-drag-progress");
    element.removeAttribute("data-dragging");
  }

  function paint() {
    const bx = Math.max(0, (width * scale - viewport.clientWidth) / 2 + 28),
      by = Math.max(0, (height * scale - viewport.clientHeight) / 2 + 28);
    x = clamp(x, -bx, bx);
    y = clamp(y, -by, by);
    image.style.transform = baseTransform();
    viewport.dataset.zoomed = String(scale > 1.01);
    $("figureScale").textContent = Math.round(scale * 100) + "%";
    $("figureZoomOut").disabled = scale <= 0.5;
    $("figureZoomIn").disabled = scale >= 8;
  }

  function sourceTransform(rect = sourceRect) {
    if (!rect || !width || !height) return null;
    const box = viewport.getBoundingClientRect(),
      centerX = box.left + box.width / 2,
      centerY = box.top + box.height / 2,
      dx = rect.left + rect.width / 2 - centerX,
      dy = rect.top + rect.height / 2 - centerY,
      sx = Math.max(0.02, rect.width / width),
      sy = Math.max(0.02, rect.height / height);
    return `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  }

  function animateOpen() {
    if (!pendingHero || element.hidden || !width || !height) return;
    pendingHero = false;
    clearGestureStyles();
    cancelAnimations();
    element.dataset.state = "opening";
    const token = ++animationToken,
      from = sourceTransform();
    if (reduceMotion() || !from) {
      backdrop.style.opacity = "1";
      image.style.opacity = "1";
      image.classList.add("ready");
      element.dataset.state = "open";
      return;
    }
    image.classList.add("ready");
    const sourceRadius = source
        ? win.getComputedStyle(source).borderRadius
        : "0px",
      hero = image.animate(
        [
          {
            transform: from,
            opacity: 0.72,
            borderRadius: sourceRadius,
            boxShadow: "0 2px 12px #0002",
          },
          {
            transform: baseTransform(),
            opacity: 1,
            borderRadius: "4px",
            boxShadow: "0 24px 100px #0008",
          },
        ],
        { duration: 420, easing: "cubic-bezier(.22,1,.36,1)" },
      );
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 300,
      easing: "ease-out",
    });
    // Keep the controls on their CSS-defined center throughout the hero
    // transition. Animating `transform` here would temporarily replace the
    // translateX(-50%) used for centering and cause a visible final-frame jump.
    for (const node of chrome)
      node.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 260,
        delay: 150,
        easing: "ease-out",
        fill: "backwards",
      });
    hero.finished
      .catch(() => {})
      .finally(() => {
        if (token === animationToken && !closing)
          element.dataset.state = "open";
      });
  }

  function fit({ animate = false } = {}) {
    if (element.hidden || !image.complete || !image.naturalWidth) return;
    const ratio = Math.min(
      (viewport.clientWidth - 40) / image.naturalWidth,
      (viewport.clientHeight - 120) / image.naturalHeight,
      1.35,
    );
    width = image.naturalWidth * ratio;
    height = image.naturalHeight * ratio;
    image.style.width = width + "px";
    image.style.height = height + "px";
    scale = 1;
    x = y = 0;
    if (animate && !reduceMotion()) {
      const from = win.getComputedStyle(image).transform;
      paint();
      image.animate([{ transform: from }, { transform: baseTransform() }], {
        duration: 260,
        easing: "cubic-bezier(.22,1,.36,1)",
      });
    } else paint();
    image.classList.add("ready");
    animateOpen();
  }

  function zoom(next, clientX, clientY) {
    const box = viewport.getBoundingClientRect(),
      before = scale;
    scale = clamp(next, 0.5, 8);
    const px = (clientX ?? box.x + box.width / 2) - box.x - box.width / 2,
      py = (clientY ?? box.y + box.height / 2) - box.y - box.height / 2;
    x = px - ((px - x) * scale) / before;
    y = py - ((py - y) * scale) / before;
    paint();
  }

  function finishClose() {
    clearGestureStyles();
    closing = false;
    drag = null;
    element.dataset.state = "closed";
    close();
  }

  function requestClose(mode = "hero") {
    if (closing || element.hidden) return;
    closing = true;
    drag = null;
    viewport.classList.remove("panning");
    element.removeAttribute("data-dragging");
    element.dataset.state = "closing";
    const token = ++animationToken;
    cancelAnimations();
    if (reduceMotion()) {
      finishClose();
      return;
    }
    if (source?.isConnected) sourceRect = source.getBoundingClientRect();
    const current = win.getComputedStyle(image).transform,
      target =
        mode === "drag"
          ? `${current} translateY(32vh) scale(.92)`
          : sourceTransform(),
      hero = image.animate(
        [
          { transform: current, opacity: 1 },
          {
            transform: target || `${current} scale(.92)`,
            opacity: target ? (mode === "drag" ? 0.12 : 0.7) : 0,
          },
        ],
        {
          duration: mode === "drag" ? 260 : 340,
          easing: "cubic-bezier(.4,0,.2,1)",
          fill: "forwards",
        },
      );
    backdrop.animate(
      [
        { opacity: Number(win.getComputedStyle(backdrop).opacity) || 1 },
        { opacity: 0 },
      ],
      { duration: 260, easing: "ease-out", fill: "forwards" },
    );
    for (const node of chrome)
      node.animate(
        [
          { opacity: Number(win.getComputedStyle(node).opacity) || 1 },
          { opacity: 0 },
        ],
        { duration: 150, fill: "forwards" },
      );
    hero.finished
      .catch(() => {})
      .finally(() => {
        if (token === animationToken) finishClose();
      });
  }

  function renderDismissGesture(dx, dy) {
    const distance = Math.max(0, dy),
      progress = clamp(
        distance / Math.max(260, viewport.clientHeight * 0.55),
        0,
        0.92,
      ),
      dragScale = scale * (1 - progress * 0.12);
    image.style.transform = baseTransform(
      x + dx * 0.18,
      y + distance,
      dragScale,
    );
    backdrop.style.opacity = String(1 - progress);
    for (const node of chrome) node.style.opacity = String(1 - progress * 1.35);
    element.style.setProperty("--lightbox-drag-progress", String(progress));
    element.setAttribute("data-dragging", "true");
    return progress;
  }

  function restoreFromDismissGesture() {
    const from = win.getComputedStyle(image).transform,
      backdropOpacity = Number(win.getComputedStyle(backdrop).opacity) || 0;
    image.style.transform = baseTransform();
    const recovery = image.animate(
      [{ transform: from }, { transform: baseTransform() }],
      { duration: 300, easing: "cubic-bezier(.22,1,.36,1)" },
    );
    backdrop.animate([{ opacity: backdropOpacity }, { opacity: 1 }], {
      duration: 220,
      easing: "ease-out",
    });
    for (const node of chrome)
      node.animate(
        [
          { opacity: Number(win.getComputedStyle(node).opacity) || 0 },
          { opacity: 1 },
        ],
        { duration: 180, easing: "ease-out" },
      );
    recovery.finished.catch(() => {}).finally(clearGestureStyles);
  }

  image.onload = () => fit();
  image.onpointerdown = (event) => {
    if (event.button !== 0 || closing) return;
    moved = false;
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      ox: x,
      oy: y,
      lastY: event.clientY,
      lastTime: performance.now(),
      velocity: 0,
      dismiss: scale <= 1.01,
    };
    image.setPointerCapture(event.pointerId);
  };
  image.onpointermove = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x,
      dy = event.clientY - drag.y,
      now = performance.now(),
      elapsed = Math.max(1, now - drag.lastTime);
    drag.velocity = (event.clientY - drag.lastY) / elapsed;
    drag.lastY = event.clientY;
    drag.lastTime = now;
    if (Math.hypot(dx, dy) > 4) moved = true;
    if (!moved) return;
    if (drag.dismiss && dy > 0) renderDismissGesture(dx, dy);
    else if (scale > 1) {
      viewport.classList.add("panning");
      x = drag.ox + dx;
      y = drag.oy + dy;
      paint();
    }
  };
  function endPointer(event) {
    if (!drag || (event && drag.id !== event.pointerId)) return;
    const last = drag,
      dy = (event?.clientY ?? last.lastY) - last.y,
      dismissed =
        last.dismiss &&
        dy > 0 &&
        (dy > Math.min(180, viewport.clientHeight * 0.22) ||
          (last.velocity > 0.75 && dy > 64));
    drag = null;
    viewport.classList.remove("panning");
    if (last.dismiss && moved)
      dismissed ? requestClose("drag") : restoreFromDismissGesture();
  }
  image.onpointerup = endPointer;
  image.onpointercancel = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    viewport.classList.remove("panning");
    restoreFromDismissGesture();
  };
  image.onclick = (event) => {
    event.stopPropagation();
    if (moved) {
      moved = false;
      return;
    }
    scale > 1.01
      ? fit({ animate: true })
      : zoom(2.5, event.clientX, event.clientY);
  };
  viewport.onclick = (event) => {
    if (event.target === viewport) requestClose();
  };
  viewport.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      const delta =
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewport.clientHeight
            : 1);
      zoom(
        scale * Math.exp(-clamp(delta, -240, 240) * 0.003),
        event.clientX,
        event.clientY,
      );
    },
    { passive: false },
  );
  $("figureClose").onclick = () => requestClose();
  $("figureZoomIn").onclick = () => zoom(scale * 1.35);
  $("figureZoomOut").onclick = () => zoom(scale / 1.35);
  $("figureFit").onclick = $("figureZoom").onclick = () =>
    fit({ animate: true });
  doc.addEventListener("keydown", (event) => {
    if (element.hidden) return;
    if (["+", "=", "-", "0"].includes(event.key)) {
      event.preventDefault();
      event.key === "0"
        ? fit({ animate: true })
        : zoom(scale * (event.key === "-" ? 1 / 1.35 : 1.35));
    }
  });
  win.addEventListener("resize", () => fit());
  return {
    open(nextSource) {
      source = nextSource;
      sourceRect = source.getBoundingClientRect();
      closing = false;
      pendingHero = true;
      moved = false;
      cancelAnimations();
      clearGestureStyles();
      element.dataset.state = "loading";
      image.style.removeProperty("opacity");
      image.classList.remove("ready");
      const description =
        source.dataset.caption ||
        source
          .closest("figure")
          ?.querySelector("figcaption")
          ?.textContent?.trim() ||
        source.alt ||
        source.title ||
        "";
      caption.textContent = description;
      caption.hidden = !description;
      image.alt = source.alt;
      const nextURL = source.currentSrc || source.src;
      if (image.src !== nextURL) image.src = nextURL;
      if (image.complete && image.naturalWidth) fit();
      $("figureClose").focus({ preventScroll: true });
    },
    requestClose,
    isClosing: () => closing,
  };
}
