const esc = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export const templates = [
  {
    id: "blank",
    name: "空白演示",
    pages: 1,
    bg: "#ffffff",
    ink: "#263d35",
    accent: "#438673",
    tag: "从空白开始",
  },
  {
    id: "report",
    name: "简洁汇报",
    pages: 5,
    bg: "#f4f3ec",
    ink: "#243d34",
    accent: "#528873",
    tag: "工作汇报",
  },
  {
    id: "tech",
    name: "技术分享",
    pages: 5,
    bg: "#101b30",
    ink: "#f1f7ff",
    accent: "#70e0ce",
    tag: "技术与方案",
  },
  {
    id: "review",
    name: "项目复盘",
    pages: 5,
    bg: "#fbf5ee",
    ink: "#46362e",
    accent: "#dc7d45",
    tag: "成果与计划",
  },
];
export function templatePreview(template) {
  return `<span class="template-preview" style="--template-bg:${template.bg};--template-ink:${template.ink};--template-accent:${template.accent}"><span class="template-preview-tag">${template.tag}</span><strong>${template.id === "blank" ? "Aa" : template.name}</strong><span class="template-preview-art"><i></i><i></i><i></i></span><span class="template-preview-line"></span></span>`;
}
export function templateContent(id, title) {
  const theme = templates.find((entry) => entry.id === id);
  if (!theme) throw new Error("请选择一个可用模板");
  const label = esc(title || "演示文稿");
  const chart = `<svg viewBox="0 0 780 330" role="img" aria-label="阶段进展示例数据" style="width:780px;height:330px"><g fill="none" stroke="currentColor" opacity=".15"><path d="M80 270H750M80 190H750M80 110H750"/></g><g fill="${theme.accent}"><rect x="130" y="165" width="110" height="105" rx="8"/><rect x="325" y="105" width="110" height="165" rx="8"/><rect x="520" y="40" width="110" height="230" rx="8"/></g><g fill="currentColor" font-size="25" text-anchor="middle"><text x="185" y="312">起点</text><text x="380" y="312">阶段一</text><text x="575" y="312">阶段二</text><text x="185" y="148">35</text><text x="380" y="88">55</text><text x="575" y="23">77</text></g></svg>`;
  const cards = (items) =>
    `<div class="tpl-cards">${items.map(([h, p], i) => `<article><span class="tpl-number">0${i + 1}</span><h2>${h}</h2><p>${p}</p></article>`).join("")}</div>`;
  const timeline = (items) =>
    `<div class="tpl-timeline">${items.map(([h, p], i) => `<article><span class="tpl-step">0${i + 1}</span><h2>${h}</h2><p>${p}</p></article>`).join("")}</div>`;
  let pages;
  if (id === "blank")
    pages = [
      {
        title: title || "演示文稿",
        body: `<h1 class="tpl-blank-title">${label}</h1>`,
        note: "双击标题即可编辑。",
      },
    ];
  else if (id === "tech")
    pages = [
      {
        title: title,
        body: `<div class="tpl-cover"><span class="tpl-tag">技术分享</span><h1>${label}</h1><p>从问题出发，讲清原理与实践。</p><div class="tpl-cover-art"><i></i><i></i><i></i></div></div>`,
        note: "介绍主题、适用场景和希望听众带走的结论。",
      },
      {
        title: "背景与问题",
        body: `<h1>为什么需要这个方案</h1><div class="tpl-columns"><div><span class="tpl-tag">现状</span><h2>描述关键场景</h2><p>谁在什么场景下遇到了什么问题？用一个具体案例说明。</p></div><div class="tpl-panel"><span class="tpl-tag">目标</span><h2>明确优化方向</h2><p>性能、可靠性、成本：选择最重要的指标，并给出衡量方式。</p></div></div>`,
        note: "替换为实际问题，补充基线指标。",
      },
      {
        title: "方案架构",
        body: `<h1>核心方案，一图看懂</h1><div class="tpl-flow">${["输入与约束", "处理流程", "核心能力", "输出与评估"].map((s, i) => `<div><span>0${i + 1}</span><h2>${s}</h2></div>${i < 3 ? "<b>→</b>" : ""}`).join("")}</div><p class="tpl-bottom-note">在图中补充模块职责、数据流与关键依赖。</p>`,
        note: "沿着数据流解释各模块，突出与旧方案的区别。",
      },
      {
        title: "验证与效果",
        body: `<h1>用结果验证方案</h1><div class="tpl-columns"><div>${chart}</div><div class="tpl-panel"><span class="tpl-tag">示例指标</span><h2 class="tpl-big">+40%</h2><p>替换为实际提升幅度，并注明测试条件、样本量和对照基线。</p></div></div>`,
        note: "图表为占位示例，使用前替换为真实实验数据。",
      },
      {
        title: "总结与下一步",
        body: `<h1>从验证走向应用</h1>${timeline([
          ["验证", "复现结果，确认适用边界。"],
          ["迭代", "补齐关键场景与工程能力。"],
          ["落地", "分阶段发布，持续观测反馈。"],
        ])}`,
        note: "回顾结论，列出待验证假设和下一步行动。",
      },
    ];
  else if (id === "review")
    pages = [
      {
        title: title,
        body: `<div class="tpl-cover"><span class="tpl-tag">项目复盘</span><h1>${label}</h1><p>看清结果，沉淀经验，确定下一步。</p><div class="tpl-cover-art"><i></i><i></i><i></i></div></div>`,
        note: "介绍项目周期、范围、角色与复盘目标。",
      },
      {
        title: "目标与范围",
        body: `<h1>我们要完成什么</h1>${cards([
          ["业务目标", "用一句话说明项目的预期价值。"],
          ["交付范围", "明确关键交付物和验收标准。"],
          ["资源与约束", "说明时间、人员和主要依赖。"],
        ])}`,
        note: "回到启动时的目标，避免用结果倒推目标。",
      },
      {
        title: "结果回顾",
        body: `<h1>目标与结果对照</h1><div class="tpl-columns"><div>${chart}</div><div class="tpl-panel"><span class="tpl-tag">示例数据</span><h2>进展与差距</h2><p>展示实际结果，解释目标差距，以及对业务的影响。</p></div></div>`,
        note: "图表数字为示例，请替换为项目真实数据。",
      },
      {
        title: "问题与行动",
        body: `<h1>把经验变成行动</h1><table class="tpl-table"><thead><tr><th>观察到的问题</th><th>原因分析</th><th>改进行动</th></tr></thead><tbody><tr><td>需求反复变化</td><td>验收标准不清晰</td><td>在启动阶段明确验收样例</td></tr><tr><td>协作信息不同步</td><td>依赖缺少负责人</td><td>指定负责人并固定同步节奏</td></tr><tr><td>上线问题发现较晚</td><td>关键路径验证不足</td><td>提前增加端到端验收</td></tr></tbody></table>`,
        note: "示例内容用于展示版式，替换成真实问题、证据与行动。",
      },
      {
        title: "后续计划",
        body: `<h1>下一阶段的三个重点</h1>${timeline([
          ["立即行动", "明确负责人和截止时间。"],
          ["持续改进", "把经验纳入日常流程。"],
          ["复查结果", "检查行动是否产生实际效果。"],
        ])}`,
        note: "行动项需要有明确的负责人、时间和衡量方式。",
      },
    ];
  else
    pages = [
      {
        title: title,
        body: `<div class="tpl-cover"><span class="tpl-tag">工作汇报</span><h1>${label}</h1><p>让重点清晰，让进展可见。</p><div class="tpl-cover-art"><i></i><i></i><i></i></div></div>`,
        note: "开场介绍汇报范围与核心结论。",
      },
      {
        title: "汇报提纲",
        body: `<h1>今天，聚焦三个问题</h1>${cards([
          ["做了什么", "概括本阶段最重要的工作。"],
          ["取得什么结果", "用数据和案例证明成果。"],
          ["接下来怎么做", "明确优先级与所需支持。"],
        ])}`,
        note: "使用简洁的提纲，引出后续内容。",
      },
      {
        title: "重点工作",
        body: `<h1>一项重点，讲清价值</h1><div class="tpl-columns"><div><span class="tpl-tag">工作内容</span><h2>写下关键行动</h2><p>交代背景、采取的行动，以及其中的重要判断。</p></div><div class="tpl-panel"><span class="tpl-tag">成果价值</span><h2>说明带来的变化</h2><p>结合一个具体案例，说明对用户、业务或团队的影响。</p></div></div>`,
        note: "用“背景—行动—结果”组织讲述。",
      },
      {
        title: "进展与数据",
        body: `<h1>进展，用数据说话</h1><div class="tpl-columns"><div>${chart}</div><div class="tpl-panel"><span class="tpl-tag">示例指标</span><h2 class="tpl-big">77%</h2><p>在此写下最值得关注的数字及其意义。</p></div></div>`,
        note: "图表为示例数据，替换后补充统计口径。",
      },
      {
        title: "下一步计划",
        body: `<h1>接下来，聚焦这些行动</h1>${timeline([
          ["优先完成", "列出最重要的一项交付。"],
          ["持续推进", "写下需要协同推进的工作。"],
          ["评估调整", "确认复盘节点与成功标准。"],
        ])}`,
        note: "将计划落到明确的交付、责任和时间。",
      },
    ];
  const css = `.slide.tpl{background:${theme.bg};color:${theme.ink};font-family:"PingFang SC","Microsoft YaHei",Arial,sans-serif;padding:90px 100px}.tpl h1{font-size:62px;line-height:1.2;letter-spacing:-1.5px;margin:0 0 70px;font-weight:700;max-width:1320px;overflow-wrap:anywhere}.tpl h2{font-size:36px;line-height:1.4;margin:24px 0}.tpl p{font-size:28px;line-height:1.7;opacity:.72;margin:0;max-width:640px}.tpl-tag{font-size:23px;letter-spacing:3px;color:${theme.accent};display:inline-block}.tpl-cover{padding-top:100px;position:relative;height:650px}.tpl-cover h1{font-size:92px;max-width:970px;margin:38px 0;position:relative;z-index:1}.tpl-cover p{font-size:30px;position:relative;z-index:1}.tpl-cover-art{position:absolute;right:0;bottom:28px;width:290px;height:330px;display:flex;gap:22px;align-items:flex-end;transform:skewY(-12deg)}.tpl-cover-art i{display:block;flex:1;background:${theme.accent};height:45%;opacity:.25;border-radius:14px}.tpl-cover-art i:nth-child(2){height:70%;opacity:.55}.tpl-cover-art i:nth-child(3){height:100%;opacity:.9}.tpl-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;margin-top:100px}.tpl-cards article{border-top:3px solid ${theme.accent};padding-top:32px}.tpl-number{font-size:60px;color:${theme.accent};font-weight:300}.tpl-columns{display:grid;grid-template-columns:1.25fr 1fr;gap:65px;align-items:center;margin-top:80px}.tpl-columns>div{min-width:0}.tpl-columns svg{max-width:100%;height:auto}.tpl-panel{padding:44px;background:${id === "tech" ? "#1b2c45" : "#ffffffb3"};border-radius:24px;min-height:320px}.tpl h2.tpl-big{font-size:104px;margin:8px 0;color:${theme.accent}}.tpl-flow{display:flex;align-items:center;gap:25px;margin-top:180px}.tpl-flow>div{flex:1;padding:32px 28px;border:2px solid ${theme.accent};border-radius:20px}.tpl-flow span{font-size:22px;color:${theme.accent}}.tpl-flow h2{font-size:30px}.tpl-flow>b{font-size:40px;color:${theme.accent};font-weight:400}.tpl-bottom-note{margin-top:60px!important}.tpl-timeline{display:grid;grid-template-columns:repeat(3,1fr);gap:45px;padding-top:140px}.tpl-timeline article{position:relative;border-top:2px solid ${theme.accent};padding-top:40px}.tpl-step{position:absolute;top:-24px;left:0;background:${theme.accent};color:${id === "tech" ? "#101b30" : "#fff"};border-radius:50%;width:48px;height:48px;display:grid;place-items:center;font-size:20px}.tpl-table{border-collapse:collapse;width:100%;margin-top:95px;font-size:27px}.tpl-table th,.tpl-table td{text-align:left;padding:34px 22px;border-bottom:1px solid ${theme.accent}55}.tpl-table th{color:${theme.accent};font-size:22px}.tpl-footer{position:absolute;bottom:35px;left:100px;right:100px;display:flex;justify-content:space-between;font-size:18px;opacity:.48}.tpl-blank-title{margin-top:250px!important;text-align:center}`;
  return {
    width: 1600,
    height: 900,
    css,
    html: pages
      .map(
        (p, i) =>
          `<section class="slide tpl" data-slide-id="template-${id}-${i + 1}">${p.body}<footer class="tpl-footer"><span>${esc(title)}</span><span>${String(i + 1).padStart(2, "0")} / ${String(pages.length).padStart(2, "0")}</span></footer></section>`,
      )
      .join("\n"),
    notes: Object.fromEntries(
      pages.map((p, i) => [
        i + 1,
        { title: p.title || title, notes: p.note, refs: [] },
      ]),
    ),
  };
}
