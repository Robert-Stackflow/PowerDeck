const root = document.querySelector("#audienceApp"),
  token = decodeURIComponent(
    location.pathname.split("/").filter(Boolean)[1] || "",
  ),
  visitorKey = "powerdeck-audience-visitor",
  visitor = localStorage.getItem(visitorKey) || crypto.randomUUID(),
  voteKey = `voted:${token}`,
  ratingKey = `rating:${token}`;
const roomName = localStorage.getItem("powerdeck-room-name") || "";
localStorage.setItem(visitorKey, visitor);

async function request(path = "", options = {}) {
  const response = await fetch(
    `/api/audience/${encodeURIComponent(token)}${path}`,
    {
      method: options.method || "GET",
      headers: {
        "X-PowerDeck-Device": visitor,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
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
  votedPoll = sessionStorage.getItem(voteKey),
  selectedPoll = "",
  selectedOption = null,
  rating = Number(sessionStorage.getItem(ratingKey)) || 0,
  message = "";

function render() {
  document.title = `${state.title} · 观众互动`;
  const poll = state.poll,
    total = poll?.votes || 0,
    showResults = poll && (poll.status !== "open" || votedPoll === poll.id);
  if (poll?.id !== selectedPoll) {
    selectedPoll = poll?.id || "";
    selectedOption = null;
  }
  root.innerHTML = `<header><span>PowerDeck 现场</span><h1>${escape(state.title)}</h1><p>评论、投票、评分</p></header><section id="audiencePoll" class="audience-card poll-card"><div class="section-heading"><span>实时投票</span>${poll ? `<small>${total} 人参与</small>` : ""}</div>${
    !poll
      ? '<p class="empty">等待演讲者发起投票</p>'
      : `<h2>${escape(poll.question)}</h2><div class="poll-options">${poll.options
          .map((option, index) => {
            const percent = total
              ? Math.round((option.count / total) * 100)
              : 0;
            return `<button type="button" data-vote="${index}" class="${selectedOption === index ? "selected" : ""}" ${poll.status !== "open" || votedPoll === poll.id ? "disabled" : ""}>${showResults ? `<i style="width:${percent}%"></i>` : ""}<span>${escape(option.label)}</span>${showResults ? `<b>${percent}%</b>` : '<em aria-hidden="true"></em>'}</button>`;
          })
          .join(
            "",
          )}</div>${poll.status === "open" && votedPoll !== poll.id ? `<button id="submitVote" type="button" ${selectedOption === null ? "disabled" : ""}>提交选择</button>` : ""}<p class="poll-status">${poll.status === "open" ? (votedPoll === poll.id ? "已提交，结果会实时更新" : "选择一个选项后提交") : "投票已结束"}</p>`
  }</section><section id="audienceComments" class="audience-card"><div class="section-heading"><span>现场评论</span></div><form id="questionForm"><label>称呼<input name="name" maxlength="40" value="${escape(roomName)}" ${roomName ? "readonly" : ""} placeholder="匿名观众"></label><label>评论内容<textarea name="body" maxlength="500" required placeholder="写下你的想法或问题…"></textarea></label><button type="submit">发布评论</button></form></section><section id="audienceRating" class="audience-card feedback-card"><div class="section-heading"><span>演示体验</span>${rating ? `<small>已评分 ${rating} 分</small>` : ""}</div><p>为本次演示打分</p><div class="rating">${[1, 2, 3, 4, 5].map((number) => `<button type="button" data-rating="${number}" class="${rating === number ? "selected" : ""}" aria-label="${number} 分" aria-pressed="${rating === number}">${number}</button>`).join("")}</div></section><output class="audience-message">${escape(message)}</output>`;
  const embed = new URLSearchParams(location.search).get("embed"),
    targets = {
      poll: "audiencePoll",
      comments: "audienceComments",
      rating: "audienceRating",
    };
  document.body.classList.toggle("audience-embed", !!targets[embed]);
  if (targets[embed]) {
    root.querySelector("header").hidden = true;
    for (const id of Object.values(targets))
      root.querySelector(`#${id}`).hidden = id !== targets[embed];
  }
  root.removeAttribute("aria-busy");
  root.querySelectorAll("[data-vote]").forEach(
    (button) =>
      (button.onclick = () => {
        selectedOption = Number(button.dataset.vote);
        render();
      }),
  );
  root
    .querySelector("#submitVote")
    ?.addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      try {
        state = await request("/vote", {
          method: "POST",
          body: { pollId: poll.id, option: selectedOption, visitor },
        });
        votedPoll = poll.id;
        sessionStorage.setItem(voteKey, poll.id);
        message = "投票已提交";
      } catch (error) {
        message = error.message;
      }
      render();
    });
  root.querySelector("#questionForm").onsubmit = async (event) => {
    event.preventDefault();
    const formElement = event.currentTarget,
      form = new FormData(formElement),
      button = event.submitter;
    button.disabled = true;
    try {
      await request("/questions", {
        method: "POST",
        body: { name: form.get("name"), body: form.get("body") },
      });
      formElement.reset();
      message = "评论已发布";
    } catch (error) {
      message = error.message;
    }
    render();
  };
  root.querySelectorAll("[data-rating]").forEach(
    (button) =>
      (button.onclick = async () => {
        try {
          rating = Number(button.dataset.rating);
          await request("/feedback", {
            method: "POST",
            body: { rating, visitor },
          });
          sessionStorage.setItem(ratingKey, String(rating));
          message = `已提交 ${rating} 分评价`;
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
        if (!document.activeElement?.closest("form")) render();
      }
    } catch {}
  }, 1800);
} catch (error) {
  root.innerHTML = `<div class="error"><h1>无法加入互动</h1><p>${escape(error.message)}</p></div>`;
}
