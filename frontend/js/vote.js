// Voting on the class twin from a phone. Anonymous: a random id kept in
// this browser stops one phone counting twice, and nothing else is sent.

const $ = (id) => document.getElementById(id);
const API_BASE = location.protocol === "file:" ? "http://localhost:3000" : "";
const POLL_MS = 3000;

function voterId() {
  try {
    let id = localStorage.getItem("studytwin_voter_id");
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "");
      localStorage.setItem("studytwin_voter_id", id);
    }
    return id;
  } catch {
    // Private browsing: one id for this page visit.
    return (window.studytwinVoter ||= crypto.randomUUID().replace(/-/g, ""));
  }
}

const state = { code: null, pollId: null, myLine: null, linesKey: "" };

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function setStatus(text) {
  $("voteStatus").textContent = text;
}

async function refresh() {
  try {
    const response = await fetch(`${API_BASE}/api/classes/${encodeURIComponent(state.code)}/poll`);
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Couldn't reach the class.");
      $("voteBallot").classList.add("hidden");
      if (response.status === 404) {
        state.code = null;
        $("voteCodeForm").classList.remove("hidden");
        return;
      }
    } else {
      $("voteClassName").textContent = `Class twin · ${data.className}`;
      render(data);
    }
  } catch {
    setStatus("Connection lost. Trying again…");
  }
  setTimeout(refresh, POLL_MS);
}

function render(data) {
  if (!data.open) {
    $("voteBallot").classList.add("hidden");
    setStatus(state.myLine !== null
      ? "Voting has closed. Look at the board to see what the class decided."
      : "Waiting for your teacher to start a vote…");
    return;
  }
  if (data.pollId !== state.pollId) {
    state.pollId = data.pollId;
    state.myLine = null;
  }
  // Only redraw when the lesson changes, so a tap isn't lost mid-refresh.
  const key = `${data.pollId}|${data.lines.join("|")}`;
  if (key !== state.linesKey) {
    state.linesKey = key;
    $("voteQuestion").textContent = data.question;
    $("voteLines").innerHTML = data.lines.map((line, index) => `
      <li><button class="vote-line" type="button" data-index="${index}" ${index === 0 ? "disabled" : ""}>
        <span class="class-twin-number">${index + 1}</span><code>${escapeHtml(line)}</code>
      </button></li>
    `).join("");
  }
  markMyVote();
  $("voteBallot").classList.remove("hidden");
  setStatus(state.myLine === null ? "" : `You voted for line ${state.myLine + 1}.`);
}

function markMyVote() {
  for (const button of $("voteLines").querySelectorAll(".vote-line")) {
    button.classList.toggle("is-mine", Number(button.dataset.index) === state.myLine);
  }
}

$("voteLines").addEventListener("click", async (event) => {
  const button = event.target.closest(".vote-line");
  if (!button || button.disabled) return;
  const line = Number(button.dataset.index);
  try {
    const response = await fetch(`${API_BASE}/api/classes/${encodeURIComponent(state.code)}/poll/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pollId: state.pollId, voterId: voterId(), line })
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || "Your vote didn't count. Try again.");
      return;
    }
    state.myLine = line;
    markMyVote();
    setStatus(`You voted for line ${line + 1}.`);
  } catch {
    setStatus("Your vote didn't send. Check your connection and tap again.");
  }
});

function start(code) {
  state.code = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  $("voteCodeForm").classList.add("hidden");
  setStatus("Joining…");
  refresh();
}

$("voteCodeForm").addEventListener("submit", (event) => {
  event.preventDefault();
  start($("voteCodeInput").value);
});

const fromLink = new URLSearchParams(location.search).get("class");
if (fromLink) start(fromLink);
else $("voteCodeForm").classList.remove("hidden");

// Installable app: works offline for pages; answers still need the network (see sw.js).
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
