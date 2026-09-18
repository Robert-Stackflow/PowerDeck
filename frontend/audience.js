const root = document.querySelector("#audienceApp"),
  token = decodeURIComponent(
    location.pathname.split("/").filter(Boolean)[1] || "",
  ),
  visitorKey = "powerdeck-audience-visitor",
  visitor = localStorage.getItem(visitorKey) || crypto.randomUUID(),
  ratingKey = `rating:${token}`,
  roomName = localStorage.getItem("powerdeck-room-name") || "";
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
      .replaceAll('"', "&quot;"),
  voteKey = (pollId) => `voted:${token}:${pollId}`;

let state,
  selectedOptions = {},
  rating = Number(sessionStorage.getItem(ratingKey)) || 0,
  message = "";

function pollMarkup(poll) {
  const total = poll.votes || 0,
    voted = sessionStorage.getItem(voteKey(poll.id)) === "1",
    showResults = poll.status !== "open" || voted,
    selected = selectedOptions[poll.id] ?? null;
  return `<article class="audience-card poll-card" data-poll-card="${poll.id}"><div class="section-heading"><span>${poll.status === "open" ? "进行中的投票" : "历史投票"}</span><small>${total} 人参与</small></div><h2>${escape(poll.question)}</h2><div class="poll-options">${poll.options
    .map((option, index) => {
      const percent = total ? Math.round((option.count / total) * 100) : 0;
      return `<button type="button" data-vote-poll="${poll.id}" data-vote="${index}" class="${selected === index ? "selected" : ""}" ${showResults ? "disabled" : ""}>${showResults ? `<i style="width:${percent}%"></i>` : ""}<span>${escape(option.label)}</span>${showResults ? `<b>${percent}%</b>` : '<em aria-hidden="true"></em>'}</button>`;
    })
    .join(
      "",
    )}</div>${poll.status === "open" && !voted ? `<button type="button" data-submit-poll="${poll.id}" ${selected === null ? "disabled" : ""}>提交选择</button>` : ""}<p class="poll-status">${voted ? "已提交，结果会实时更新" : poll.status === "closed" ? "投票已结束" : "选择一个选项后提交"}</p></article>`;
}

function render() {
  document.title = `${state.title} · 观众互动`;
  const polls = state.polls || (state.poll ? [state.poll] : []);
  root.innerHTML = `<header><span>PowerDeck 现场</span><h1>${escape(state.title)}</h1><p>评论、投票、评分</p></header><section id="audiencePoll" class="audience-poll-history">${polls.length ? polls.map(pollMarkup).join("") : '<div class="audience-card"><p class="empty">等待演讲者发起投票</p></div>'}</section><section id="audienceComments" class="audience-card"><div class="section-heading"><span>现场评论</span></div><form id="questionForm"><label>称呼<input name="name" maxlength="40" value="${escape(roomName)}" ${roomName ? "readonly" : ""} placeholder="匿名观众"></label><label>评论内容<textarea name="body" maxlength="500" required placeholder="写下你的想法或问题…"></textarea></label><button type="submit">发布评论</button></form></section><section id="audienceRating" class="audience-card feedback-card"><div class="section-heading"><span>演示体验</span>${rating ? `<small>已评分 ${rating} 分</small>` : ""}</div><p>为本次演示打分</p><div class="rating">${[1, 2, 3, 4, 5].map((number) => `<button type="button" data-rating="${number}" class="${rating === number ? "selected" : ""}" aria-label="${number} 分" aria-pressed="${rating === number}">${number}</button>`).join("")}</div></section><output class="audience-message">${escape(message)}</output>`;
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
  root.querySelectorAll("[data-vote-poll]").forEach((button) => {
    button.onclick = () => {
      selectedOptions[button.dataset.votePoll] = Number(button.dataset.vote);
      render();
    };
  });
  root.querySelectorAll("[data-submit-poll]").forEach((button) => {
    button.onclick = async () => {
      const pollId = button.dataset.submitPoll;
      button.disabled = true;
      try {
        state = await request("/vote", {
          method: "POST",
          body: {
            pollId,
            option: selectedOptions[pollId],
            visitor,
            name: roomName || "匿名观众",
          },
        });
        sessionStorage.setItem(voteKey(pollId), "1");
        message = "投票已提交";
      } catch (error) {
        message = error.message;
      }
      render();
    };
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
      formElement.elements.body.value = "";
      message = "评论已发布";
    } catch (error) {
      message = error.message;
    }
    render();
  };
  root.querySelectorAll("[data-rating]").forEach((button) => {
    button.onclick = async () => {
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
    };
  });
}

try {
  state = await request();
  render();
  setInterval(async () => {
    try {
      const next = await request();
      if (JSON.stringify(next.polls) !== JSON.stringify(state.polls)) {
        state = next;
        if (!document.activeElement?.closest("form")) render();
      }
    } catch {}
  }, 1800);
} catch (error) {
  root.innerHTML = `<div class="error"><h1>无法加入互动</h1><p>${escape(error.message)}</p></div>`;
}
