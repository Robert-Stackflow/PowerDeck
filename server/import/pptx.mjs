import path from "node:path";
import {
  readArchive,
  xmlReader,
  relationships,
  children,
  child,
  all,
  first,
  attr,
  number,
  relationId,
} from "./archive.mjs";
import { escapeHTML as esc, requireValue, assetTypes } from "../content.mjs";
const round = (n) => Math.round(n * 100) / 100;
const px = (n) => round(n) + "px";
const fontName = (s) =>
  String(s)
    .replace(/["'\\;{}<>]/g, "")
    .slice(0, 120);
const placeholder = (s) =>
  first(child(s, "nvSpPr") || child(s, "nvPicPr"), "ph");
const shapeTree = (d) => first(d, "spTree");
const shapeProps = (s) => child(s, "spPr") || child(s, "grpSpPr");
const safeLink = (u) =>
  /^(https?:|mailto:|tel:)/i.test(u || "") && !/[\u0000-\u0020]/.test(u)
    ? u
    : null;

export async function convertPptx(buffer, { mode = "slides" } = {}) {
  requireValue(
    ["slides", "masters"].includes(mode),
    "请选择导入页面或提取母版",
  );
  const files = await readArchive(buffer),
    xml = xmlReader(files),
    presentation = xml("ppt/presentation.xml");
  requireValue(presentation, "文件不是有效的 PowerPoint 演示稿");
  const pRels = relationships(xml, "ppt/presentation.xml");
  const size = first(presentation, "sldSz"),
    sourceW = number(size, "cx"),
    sourceH = number(size, "cy");
  requireValue(sourceW > 0 && sourceH > 0, "PowerPoint 页面尺寸不正确");
  const width = 1600,
    height = Math.round((width * sourceH) / sourceW),
    scale = width / sourceW;
  requireValue(height >= 240 && height <= 2160, "暂不支持此页面比例");
  const warnings = new Set(),
    assets = new Map();
  const warn = (text) => warnings.add(text);
  const relCache = new Map();
  const rels = (name) => {
    if (!relCache.has(name)) relCache.set(name, relationships(xml, name));
    return relCache.get(name);
  };
  const related = (name, type) =>
    [...rels(name).values()].find((r) => r.type === type && !r.external)
      ?.target;
  function media(name, rid) {
    const r = rels(name).get(rid);
    if (!r || r.external || !files.has(r.target)) {
      warn("外部链接图片未下载，请在编辑器中补充。");
      return null;
    }
    const ext = path.posix.extname(r.target).toLowerCase();
    if (!assetTypes[ext] || !assetTypes[ext].startsWith("image/")) {
      warn("部分图片格式不受浏览器支持（如 EMF/WMF），请替换为 PNG 或 SVG。");
      return null;
    }
    const data = files.get(r.target);
    if (data.length > 12 * 1024 * 1024) {
      warn("超过 12 MB 的图片未导入，请压缩后补充。");
      return null;
    }
    if (!assets.has(r.target))
      assets.set(r.target, {
        name: "image-" + (assets.size + 1) + ext,
        path: "assets/powerpoint/image-" + (assets.size + 1) + ext,
        base64: data.toString("base64"),
      });
    return assets.get(r.target).path;
  }
  function context(name, layoutOnly = false) {
    const layoutName = layoutOnly ? name : related(name, "slideLayout"),
      layout = xml(layoutName);
    const masterName = layoutName ? related(layoutName, "slideMaster") : name,
      master = xml(masterName);
    const themeName = masterName ? related(masterName, "theme") : null,
      theme = xml(themeName);
    const colors = {
      dk1: "#000000",
      lt1: "#ffffff",
      dk2: "#24364b",
      lt2: "#f1f3f5",
      accent1: "#4472c4",
      accent2: "#ed7d31",
      accent3: "#a5a5a5",
      accent4: "#ffc000",
      accent5: "#5b9bd5",
      accent6: "#70ad47",
      hlink: "#0563c1",
      folHlink: "#954f72",
    };
    for (const c of children(first(theme, "clrScheme")))
      colors[c.localName] =
        "#" +
        (attr(children(c)[0], "lastClr") ||
          attr(children(c)[0], "val") ||
          "000000");
    const mapNode =
      first(xml(name), "overrideClrMapping") ||
      first(layout, "overrideClrMapping") ||
      first(master, "clrMap");
    const colorMap = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2" };
    for (const a of Array.from(mapNode?.attributes || []))
      colorMap[a.name] = a.value;
    return {
      name,
      layoutName,
      layout,
      masterName,
      master,
      theme,
      themeName,
      colors,
      colorMap,
      sx: scale,
      sy: scale,
      ox: 0,
      oy: 0,
      layoutOnly,
    };
  }
  function color(node, ctx, fallback = "transparent") {
    if (!node) return fallback;
    const c = ["srgbClr", "schemeClr", "sysClr", "prstClr"].includes(
      node.localName,
    )
      ? node
      : children(node).find((n) =>
          ["srgbClr", "schemeClr", "sysClr", "prstClr"].includes(n.localName),
        );
    if (!c) return fallback;
    let raw = attr(c, "val"),
      hex;
    if (c.localName === "schemeClr")
      hex = ctx.colors[ctx.colorMap[raw] || raw] || fallback;
    else if (c.localName === "sysClr") hex = "#" + attr(c, "lastClr", "000000");
    else if (c.localName === "srgbClr")
      hex = /^[a-f\d]{6}$/i.test(raw) ? "#" + raw : fallback;
    else
      hex =
        {
          black: "#000000",
          white: "#ffffff",
          red: "#ff0000",
          blue: "#0000ff",
          green: "#008000",
          yellow: "#ffff00",
          gray: "#808080",
        }[raw] || fallback;
    if (!/^#[a-f\d]{6}$/i.test(hex)) return hex;
    let rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)),
      alpha = 1;
    for (const t of children(c)) {
      const v = number(t, "val") / 100000;
      if (t.localName === "alpha") alpha = v;
      if (t.localName === "tint") rgb = rgb.map((c) => c + (255 - c) * v);
      if (t.localName === "shade" || t.localName === "lumMod")
        rgb = rgb.map((c) => c * v);
      if (t.localName === "lumOff") rgb = rgb.map((c) => c + 255 * v);
    }
    return `rgba(${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c)))).join(",")},${Math.max(0, Math.min(1, alpha))})`;
  }
  function fill(props, ctx, fallback = "transparent") {
    if (!props) return fallback;
    if (child(props, "noFill")) return "transparent";
    if (props.localName === "solidFill" || child(props, "solidFill"))
      return color(
        props.localName === "solidFill" ? props : child(props, "solidFill"),
        ctx,
        fallback,
      );
    const gradient =
      props.localName === "gradFill" ? props : child(props, "gradFill");
    if (gradient) {
      const stops = all(gradient, "gs").map(
        (s) => `${color(s, ctx, "#ffffff")} ${number(s, "pos") / 1000}%`,
      );
      return stops.length
        ? `linear-gradient(${90 + number(first(gradient, "lin"), "ang") / 60000}deg,${stops.join(",")})`
        : fallback;
    }
    return fallback;
  }
  function inheritance(s, ctx) {
    const ph = placeholder(s);
    if (!ph) return [s];
    const type = attr(ph, "type", "body"),
      idx = attr(ph, "idx", "0");
    const match = (doc) =>
      children(shapeTree(doc)).find((candidate) => {
        const p = placeholder(candidate);
        return p && attr(p, "idx", "0") === idx;
      }) ||
      children(shapeTree(doc)).find((candidate) => {
        const p = placeholder(candidate);
        return p && attr(p, "type", "body") === type;
      });
    const values = ctx.layoutOnly
      ? [match(ctx.master), s]
      : [match(ctx.master), match(ctx.layout), s];
    return values.filter(Boolean);
  }
  function box(chain, ctx) {
    const x = chain
      .map((s) => child(shapeProps(s), "xfrm") || child(s, "xfrm"))
      .reverse()
      .find(Boolean);
    const off = child(x, "off"),
      ext = child(x, "ext");
    return {
      x: (number(off, "x") - ctx.ox) * ctx.sx,
      y: (number(off, "y") - ctx.oy) * ctx.sy,
      w: Math.max(1, number(ext, "cx", sourceW / 2) * ctx.sx),
      h: Math.max(1, number(ext, "cy", sourceH / 5) * ctx.sy),
      rotation: number(x, "rot") / 60000,
      flipH: attr(x, "flipH") === "1",
      flipV: attr(x, "flipV") === "1",
    };
  }
  function position(b) {
    return `position:absolute;left:${px(b.x)};top:${px(b.y)};width:${px(b.w)};height:${px(b.h)};${b.rotation || b.flipH || b.flipV ? `transform:rotate(${round(b.rotation)}deg) scale(${b.flipH ? -1 : 1},${b.flipV ? -1 : 1});` : ""}`;
  }
  function textStyle(nodes, ctx) {
    const values = {};
    let clr, font;
    for (const node of nodes.filter(Boolean)) {
      for (const a of Array.from(node.attributes || []))
        values[a.name] = a.value;
      if (child(node, "solidFill")) clr = color(child(node, "solidFill"), ctx);
      const f =
        attr(child(node, "ea"), "typeface") ||
        attr(child(node, "latin"), "typeface");
      if (f) font = f;
    }
    if (font?.startsWith("+"))
      font = attr(
        first(
          first(ctx.theme, font.startsWith("+mj") ? "majorFont" : "minorFont"),
          "latin",
        ),
        "typeface",
        "Arial",
      );
    return `font-size:${px(Math.max(1, (Number(values.sz || 2400) / 100) * 12700 * scale * (ctx.fontScale ?? 1)))};font-family:'${esc(fontName(font || "Arial"))}','PingFang SC',sans-serif;color:${clr || color({ localName: "schemeClr", hasAttribute: () => true, getAttribute: () => "tx1", childNodes: [] }, ctx, "#20252d")};font-weight:${values.b === "1" ? "700" : "400"};font-style:${values.i === "1" ? "italic" : "normal"};text-decoration:${values.u && values.u !== "none" ? "underline " : ""}${values.strike && values.strike !== "noStrike" ? "line-through" : ""};${values.spc ? `letter-spacing:${px((Number(values.spc) / 100) * 12700 * scale)};` : ""}`;
  }
  function textBody(body, chain, ctx, replacement) {
    if (!body) return "";
    const bodyProps = chain
      .map((n) => child(child(n, "txBody"), "bodyPr"))
      .filter(Boolean);
    const autofit = bodyProps
      .map((n) => child(n, "normAutofit"))
      .filter(Boolean)
      .at(-1);
    ctx = { ...ctx, fontScale: number(autofit, "fontScale", 100000) / 100000 };
    const wrap = bodyProps
      .map((n) => attr(n, "wrap"))
      .filter(Boolean)
      .at(-1);
    const ph = placeholder(chain.at(-1)),
      type = attr(ph, "type", "body");
    const masterStyle = child(
      first(ctx.master, "txStyles"),
      /title/i.test(type) ? "titleStyle" : ph ? "bodyStyle" : "otherStyle",
    );
    const ps = children(body, "p");
    return ps
      .map((p, i) => {
        const pp = child(p, "pPr"),
          level = number(pp, "lvl"),
          levelName = `lvl${level + 1}pPr`;
        const defaults = [
          child(first(presentation, "defaultTextStyle"), levelName),
          child(masterStyle, levelName),
          ...chain.map((s) =>
            child(child(child(s, "txBody"), "lstStyle"), levelName),
          ),
          pp,
        ].filter(Boolean);
        const rDefaults = defaults.map((n) => child(n, "defRPr"));
        let align = "left",
          margin = 0,
          indent = 0,
          bullet = "",
          line = "1.2",
          spaceBefore = 0,
          spaceAfter = 0;
        for (const d of defaults) {
          if (d.hasAttribute("algn"))
            align =
              { l: "left", ctr: "center", r: "right", just: "justify" }[
                attr(d, "algn")
              ] || "left";
          if (d.hasAttribute("marL")) margin = number(d, "marL") * scale;
          if (d.hasAttribute("indent")) indent = number(d, "indent") * scale;
          if (child(d, "buNone")) bullet = "";
          if (child(d, "buChar")) bullet = attr(child(d, "buChar"), "char");
          if (child(d, "buAutoNum")) bullet = i + 1 + ".";
          if (child(d, "lnSpc")) {
            const sp = child(d, "lnSpc");
            line = child(sp, "spcPct")
              ? String(number(child(sp, "spcPct"), "val") / 100000)
              : px((number(child(sp, "spcPts"), "val") / 100) * 12700 * scale);
          }
          for (const [tag, set] of [
            ["spcBef", (v) => (spaceBefore = v)],
            ["spcAft", (v) => (spaceAfter = v)],
          ]) {
            const sp = child(child(d, tag), "spcPts");
            if (sp) set((number(sp, "val") / 100) * 12700 * scale);
          }
        }
        let runs = children(p)
          .filter((n) => ["r", "br", "fld"].includes(n.localName))
          .map((r) => {
            if (r.localName === "br") return "<br>";
            const rp = child(r, "rPr"),
              value = children(r, "t")
                .map((t) => t.textContent)
                .join("");
            const link = rels(ctx.name).get(
              relationId(child(rp, "hlinkClick")),
            );
            return `<span style="${textStyle([...rDefaults, rp], ctx)}"${link?.external && safeLink(link.target) ? ` data-editor-href="${esc(link.target)}"` : ""}>${esc(value)}</span>`;
          })
          .join("");
        if (replacement !== undefined)
          runs =
            i === 0
              ? `<span style="${textStyle([...rDefaults, child(children(p, "r")[0], "rPr"), child(p, "endParaRPr")], ctx)}">${esc(replacement)}</span>`
              : "";
        if (replacement !== undefined && i > 0) return "";
        return `<p style="white-space:${wrap === "none" ? "pre" : "pre-wrap"};flex-shrink:0;margin:${px(spaceBefore)} 0 ${px(spaceAfter)};text-align:${align};line-height:${line};padding-left:${px(Math.max(0, margin))};text-indent:${px(indent)};${textStyle([...rDefaults, child(children(p, "r")[0], "rPr") || child(p, "endParaRPr")], ctx)}">${bullet ? esc(bullet) + " " : ""}${runs || "<br>"}</p>`;
      })
      .join("");
  }
  function image(s, ctx, chain) {
    const b = box(chain, ctx),
      blip = first(s, "svgBlip") || first(s, "blip"),
      src = media(ctx.name, attr(blip, "r:embed"));
    if (!src) return "";
    const crop = first(s, "srcRect"),
      l = number(crop, "l") / 100000,
      r = number(crop, "r") / 100000,
      t = number(crop, "t") / 100000,
      bottom = number(crop, "b") / 100000;
    const name =
      attr(first(s, "cNvPr"), "descr") ||
      attr(first(s, "cNvPr"), "name", "图片");
    if (l || r || t || bottom)
      return `<div style="${position(b)}overflow:hidden"><img src="${src}" alt="${esc(name)}" style="position:absolute;max-width:none;left:${(-l / (1 - l - r)) * 100}%;top:${(-t / (1 - t - bottom)) * 100}%;width:${100 / Math.max(0.01, 1 - l - r)}%;height:${100 / Math.max(0.01, 1 - t - bottom)}%"></div>`;
    return `<img src="${src}" alt="${esc(name)}" style="${position(b)}object-fit:fill">`;
  }
  function geometry(props, b, ctx, background, stroke, strokeWidth, dash) {
    const preset = attr(child(props, "prstGeom"), "prst", "rect"),
      custom = child(props, "custGeom");
    if (preset === "rect" && !custom)
      return {
        css: `background:${background};border:${px(strokeWidth)} ${dash ? "dashed" : "solid"} ${stroke};`,
        svg: "",
      };
    if (preset === "roundRect")
      return {
        css: `background:${background};border:${px(strokeWidth)} ${dash ? "dashed" : "solid"} ${stroke};border-radius:${px(Math.min(b.w, b.h) * 0.14)};`,
        svg: "",
      };
    const shapes = {
      ellipse: '<ellipse cx="50" cy="50" rx="49" ry="49"/>',
      triangle: '<path d="M50 0L100 100H0Z"/>',
      rtTriangle: '<path d="M0 0L100 100H0Z"/>',
      diamond: '<path d="M50 0L100 50L50 100L0 50Z"/>',
      hexagon: '<path d="M25 0H75L100 50L75 100H25L0 50Z"/>',
      parallelogram: '<path d="M25 0H100L75 100H0Z"/>',
      chevron: '<path d="M0 0H65L100 50L65 100H0L35 50Z"/>',
      rightArrow: '<path d="M0 30H60V0L100 50L60 100V70H0Z"/>',
      leftArrow: '<path d="M100 30H40V0L0 50L40 100V70H100Z"/>',
      line: '<path d="M0 0L100 100"/>',
      straightConnector1: '<path d="M0 0L100 100"/>',
    };
    let content = shapes[preset],
      view = "0 0 100 100";
    if (custom) {
      content = all(custom, "path")
        .map((p) => {
          const w = number(p, "w", b.w / ctx.sx),
            h = number(p, "h", b.h / ctx.sy);
          const point = (n) =>
            `${(number(n, "x") / Math.max(1, w)) * 100} ${(number(n, "y") / Math.max(1, h)) * 100}`;
          const commands = children(p)
            .map((n) => {
              const pts = children(n, "pt");
              if (n.localName === "moveTo") return "M" + point(pts[0]);
              if (n.localName === "lnTo") return "L" + point(pts[0]);
              if (n.localName === "cubicBezTo")
                return "C" + pts.map(point).join(" ");
              if (n.localName === "quadBezTo")
                return "Q" + pts.map(point).join(" ");
              if (n.localName === "close") return "Z";
              warn("部分自定义曲线已简化，请检查其轮廓。");
              return "";
            })
            .join(" ");
          return `<path d="${commands}"${attr(p, "fill") === "none" ? ' fill="none"' : ""}/>`;
        })
        .join("");
    }
    if (!content) {
      warn("部分特殊形状已简化为矩形，请检查轮廓。");
      return {
        css: `background:${background};border:${px(strokeWidth)} solid ${stroke};`,
        svg: "",
      };
    }
    const fillColor = background.includes("gradient") ? "#dbe5ef" : background;
    if (background.includes("gradient")) warn("部分形状渐变已简化为纯色。");
    return {
      css: "",
      svg: `<svg viewBox="${view}" preserveAspectRatio="none" aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;overflow:visible" fill="${fillColor}" stroke="${stroke}" stroke-width="${strokeWidth}"${dash ? ' stroke-dasharray="6 4"' : ""}><g vector-effect="non-scaling-stroke">${content.replaceAll("/>", ' vector-effect="non-scaling-stroke"/>')}</g></svg>`,
    };
  }
  function shape(s, ctx) {
    const chain = inheritance(s, ctx),
      b = box(chain, ctx);
    if (s.localName === "pic") return image(s, ctx, chain);
    if (s.localName === "graphicFrame") {
      const table = first(s, "tbl");
      if (table) return tableShape(s, table, b, ctx);
      const chart = first(s, "chart");
      if (chart) return chartShape(chart, b, ctx);
      warn("SmartArt、嵌入对象或媒体暂未转换，请在原文件中核对。");
      return "";
    }
    const props = chain.map(shapeProps).reverse().find(Boolean);
    let background = "transparent";
    for (const node of chain)
      background = fill(shapeProps(node), ctx, background);
    const style = child(s, "style"),
      fillRef = child(style, "fillRef");
    if (
      background === "transparent" &&
      !child(props, "noFill") &&
      fillRef &&
      number(fillRef, "idx") > 0
    )
      background = color(fillRef, ctx, "transparent");
    const line = chain
      .map((n) => child(shapeProps(n), "ln"))
      .reverse()
      .find(Boolean);
    const lineRef = child(style, "lnRef");
    const stroke = child(line, "noFill")
      ? "transparent"
      : color(
          child(line, "solidFill"),
          ctx,
          color(lineRef, ctx, "transparent"),
        );
    const strokeWidth =
      stroke === "transparent" ? 0 : number(line, "w", 12700) * scale;
    const { css, svg } = geometry(
      props,
      b,
      ctx,
      background,
      stroke,
      strokeWidth,
      first(line, "prstDash") &&
        attr(first(line, "prstDash"), "val") !== "solid",
    );
    const body = child(s, "txBody"),
      bodyPr = chain
        .map((n) => child(child(n, "txBody"), "bodyPr"))
        .filter(Boolean);
    const bp = {};
    for (const node of bodyPr)
      for (const a of Array.from(node.attributes || [])) bp[a.name] = a.value;
    const anchor = { ctr: "center", b: "flex-end" }[bp.anchor] || "flex-start";
    const padding = [
      bp.tIns ?? 45720,
      bp.rIns ?? 91440,
      bp.bIns ?? 45720,
      bp.lIns ?? 91440,
    ]
      .map((v) => px(Number(v) * scale))
      .join(" ");
    const ph = placeholder(s),
      phType = attr(ph, "type", "body");
    if (ctx.layoutOnly && ["dt", "ftr", "sldNum", "hdr"].includes(phType))
      return "";
    const placeholderText =
      ctx.layoutOnly && ph
        ? phType === "subTitle"
          ? "副标题"
          : /title/i.test(phType)
            ? "页面标题"
            : "正文内容"
        : undefined;
    const hlink = rels(ctx.name).get(
      relationId(first(child(s, "nvSpPr"), "hlinkClick")),
    );
    const link =
      hlink?.external && safeLink(hlink.target)
        ? ` data-editor-href="${esc(hlink.target)}"`
        : "";
    return `<div${link} style="${position(b)}${css}">${svg}${body ? `<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:${anchor};padding:${padding};overflow:${bp.vertOverflow === "clip" || bp.horzOverflow === "clip" ? "hidden" : "visible"};${bp.vert === "vert" ? "writing-mode:vertical-rl;" : ""}">${textBody(body, chain, ctx, placeholderText)}</div>` : ""}</div>`;
  }
  function tableShape(s, table, b, ctx) {
    const cols = children(first(table, "tblGrid"), "gridCol"),
      rows = children(table, "tr");
    return `<div style="${position(b)}"><table style="width:100%;height:100%;border-collapse:collapse;table-layout:fixed"><colgroup>${cols.map((c) => `<col style="width:${(number(c, "w") / cols.reduce((a, c) => a + number(c, "w"), 0)) * 100}%">`).join("")}</colgroup><tbody>${rows
      .map(
        (row) =>
          `<tr style="height:${px(number(row, "h") * scale)}">${children(
            row,
            "tc",
          )
            .filter(
              (c) => attr(c, "hMerge") !== "1" && attr(c, "vMerge") !== "1",
            )
            .map(
              (c) =>
                `<td colspan="${number(c, "gridSpan", 1)}" rowspan="${number(c, "rowSpan", 1)}" style="border:1px solid #9aabbc;padding:6px;background:${fill(child(c, "tcPr"), ctx, "transparent")}">${textBody(child(c, "txBody"), [s], ctx)}</td>`,
            )
            .join("")}</tr>`,
      )
      .join("")}</tbody></table></div>`;
  }
  function chartShape(chart, b, ctx) {
    const r = rels(ctx.name).get(relationId(chart)),
      doc = r && !r.external ? xml(r.target) : null;
    if (!doc) {
      warn("未能读取嵌入图表。");
      return "";
    }
    const series = all(doc, "ser"),
      values = series.map((s) =>
        all(child(s, "val") || child(s, "yVal"), "pt").map(
          (p) => Number(first(p, "v")?.textContent) || 0,
        ),
      );
    const labels = all(child(series[0], "cat"), "pt").map(
      (p) => first(p, "v")?.textContent || "",
    );
    const count = Math.max(0, ...values.map((v) => v.length));
    if (!count) {
      warn("图表缺少缓存数据，未能转换。");
      return "";
    }
    const seriesNames = series.map(
      (s, i) => all(child(s, "tx"), "v")[0]?.textContent || `系列 ${i + 1}`,
    );
    const bar = first(doc, "barChart");
    const simpleBar =
      bar &&
      attr(child(bar, "barDir"), "val", "col") === "col" &&
      ["clustered", "standard"].includes(
        attr(child(bar, "grouping"), "val", "clustered"),
      );
    if (!simpleBar) {
      warn("复杂图表已保留为可编辑的数据表，请核对原图并按需替换。");
      return `<div style="${position(b)}overflow:hidden"><table style="width:100%;border-collapse:collapse;font-size:${px(Math.min(28, (b.h / (count + 2)) * 0.6))};color:${ctx.colors.dk1};background:${ctx.colors.lt1}"><thead><tr><th></th>${seriesNames.map((n) => `<th style="padding:8px;border:1px solid #9aabbc">${esc(n)}</th>`).join("")}</tr></thead><tbody>${Array.from({ length: count }, (_, i) => `<tr><th style="padding:8px;border:1px solid #9aabbc">${esc(labels[i] || String(i + 1))}</th>${values.map((v) => `<td style="padding:8px;border:1px solid #9aabbc;text-align:center">${v[i] ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }
    warn("柱形图已转为 SVG，保留缓存数据；图表数据需在源码中修改或重新导入。");
    const minimum = Math.min(0, ...values.flat()),
      maximum = Math.max(0, ...values.flat());
    const span = maximum - minimum || 1,
      y = (v) => 340 - ((v - minimum) / span) * 280,
      baseline = y(0);
    const colors = Object.keys(ctx.colors)
      .filter((k) => k.startsWith("accent"))
      .map((k) => ctx.colors[k]);
    const cell = 700 / count;
    let drawing = `<path d="M50 ${baseline}H770" fill="none" stroke="#8796a6"/>`;
    values.forEach((row, si) =>
      row.forEach((v, i) => {
        const top = y(v),
          h = Math.abs(top - baseline),
          w = cell / (series.length + 1),
          x = 50 + i * cell + si * w + 5;
        drawing += `<rect x="${x}" y="${Math.min(top, baseline)}" width="${w * 0.85}" height="${h}" fill="${colors[si % colors.length]}"/><text x="${x + w * 0.4}" y="${top + (v < 0 ? 20 : -8)}" text-anchor="middle" font-size="16">${v}</text>`;
      }),
    );
    drawing += labels
      .slice(0, count)
      .map(
        (l, i) =>
          `<text x="${50 + i * cell + cell / 2}" y="378" text-anchor="middle" font-size="17">${esc(l)}</text>`,
      )
      .join("");
    drawing += seriesNames
      .map(
        (n, i) =>
          `<rect x="${50 + i * 230}" y="16" width="14" height="14" fill="${colors[i % colors.length]}"/><text x="${72 + i * 230}" y="29" font-size="16">${esc(n)}</text>`,
      )
      .join("");
    return `<svg role="img" aria-label="导入图表" viewBox="0 0 800 400" style="${position(b)}" fill="${ctx.colors.dk1}">${drawing}</svg>`;
  }

  function render(nodes, ctx, { skipPlaceholders = false } = {}) {
    return nodes
      .map((s) => {
        if (skipPlaceholders && placeholder(s)) return "";
        if (s.localName === "AlternateContent")
          return render(
            children(child(s, "Choice") || child(s, "Fallback")),
            ctx,
          );
        if (s.localName === "grpSp") {
          const x = child(shapeProps(s), "xfrm"),
            b = box([s], ctx),
            ce = child(x, "chExt"),
            co = child(x, "chOff");
          return `<div style="${position(b)}">${render(children(s), { ...ctx, sx: b.w / Math.max(1, number(ce, "cx", b.w / ctx.sx)), sy: b.h / Math.max(1, number(ce, "cy", b.h / ctx.sy)), ox: number(co, "x"), oy: number(co, "y") })}</div>`;
        }
        if (["sp", "pic", "cxnSp", "graphicFrame"].includes(s.localName))
          return shape(s, ctx);
        return "";
      })
      .join("");
  }
  function background(ctx, doc) {
    const sources = [
      { doc, name: ctx.name },
      { doc: ctx.layout, name: ctx.layoutName },
      { doc: ctx.master, name: ctx.masterName },
    ];
    for (const source of sources) {
      const bg = child(first(source.doc, "cSld"), "bg");
      if (!bg) continue;
      let props = child(bg, "bgPr"),
        owner = source.name;
      if (!props) {
        const ref = child(bg, "bgRef"),
          idx = number(ref, "idx");
        props = children(
          first(ctx.theme, idx >= 1001 ? "bgFillStyleLst" : "fillStyleLst"),
        )[idx >= 1001 ? idx - 1001 : idx - 1];
        owner = ctx.themeName;
        if (!props) return `background:${color(ref, ctx, "#ffffff")};`;
        // Theme background lists contain fill nodes, rather than bgPr wrappers.
        if (props.localName === "solidFill")
          return `background:${color(props, ctx, "#ffffff")};`;
      }
      const blip = first(props, "blip");
      if (blip) {
        const src = media(owner, attr(blip, "r:embed"));
        if (src)
          return `background:#ffffff url('${src}') center/100% 100% no-repeat;`;
      }
      return `background:${fill(props, ctx, "#ffffff")};`;
    }
    return "background:#ffffff;";
  }
  const slideNames = all(presentation, "sldId")
    .map((n) => pRels.get(relationId(n)))
    .filter((r) => r && !r.external)
    .map((r) => r.target);
  let names = slideNames;
  if (mode === "masters") {
    names = [];
    for (const m of all(presentation, "sldMasterId")) {
      const master = pRels.get(relationId(m));
      if (!master || master.external) continue;
      for (const layout of all(xml(master.target), "sldLayoutId")) {
        const r = rels(master.target).get(relationId(layout));
        if (r && !r.external && !names.includes(r.target)) names.push(r.target);
      }
    }
  }
  requireValue(
    names.length > 0 && names.length <= 200,
    mode === "masters"
      ? "未找到可提取的母版版式，或版式超过 200 个"
      : "演示稿需要包含 1–200 页",
  );
  const notes = {};
  const html = names
    .map((name, i) => {
      const doc = xml(name);
      requireValue(doc, "PowerPoint 中缺少页面文件");
      const ctx = context(name, mode === "masters"),
        root = doc.documentElement;
      const bg = background(ctx, doc);
      let body = "";
      if (
        attr(root, "showMasterSp", "1") !== "0" &&
        attr(ctx.layout?.documentElement, "showMasterSp", "1") !== "0"
      )
        body += render(
          children(shapeTree(ctx.master)),
          { ...ctx, name: ctx.masterName },
          { skipPlaceholders: true },
        );
      if (mode === "slides")
        body += render(
          children(shapeTree(ctx.layout)),
          { ...ctx, name: ctx.layoutName },
          { skipPlaceholders: true },
        );
      body += render(children(shapeTree(doc)), ctx);
      let title =
        mode === "masters"
          ? attr(
              first(doc, "cSld"),
              "name",
              attr(root, "type", `版式 ${i + 1}`),
            )
          : "";
      if (!title) {
        const titleShape = children(shapeTree(doc)).find((s) =>
          /title/i.test(attr(placeholder(s), "type")),
        );
        title =
          all(titleShape, "t")
            .map((n) => n.textContent)
            .join("") ||
          children(shapeTree(doc))
            .map((s) =>
              all(s, "t")
                .map((n) => n.textContent)
                .join(""),
            )
            .find(Boolean) ||
          `第 ${i + 1} 页`;
      }
      const notesName = mode === "slides" ? related(name, "notesSlide") : null;
      const noteText = children(shapeTree(xml(notesName)))
        .filter((s) => attr(placeholder(s), "type") === "body")
        .map((s) =>
          all(s, "t")
            .map((n) => n.textContent)
            .join("\n"),
        )
        .join("\n");
      notes[i + 1] = { title: title.slice(0, 200), notes: noteText, refs: [] };
      if (first(doc, "oMath") || first(doc, "oMathPara"))
        warn("原生 Office 公式暂未转换，请使用编辑器的公式功能重新录入。");
      if (first(doc, "timing") || first(doc, "transition"))
        warn("动画和页面切换效果未导入，使用系统统一演示控件。");
      return `<section class="slide ppt-import" data-slide-id="ppt-${i + 1}" style="${bg}">${body}</section>`;
    })
    .join("\n");
  return {
    width,
    height,
    html,
    css: '.ppt-import,.ppt-import *{box-sizing:border-box}.ppt-import{overflow:hidden}.ppt-import p{white-space:pre-wrap}.ppt-import img{max-width:none}.ppt-import svg text{font-family:Arial,"PingFang SC",sans-serif}',
    notes,
    assets: [...assets.values()],
    warnings: [...warnings],
    sourceSlides: slideNames.length,
    layouts: mode === "masters" ? names.length : undefined,
  };
}
