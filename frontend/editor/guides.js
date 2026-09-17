export function createGuides(doc, meta, getScale, getSlide) {
  const layer = doc.createElement("div");
  layer.id = "ve-guides";
  layer.setAttribute("aria-hidden", "true");
  doc.body.append(layer);
  let origin,
    targets = { x: [], y: [] },
    enabled = true;
  const bounds = (node) => {
    const r = node.getBoundingClientRect(),
      p = getSlide().getBoundingClientRect(),
      s = getScale();
    return {
      x: (r.x - p.x) / s,
      y: (r.y - p.y) / s,
      width: r.width / s,
      height: r.height / s,
    };
  };
  function begin(node) {
    origin = bounds(node);
    targets = {
      x: [0, meta.width / 2, meta.width],
      y: [0, meta.height / 2, meta.height],
    };
    const candidates = getSlide().querySelectorAll(
      "[data-editor-element],h1,h2,h3,p,li,svg,img,.math,[data-tex]",
    );
    for (const other of candidates) {
      if (other === node || node.contains(other) || other.contains(node))
        continue;
      if (
        other.closest("svg,.math,[data-tex]") &&
        !other.matches("svg,.math,[data-tex]")
      )
        continue;
      const r = bounds(other);
      if (r.width < 1 || r.height < 1) continue;
      targets.x.push(r.x, r.x + r.width / 2, r.x + r.width);
      targets.y.push(r.y, r.y + r.height / 2, r.y + r.height);
    }
  }
  function nearest(values, axis) {
    let best = null,
      distance = 6 / getScale();
    for (const value of values)
      for (const target of targets[axis]) {
        const delta = target - value;
        if (Math.abs(delta) < distance) {
          best = { target, delta };
          distance = Math.abs(delta);
        }
      }
    return best;
  }
  function show(x, y) {
    layer.replaceChildren();
    const p = getSlide().getBoundingClientRect(),
      s = getScale();
    for (const [axis, match] of [
      ["x", x],
      ["y", y],
    ])
      if (match) {
        const line = doc.createElement("div");
        line.className = "ve-guide";
        line.dataset.axis = axis;
        Object.assign(line.style, {
          position: "fixed",
          pointerEvents: "none",
          zIndex: 2147483645,
          ...(axis === "x"
            ? {
                left: p.left + match.target * s + "px",
                top: p.top + "px",
                height: meta.height * s + "px",
                borderLeft: "1px dashed #e35c9d",
              }
            : {
                left: p.left + "px",
                top: p.top + match.target * s + "px",
                width: meta.width * s + "px",
                borderTop: "1px dashed #e35c9d",
              }),
        });
        layer.append(line);
      }
  }
  function snap(dx, dy, { altKey, shiftKey }, kind = "move") {
    if (!enabled || altKey || !origin) {
      show();
      return { dx, dy };
    }
    const move = kind === "move",
      left = kind.includes("w"),
      top = kind.includes("n");
    const x = nearest(
      move
        ? [
            origin.x + dx,
            origin.x + origin.width / 2 + dx,
            origin.x + origin.width + dx,
          ]
        : [origin.x + (left ? 0 : origin.width) + dx],
      "x",
    );
    const y = nearest(
      move
        ? [
            origin.y + dy,
            origin.y + origin.height / 2 + dy,
            origin.y + origin.height + dy,
          ]
        : [origin.y + (top ? 0 : origin.height) + dy],
      "y",
    );
    const lockX = move && shiftKey && dx === 0,
      lockY = move && shiftKey && dy === 0;
    show(lockX ? null : x, lockY ? null : y);
    return {
      dx: dx + (lockX ? 0 : x?.delta || 0),
      dy: dy + (lockY ? 0 : y?.delta || 0),
    };
  }
  return {
    begin,
    snap,
    clear: () => show(),
    setEnabled(value) {
      enabled = value;
      show();
    },
    destroy: () => layer.remove(),
  };
}
