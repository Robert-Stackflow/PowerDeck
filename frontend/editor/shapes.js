// Shape assets use native SVG; the picker uses the same Lucide icon set as the app.
export const shapes = [
  {
    id: "rectangle",
    label: "矩形",
    icon: "rectangleHorizontal",
    body: '<rect x="2" y="2" width="196" height="116"/>',
  },
  {
    id: "rounded",
    label: "圆角矩形",
    icon: "squareRoundCorner",
    body: '<rect x="2" y="2" width="196" height="116" rx="18"/>',
  },
  {
    id: "ellipse",
    label: "椭圆",
    icon: "circle",
    body: '<ellipse cx="100" cy="60" rx="98" ry="58"/>',
  },
  {
    id: "triangle",
    label: "三角形",
    icon: "triangle",
    body: '<path d="M100 2 198 118H2Z"/>',
  },
  {
    id: "diamond",
    label: "菱形",
    icon: "diamond",
    body: '<path d="m100 2 98 58-98 58L2 60Z"/>',
  },
  {
    id: "hexagon",
    label: "六边形",
    icon: "hexagon",
    body: '<path d="M48 2h104l46 58-46 58H48L2 60Z"/>',
  },
  {
    id: "star",
    label: "星形",
    icon: "star",
    body: '<path d="m100 2 23 39 73 4-55 28 17 45-58-26-58 26 17-45L4 45l73-4Z"/>',
  },
  {
    id: "arrow-right",
    label: "右箭头",
    icon: "arrowRight",
    body: '<path d="M2 36h128V2l68 58-68 58V84H2Z"/>',
  },
  {
    id: "arrow-left",
    label: "左箭头",
    icon: "arrowLeft",
    body: '<path d="M198 36H70V2L2 60l68 58V84h128Z"/>',
  },
  {
    id: "chevron",
    label: "燕尾箭头",
    icon: "chevronRight",
    body: '<path d="M2 2h122l74 58-74 58H2l74-58Z"/>',
  },
  {
    id: "callout",
    label: "对话框",
    icon: "messageSquare",
    body: '<path d="M18 2h164q16 0 16 16v62q0 16-16 16H72l-36 22V96H18Q2 96 2 80V18Q2 2 18 2Z"/>',
  },
  {
    id: "line",
    label: "直线",
    icon: "minus",
    body: '<path d="M2 60h196" fill="none"/>',
    height: 24,
  },
];
export function shapeMarkup(id) {
  const shape = shapes.find((item) => item.id === id) || shapes[1];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" preserveAspectRatio="none" aria-hidden="true" style="display:block!important;position:static!important;width:100%!important;height:100%!important;overflow:visible!important;pointer-events:none!important"><g fill="var(--shape-fill,#dceae3)" stroke="var(--shape-stroke,#658e7c)" stroke-width="var(--shape-stroke-width,2)" stroke-dasharray="var(--shape-dash,none)" stroke-opacity="var(--shape-stroke-opacity,1)" stroke-linejoin="round">${shape.body.replaceAll("<path ", '<path vector-effect="non-scaling-stroke" ').replaceAll("<rect ", '<rect vector-effect="non-scaling-stroke" ').replaceAll("<ellipse ", '<ellipse vector-effect="non-scaling-stroke" ')}</g></svg>`;
}
export function safeLink(value) {
  const input = String(value).trim();
  if (!input) return "";
  if (/\s/.test(input) || input.length > 2048)
    throw new Error("请输入有效的链接地址");
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(input)
    ? input
    : "https://" + input;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("请输入有效的链接地址");
  }
  if (!["https:", "http:", "mailto:", "tel:"].includes(url.protocol))
    throw new Error("支持网页、邮件和电话链接");
  if (["http:", "https:"].includes(url.protocol) && !url.hostname)
    throw new Error("请输入有效的链接地址");
  return url.href;
}
