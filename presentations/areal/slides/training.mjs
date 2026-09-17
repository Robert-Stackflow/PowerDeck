export function addTrainingSlides({
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
}) {
  SRC.ppo = ["PPO · 2017", "https://arxiv.org/abs/1707.06347"];
  const refs = {
    ppo: asset("assets/reference-figures/ppo.png"),
    grpo: asset("assets/reference-figures/grpo.png"),
    compare: asset("assets/reference-figures/ppo-grpo.png"),
  };
  slides[6].figures = [{ src: refs.ppo, title: "PPO 训练流程（用户提供）" }];
  slides[6].notes +=
    " 下一页介绍 DPO：直接从偏好对优化策略，不需要单独训练奖励模型，也不需要在标准 DPO 的训练循环内做 Rollout。";
  slides[7].figures = [{ src: refs.grpo, title: "GRPO 训练流程（用户提供）" }];
  slides[7].notes =
    "本页采用 GRPO 作为 RLVR 的策略更新算法。对同一道题，用采样策略 πold 生成 G 条回答，验证器产生奖励，按组内均值与标准差构造优势。策略损失对每条回答的 token 取平均，KL 是对冻结参考策略的约束。πold 是采样策略，πref 是参考策略，两者角色不同。δ 用于数值稳定。GRPO 可接入验证器，也可接入奖励模型，RLVR 表示这里使用可验证奖励。";
  redraw(
    8,
    paradigm(
      trainingDiagram([
        ["s₀", "同一任务与环境", "重置工具与沙箱初始状态"],
        ["G", "组内轨迹采样", "生成 G 条多轮交互轨迹"],
        ["Rᵢ", "奖励与组内优势", "比较每条轨迹的任务回报"],
        ["GRPO", "策略更新", "只更新模型生成的 token"],
      ]),
      `<p class="paradigm-intro">以完整任务轨迹进行组内比较</p>${objective("GRPO 损失（生成 token 掩码）", String.raw`\begin{aligned}\mathcal L_{\mathrm{agent}}&=-\mathbb E\!\left[\frac1G\sum_{i=1}^{G}\frac{\sum_t m_{i,t}\ell_{i,t}}{\sum_t m_{i,t}}\right]+\beta\overline D_{\mathrm{KL}}\\\ell_{i,t}&=\min\!\left(\rho_{i,t}\hat A_i,\operatorname{clip}(\rho_{i,t},1-\epsilon,1+\epsilon)\hat A_i\right)\end{aligned}`)}<div class="short-defs">${math(String.raw`\hat A_i=\frac{R_i-\operatorname{mean}(R_{1:G})}{\operatorname{std}(R_{1:G})+\delta}`)}<p>ρᵢ,ₜ = πθ(aᵢ,ₜ | hᵢ,ₜ) / πold(aᵢ,ₜ | hᵢ,ₜ)</p></div><div class="concepts">${detail("采样单位", "同一任务的多条完整交互轨迹。")}${detail("训练掩码", "环境观测和工具返回参与上下文，不计入策略损失。")}</div>`,
    ),
    "paradigm-slide agent-v3 agent-grpo-v5",
    ["grpo", "ragen"],
    "本页展示 Agentic RL 使用 outcome-supervised GRPO 的一种具体实现。同一任务与可复现的初始环境下采样 G 条轨迹，回报 R_i 构造组内标准化优势，将该优势分配给对应轨迹中的模型生成 token。m_i,t 仅标记模型生成内容，包括工具调用参数；环境观测、工具返回不参与策略损失。h_i,t 包含完整交互历史。分母只统计生成 token，假设每条轨迹至少包含一个生成 token。图和公式没有把 Agentic RL 限定为只能使用 GRPO，其他策略更新方法与过程奖励也可以使用。",
  );
  redraw(
    9,
    paradigm(
      trainingDiagram([
        ["x", "提示与教师", "准备冻结的教师模型"],
        ["πθ", "学生 Rollout", "学生策略生成回答 y"],
        ["πT", "教师进行前向", "同一前缀下计算 token 概率"],
        ["KL", "更新学生", "缩小学生与教师的差异"],
      ]),
      `<p class="paradigm-intro">On-Policy Distillation：在学生采样的轨迹上蒸馏</p>${objective("Reverse KL 目标", String.raw`\begin{aligned}\mathcal L_{\mathrm{OPD}}&=\mathbb E_xD_{\mathrm{KL}}\!\left(\pi_\theta(\cdot\mid x)\Vert\pi_T(\cdot\mid x)\right)\\&=\mathbb E_{x,\,y\sim\pi_\theta}\!\left[\sum_t\log\frac{\pi_\theta(y_t\mid x,y_{<t})}{\pi_T(y_t\mid x,y_{<t})}\right]\end{aligned}`)}<p class="symbol-line">πθ：学生；πT：冻结教师。</p><div class="concepts">${detail("On-policy", "训练轨迹来自当前学生策略，随学生更新而刷新。")}${detail("Distillation", "教师在学生前缀上前向计算，以 token 概率指导学生。")}</div>`,
    ),
    "paradigm-slide opd-v3 opd-v5",
    ["gkd", "opd", "distill"],
    "On-policy 描述训练轨迹的来源：由正在训练的学生策略生成。Distillation 描述学习信号：冻结教师在同一学生前缀上前向计算概率，学生据此更新。教师无需自回归生成整条答案，也无需生成文字点评。图中 Reverse KL 是一个序列分布目标，右侧展开式利用自回归分解。实际系统可用采样 token 的 log-prob 差构造稠密奖励与策略梯度，也可在学生前缀上计算全词表蒸馏损失。On-policy 不限定 KL 的方向，GKD 讨论了多种散度。",
  );
  add(
    25,
    "1. 偏好优化 · DPO",
    paradigm(
      trainingDiagram(
        [
          ["D", "偏好数据", "提示 x、优选 y⁺、拒选 y⁻"],
          ["πθ", "策略与参考前向", "计算两种回答的 log-prob"],
          ["Δ", "偏好差值", "比较相对参考策略的增益"],
          ["∇θ", "更新策略", "提高优选回答的相对概率"],
        ],
        false,
      ),
      `<p class="paradigm-intro">直接从偏好对学习</p>${objective("DPO 损失", String.raw`\begin{aligned}\mathcal L_{\mathrm{DPO}}&=-\mathbb E_{(x,y^+,y^-)\sim\mathcal D}\log\sigma(\beta\Delta_\theta)\\\Delta_\theta&=\log\frac{\pi_\theta(y^+\mid x)}{\pi_{\mathrm{ref}}(y^+\mid x)}-\log\frac{\pi_\theta(y^-\mid x)}{\pi_{\mathrm{ref}}(y^-\mid x)}\end{aligned}`)}<p class="symbol-line">πref：冻结参考策略；β：控制偏离参考策略的程度。</p><div class="concepts">${detail("训练方式", "固定偏好对，直接反向传播更新策略。")}${detail("计算特点", "无需独立奖励模型、Value 模型或训练内 Rollout。")}</div>`,
    ),
    ["dpo"],
    "DPO 即 Direct Preference Optimization。标准 DPO 在固定偏好对上训练，将 KL 正则奖励最大化下的最优策略关系代入 Bradley–Terry 偏好模型，得到直接优化策略的分类损失。公式中的概率是完整回答的条件概率，在实现中累加回答 token 的 log-prob。β 控制与参考策略的偏离程度，不应简单理解为越大更新就越强。DPO 是偏好优化方法，不采用 PPO / GRPO 的在线策略梯度循环；在线 DPO 扩展可以在外层刷新偏好数据，本页比较的是标准离线 DPO。",
    "paradigm-slide dpo-v5",
  );
  const policyDiagram = (on) => {
    const id = on ? "policy-on" : "policy-off",
      color = on ? "#3e78b9" : "#9a7944";
    const nodes = on
      ? [
          [25, 25, "当前学生策略", "πθ"],
          [375, 25, "新轨迹", "y ∼ πθ"],
          [375, 215, "教师 / 奖励信号", "在这批轨迹上计算"],
          [25, 215, "策略更新", "更新后重新采样"],
        ]
      : [
          [25, 25, "其他 / 历史策略", "πb"],
          [375, 25, "已有轨迹", "y ∼ πb"],
          [375, 215, "教师 / 奖励信号", "在已有轨迹上计算"],
          [25, 215, "当前策略更新", "优化 πθ"],
        ];
    return `<svg class="policy-diagram" viewBox="0 0 670 340" role="img" aria-label="${on ? "On-policy：当前学生生成轨迹并持续刷新" : "Off-policy：使用其他或历史策略生成的数据"}"><defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 10 5 0 10" fill="${color}"/></marker></defs>${nodes.map(([x, y, t, s]) => `<rect x="${x}" y="${y}" width="270" height="94" rx="9" fill="#fffdfa" stroke="${color}" stroke-width="1.8"/><text x="${x + 135}" y="${y + 39}" text-anchor="middle" font-size="25" font-weight="600" fill="#294260">${t}</text><text x="${x + 135}" y="${y + 74}" text-anchor="middle" font-size="22" fill="#758399">${s}</text>`).join("")}${["M308 72 H362", "M510 130 V202", "M362 262 H308", ...(on ? ["M160 202 V132"] : [])].map((d) => `<path d="${d}" stroke="${color}" stroke-width="2.3" fill="none" marker-end="url(#${id})"/>`).join("")}</svg>`;
  };
  add(
    26,
    "1. 训练数据的来源 · On-policy 与 Off-policy",
    `<div class="policy-comparison"><article><h2>On-policy</h2><p class="policy-definition">当前策略采样，持续刷新训练轨迹</p>${policyDiagram(true)}<p class="policy-example"><b>OPD</b>　学生生成回答，教师在学生前缀上指导。</p></article><article><h2>Off-policy</h2><p class="policy-definition">数据来自其他策略或历史策略</p>${policyDiagram(false)}<p class="policy-example"><b>离线蒸馏</b>　教师预先生成答案，学生在已有数据上学习。</p></article></div><p class="policy-bottom">判别关键：<strong>谁生成训练轨迹，以及轨迹是否随当前策略刷新。</strong></p>`,
    ["gkd", "opd", "ppo", "offpolicy"],
    "On-policy / Off-policy 是相对于当前学习策略而言的数据分布关系。当前策略（或刚冻结的采样版本）产生新轨迹并频繁刷新，通常称为 on-policy 流程。其他策略或较旧历史策略产生的可复用轨迹具有 off-policy 性质。在 PPO / GRPO 中，πold 用于采样，πθ 在该批数据上更新，多轮更新后两者也会有一定差异，需限制更新幅度与样本滞后。异步 RL 的版本差同样引入 off-policy 程度。重要性采样等修正依赖支持集覆盖，无法任意消除过旧数据的问题。本页用 OPD 与离线教师蒸馏说明分布差异，不把所有离线监督训练称为传统 off-policy RL 算法。On-policy 不是“联网”或“实时服务”的同义词，也不决定使用正向还是反向 KL。",
    "policy-comparison-v5",
  );
  add(
    27,
    "1. 策略与偏好优化 · PPO / DPO / GRPO",
    `<div class="algorithm-comparison"><figure class="algorithm-paper"><img class="zoomable" src="${refs.compare}" alt="DeepSeekMath 图 4：PPO 与 GRPO 的训练流程对比" tabindex="0" role="button" aria-label="放大 PPO 与 GRPO 训练流程图"><figcaption>DeepSeekMath · Figure 4</figcaption></figure><div class="algorithm-methods"><section><h2>PPO</h2><p>策略采样，接收标量奖励。<br>Value 模型 + GAE 估计优势。<br>裁剪概率比，约束策略更新。</p></section><section><h2>DPO</h2><p>固定数据中的优选 / 拒选对。<br>直接优化偏好分类损失。<br>无需显式奖励模型或 Critic。</p></section><section><h2>GRPO</h2><p>同一任务，成组采样。<br>组内奖励构造相对优势。<br>省去独立 Value 模型。</p></section></div></div>`,
    ["ppo", "dpo", "grpo"],
    "左图是用户提供的 DeepSeekMath 论文 Figure 4。PPO 与 GRPO 都使用策略生成的数据，图中展示的是 LLM 后训练的经典配置，不是所有 PPO 任务都需要参考语言模型或学习型奖励模型。RLVR 可以用可验证奖励替代图中的 Reward Model。PPO 通常通过 Value 模型与 GAE 估计优势；GRPO 用同一任务下的一组结果计算基线，无需独立 Critic。标准 DPO 使用离线偏好数据，训练时无需显式奖励模型、Critic 或 Rollout，参考策略用来计算偏好损失中的概率比。PPO / GRPO 的 πold 是采样策略，而 πref 是 KL 参考策略。附图一和二也由用户提供，保留原始分辨率，可点击放大。",
    "algorithm-comparison-v5",
  );
  slides[27].figures = [
    { src: refs.ppo, title: "PPO 训练流程（用户提供）" },
    { src: refs.grpo, title: "GRPO 训练流程（用户提供）" },
  ];
  const order = [
    1,
    2,
    3,
    4,
    5,
    6,
    25,
    7,
    8,
    9,
    26,
    27,
    ...Array.from({ length: 15 }, (_, i) => i + 10),
  ];
  const ordered = {};
  order.forEach((old, i) => {
    const n = i + 1,
      s = slides[old];
    s.id =
      old <= 24
        ? "ref-" + old
        : { 25: "dpo", 26: "on-off-policy", 27: "algorithm-comparison" }[old];
    s.originalPage = old <= 24 ? old : null;
    s.html = s.html
      .replace(
        /data-page="\d+"/,
        `data-page="${n}" data-slide-id="${s.id}"${s.originalPage ? ` data-original-page="${s.originalPage}"` : ""}`,
      )
      .replace(/aria-label="第 \d+ 页：/, `aria-label="第 ${n} 页：`)
      .replace(
        /<span class="page">\d+ \/ 24<\/span>/,
        `<span class="page">${String(n).padStart(2, "0")} / ${order.length}</span>`,
      );
    ordered[n] = s;
  });
  return ordered;
}
