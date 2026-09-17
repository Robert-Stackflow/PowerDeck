import catalog from "./slides/catalog.json" with { type: "json" };
import { addTrainingSlides } from "./slides/training.mjs";

// Numeric keys preserve reference-slide identity; training.mjs declares presentation order.
export function createDeck({
  logo,
  antWhite,
  antBlue,
  asset,
  math,
  enc,
  link,
}) {
  const SRC = {
    opsd: ["On-Policy Self-Distillation", "https://arxiv.org/abs/2607.05184"],
    mopd: ["MOPD · 2026", "https://arxiv.org/abs/2606.30406"],
    scaling: [
      "Scaling RL Compute · ICLR 2026",
      "https://proceedings.iclr.cc/paper_files/paper/2026/hash/75ea88aca02640cca54c1231db8cacdd-Abstract-Conference.html",
    ],
    offpolicy: [
      "Decoupled PPO 官方文档",
      "https://github.com/areal-project/AReaL/blob/e839b6f37a40d3a5da3de93bba1c3ec0252b416a/docs/en/best_practices/algo_perf.md",
    ],
    dtepaper: ["AReaL-DTE 论文", "https://arxiv.org/abs/2608.00455"],
    dterepo: [
      "AReaL-DTE 仓库",
      "https://github.com/areal-project/AReaL-DTE/blob/main/README.zh-CN.md",
    ],
    dteexample: [
      "AReaL DTE 示例",
      "https://github.com/areal-project/AReaL/blob/e839b6f37a40d3a5da3de93bba1c3ec0252b416a/examples/dte/README.md",
    ],
    instruct: ["InstructGPT · 2022", "https://arxiv.org/abs/2203.02155"],
    cot: ["CoT · 2022", "https://arxiv.org/abs/2201.11903"],
    chat: ["ChatGPT · 2022", "https://openai.com/index/chatgpt/"],
    dpo: ["DPO · 2023", "https://arxiv.org/abs/2305.18290"],
    grpo: ["DeepSeekMath · 2024", "https://arxiv.org/abs/2402.03300"],
    o1: [
      "OpenAI o1 · 2024",
      "https://openai.com/index/learning-to-reason-with-llms/",
    ],
    r1: ["DeepSeek-R1 · 2025", "https://arxiv.org/abs/2501.12948"],
    ragen: ["RAGEN · 2025", "https://arxiv.org/abs/2504.20073"],
    gkd: ["GKD · 2023/2024", "https://arxiv.org/abs/2306.13649"],
    opd: [
      "On-Policy Distillation · 2025",
      "https://thinkingmachines.ai/blog/on-policy-distillation/",
    ],
    areal: ["AReaL 论文 · v5", "https://arxiv.org/abs/2505.24298v5"],
    repo: ["AReaL 官方仓库", "https://github.com/areal-project/AReaL"],
    async: [
      "异步 RL 文档",
      "https://github.com/areal-project/AReaL/blob/e839b6f37a40d3a5da3de93bba1c3ec0252b416a/docs/en/algorithms/async.md",
    ],
    distill: [
      "AReaL OPD 文档",
      "https://github.com/areal-project/AReaL/blob/e839b6f37a40d3a5da3de93bba1c3ec0252b416a/docs/en/algorithms/distillation.md",
    ],
    v2: ["AReaL 2.0 技术报告", "https://arxiv.org/abs/2607.01120v2"],
    online: [
      "Online RL 文档",
      "https://github.com/areal-project/AReaL/blob/e839b6f37a40d3a5da3de93bba1c3ec0252b416a/docs/en/tutorial/online_proxy.md",
    ],
    hermes: [
      "Hermes 在线训练示例",
      "https://github.com/areal-project/AReaL/blob/e839b6f37a40d3a5da3de93bba1c3ec0252b416a/examples/hermes/README.md",
    ],
    claw: [
      "OpenClaw / ZeroClaw 示例",
      "https://github.com/areal-project/AReaL/blob/e839b6f37a40d3a5da3de93bba1c3ec0252b416a/examples/openclaw/README.md",
    ],
    roadmap: [
      "2026 H2 Roadmap",
      "https://github.com/areal-project/AReaL/issues/1381",
    ],
  };
  let slides = {};
  function add(n, title, body, refs = [], notes = "", cls = "") {
    slides[n] = {
      title,
      refs,
      notes,
      html: `<section class="slide custom ${cls}" data-page="${n}" aria-label="第 ${n} 页：${enc(title)}"><header><h1>${title}</h1><div class="rule"></div></header><main>${body}</main><footer><div class="sources"></div><span class="page">${String(n).padStart(2, "0")} / 24</span><div class="brand"><img src="${logo}" alt="">AReaL</div></footer></section>`,
    };
  }
  let diagramId = 0;
  const svgStart = (view = "0 0 1050 570") =>
    `<svg class="diagram" viewBox="${view}" xmlns="http://www.w3.org/2000/svg"><defs><marker id="arrow${++diagramId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#3467da"/></marker></defs>`;
  function svgNode(x, y, w, h, num, title, sub, color = "#3467da") {
    return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#fffdf9" stroke="${color}" stroke-width="2"/><circle cx="${x + 32}" cy="${y + 34}" r="19" fill="${color}"/><text x="${x + 32}" y="${y + 41}" text-anchor="middle" fill="white" font-size="23" font-weight="700">${num}</text><text x="${x + 65}" y="${y + 43}" font-size="25" font-weight="650" fill="#172640">${title}</text><text x="${x + 25}" y="${y + 85}" font-size="21" fill="#586578">${sub}</text></g>`;
  }
  const arrow = (d) =>
    `<path d="${d}" fill="none" stroke="#3467da" stroke-width="4" marker-end="url(#arrow${diagramId})"/>`;
  const coreCycle = `${svgStart()}
${svgNode(335, 12, 385, 110, 1, "Rollout · 生成", "用策略执行器产生回答或交互轨迹")}
${svgNode(690, 232, 335, 110, 2, "Reward · 评分", "计算奖励，形成优势估计", "#1b9a83")}
${svgNode(335, 447, 385, 110, 3, "Training · 训练", "前向、反向、优化器更新", "#e18b2a")}
${svgNode(15, 232, 335, 110, 4, "Weight Sync · 同步", "将新权重同步至推理侧", "#8658b5")}
${arrow("M720 68 C846 68 854 172 854 220")}${arrow("M858 352 C858 464 796 503 732 503")}${arrow("M322 502 C195 502 178 410 178 353")}${arrow("M178 220 C178 100 254 68 321 68")}
<text x="525" y="270" text-anchor="middle" fill="#2d5fc0" font-size="63" font-weight="750">RL</text><text x="525" y="312" text-anchor="middle" fill="#637085" font-size="22">持续迭代策略</text></svg>`;
  const antLogo = (white = false) =>
    `<svg class="ant-logo" viewBox="${white ? "1057" : "1062"} 762 1805 570" aria-label="蚂蚁集团 ANT GROUP" role="img"><image href="${white ? antWhite : antBlue}" x="0" y="0" width="${white ? 3863 : 3864}" height="2251"/></svg>`;
  const cornerBrand = (white = false) =>
    `<div class="corner-brand">${antLogo(white)}<img class="corner-cup" src="${logo}" alt="AReaL"></div>`;
  function special(n, title, body, cls, notes = "") {
    slides[n] = {
      title,
      refs: [],
      notes,
      html: `<section class="slide custom ${cls}" data-page="${n}" aria-label="第 ${n} 页：${enc(title)}">${body}</section>`,
    };
  }
  special(
    1,
    "2026 实习分享",
    `${cornerBrand(true)}<div class="cover-year">2026</div><h1 class="cover-title">实习分享</h1><p class="cover-subtitle">蚂蚁集团 – AReaL</p><div class="cover-author">徐瑞达　 华中科技大学</div><p class="cover-mentor">导师：莫益军</p>`,
    "cover",
    "实习分享，徐瑞达，华中科技大学；导师：莫益军。",
  );
  for (const [n, t] of [
    [2, "一、AReaL 是什么"],
    [17, "二、AReaL 在做什么"],
    [21, "三、经验与教训"],
  ]) {
    special(
      n,
      t,
      `${cornerBrand()}<h1 class="section-title">${t}</h1>`,
      "section-slide",
      t,
    );
  }

  add(
    22,
    "何去何从",
    `<div class="advice-stack"><div>我应该学习什么东西</div><div>我应该研究什么方向</div><div>我会不会找不到工作</div></div>`,
    [],
    "围绕学习、研究与职业选择的三个问题，分享实习经历中的思考。",
    "advice-slide",
  );
  add(
    23,
    "我的建议",
    `<div class="advice-stack"><div>实践是检验真理的唯一标准</div><div>永远保持对前沿科技的关注</div><div>培养你不可替代的竞争力<small>逻辑、思维、影响力</small></div></div>`,
    [],
    "实践是检验真理的唯一标准；永远保持对前沿科技的关注；培养不可替代的竞争力，尤其是逻辑、思维和影响力。",
    "advice-slide",
  );
  special(
    24,
    "欢迎批评指正",
    `${cornerBrand(true)}<h1 class="closing-title">欢迎批评指正</h1>`,
    "cover closing",
    "欢迎批评指正。",
  );

  const redraw = (
    n,
    body,
    cls = "",
    refs = catalog[n].refs,
    notes = catalog[n].notes,
  ) => add(n, catalog[n].title, body, refs, notes, cls);
  function trainingDiagram(steps, loop = true) {
    const id = "par-" + ++diagramId,
      gap = steps.length === 3 ? 185 : 145,
      start = steps.length === 3 ? 68 : 24;
    const colors = ["#778aa5", "#3d72c2", "#369783", "#c08c3e"];
    return `<svg class="training-diagram" viewBox="0 0 530 640" role="img" aria-label="训练过程"><defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 10 5 0 10" fill="#91a5bf"/></marker></defs>${steps
      .map((s, i) => {
        let y = start + gap * i,
          c = colors[i];
        return `<g><rect x="34" y="${y}" width="408" height="108" rx="9" fill="#fffdfa" stroke="${c}" stroke-width="2"/><path d="M119 ${y + 18}V${y + 89}" stroke="#dce1e7"/><text x="77" y="${y + 63}" fill="${c}" font-size="${s[0].length > 3 ? 20 : 29}" text-anchor="middle" font-family="Georgia,serif" font-weight="600">${s[0]}</text><text x="143" y="${y + 44}" font-size="26" font-weight="650" fill="#172640">${s[1]}</text><text x="143" y="${y + 80}" font-size="20" fill="#68778a">${s[2]}</text></g>${i < steps.length - 1 ? `<path d="M238 ${y + 112} V${y + gap - 7}" stroke="#91a5bf" stroke-width="2.5" marker-end="url(#${id})"/>` : ""}`;
      })
      .join(
        "",
      )}${loop ? `<path d="M444 ${start + gap * (steps.length - 1) + 54} H486 V${start + gap + 54} H449" stroke="#9aacbf" stroke-width="2" fill="none" marker-end="url(#${id})"/><text x="510" y="${start + gap + 120}" font-size="18" fill="#8796a9" transform="rotate(90 510 ${start + gap + 120})">更新策略</text>` : ""}</svg>`;
  }
  const detail = (t, b) => `<div class="concept"><b>${t}</b><p>${b}</p></div>`;
  const objective = (t, tex) =>
    `<div class="objective"><h3>${t}</h3>${math(tex)}</div>`;
  const paradigm = (diagram, body) =>
    `<div class="paradigm-layout"><div class="paradigm-visual">${diagram}</div><div class="paradigm-copy">${body}</div></div>`;

  redraw(
    5,
    paradigm(
      trainingDiagram([
        ["D", "高质量示范", "指令 x 与答案 y*"],
        ["πθ", "Teacher Forcing", "基于示范前缀预测 token"],
        ["y*", "交叉熵", "预测概率与目标 token 对齐"],
        ["∇θ", "梯度更新", "提高示范答案的概率"],
      ]),
      `<p class="paradigm-intro">用示范答案学习期望行为</p>${objective("损失函数", String.raw`\mathcal L_{\mathrm{SFT}}=-\mathbb E_{(x,y^*)\sim\mathcal D}\!\left[\sum_t m_t\log\pi_\theta(y_t^*\mid x,y_{<t}^*)\right]`)}<p class="symbol-line">mₜ：训练掩码，只对目标 token 计算损失。</p><div class="concepts">${detail("适用", "指令遵循、输出格式、工具调用冷启动。")}${detail("关键", "示范质量与覆盖面决定模型学到的行为。")}</div>`,
    ),
    "paradigm-slide sft-v3",
  );

  redraw(
    6,
    paradigm(
      trainingDiagram([
        ["x", "提示与人工偏好", "排序回答，训练奖励模型"],
        ["πθ", "策略采样", "生成候选回答"],
        ["rφ", "偏好奖励", "奖励模型打分"],
        ["PPO", "策略更新", "提高奖励，约束策略偏移"],
      ]),
      `<p class="paradigm-intro">把人类偏好转化为可优化的奖励</p>${objective("奖励模型", String.raw`\mathcal L_{\mathrm{RM}}=-\mathbb E\log\sigma\!\left(r_\phi(x,y^+)-r_\phi(x,y^-)\right)`)}${objective("策略目标", String.raw`\mathcal L_{\mathrm{RLHF}}=-\mathbb E_{y\sim\pi_\theta}[r_\phi(x,y)]+\beta D_{\mathrm{KL}}(\pi_\theta\Vert\pi_{\mathrm{ref}})`)}<p class="symbol-line">y⁺ / y⁻：偏好对；πref：参考策略。</p><div class="concepts">${detail("学习信号", "奖励模型近似人的偏好，常用于对话质量与风格对齐。")}${detail("实现", "经典路线用 PPO 优化上述目标。")}</div>`,
    ),
    "paradigm-slide rlhf-v3",
  );

  redraw(
    7,
    paradigm(
      trainingDiagram([
        ["x", "可验证任务", "题目、答案或单元测试"],
        ["G", "组内采样", "同一题生成多条解答"],
        ["✓", "验证与比较", "计算奖励和组内优势"],
        ["GRPO", "策略更新", "强化相对高分的回答"],
      ]),
      `<p class="paradigm-intro">用答案校验或测试结果提供奖励</p>${objective("GRPO 损失", String.raw`\begin{aligned}\mathcal L_{\mathrm{GRPO}}&=-\mathbb E\!\left[\frac1G\sum_{i=1}^{G}\frac1{T_i}\sum_t\ell_{i,t}\right]+\beta\overline D_{\mathrm{KL}}\\\ell_{i,t}&=\min\!\left(\rho_{i,t}\hat A_i,\operatorname{clip}(\rho_{i,t},1-\epsilon,1+\epsilon)\hat A_i\right)\end{aligned}`)}<div class="short-defs">${math(String.raw`\hat A_i=\frac{r_i-\operatorname{mean}(r_{1:G})}{\operatorname{std}(r_{1:G})+\delta},\qquad \rho_{i,t}=\frac{\pi_\theta(y_{i,t}\mid h_{i,t})}{\pi_{\mathrm{old}}(y_{i,t}\mid h_{i,t})}`)}</div><div class="concepts">${detail("组内比较", "用组内奖励构造优势，通常无需独立 Critic。")}${detail("适用", "数学、代码等结果可验证的任务。")}</div>`,
    ),
    "paradigm-slide rlvr-v3",
  );

  redraw(
    3,
    `<svg class="evolution-timeline" viewBox="0 0 1460 650" role="img" aria-label="后训练演进：历史事件、从 2025 年 6 月持续至今的 Agentic RL 与蒸馏路线、近期 Scaling RL，以及未来 Online Agentic RL">
<defs><marker id="future-tip" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 10 5 0 10" fill="#839ab5"/></marker></defs>
<path d="M24 57 H1400" stroke="#c7d1df" stroke-width="2"/>
${[
  [24, "2022.01–03", "CoT / InstructGPT", "推理步骤、SFT 与 RLHF"],
  [304, "2022.11", "ChatGPT", "对话 SFT 与人类偏好"],
  [584, "2023", "DPO / GKD", "偏好优化与学生轨迹蒸馏"],
  [864, "2024", "GRPO / o1", "组内优势与推理 RL"],
  [1144, "2025.01", "DeepSeek-R1", "可验证奖励与大规模 RL"],
]
  .map(
    ([x, d, t, s]) =>
      `<text x="${x}" y="26" font-size="23" font-weight="600" fill="#b4843d">${d}</text><circle cx="${x}" cy="57" r="6" fill="#b99157"/><text x="${x}" y="104" font-size="27" font-weight="650" fill="#243b5d">${t}</text><text x="${x}" y="146" font-size="21" fill="#6e7f96">${s}</text>`,
  )
  .join("")}
<text x="24" y="244" font-size="25" font-weight="600" fill="#627893">2025.06</text>
<text x="776" y="244" font-size="23" fill="#b18442">最近几个月</text>
<text x="1102" y="244" text-anchor="end" font-size="25" font-weight="600" fill="#627893">现在</text>
<text x="1310" y="244" text-anchor="middle" font-size="26" font-weight="600" fill="#7c91ad">未来</text>
<path d="M24 270 H1115" stroke="#c4cedb" stroke-width="2"/><path d="M1115 270 H1430" stroke="#a9b8ca" stroke-width="2" stroke-dasharray="8 8"/>
<path d="M24 263 V278 M1115 263 V616" stroke="#c4cedb" stroke-width="1.5"/><path d="M760 263 V616" stroke="#d1b78e" stroke-width="1.5" stroke-dasharray="5 8"/>
<path d="M24 314 H1085 L1115 348 L1085 382 H24 Z" fill="#e7eefb"/>
<path d="M24 314 H1085 L1115 348 L1085 382 H24" fill="none" stroke="#7095c9" stroke-width="1.6"/>
<text x="48" y="359" font-size="32" font-weight="650" fill="#3567a9">Agentic RL</text>
<path d="M24 419 H1085 L1115 453 L1085 487 H24 Z" fill="#e8f3ef"/>
<path d="M24 419 H1085 L1115 453 L1085 487 H24" fill="none" stroke="#6fa79a" stroke-width="1.6"/>
<text x="48" y="464" font-size="31" font-weight="650" fill="#397d70">OPD / OPSD / MOPD</text>
<path d="M760 531 H1085 L1115 565 L1085 599 H760 Z" fill="#fbefda" stroke="#caa163" stroke-width="1.6"/>
<text x="789" y="576" font-size="31" font-weight="650" fill="#ad7a2e">Scaling RL</text>
<rect x="1190" y="314" width="240" height="285" rx="12" fill="#ffffff50" stroke="#8da3bd" stroke-width="2" stroke-dasharray="9 8"/>
<text x="1310" y="435" text-anchor="middle" font-size="33" font-weight="600" fill="#607d9f">Online</text><text x="1310" y="479" text-anchor="middle" font-size="32" font-weight="600" fill="#607d9f">Agentic RL</text>
<path d="M1129 348 H1177 M1129 453 H1177 M1129 565 H1177" fill="none" stroke="#8da3bd" stroke-width="2" stroke-dasharray="6 5" marker-end="url(#future-tip)"/>
</svg>`,
    "timeline-v4",
    [
      "cot",
      "instruct",
      "chat",
      "dpo",
      "gkd",
      "grpo",
      "o1",
      "r1",
      "ragen",
      "opd",
      "opsd",
      "mopd",
      "scaling",
    ],
    `上方是代表性历史节点，下方是技术路线的持续演进，时间轴为示意，并非按年数等比例绘制。2025 年 6 月至今表示 Agentic RL 与 on-policy 蒸馏路线持续发展的讨论区间，不表示 OPD、OPSD、MOPD 都在 2025 年 6 月首发。OPSD 为 On-Policy Self-Distillation，MOPD 为 Multi-Teacher On-Policy Distillation，其论文发布于 2026 年 6 月。最近几个月重点展示 Scaling RL，即扩大强化学习训练的计算、数据与任务规模，并研究稳定性和效率。虚线 Online Agentic RL 表示持续在线学习与演化的未来方向，不否认当前已有原型和探索。GRPO 由 2024 年 DeepSeekMath 提出，CoT 最初是提示方法。`,
  );

  redraw(
    4,
    `<table class="clean-comparison"><thead><tr><th>范式</th><th>训练数据</th><th>学习信号</th><th>适用任务</th></tr></thead><tbody>${[
      ["SFT", "高质量示范", "目标 token", "指令、格式、工具调用"],
      [
        "RLHF",
        "偏好对 + 策略采样",
        "人类偏好训练的奖励模型",
        "对话质量、风格对齐",
      ],
      ["RLVR", "题目 + 策略采样", "答案校验、单元测试", "数学、编程"],
      [
        "Agentic RL",
        "多轮环境交互轨迹",
        "任务结果与过程反馈",
        "搜索、浏览器、代码 Agent",
      ],
      ["OPD", "学生 Rollout", "教师 token 概率", "能力迁移、推理蒸馏"],
    ]
      .map(
        (r) =>
          `<tr><th>${r[0]}</th>${r
            .slice(1)
            .map((c) => `<td>${c}</td>`)
            .join("")}</tr>`,
      )
      .join("")}</tbody></table>`,
    "comparison-v3",
  );

  redraw(
    10,
    `<div class="core-layout"><div class="core-cycle">${coreCycle}</div><div class="core-data"><h3>训练数据</h3>${detail("轨迹", "token、行动、环境观测")}${detail("学习信号", "reward、advantage、mask")}${detail("策略信息", "behavior log-prob、版本号")}</div></div>`,
    "core-v3",
  );

  redraw(
    11,
    `<div class="challenge-diagram">${svgStart("0 0 1460 515")}${[
      [20, 12, "Rollout", "长轨迹与工具时延", "KV Cache 与推理吞吐", "#3d72c2"],
      [
        820,
        12,
        "Reward",
        "外部测试与裁判开销",
        "稀疏奖励与信用分配",
        "#369783",
      ],
      [
        820,
        319,
        "Training",
        "精度与训推一致性",
        "异步样本的策略滞后",
        "#c08c3e",
      ],
      [
        20,
        319,
        "Weight Sync",
        "大模型权重搬运",
        "TP / PP / EP 重分片",
        "#9070b2",
      ],
    ]
      .map(
        ([x, y, t, a, b, c]) =>
          `<g><rect x="${x}" y="${y}" width="610" height="175" rx="12" fill="#fffdfa" stroke="${c}" stroke-width="2"/><text x="${x + 28}" y="${y + 49}" font-size="31" fill="${c}" font-weight="700">${t}</text><text x="${x + 28}" y="${y + 99}" font-size="26" fill="#4d617f">${a}</text><text x="${x + 28}" y="${y + 139}" font-size="26" fill="#4d617f">${b}</text></g>`,
      )
      .join(
        "",
      )}${arrow("M643 99 H804")}${arrow("M1125 200 V304")}${arrow("M807 406 H646")}${arrow("M325 305 V202")}<text x="730" y="273" text-anchor="middle" font-size="49" fill="#637fa8" font-weight="700">RL</text></svg></div><div class="challenge-summary"><p><b>Agent 环境</b>　沙箱隔离、工具容错与回滚</p><p><b>系统全局</b>　GPU 利用率、高可用与算法迭代</p></div>`,
    "challenges-v3",
  );

  redraw(
    12,
    `<div class="project-intro"><div class="project-logo"><img src="${logo}" alt="AReaL"><b>AReaL</b></div><div><h2>LLM 与 Agent 的<br>强化学习训练系统</h2><p>异步训练，在线交互，持续更新策略。</p><p class="project-methods">SFT　 PPO / GRPO　 Distillation</p></div></div><div class="project-links"><p>${link("https://github.com/areal-project/AReaL", "github.com/areal-project/AReaL")}</p><p>${link("https://areal-ai.io/", "areal-ai.io")}</p></div>`,
    "project-v3",
  );

  const paperFigure = (name, caption, url) =>
    `<figure class="paper-figure"><img class="zoomable" src="${asset("assets/papers/" + name + "_figure.svg", "image/svg+xml")}" alt="${enc(caption)}" tabindex="0" role="button" aria-label="放大查看：${enc(caption)}"><figcaption>${link(url, caption)}</figcaption></figure>`;
  redraw(
    13,
    `${paperFigure("async", "AReaL 论文，图 2", "https://arxiv.org/html/2505.24298v5#S4.F2")}<div class="figure-takeaways"><p><b>训推分离</b><br>独立资源池与并行配置</p><p><b>异步执行</b><br>生成、评分与训练重叠</p><p><b>控制滞后</b><br>限制采样与训练的版本差</p></div>`,
    "async-paper-v3",
  );

  redraw(
    14,
    paradigm(
      trainingDiagram(
        [
          ["πb", "Behavior policy", "实际生成轨迹的旧策略"],
          ["πp", "Proximal policy", "近期冻结的参照策略"],
          ["πθ", "Training policy", "当前接受梯度更新的策略"],
        ],
        false,
      ),
      `<p class="paradigm-intro">采样修正与 PPO 更新约束解耦</p>${objective("Decoupled PPO", String.raw`\begin{aligned}\mathcal L&=-\mathbb E_{\tau\sim\pi_b}\!\left[w_b\min\!\left(\rho\hat A,\bar\rho\hat A\right)\right]\\\bar\rho&=\operatorname{clip}(\rho,1-\epsilon,1+\epsilon)\end{aligned}`)}<div class="offpolicy-defs"><div>${math(String.raw`w_b=\frac{\pi_p}{\pi_b}`)}<p>修正采样分布差异</p></div><div>${math(String.raw`\rho=\frac{\pi_\theta}{\pi_p}`)}<p>约束当前策略的更新幅度</p></div></div><div class="concepts">${detail("稳定性", "保留 behavior log-prob，并继续限制策略版本差。")}</div>`,
    ),
    "paradigm-slide offpolicy-v3",
  );

  redraw(
    15,
    `<div class="paper-layout v2-layout">${paperFigure("v2", "AReaL 2.0 技术报告，图 1", "https://arxiv.org/html/2607.01120v2#S6.F1")}<div class="paper-notes">${detail("Agent 服务", "保留规划、工具与记忆。")}${detail("推理服务", "接收调用<br>记录交互轨迹。")}${detail("训练服务", "消费轨迹，优化模型。")}${detail("权重服务", "发布新策略版本。")}</div></div>`,
    "paper-v3",
  );

  redraw(
    16,
    `<div class="paper-layout dte-layout">${paperFigure("dte", "AReaL-DTE 论文，图 2", "https://arxiv.org/html/2608.00455v1#S4.F2")}<div class="paper-notes">${detail("重建旧权重", "AdamW 逆更新<br>避免保存完整历史快照。")}${detail("检测与重映射", "比较 BF16 变化<br>映射到接收端分片。")}${detail("传输与应用", "交换索引和新值<br>直接写入推理权重。")}</div></div>`,
    "paper-v3",
    catalog[16].refs,
    "图为 AReaL-DTE 论文图 2，同集群端到端流程，保留原图结构与标注。按顺时针讲解：AdamW 逆更新重建旧权重、BF16 变化检测、接收端索引重映射、两轮通信及直接应用。跨集群路径使用共享存储和版本提交。相邻版本 BF16 变化低于 2% 是论文所测工作负载中的观察。",
  );

  redraw(
    18,
    `<p class="direction-note">研究方向</p><div class="rsi-loop">${svgStart("0 0 1460 440")}${[
      [30, "Research Agent", "提出数据、算法或配置改动", "#3d72c2"],
      [405, "AReaL Training", "执行训练，记录实验结果", "#c08c3e"],
      [780, "Evaluation", "在固定测试集上评估", "#369783"],
      [1155, "Analysis Agent", "归纳收益与失败模式", "#9070b2"],
    ]
      .map(
        ([x, t, s, c], i) =>
          `<rect x="${x}" y="85" width="270" height="150" rx="10" fill="#fffdfa" stroke="${c}" stroke-width="2"/><text x="${x + 135}" y="145" text-anchor="middle" font-size="26" font-weight="650" fill="${c}">${t}</text><text x="${x + 135}" y="189" text-anchor="middle" font-size="19" fill="#69768a">${s}</text>${i < 3 ? arrow(`M${x + 282} 159 H${x + 360}`) : ""}`,
      )
      .join(
        "",
      )}${arrow("M1290 249 V332 H165 V249")}<text x="730" y="370" text-anchor="middle" font-size="22" fill="#677d9a">分析结果用于下一轮实验</text></svg></div><p class="rsi-point">在固定预算与独立评测下，验证每一轮改动是否带来可复现的提升。</p>`,
    "rsi-v3",
  );

  redraw(
    19,
    `<div class="online-visual">${svgStart("0 0 1460 550")}
<text x="26" y="79" font-size="26" fill="#536985" font-weight="650">在线交互</text>${[
      [235, "用户任务"],
      [575, "Agent / 工具"],
      [915, "用户反馈"],
    ]
      .map(
        ([x, t], i) =>
          `<rect x="${x}" y="28" width="260" height="96" rx="9" fill="#fffdfa" stroke="#729acb" stroke-width="2"/><text x="${x + 130}" y="87" text-anchor="middle" font-size="29" fill="#345782">${t}</text>${i < 2 ? arrow(`M${x + 270} 76 H${x + 325}`) : ""}`,
      )
      .join("")}
${arrow("M705 136 V215")}<rect x="375" y="230" width="660" height="106" rx="10" fill="#ecf3f4" stroke="#77a6aa" stroke-width="2"/><text x="705" y="273" text-anchor="middle" font-size="30" fill="#36747b" font-weight="650">Data Proxy</text><text x="705" y="311" text-anchor="middle" font-size="23" fill="#5c7b82">记录 token、log-prob、会话与奖励</text>
${arrow("M705 348 V413")}<rect x="435" y="430" width="540" height="92" rx="10" fill="#fff6e9" stroke="#c69d64" stroke-width="2"/><text x="705" y="487" text-anchor="middle" font-size="28" fill="#98703b">收集一个 batch，执行策略训练</text>
${arrow("M987 476 H1280 V177 H810 V136")}<text x="1330" y="300" text-anchor="middle" font-size="22" fill="#7e8da3" transform="rotate(90 1330 300)">新权重服务后续交互</text>
</svg></div><p class="quiet-note">已有 Hermes、OpenClaw / ZeroClaw 示例。Online API 目前标为实验性。</p>`,
    "online-v3",
  );

  redraw(
    20,
    `<div class="personal-v3-layout"><div class="personal-conversation"><div class="dialog user"><b>用户任务</b>“整理本周进展，按我习惯的结构。”</div><div class="dialog assistant"><b>Agent</b>读取信息并生成周报。</div><div class="dialog user"><b>用户纠正</b>“先写结论，风险单独列一段。”</div></div><div class="personal-learning">${trainingDiagram(
      [
        ["τ", "个人任务轨迹", "保留行为与上下文"],
        ["r", "反馈与奖励", "关联到具体任务"],
        ["πθ", "策略训练", "调整后续回答的行为"],
      ],
      false,
    )}</div></div><p class="quiet-note">示例说明个性化学习路径。长期收益仍需评估偏好漂移与通用能力保持。</p>`,
    "personal-v3",
  );

  slides = addTrainingSlides({
    slides,
    add,
    redraw,
    paradigm,
    trainingDiagram,
    objective,
    detail,
    math,
    asset,
    SRC,
    enc,
  });
  return { slides, SRC };
}
