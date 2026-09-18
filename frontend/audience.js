const root = document.querySelector("#audienceApp"),
  token = decodeURIComponent(
    location.pathname.split("/").filter(Boolean)[1] || "",
  ),
  visitorKey = "powerdeck-audience-visitor",
  visitor = localStorage.getItem(visitorKey) || crypto.randomUUID();
localStorage.setItem(visitorKey, visitor);

async function request(path = "", options = {}) {
  const response = await fetch(
    `/api/audience/${encodeURIComponent(token)}${path}`,
    {
      method: options.method || "GET",
      headers: options.body ? { "Content-Type": "application/json" } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
  );
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "请求失败");
  return result;
}
const escape = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

let state,
  votedPoll = sessionStorage.getItem(`voted:${token}`),
  message = "";
function render() {
  document.title = `${state.title} · 观众互动`;
  const poll = state.poll,
    total = poll?.votes || 0;
  root.innerHTML = `<header><span>PowerDeck 现场</span><h1>${escape(state.title)}</h1><p>匿名提问、参与投票，并为本次演示评分。</p></header><section class="audience-card poll-card"><div class="section-heading"><span>实时投票</span>${poll ? `<small>${total} 人参与</small>` : ""}</div>${
    !poll
      ? '<p class="empty">演讲者还没有发起投票</p>'
      : `<h2>${escape(poll.question)}</h2><div class="poll-options">${poll.options
          .map((option, index) => {
            const percent = total
              ? Math.round((option.count / total) * 100)
              : 0;
            return `<button type="button" data-vote="${index}" ${poll.status !== "open" || votedPoll === poll.id ? "disabled" : ""}><i style="width:${percent}%"></i><span>${escape(option.label)}</span><b>${percent}%</b></button>`;
          })
          .join(
            "",
          )}</div><p class="poll-status">${poll.status === "open" ? (votedPoll === poll.id ? "已提交，结果会实时更新" : "请选择一个选项") : "投票已结束"}</p>`
  }</section><section class="audience-card"><div class="section-heading"><span>向演讲者提问</span></div><form id="questionForm"><label>称呼（可选）<input name="name" maxlength="40" placeholder="匿名观众"></label><label>你的问题<textarea name="body" maxlength="500" required placeholder="输入想提问的内容…"></textarea></label><button type="submit">提交问题</button></form></section><section class="audience-card feedback-card"><div class="section-heading"><span>演示体验</span></div><p>为本次演示打分</p><div class="rating">${[1, 2, 3, 4, 5].map((number) => `<button type="button" data-rating="${number}" aria-label="${number} 分">${number}</button>`).join("")}</div></section><output class="audience-message">${escape(message)}</output>`;
  root.removeAttribute("aria-busy");
  root.querySelectorAll("[data-vote]").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          state = await request("/vote", {
            method: "POST",
            body: {
              pollId: poll.id,
              option: Number(button.dataset.vote),
              visitor,
            },
          });
          votedPoll = poll.id;
          sessionStorage.setItem(`voted:${token}`, poll.id);
          message = "投票已提交";
          render();
        } catch (error) {
          message = error.message;
          render();
        }
      }),
  );
  root.querySelector("#questionForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      button = event.submitter;
    button.disabled = true;
    try {
      await request("/questions", {
        method: "POST",
        body: { name: form.get("name"), body: form.get("body") },
      });
      event.currentTarget.reset();
      message = "问题已发送给演讲者";
    } catch (error) {
      message = error.message;
    }
    render();
  };
  root.querySelectorAll("[data-rating]").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          await request("/feedback", {
            method: "POST",
            body: { rating: Number(button.dataset.rating), visitor },
          });
          message = `已提交 ${button.dataset.rating} 分评价`;
        } catch (error) {
          message = error.message;
        }
        render();
      }),
  );
}

try {
  state = await request();
  render();
  setInterval(async () => {
    try {
      const next = await request();
      if (JSON.stringify(next.poll) !== JSON.stringify(state.poll)) {
        state = next;
        render();
      }
    } catch {}
  }, 1800);
} catch (error) {
  root.innerHTML = `<div class="error"><h1>无法加入互动</h1><p>${escape(error.message)}</p></div>`;
}
