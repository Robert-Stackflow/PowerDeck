const round = (value) => Math.round(value * 10) / 10;
const overlap = (a1, a2, b1, b2) =>
  Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
const rect = (x, y, width, height) => ({
  x,
  y,
  width,
  height,
  right: x + width,
  bottom: y + height,
});

export function createGuides(doc, meta, getScale, getSlide, getCandidates) {
  const layer = doc.createElement("div"),
    gridLayer = doc.createElement("div"),
    fixedLayer = doc.createElement("div"),
    dynamicLayer = doc.createElement("div");
  layer.id = "ve-guides";
  layer.setAttribute("aria-hidden", "true");
  gridLayer.dataset.guideLayer = "grid";
  fixedLayer.dataset.guideLayer = "fixed";
  dynamicLayer.dataset.guideLayer = "dynamic";
  layer.append(gridLayer, fixedLayer, dynamicLayer);
  doc.body.append(layer);
  let origin,
    candidates = [],
    selected = new Set(),
    enabled = true,
    showFixed = false,
    showGrid = false,
    gridSize = 20,
    custom = [],
    customId = 0,
    spacingPatterns = { x: [], y: [] },
    axisTargets = { x: [], y: [] },
    latch = { x: null, y: null };

  const scene = () => ({
    p: getSlide().getBoundingClientRect(),
    s: getScale(),
  });
  const bounds = (node) => {
    const r = node.getBoundingClientRect(),
      { p, s } = scene();
    return rect((r.x - p.x) / s, (r.y - p.y) / s, r.width / s, r.height / s);
  };
  const groupBounds = (nodes) => {
    const boxes = nodes.map(bounds);
    if (!boxes.length) return null;
    const x = Math.min(...boxes.map((box) => box.x)),
      y = Math.min(...boxes.map((box) => box.y)),
      right = Math.max(...boxes.map((box) => box.right)),
      bottom = Math.max(...boxes.map((box) => box.bottom));
    return rect(x, y, right - x, bottom - y);
  };
  const addLine = (styles, kind, axis) => {
    const node = doc.createElement("div");
    node.className = "ve-guide";
    node.dataset.guideKind = kind;
    node.dataset.axis = axis;
    Object.assign(node.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: 2147483645,
      boxSizing: "border-box",
      ...styles,
    });
    dynamicLayer.append(node);
    return node;
  };
  const addLabel = (text, x, y) => {
    const node = addLine(
      {
        left: `${x}px`,
        top: `${y}px`,
        transform: "translate(-50%,-50%)",
        padding: "1px 4px",
        color: "#b43f6d",
        background: "#fff",
        border: "1px solid #e8a7c2",
        borderRadius: "3px",
        font: "10px/1.35 Inter,Arial,sans-serif",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
      },
      "distance-label",
      "label",
    );
    node.textContent = String(round(text));
  };
  function renderAlignment(match, moving) {
    if (!match || match.type === "grid") return;
    const { p, s } = scene(),
      target = match.rect,
      page = match.type === "page";
    if (match.axis === "x") {
      const top = page ? 0 : Math.min(moving.y, target.y),
        bottom = page ? meta.height : Math.max(moving.bottom, target.bottom);
      addLine(
        {
          left: `${p.left + match.target * s}px`,
          top: `${p.top + top * s}px`,
          height: `${Math.max(1, (bottom - top) * s)}px`,
          borderLeft: "1px dashed #d94f87",
        },
        match.type === "size" ? "equal-size" : "alignment",
        "x",
      );
    } else {
      const left = page ? 0 : Math.min(moving.x, target.x),
        right = page ? meta.width : Math.max(moving.right, target.right);
      addLine(
        {
          left: `${p.left + left * s}px`,
          top: `${p.top + match.target * s}px`,
          width: `${Math.max(1, (right - left) * s)}px`,
          borderTop: "1px dashed #d94f87",
        },
        match.type === "size" ? "equal-size" : "alignment",
        "y",
      );
    }
  }
  function renderGapSegment(axis, from, to, cross, value, kind = "spacing") {
    const { p, s } = scene(),
      start = Math.min(from, to),
      length = Math.abs(to - from);
    if (length < 0.5) return;
    if (axis === "x") {
      addLine(
        {
          left: `${p.left + start * s}px`,
          top: `${p.top + cross * s}px`,
          width: `${length * s}px`,
          borderTop: "1px solid #d94f87",
        },
        kind,
        "x",
      );
      for (const valueX of [from, to])
        addLine(
          {
            left: `${p.left + valueX * s}px`,
            top: `${p.top + cross * s - 3}px`,
            height: "7px",
            borderLeft: "1px solid #d94f87",
          },
          `${kind}-tick`,
          "x",
        );
      addLabel(value, p.left + ((from + to) / 2) * s, p.top + cross * s - 9);
    } else {
      addLine(
        {
          left: `${p.left + cross * s}px`,
          top: `${p.top + start * s}px`,
          height: `${length * s}px`,
          borderLeft: "1px solid #d94f87",
        },
        kind,
        "y",
      );
      for (const valueY of [from, to])
        addLine(
          {
            left: `${p.left + cross * s - 3}px`,
            top: `${p.top + valueY * s}px`,
            width: "7px",
            borderTop: "1px solid #d94f87",
          },
          `${kind}-tick`,
          "y",
        );
      addLabel(value, p.left + cross * s + 12, p.top + ((from + to) / 2) * s);
    }
  }
  function renderSpacing(match, moving) {
    if (!match) return;
    if (match.axis === "x") {
      const cross = Math.max(moving.y, ...match.refs.map((item) => item.y)) - 9;
      if (match.mode === "between") {
        renderGapSegment("x", match.refs[0].right, moving.x, cross, match.gap);
        renderGapSegment("x", moving.right, match.refs[1].x, cross, match.gap);
      } else {
        const [a, b] = match.refs;
        renderGapSegment("x", a.right, b.x, cross, match.gap);
        renderGapSegment(
          "x",
          match.direction === "after" ? b.right : moving.right,
          match.direction === "after" ? moving.x : a.x,
          cross,
          match.gap,
        );
      }
    } else {
      const cross = Math.max(moving.x, ...match.refs.map((item) => item.x)) - 9;
      if (match.mode === "between") {
        renderGapSegment("y", match.refs[0].bottom, moving.y, cross, match.gap);
        renderGapSegment("y", moving.bottom, match.refs[1].y, cross, match.gap);
      } else {
        const [a, b] = match.refs;
        renderGapSegment("y", a.bottom, b.y, cross, match.gap);
        renderGapSegment(
          "y",
          match.direction === "after" ? b.bottom : moving.bottom,
          match.direction === "after" ? moving.y : a.y,
          cross,
          match.gap,
        );
      }
    }
  }
  function renderSize(match, moving) {
    if (match.axis === "x") {
      renderGapSegment(
        "x",
        moving.x,
        moving.right,
        moving.y - 9,
        moving.width,
        "equal-size",
      );
      renderGapSegment(
        "x",
        match.rect.x,
        match.rect.right,
        match.rect.y - 9,
        match.rect.width,
        "equal-size",
      );
    } else {
      renderGapSegment(
        "y",
        moving.y,
        moving.bottom,
        moving.x - 9,
        moving.height,
        "equal-size",
      );
      renderGapSegment(
        "y",
        match.rect.y,
        match.rect.bottom,
        match.rect.x - 9,
        match.rect.height,
        "equal-size",
      );
    }
  }
  function render(matches, moving) {
    dynamicLayer.replaceChildren();
    for (const match of [matches.x, matches.y]) {
      if (!match) continue;
      if (match.type === "spacing") renderSpacing(match, moving);
      else if (match.type === "size") renderSize(match, moving);
      else renderAlignment(match, moving);
    }
  }
  function renderFixed() {
    fixedLayer.replaceChildren();
    const { p, s } = scene();
    Object.assign(gridLayer.style, {
      position: "fixed",
      pointerEvents: "none",
      zIndex: 2147483643,
      left: `${p.left}px`,
      top: `${p.top}px`,
      width: `${meta.width * s}px`,
      height: `${meta.height * s}px`,
      display: showGrid ? "block" : "none",
      backgroundImage:
        "linear-gradient(#879b921f 1px,transparent 1px),linear-gradient(90deg,#879b921f 1px,transparent 1px)",
      backgroundSize: `${gridSize * s}px ${gridSize * s}px`,
    });
    if (!showFixed) return;
    const values = [
      { id: "center-x", axis: "x", value: meta.width / 2, fixed: true },
      { id: "center-y", axis: "y", value: meta.height / 2, fixed: true },
      ...custom,
    ];
    for (const guide of values) {
      const node = doc.createElement("div"),
        vertical = guide.axis === "x";
      node.className = "ve-fixed-guide";
      node.dataset.axis = guide.axis;
      node.dataset.guideId = guide.id;
      node.title = guide.fixed ? "页面中心参考线" : "拖动调整；双击删除";
      Object.assign(node.style, {
        position: "fixed",
        pointerEvents: guide.fixed ? "none" : "auto",
        zIndex: 2147483644,
        cursor: vertical ? "ew-resize" : "ns-resize",
        ...(vertical
          ? {
              left: `${p.left + guide.value * s - 4}px`,
              top: `${p.top}px`,
              width: "9px",
              height: `${meta.height * s}px`,
              borderLeft: "1px dashed #6795c6",
              transform: "translateX(4px)",
            }
          : {
              left: `${p.left}px`,
              top: `${p.top + guide.value * s - 4}px`,
              width: `${meta.width * s}px`,
              height: "9px",
              borderTop: "1px dashed #6795c6",
              transform: "translateY(4px)",
            }),
      });
      if (!guide.fixed) {
        node.addEventListener("pointerdown", (event) =>
          startFixedDrag(event, guide),
        );
        node.addEventListener("dblclick", (event) => {
          event.preventDefault();
          event.stopPropagation();
          custom = custom.filter((item) => item !== guide);
          renderFixed();
        });
      }
      fixedLayer.append(node);
    }
  }
  function startFixedDrag(event, guide) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const move = (next) => {
      const { p, s } = scene();
      guide.value = Math.max(
        0,
        Math.min(
          guide.axis === "x" ? meta.width : meta.height,
          (guide.axis === "x" ? next.clientX - p.left : next.clientY - p.top) /
            s,
        ),
      );
      renderFixed();
      const marker = doc.createElement("div"),
        distance = round(
          guide.value - (guide.axis === "x" ? meta.width / 2 : meta.height / 2),
        );
      marker.dataset.guideKind = "fixed-distance";
      marker.textContent = distance > 0 ? `+${distance}` : String(distance);
      Object.assign(marker.style, {
        position: "fixed",
        pointerEvents: "none",
        zIndex: 2147483645,
        left:
          guide.axis === "x"
            ? `${p.left + guide.value * s + 7}px`
            : `${p.left + 8}px`,
        top:
          guide.axis === "x"
            ? `${p.top + 8}px`
            : `${p.top + guide.value * s + 7}px`,
        padding: "1px 4px",
        color: "#356a9c",
        background: "#fff",
        border: "1px solid #a9c3dd",
        borderRadius: "3px",
        font: "10px/1.35 Inter,Arial,sans-serif",
      });
      fixedLayer.append(marker);
    };
    const end = () => {
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", end);
      doc.removeEventListener("pointercancel", end);
    };
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", end);
    doc.addEventListener("pointercancel", end);
  }
  const alignedRow = (a, b) =>
    overlap(a.y, a.bottom, b.y, b.bottom) >= Math.min(a.height, b.height) * 0.3;
  const alignedColumn = (a, b) =>
    overlap(a.x, a.right, b.x, b.right) >= Math.min(a.width, b.width) * 0.3;
  const nearbyTargets = (axis, value, threshold) => {
    const values = axisTargets[axis];
    let low = 0,
      high = values.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (values[middle].value < value - threshold) low = middle + 1;
      else high = middle;
    }
    const nearby = [];
    for (let index = low; index < values.length; index++) {
      if (values[index].value > value + threshold) break;
      nearby.push(values[index]);
    }
    return nearby;
  };
  function spacingMatches(moving, axis) {
    const matches = [],
      threshold = 6 / getScale();
    if (axis === "x") {
      let left = null,
        right = null;
      for (const item of candidates) {
        if (!alignedRow(item, moving)) continue;
        if (
          item.right <= moving.x + threshold &&
          (!left || item.right > left.right)
        )
          left = item;
        if (item.x >= moving.right - threshold && (!right || item.x < right.x))
          right = item;
      }
      if (left && right) {
        const desired = (left.right + right.x - moving.width) / 2,
          delta = desired - moving.x;
        if (Math.abs(delta) <= threshold)
          matches.push({
            type: "spacing",
            axis,
            mode: "between",
            delta,
            gap: desired - left.right,
            refs: [left, right],
            key: `xb:${left.id}:${right.id}`,
          });
      }
      for (const { a, b, gap } of spacingPatterns.x)
        for (const [desired, direction] of [
          [b.right + gap, "after"],
          [a.x - gap - moving.width, "before"],
        ]) {
          if (!alignedRow(b, moving) && !alignedRow(a, moving)) continue;
          const delta = desired - moving.x;
          if (Math.abs(delta) <= threshold)
            matches.push({
              type: "spacing",
              axis,
              mode: "repeat",
              direction,
              delta,
              gap,
              refs: [a, b],
              key: `xr:${a.id}:${b.id}:${direction}`,
            });
        }
    } else {
      let above = null,
        below = null;
      for (const item of candidates) {
        if (!alignedColumn(item, moving)) continue;
        if (
          item.bottom <= moving.y + threshold &&
          (!above || item.bottom > above.bottom)
        )
          above = item;
        if (item.y >= moving.bottom - threshold && (!below || item.y < below.y))
          below = item;
      }
      if (above && below) {
        const desired = (above.bottom + below.y - moving.height) / 2,
          delta = desired - moving.y;
        if (Math.abs(delta) <= threshold)
          matches.push({
            type: "spacing",
            axis,
            mode: "between",
            delta,
            gap: desired - above.bottom,
            refs: [above, below],
            key: `yb:${above.id}:${below.id}`,
          });
      }
      for (const { a, b, gap } of spacingPatterns.y)
        for (const [desired, direction] of [
          [b.bottom + gap, "after"],
          [a.y - gap - moving.height, "before"],
        ]) {
          if (!alignedColumn(b, moving) && !alignedColumn(a, moving)) continue;
          const delta = desired - moving.y;
          if (Math.abs(delta) <= threshold)
            matches.push({
              type: "spacing",
              axis,
              mode: "repeat",
              direction,
              delta,
              gap,
              refs: [a, b],
              key: `yr:${a.id}:${b.id}:${direction}`,
            });
        }
    }
    return matches;
  }
  function alignmentMatches(moving, axis, resizeKind = "") {
    const threshold = 6 / getScale(),
      matches = [],
      source =
        axis === "x"
          ? resizeKind
            ? [resizeKind.includes("w") ? moving.x : moving.right]
            : [moving.x, moving.x + moving.width / 2, moving.right]
          : resizeKind
            ? [resizeKind.includes("n") ? moving.y : moving.bottom]
            : [moving.y, moving.y + moving.height / 2, moving.bottom];
    const pages =
      axis === "x"
        ? [0, meta.width / 2, meta.width]
        : [0, meta.height / 2, meta.height];
    for (const value of source) {
      for (const target of pages) {
        const delta = target - value;
        if (Math.abs(delta) <= threshold)
          matches.push({
            type: "page",
            axis,
            delta,
            target,
            rect: rect(0, 0, meta.width, meta.height),
            key: `${axis}p:${target}:${value - (axis === "x" ? moving.x : moving.y)}`,
          });
      }
      for (const target of nearbyTargets(axis, value, threshold))
        matches.push({
          type: "object",
          axis,
          delta: target.value - value,
          target: target.value,
          rect: target.rect,
          key: `${axis}o:${target.rect.id}:${target.value}:${value - (axis === "x" ? moving.x : moving.y)}`,
        });
      if (showGrid) {
        const target = Math.round(value / gridSize) * gridSize,
          delta = target - value;
        if (Math.abs(delta) <= threshold)
          matches.push({
            type: "grid",
            axis,
            delta,
            target,
            rect: moving,
            key: `${axis}g:${target}`,
          });
      }
      if (showFixed) {
        const references = custom.concat(
          axis === "x"
            ? [{ id: "center-x", axis, value: meta.width / 2 }]
            : [{ id: "center-y", axis, value: meta.height / 2 }],
        );
        for (const guide of references) {
          if (guide.axis !== axis) continue;
          const delta = guide.value - value;
          if (Math.abs(delta) <= threshold)
            matches.push({
              type: "page",
              axis,
              delta,
              target: guide.value,
              rect: rect(0, 0, meta.width, meta.height),
              key: `${axis}f:${guide.id}`,
            });
        }
      }
    }
    return matches;
  }
  function choose(matches, axis) {
    const release = 10 / getScale(),
      nearTie = 1 / getScale(),
      previous = latch[axis],
      retained =
        previous &&
        matches.find(
          (item) =>
            item.key === previous.key && Math.abs(item.delta) <= release,
        ),
      best =
        retained ||
        matches.sort((a, b) => {
          const distance = Math.abs(a.delta) - Math.abs(b.delta);
          if (Math.abs(distance) > nearTie) return distance;
          if (a.type === b.type) return distance;
          return a.type === "spacing"
            ? -1
            : b.type === "spacing"
              ? 1
              : distance;
        })[0] ||
        null;
    latch[axis] = best;
    return best;
  }
  function begin(nodes) {
    const list = Array.isArray(nodes)
      ? nodes
      : nodes instanceof Set
        ? [...nodes]
        : [nodes];
    selected = new Set(list.filter(Boolean));
    origin = groupBounds([...selected]);
    latch = { x: null, y: null };
    candidates = (getCandidates ? getCandidates() : [])
      .filter(
        (node) =>
          ![...selected].some(
            (item) =>
              item === node || item.contains(node) || node.contains(item),
          ),
      )
      .map((node, index) => ({
        ...bounds(node),
        node,
        id: node.id || node.dataset.slideId || `candidate-${index}`,
      }))
      .filter(
        (item) =>
          item.width >= 1 &&
          item.height >= 1 &&
          doc.defaultView.getComputedStyle(item.node).visibility !== "hidden",
      );
    spacingPatterns = { x: [], y: [] };
    axisTargets = { x: [], y: [] };
    for (const item of candidates) {
      for (const value of [item.x, item.x + item.width / 2, item.right])
        axisTargets.x.push({ value, rect: item });
      for (const value of [item.y, item.y + item.height / 2, item.bottom])
        axisTargets.y.push({ value, rect: item });
      let left = null,
        above = null;
      for (const other of candidates) {
        if (
          other !== item &&
          other.right <= item.x &&
          alignedRow(other, item) &&
          (!left || other.right > left.right)
        )
          left = other;
        if (
          other !== item &&
          other.bottom <= item.y &&
          alignedColumn(other, item) &&
          (!above || other.bottom > above.bottom)
        )
          above = other;
      }
      if (left) {
        const gap = item.x - left.right;
        if (gap <= meta.width / 2)
          spacingPatterns.x.push({ a: left, b: item, gap });
      }
      if (above) {
        const gap = item.y - above.bottom;
        if (gap <= meta.height / 2)
          spacingPatterns.y.push({ a: above, b: item, gap });
      }
    }
    axisTargets.x.sort((a, b) => a.value - b.value);
    axisTargets.y.sort((a, b) => a.value - b.value);
    renderFixed();
  }
  function snap(dx, dy, { altKey, shiftKey }, kind = "move") {
    if (!enabled || altKey || !origin) {
      dynamicLayer.replaceChildren();
      latch = { x: null, y: null };
      return { dx, dy };
    }
    const moving = rect(
        origin.x + dx,
        origin.y + dy,
        origin.width,
        origin.height,
      ),
      move = kind === "move";
    if (!move) return { dx, dy };
    const lockX = shiftKey && dx === 0,
      lockY = shiftKey && dy === 0,
      x = lockX
        ? null
        : choose(
            [...spacingMatches(moving, "x"), ...alignmentMatches(moving, "x")],
            "x",
          ),
      y = lockY
        ? null
        : choose(
            [...spacingMatches(moving, "y"), ...alignmentMatches(moving, "y")],
            "y",
          ),
      snapped = rect(
        moving.x + (x?.delta || 0),
        moving.y + (y?.delta || 0),
        moving.width,
        moving.height,
      );
    render({ x, y }, snapped);
    return {
      dx: dx + (x?.delta || 0),
      dy: dy + (y?.delta || 0),
    };
  }
  function resize(width, height, kind, { altKey }, preserveRatio = false) {
    const left = kind.includes("w"),
      top = kind.includes("n"),
      base = {
        width,
        height,
        offsetX: left ? origin.width - width : 0,
        offsetY: top ? origin.height - height : 0,
      };
    if (!enabled || altKey || !origin) {
      dynamicLayer.replaceChildren();
      return base;
    }
    const ratio = origin.width / origin.height,
      threshold = 6 / getScale();
    let nextWidth = width,
      nextHeight = height,
      sizeX = null,
      sizeY = null;
    const widthMatch = candidates
        .map((item) => ({ item, delta: item.width - nextWidth }))
        .filter((item) => Math.abs(item.delta) <= threshold)
        .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0],
      heightMatch = candidates
        .map((item) => ({ item, delta: item.height - nextHeight }))
        .filter((item) => Math.abs(item.delta) <= threshold)
        .sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
    if (preserveRatio) {
      const useWidth =
        widthMatch &&
        (!heightMatch ||
          Math.abs(widthMatch.delta) <= Math.abs(heightMatch.delta * ratio));
      if (useWidth) {
        nextWidth = widthMatch.item.width;
        nextHeight = nextWidth / ratio;
        sizeX = {
          type: "size",
          axis: "x",
          target: left ? origin.right - nextWidth : origin.x + nextWidth,
          rect: widthMatch.item,
        };
      } else if (heightMatch) {
        nextHeight = heightMatch.item.height;
        nextWidth = nextHeight * ratio;
        sizeY = {
          type: "size",
          axis: "y",
          target: top ? origin.bottom - nextHeight : origin.y + nextHeight,
          rect: heightMatch.item,
        };
      }
    } else {
      if (widthMatch) {
        nextWidth = widthMatch.item.width;
        sizeX = {
          type: "size",
          axis: "x",
          target: left ? origin.right - nextWidth : origin.x + nextWidth,
          rect: widthMatch.item,
        };
      }
      if (heightMatch) {
        nextHeight = heightMatch.item.height;
        sizeY = {
          type: "size",
          axis: "y",
          target: top ? origin.bottom - nextHeight : origin.y + nextHeight,
          rect: heightMatch.item,
        };
      }
    }
    let moving = rect(
      left ? origin.right - nextWidth : origin.x,
      top ? origin.bottom - nextHeight : origin.y,
      nextWidth,
      nextHeight,
    );
    const x = sizeX || choose(alignmentMatches(moving, "x", kind), "x"),
      y = sizeY || choose(alignmentMatches(moving, "y", kind), "y");
    if (!sizeX && x) nextWidth += left ? -x.delta : x.delta;
    if (!sizeY && y && !preserveRatio) nextHeight += top ? -y.delta : y.delta;
    if (preserveRatio && !sizeX && !sizeY) nextHeight = nextWidth / ratio;
    moving = rect(
      left ? origin.right - nextWidth : origin.x,
      top ? origin.bottom - nextHeight : origin.y,
      nextWidth,
      nextHeight,
    );
    render({ x, y }, moving);
    return {
      width: nextWidth,
      height: nextHeight,
      offsetX: left ? origin.width - nextWidth : 0,
      offsetY: top ? origin.height - nextHeight : 0,
    };
  }
  renderFixed();
  return {
    begin,
    snap,
    resize,
    refresh: renderFixed,
    clear() {
      dynamicLayer.replaceChildren();
      latch = { x: null, y: null };
    },
    setEnabled(value) {
      enabled = value;
      dynamicLayer.replaceChildren();
    },
    setOptions(options = {}) {
      if ("guides" in options) showFixed = !!options.guides;
      if ("grid" in options) showGrid = !!options.grid;
      if (Number.isFinite(options.gridSize))
        gridSize = Math.max(5, Math.min(200, options.gridSize));
      renderFixed();
    },
    addGuide(axis) {
      if (!["x", "y"].includes(axis)) return;
      showFixed = true;
      custom.push({
        id: `custom-${++customId}`,
        axis,
        value:
          (axis === "x" ? meta.width : meta.height) / 2 +
          40 +
          custom.length * 12,
      });
      renderFixed();
    },
    clearCustomGuides() {
      custom = [];
      renderFixed();
    },
    destroy: () => layer.remove(),
  };
}
