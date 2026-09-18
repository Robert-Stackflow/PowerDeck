import fs from "node:fs";
import { icons } from "lucide/dist/esm/lucide.js";
const names = {
  timer: "Timer",
  play: "Play",
  pause: "Pause",
  prev: "ChevronLeft",
  next: "ChevronRight",
  down: "ChevronDown",
  pointer: "MousePointer2",
  laser: "Wand",
  pen: "PenLine",
  highlighter: "Highlighter",
  eraser: "Eraser",
  clear: "Trash2",
  undo: "Undo2",
  redo: "Redo2",
  overview: "LayoutGrid",
  notes: "StickyNote",
  full: "Maximize",
  exitFull: "Minimize",
  more: "Ellipsis",
  print: "Printer",
  check: "Check",
  close: "X",
  zoom: "ZoomIn",
  zoomOut: "ZoomOut",
  fit: "Scan",
  external: "ExternalLink",
  edit: "Pencil",
  presenter: "Monitor",
  smartphone: "Smartphone",
  audience: "MessageSquare",
  flag: "Flag",
};
const escape = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
export const presenterIcons = Object.fromEntries(
  Object.entries(names).map(([key, name]) => {
    if (!icons[name]) throw new Error("Missing Lucide icon: " + name);
    return [
      key,
      {
        name: name
          .replace(/[a-z0-9][A-Z]/g, (s) => s[0] + "-" + s[1])
          .replace(/([a-zA-Z])(\d+)/g, "$1-$2")
          .toLowerCase(),
        body: icons[name]
          .map(
            ([tag, attrs]) =>
              `<${tag} ${Object.entries(attrs)
                .map(([k, v]) => `${k}="${escape(v)}"`)
                .join(" ")}/>`,
          )
          .join(""),
      },
    ];
  }),
);
export const lucideLicense = fs.readFileSync(
  new URL("../../LICENSE", import.meta.resolve("lucide")),
  "utf8",
);
