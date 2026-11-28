// StudyTwin for teachers.
//
// Teacher keys live only in this browser (localStorage) and in the private
// teacher link (#code=…&key=…). The part after # is never sent to the server.

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "studytwin_teacher_classes";
const API_BASE = location.protocol === "file:" ? "http://localhost:3000" : "";

const state = { classes: [], current: null, report: null };

function loadClasses() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((c) => c && c.code && c.key) : [];
  } catch {
    return [];
  }
}

function saveClasses() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.classes));
  } catch {
    // Private browsing: the teacher link still works.
  }
}

function rememberClass(entry) {
  state.classes = [entry, ...state.classes.filter((c) => c.code !== entry.code)];
  saveClasses();
}

function teacherLink(entry) {
  return `${location.origin}${location.pathname}#code=${entry.code}&key=${encodeURIComponent(entry.key)}`;
}

function parseTeacherLink(text) {
  const hash = String(text || "").split("#")[1] || "";
  const params = new URLSearchParams(hash);
  const code = (params.get("code") || "").toUpperCase();
  const key = params.get("key") || "";
  return code && key ? { code, key } : null;
}

async function api(path, { method = "GET", body, key } = {}) {
  const response = await fetch(API_BASE + path, {
    method,
    headers: { "Content-Type": "application/json", ...(key ? { "X-Teacher-Key": key } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `The server returned HTTP ${response.status}.`);
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

const percent = (rate) => (rate === null || rate === undefined ? "–" : `${Math.round(rate * 100)}%`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function timeAgo(iso) {
  if (!iso) return "Never";
  const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}

function showError(message) {
  $("teacherError").textContent = message;
  $("teacherError").classList.toggle("hidden", !message);
}

function show(panel) {
  for (const id of ["setupPanel", "createdPanel", "reportPanel", "classTwinPanel"]) {
    $(id).classList.toggle("hidden", id !== panel);
  }
}

// ------------------------------------------------------------
// Report
// ------------------------------------------------------------

function renderStuck(students) {
  const stuck = students.filter((s) => s.stuckOn);
  $("stuckCard").classList.toggle("hidden", stuck.length === 0);
  $("stuckList").innerHTML = stuck.map((s) => `
    <div class="teacher-row">
      <div>
        <strong>${escapeHtml(s.name)}</strong>
        <span class="teacher-row-detail">${escapeHtml(s.stuckOn.label)}: ${s.stuckOn.count} of the last ${s.stuckOn.outOf} answers</span>
      </div>
      <span class="teacher-row-side">Last active ${escapeHtml(timeAgo(s.lastActive).toLowerCase())}</span>
    </div>
  `).join("");
}

function renderMistakes(mistakes, studentCount) {
  $("mistakesCard").classList.toggle("hidden", mistakes.length === 0);
  $("mistakesList").innerHTML = mistakes.map((m) => {
    const share = studentCount ? m.students / studentCount : 0;
    return `
      <div class="mastery-row">
        <div class="mastery-head">
          <strong>${escapeHtml(m.label)}</strong>
          <span>${m.students} of ${plural(studentCount, "student")} · ${plural(m.occurrences, "time")}</span>
        </div>
        <div class="mastery-track"><div class="mastery-fill" style="width:${Math.round(share * 100)}%"></div></div>
        ${m.stuck.length ? `<p class="teacher-row-detail">Stuck: ${m.stuck.map(escapeHtml).join(", ")}</p>` : ""}
      </div>
    `;
  }).join("");
}

function renderStudents(students) {
  $("studentsCard").classList.toggle("hidden", students.length === 0);
  $("studentsTable").innerHTML = students.map((s) => `
    <tr>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td>${s.answers}</td>
      <td>${escapeHtml(timeAgo(s.lastActive))}</td>
      <td>${percent(s.recentAccuracy)}</td>
      <td>${s.hintsPerAnswer === null ? `<span class="muted">–</span>` : `${s.hintsPerAnswer} per answer`}</td>
      <td>${s.stuckOn ? `<span class="mistake-tag">${escapeHtml(s.stuckOn.label)}</span>` : `<span class="muted">–</span>`}</td>
      <td>${s.cured.length ? s.cured.map((c) => escapeHtml(c.label)).join(", ") : `<span class="muted">–</span>`}</td>
      <td><button class="text-button print-student" type="button" data-id="${escapeHtml(s.id)}">Print</button> <button class="text-button parent-link" type="button" data-id="${escapeHtml(s.id)}">Parent link</button> <button class="text-button student-remove" type="button" data-id="${escapeHtml(s.id)}" data-name="${escapeHtml(s.name)}">Remove</button></td>
    </tr>
  `).join("");
}

function renderEvidence(evidence) {
  const effects = evidence.twinEffect || [];
  const cures = evidence.cures || { total: 0 };
  $("evidenceCard").classList.toggle("hidden", effects.length === 0 && cures.total === 0);

  $("evidenceList").innerHTML = effects.map((e) => {
    if (!e.students) {
      return `
        <div class="evidence-row">
          <strong>${escapeHtml(e.label)}</strong>
          <p class="teacher-row-detail">${plural(e.collecting, "student")} taught their twin this; waiting for at least 5 more answers each before comparing.</p>
        </div>`;
    }
    const change = e.change === null ? null : Math.round(e.change * 100);
    const headline = change === null
      ? "Not enough earlier answers to compare"
      : change < 0
        ? `<span class="twin-effect-good">${Math.abs(change)}% less often</span> since teaching the twin`
        : change === 0 ? "No change yet" : `${change}% more often so far`;
    return `
      <div class="evidence-row">
        <div class="twin-effect-row-head">
          <strong>${escapeHtml(e.label)}</strong>
          <span class="teacher-row-side">${plural(e.students, "student")}${e.collecting ? ` · ${e.collecting} still collecting` : ""}</span>
        </div>
        <p class="twin-effect-headline">${headline}</p>
        <div class="twin-effect-rate"><span class="twin-effect-rate-label">Before</span><div class="twin-effect-track"><div class="twin-effect-fill" style="width:${Math.round((e.before.rate || 0) * 100)}%"></div></div><span class="twin-effect-rate-value">${percent(e.before.rate)} (${e.before.errors} of ${e.before.attempts})</span></div>
        <div class="twin-effect-rate"><span class="twin-effect-rate-label">Since</span><div class="twin-effect-track"><div class="twin-effect-fill" style="width:${Math.round((e.after.rate || 0) * 100)}%"></div></div><span class="twin-effect-rate-value">${percent(e.after.rate)} (${e.after.errors} of ${e.after.attempts})</span></div>
        <p class="teacher-row-detail">Fewer for ${e.outcomes.improved}, same for ${e.outcomes.unchanged}, more for ${e.outcomes.not_yet}.</p>
      </div>`;
  }).join("");

  const checkups = (cures.checkups || [])
    .filter((c) => c.answered)
    .map((c) => `after ${c.days} days, ${c.held} of ${c.answered} held`)
    .join("; ");
  $("curesSummary").innerHTML = cures.total
    ? `<strong>Trap rounds:</strong> ${plural(cures.total, "mistake")} cured. ${cures.held} stayed away for ${cures.settledAfter}+ answers since, ${cures.cameBack} came back, ${cures.tooSoon} too recent to tell.` +
      (checkups ? `<br><strong>Surprise check-ups:</strong> ${escapeHtml(checkups)}.` : "")
    : "";
}

function renderReport(report) {
  $("className").textContent = report.class.name;
  document.title = `${report.class.name} · StudyTwin for teachers`;
  $("reportUpdated").textContent = `Updated ${new Date(report.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  $("classCode").textContent = report.class.code;
  $("joinLink").textContent = `${location.origin}/?class=${report.class.code}`;
  const closed = Boolean(report.class.joinsClosed);
  $("joinStatus").textContent = closed
    ? "Closed to new students. Students already in the class carry on as normal."
    : "Open: anyone with the code can join.";
  $("joinToggle").textContent = closed ? "Open to new students" : "Close to new students";
  $("joinToggle").dataset.open = closed ? "true" : "false";

  $("metricStudents").textContent = report.totals.students;
  $("metricActive").textContent = `${report.totals.activeThisWeek} active this week`;
  $("metricAnswers").textContent = report.totals.answers;
  $("metricStuck").textContent = report.totals.stuck;
  $("stuckRule").textContent = `Stuck: ${report.rules.stuck}`;

  $("emptyState").classList.toggle("hidden", report.totals.students > 0);
  renderStuck(report.students);
  renderMistakes(report.mistakes, report.totals.students);
  renderStudents(report.students);
  renderEvidence(report.evidence);
  renderStudy(report.study);
  renderHomework(report.assignments || [], report.totals.students);
  renderQuestions(report.questions || []);
}

async function openClass(entry) {
  state.current = entry;
  showError("");
  show("reportPanel");
  renderSwitcher();
  $("refreshButton").disabled = true;
  try {
    const report = await api(`/api/classes/${encodeURIComponent(entry.code)}/report`, { key: entry.key });
    if (report.class.name !== entry.name) rememberClass({ ...entry, name: report.class.name });
    state.report = report;
    renderReport(report);
  } catch (error) {
    showError(error.message);
  } finally {
    $("refreshButton").disabled = false;
  }
}

function renderSwitcher() {
  const switcher = $("classSwitcher");
  switcher.classList.toggle("hidden", state.classes.length === 0);
  switcher.innerHTML = [
    ...state.classes.map((c) => `<option value="${escapeHtml(c.code)}" ${c.code === state.current?.code ? "selected" : ""}>${escapeHtml(c.name || c.code)}</option>`),
    `<option value="__new" ${state.current ? "" : "selected"}>New or other class…</option>`
  ].join("");
}

async function download(blind) {
  const entry = state.current;
  if (!entry) return;
  try {
    const response = await fetch(`${API_BASE}/api/classes/${encodeURIComponent(entry.code)}/export.csv${blind ? "?blind=1" : ""}`,
      { headers: { "X-Teacher-Key": entry.key } });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Download failed.");
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `studytwin-${entry.code}${blind ? "-to-label" : ""}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    showError(error.message);
  }
}

// ------------------------------------------------------------
// Setup
// ------------------------------------------------------------

$("createClassForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  try {
    const created = await api("/api/classes", { method: "POST", body: { name: $("classNameInput").value } });
    const entry = { code: created.code, key: created.teacherKey, name: created.name };
    rememberClass(entry);
    state.current = entry;
    $("createdTeacherLink").textContent = teacherLink(entry);
    show("createdPanel");
  } catch (error) {
    showError(error.message);
  }
});

$("createdDoneButton").addEventListener("click", () => openClass(state.current));

$("openClassForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const parsed = parseTeacherLink($("teacherLinkInput").value);
  if (!parsed) {
    showError("That doesn't look like a teacher link. It ends with #code=…&key=…");
    return;
  }
  rememberClass(parsed);
  openClass(parsed);
});

$("classSwitcher").addEventListener("change", (event) => {
  if (event.target.value === "__new") {
    state.current = null;
    show("setupPanel");
    return;
  }
  const entry = state.classes.find((c) => c.code === event.target.value);
  if (entry) openClass(entry);
});

$("refreshButton").addEventListener("click", () => state.current && openClass(state.current));
$("exportButton").addEventListener("click", () => download(false));
$("exportBlindButton").addEventListener("click", () => download(true));

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]");
  if (!button) return;
  try {
    await navigator.clipboard.writeText($(button.dataset.copy).textContent);
    button.textContent = "Copied";
    setTimeout(() => { button.textContent = "Copy"; }, 1500);
  } catch {
    showError("Couldn't copy. Select the text and copy it yourself.");
  }
});

// ------------------------------------------------------------
// Start
// ------------------------------------------------------------

state.classes = loadClasses();
const fromLink = parseTeacherLink(location.href);
if (fromLink) {
  rememberClass({ ...fromLink, name: state.classes.find((c) => c.code === fromLink.code)?.name });
  // Take the key out of the address bar so it isn't shown on a projector.
  history.replaceState(null, "", location.pathname);
  openClass(state.classes[0]);
} else if (new URLSearchParams(location.search).get("demo") === "1") {
  openDemoClass();
} else if (state.classes.length) {
  openClass(state.classes[0]);
} else {
  show("setupPanel");
}

// ------------------------------------------------------------
// Class twin: one twin for the whole class, on the projector
// ------------------------------------------------------------
//
// The twin makes the class's most common mistakes, one lesson at a time.
// The class votes on the wrong line, agrees the fix, then says why it was
// wrong. It uses the same lesson and checking endpoints as a student's twin.

const classTwin = { queue: [], turn: 0, lesson: null, foundIndex: null, fix: null, seen: [], pollId: null, pollTimer: null };

const TWIN_MISTAKES = ["failed_to_distribute", "sign_error", "wrong_inverse_op", "one_sided_op", "combining_unlike_terms", "arithmetic_slip"];
const VERDICT_TITLES = { right: "That's it.", partly: "Nearly.", not_yet: "Not quite." };

function openClassTwin() {
  const mistakes = (state.report?.mistakes || []).filter((m) => TWIN_MISTAKES.includes(m.type));
  classTwin.queue = mistakes.length ? mistakes : [{ type: "failed_to_distribute", label: "Failed to distribute", students: 0 }];
  classTwin.turn = 0;
  show("classTwinPanel");
  loadClassTwinLesson();
}

function setClassTwinResult(text, verdict = "") {
  $("classTwinResult").textContent = text;
  $("classTwinResult").dataset.verdict = verdict;
  $("classTwinResult").classList.toggle("hidden", !text);
}

async function loadClassTwinLesson() {
  const mistake = classTwin.queue[classTwin.turn % classTwin.queue.length];
  classTwin.lesson = null;
  classTwin.foundIndex = null;
  classTwin.fix = null;
  for (const id of ["classTwinFixForm", "classTwinExplainForm", "classTwinNext"]) $(id).classList.add("hidden");
  setClassTwinResult("");
  $("classTwinLines").innerHTML = "";
  $("classTwinMistake").textContent = mistake.students
    ? `Today's twin makes your class's mistake: ${mistake.label} (${mistake.students} of ${state.report.totals.students} students)`
    : `Today's twin makes a common mistake: ${mistake.label}`;

  try {
    const data = await api("/api/twin/lesson", {
      method: "POST",
      body: { misconceptionType: mistake.type, excludeQuestionIds: classTwin.seen }
    });
    classTwin.lesson = data.lesson;
    classTwin.seen.push(data.lesson.questionId);
    startVote(data.lesson);
    $("classTwinQuestion").textContent = data.lesson.question;
    $("classTwinSays").textContent = "Here's how I solved it. Which line did I get wrong? Vote!";
    $("classTwinLines").innerHTML = data.lesson.lines.map((line, index) => `
      <li><button class="class-twin-line" type="button" data-index="${index}" ${index === 0 ? "disabled" : ""}>
        <span class="class-twin-number">${index + 1}</span><code>${escapeHtml(line)}</code>
        <span class="class-twin-votes" aria-live="polite"></span>
      </button></li>
    `).join("");
  } catch (error) {
    $("classTwinSays").textContent = "";
    showError(error.message);
  }
}

async function checkClassTwin(body) {
  const lesson = classTwin.lesson;
  return api("/api/twin/check", {
    method: "POST",
    body: { questionId: lesson.questionId, misconceptionType: lesson.misconceptionType, variant: lesson.variant, ...body }
  });
}

$("classTwinLines").addEventListener("click", async (event) => {
  const button = event.target.closest(".class-twin-line");
  if (!button || button.disabled || classTwin.foundIndex !== null || !classTwin.lesson) return;
  const index = Number(button.dataset.index);
  try {
    const result = await checkClassTwin({ chosenIndex: index });
    $("classTwinSays").textContent = result.twinSays;
    if (!result.foundMistake) {
      button.classList.add("is-not-it");
      button.disabled = true;
      return;
    }
    classTwin.foundIndex = index;
    button.classList.add("is-found");
    stopVote();
    // Who got it right: the share of phones that voted for the real mistake.
    const votes = classTwin.lastVotes;
    if (votes?.voters) {
      const right = votes.counts[index] || 0;
      $("classTwinVoters").textContent = `${right} of ${votes.voters} spotted it (${Math.round((right / votes.voters) * 100)}%)`;
    }
    $("classTwinFixInput").value = "";
    $("classTwinFixForm").classList.remove("hidden");
    $("classTwinFixInput").focus();
  } catch (error) {
    showError(error.message);
  }
});

$("classTwinFixForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const correctedLine = $("classTwinFixInput").value.trim();
  if (!correctedLine) return;
  try {
    const result = await checkClassTwin({ chosenIndex: classTwin.foundIndex, correctedLine });
    $("classTwinSays").textContent = result.twinSays;
    if (!result.fixedIt) return;
    classTwin.fix = correctedLine;
    const line = $("classTwinLines").querySelector(`[data-index="${classTwin.foundIndex}"]`);
    line.insertAdjacentHTML("beforeend", `<span class="class-twin-fix">→ ${escapeHtml(correctedLine)}</span>`);
    $("classTwinFixForm").classList.add("hidden");
    $("classTwinExplainInput").value = "";
    $("classTwinExplainForm").classList.remove("hidden");
    $("classTwinNext").classList.remove("hidden");
  } catch (error) {
    showError(error.message);
  }
});

$("classTwinExplainForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const explanation = $("classTwinExplainInput").value.trim();
  if (!explanation) return;
  const lesson = classTwin.lesson;
  try {
    const result = await api("/api/twin/explain", {
      method: "POST",
      key: state.current.key,
      body: {
        classCode: state.current.code, questionId: lesson.questionId, misconceptionType: lesson.misconceptionType,
        variant: lesson.variant, correctedLine: classTwin.fix, explanation
      }
    });
    setClassTwinResult(`${VERDICT_TITLES[result.verdict]} ${result.feedback}`, result.verdict);
  } catch (error) {
    setClassTwinResult(error.message, "error");
  }
});

$("classTwinNext").addEventListener("click", () => {
  classTwin.turn += 1;
  loadClassTwinLesson();
});
$("classTwinButton").addEventListener("click", openClassTwin);
$("classTwinClose").addEventListener("click", () => {
  stopVote();
  if (document.fullscreenElement) document.exitFullscreen();
  show("reportPanel");
});
$("classTwinFullscreen").addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else $("classTwinPanel").requestFullscreen?.();
});

// ------------------------------------------------------------
// Phone voting for the class twin
// ------------------------------------------------------------
//
// Each lesson opens a vote. Students open /vote.html?class=CODE, tap the
// line they think is wrong, and the counts show live beside each line.
// The vote closes when the teacher clicks the line the class chose.

const VOTE_REFRESH_MS = 2000;

async function startVote(lesson) {
  stopVote();
  $("classTwinVoteLink").textContent = `${location.origin}/vote.html?class=${state.current.code}`;
  $("classTwinVoteCode").textContent = state.current.code;
  $("classTwinVoters").textContent = "0 votes";
  try {
    const data = await api(`/api/classes/${encodeURIComponent(state.current.code)}/poll`, {
      method: "POST",
      key: state.current.key,
      body: { questionId: lesson.questionId, misconceptionType: lesson.misconceptionType, variant: lesson.variant }
    });
    classTwin.pollId = data.pollId;
    classTwin.lastVotes = null;
    $("classTwinVote").classList.remove("hidden");
    refreshVotes();
  } catch (error) {
    // Voting is extra: the class can still vote by hands.
    $("classTwinVote").classList.add("hidden");
  }
}

async function refreshVotes() {
  if (!classTwin.pollId) return;
  try {
    const data = await api(`/api/classes/${encodeURIComponent(state.current.code)}/poll/results`, { key: state.current.key });
    if (data.pollId !== classTwin.pollId) return;
    showVoteCounts(data.counts, data.voters);
  } catch {
    // Try again on the next tick.
  }
  if (classTwin.pollId) classTwin.pollTimer = setTimeout(refreshVotes, VOTE_REFRESH_MS);
}

function showVoteCounts(counts, voters) {
  classTwin.lastVotes = { counts, voters };
  $("classTwinVoters").textContent = `${voters} vote${voters === 1 ? "" : "s"}`;
  const top = Math.max(0, ...counts);
  for (const button of $("classTwinLines").querySelectorAll(".class-twin-line")) {
    const count = counts[Number(button.dataset.index)] || 0;
    const badge = button.querySelector(".class-twin-votes");
    badge.textContent = count ? `${count} vote${count === 1 ? "" : "s"}` : "";
    badge.style.setProperty("--share", voters ? `${Math.round((count / voters) * 100)}%` : "0%");
    button.classList.toggle("is-top-voted", count > 0 && count === top);
  }
}

function stopVote() {
  clearTimeout(classTwin.pollTimer);
  classTwin.pollTimer = null;
  const pollId = classTwin.pollId;
  classTwin.pollId = null;
  if (pollId && state.current) {
    api(`/api/classes/${encodeURIComponent(state.current.code)}/poll/close`, {
      method: "POST", key: state.current.key, body: { pollId }
    }).catch(() => {});
  }
}

// ------------------------------------------------------------
// Homework
// ------------------------------------------------------------

const topicName = (value) => {
  if (value === "class_questions") return "Your own questions";
  const text = String(value || "").replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// "2026-11-28" -> "Fri 28 Nov", read as a calendar date (no time zone shift).
const dueLabel = (date) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const todayString = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

async function loadHomeworkTopics() {
  try {
    const data = await api("/api/questions/concepts");
    $("homeworkTopic").innerHTML = data.concepts
      .map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(topicName(c))}</option>`).join("");
  } catch {
    // The form still shows; the server checks the topic.
  }
  const nextWeek = new Date(Date.now() + 7 * 864e5 - new Date().getTimezoneOffset() * 60000);
  $("homeworkDue").value = nextWeek.toISOString().slice(0, 10);
  $("homeworkDue").min = todayString();
}

function renderHomework(assignments, studentCount) {
  const today = todayString();
  $("homeworkList").innerHTML = assignments.slice().reverse().map((a) => {
    const overdue = a.dueDate < today;
    const share = studentCount ? Math.round((a.finished / studentCount) * 100) : 0;
    const rows = a.students.map((s) => `
      <tr>
        <td>${escapeHtml(s.name)}</td>
        <td>${a.misconceptionType ? (s.finished ? "Cured ✓" : `${s.trapsAnswered || 0} traps answered`) : `${s.done} of ${a.count}${s.finished ? " ✓" : ""}`}</td>
        <td>${s.done ? `${s.correct} right` : `<span class="muted">–</span>`}</td>
      </tr>`).join("");
    return `
      <div class="homework-row">
        <div class="mastery-head">
          <strong>${a.misconceptionType ? `Cure: ${escapeHtml(topicName(a.misconceptionType))} · ${escapeHtml(topicName(a.concept))}` : `${a.count} questions · ${escapeHtml(topicName(a.concept))}`}</strong>
          <span class="${overdue ? "homework-overdue" : ""}">${overdue ? "Was due" : "Due"} ${escapeHtml(dueLabel(a.dueDate))}</span>
        </div>
        <div class="mastery-track"><div class="mastery-fill" style="width:${share}%"></div></div>
        <p class="teacher-row-detail">${a.finished} finished · ${a.started} started · ${a.notStarted} not started</p>
        ${a.students.length ? `
          <details class="homework-who">
            <summary>Who</summary>
            <table class="attempts-table"><thead><tr><th>Name</th><th>Done</th><th>Right</th></tr></thead><tbody>${rows}</tbody></table>
          </details>` : ""}
        <button class="text-button homework-remove" type="button" data-id="${escapeHtml(a.id)}">Remove</button>
      </div>`;
  }).join("");
}

$("homeworkForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  try {
    await api(`/api/classes/${encodeURIComponent(state.current.code)}/assignments`, {
      method: "POST",
      key: state.current.key,
      body: {
        concept: $("homeworkTopic").value, count: Number($("homeworkCount").value), dueDate: $("homeworkDue").value,
        ...($("homeworkMistake").value ? { misconceptionType: $("homeworkMistake").value } : {})
      }
    });
    openClass(state.current);
  } catch (error) {
    showError(error.message);
  }
});

$("homeworkList").addEventListener("click", async (event) => {
  const button = event.target.closest(".homework-remove");
  if (!button || !confirm("Remove this homework? Students won't see it any more.")) return;
  try {
    await api(`/api/classes/${encodeURIComponent(state.current.code)}/assignments/${encodeURIComponent(button.dataset.id)}`, {
      method: "DELETE",
      key: state.current.key
    });
    openClass(state.current);
  } catch (error) {
    showError(error.message);
  }
});

loadHomeworkTopics();

// ------------------------------------------------------------
// Printable progress reports
// ------------------------------------------------------------
//
// One page per student (and a class summary first when printing all),
// built from the report already on screen, then the browser's own print
// dialog, which can also save as PDF.

const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "–");

// The student page is shared with the parent link (js/report.js).
function printStudentPage(student, className) {
  return studentReportHtml(student, className);
}

function printClassPage(report) {
  return `
    <section class="print-page">
      <header class="print-head">
        <div><p class="print-kicker">StudyTwin class summary</p><h1>${escapeHtml(report.class.name)}</h1></div>
        <p>${escapeHtml(shortDate(report.generatedAt))}</p>
      </header>
      <div class="print-stats">
        <div><strong>${report.totals.students}</strong><span>${report.totals.students === 1 ? "student" : "students"}</span></div>
        <div><strong>${report.totals.answers}</strong><span>${report.totals.answers === 1 ? "answer" : "answers"} checked</span></div>
        <div><strong>${report.totals.stuck}</strong><span>stuck on a mistake</span></div>
      </div>
      <h2>Common mistakes</h2>
      ${report.mistakes.length ? `<table><thead><tr><th>Mistake</th><th>Students</th><th>Stuck</th></tr></thead><tbody>${report.mistakes.map((m) =>
        `<tr><td>${escapeHtml(m.label)}</td><td>${m.students} of ${report.totals.students}</td><td>${escapeHtml(m.stuck.join(", ") || "–")}</td></tr>`).join("")}</tbody></table>` : "<p>None yet.</p>"}
      <h2>Students</h2>
      <table><thead><tr><th>Name</th><th>Answers</th><th>Mastery</th><th>Stuck on</th></tr></thead><tbody>${report.students.map((s) =>
        `<tr><td>${escapeHtml(s.name)}</td><td>${s.answers}</td><td>${percent(s.recentAccuracy)}</td><td>${escapeHtml(s.stuckOn?.label || "–")}</td></tr>`).join("")}</tbody></table>
    </section>`;
}

function printReports(students, withClassPage) {
  const report = state.report;
  if (!report) return;
  $("printArea").innerHTML = (withClassPage ? printClassPage(report) : "") +
    students.map((s) => printStudentPage(s, report.class.name)).join("");
  window.print();
}

$("printAllButton").addEventListener("click", () => printReports(state.report?.students || [], true));
$("studentsTable").addEventListener("click", (event) => {
  const button = event.target.closest(".print-student");
  if (!button) return;
  printReports((state.report?.students || []).filter((s) => s.id === button.dataset.id), false);
});

// ------------------------------------------------------------
// Personalised practice sheets: one per student from their own mistakes,
// then an answer key. Each question's link opens it in StudyTwin, where
// the student can type or photograph their working to have it checked.
// ------------------------------------------------------------

const sheetAnswer = (answer) => (/^-?[\d./]+$/.test(answer) ? `x = ${answer}` : answer);

function practiceSheetsHtml(data) {
  const date = shortDate(data.date);
  const sheets = data.sheets.map((sheet) => `
    <section class="print-page practice-sheet">
      <header class="print-head">
        <div><p class="print-kicker">StudyTwin practice sheet</p><h1>${escapeHtml(sheet.name)}</h1></div>
        <p>${escapeHtml(data.className)}<br>${escapeHtml(date)}</p>
      </header>
      <p class="sheet-intro">These questions were picked for you. Show your working, one step per line. To have your working checked, open a question's link in StudyTwin and type it in or add a photo.</p>
      <ol class="sheet-questions">${sheet.questions.map((q) => `
        <li>
          <p class="sheet-question">${escapeHtml(q.question)}</p>
          <p class="sheet-link">Check it: ${escapeHtml(`${location.origin}/?q=${q.id}`)}</p>
          <div class="sheet-work"></div>
        </li>`).join("")}
      </ol>
    </section>`).join("");

  const key = `
    <section class="print-page">
      <header class="print-head">
        <div><p class="print-kicker">StudyTwin practice sheets</p><h1>Answer key</h1></div>
        <p>${escapeHtml(data.className)}<br>${escapeHtml(date)}</p>
      </header>
      ${data.sheets.map((sheet) => `
        <h2>${escapeHtml(sheet.name)}</h2>
        <table><thead><tr><th>#</th><th>Question</th><th>Answer</th><th>Aimed at</th></tr></thead><tbody>${sheet.questions.map((q, i) => `
          <tr><td>${i + 1}</td><td>${escapeHtml(q.question)}</td><td>${escapeHtml(sheetAnswer(q.answer))}</td><td>${escapeHtml(q.reason || "–")}</td></tr>`).join("")}
        </tbody></table>`).join("")}
    </section>`;
  return sheets + key;
}

$("printSheetsButton").addEventListener("click", async () => {
  if (!state.current) return;
  const button = $("printSheetsButton");
  button.disabled = true;
  button.textContent = "Making sheets…";
  try {
    const data = await api(`/api/classes/${encodeURIComponent(state.current.code)}/practice-sheets`, { key: state.current.key });
    if (!data.sheets.length) {
      showError("No students have joined yet, so there are no sheets to print.");
      return;
    }
    $("printArea").innerHTML = practiceSheetsHtml(data);
    window.print();
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Print practice sheets";
  }
});

// Installable app: works offline for pages; answers still need the network (see sw.js).
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// ------------------------------------------------------------
// The teacher's own questions
// ------------------------------------------------------------

const CLASS_QUESTIONS = "class_questions";

function renderQuestions(questions) {
  $("questionsList").innerHTML = questions.map((q) => `
    <li>
      <code>${escapeHtml(q.question.replace(/^(Solve|Simplify):\s*/, ""))}</code>
      <span class="questions-answer">${q.question.startsWith("Solve") ? "x = " : ""}${escapeHtml(q.answer)}</span>
      <button class="text-button question-remove" type="button" data-id="${escapeHtml(q.id)}" aria-label="Remove ${escapeHtml(q.question)}">Remove</button>
    </li>`).join("");
  $("questionsHomeworkButton").classList.toggle("hidden", questions.length === 0);
  $("questionsHomeworkButton").dataset.count = String(questions.length);

  // Homework can be set on them like any topic.
  const topic = [...$("homeworkTopic").options].find((option) => option.value === CLASS_QUESTIONS);
  if (questions.length && !topic) $("homeworkTopic").add(new Option("Your own questions", CLASS_QUESTIONS));
  if (!questions.length && topic) topic.remove();
}

$("questionsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  showError("");
  const text = $("questionsInput").value;
  if (!text.trim()) return;
  try {
    const result = await api(`/api/classes/${encodeURIComponent(state.current.code)}/questions`, {
      method: "POST", key: state.current.key, body: { text }
    });
    // Keep only the lines that couldn't be added, so they can be fixed.
    $("questionsInput").value = result.refused.map((r) => r.line).join("\n");
    $("questionsRefused").innerHTML = result.refused.length
      ? `<p>${result.refused.length === 1 ? "This line wasn't" : "These lines weren't"} added:</p><ul>${result.refused.map((r) =>
          `<li><code>${escapeHtml(r.line)}</code>: ${escapeHtml(r.error)}</li>`).join("")}</ul>`
      : "";
    $("questionsRefused").classList.toggle("hidden", !result.refused.length);
    if (result.full) showError("A class can have up to 50 questions. Remove some to add more.");
    openClass(state.current);
  } catch (error) {
    showError(error.message);
  }
});

$("questionsList").addEventListener("click", async (event) => {
  const button = event.target.closest(".question-remove");
  if (!button) return;
  try {
    await api(`/api/classes/${encodeURIComponent(state.current.code)}/questions/${encodeURIComponent(button.dataset.id)}`, {
      method: "DELETE", key: state.current.key
    });
    openClass(state.current);
  } catch (error) {
    showError(error.message);
  }
});

$("questionsHomeworkButton").addEventListener("click", async () => {
  try {
    const due = new Date(Date.now() + 7 * 864e5 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    await api(`/api/classes/${encodeURIComponent(state.current.code)}/assignments`, {
      method: "POST", key: state.current.key,
      body: { concept: CLASS_QUESTIONS, count: Math.min(50, Number($("questionsHomeworkButton").dataset.count)), dueDate: due }
    });
    openClass(state.current);
  } catch (error) {
    showError(error.message);
  }
});

// A "cure a mistake" goal is one trap round, so the question count doesn't apply.
$("homeworkMistake").addEventListener("change", () => { $("homeworkCount").disabled = Boolean($("homeworkMistake").value); });

// ------------------------------------------------------------
// Parent link: a private, read-only page with one student's report
// ------------------------------------------------------------

$("studentsTable").addEventListener("click", async (event) => {
  const button = event.target.closest(".parent-link");
  if (!button) return;
  try {
    const data = await api(`/api/classes/${encodeURIComponent(state.current.code)}/parent-link`, {
      method: "POST", key: state.current.key, body: { student: button.dataset.id }
    });
    const link = `${location.origin}/parent.html#k=${encodeURIComponent(data.token)}`;
    $("parentLinkBox").innerHTML = `
      <p>Parent link for <strong>${escapeHtml(data.name)}</strong>. Anyone with it can see this report, so send it only to the family. Making a new link switches this one off.</p>
      <div class="copy-row"><code id="parentLinkText">${escapeHtml(link)}</code><button class="ghost-button" type="button" data-copy="parentLinkText">Copy</button></div>`;
    $("parentLinkBox").classList.remove("hidden");
  } catch (error) {
    showError(error.message);
  }
});

// Delete the class: the teacher types its name to confirm. Afterwards it is
// forgotten in this browser too, and the page goes back to the start.
$("deleteClassButton").addEventListener("click", async () => {
  const entry = state.current;
  if (!entry) return;
  const name = state.report?.class?.name || entry.name || "";
  const typed = prompt(`This deletes "${name}" for good. Every student leaves the class and their parent links stop working; they keep their own practice.\n\nType the class name to confirm:`);
  if (typed === null) return;
  if (typed.trim().toLowerCase() !== name.trim().toLowerCase()) {
    showError("The name didn't match, so nothing was deleted.");
    return;
  }
  try {
    await api(`/api/classes/${encodeURIComponent(entry.code)}`, { method: "DELETE", key: entry.key, body: { name: typed } });
    state.classes = state.classes.filter((c) => c.code !== entry.code);
    saveClasses();
    state.current = null;
    state.report = null;
    renderSwitcher();
    show("setupPanel");
    showError(`"${name}" was deleted.`);
  } catch (error) {
    showError(error.message);
  }
});

// Joining: close the class once everyone is in, so a removed student or
// someone who was passed the code can't (re)join.
$("joinToggle").addEventListener("click", async () => {
  try {
    await api(`/api/classes/${encodeURIComponent(state.current.code)}/joining`, {
      method: "POST", key: state.current.key, body: { open: $("joinToggle").dataset.open === "true" }
    });
    openClass(state.current);
  } catch (error) {
    showError(error.message);
  }
});

// Remove a student: they leave the class (and their parent link stops
// working), but keep their own practice and can rejoin with the code.
$("studentsTable").addEventListener("click", async (event) => {
  const button = event.target.closest(".student-remove");
  if (!button) return;
  const name = button.dataset.name || "this student";
  if (!confirm(`Remove ${name} from the class? They'll drop out of your reports and their parent link will stop working. They keep their own practice and can rejoin with the class code.`)) return;
  try {
    await api(`/api/classes/${encodeURIComponent(state.current.code)}/students/${encodeURIComponent(button.dataset.id)}`, {
      method: "DELETE",
      key: state.current.key
    });
    openClass(state.current);
  } catch (error) {
    showError(error.message);
  }
});

// ------------------------------------------------------------
// Demo: a sample class to show StudyTwin without setting one up
// ------------------------------------------------------------

async function openDemoClass() {
  showError("");
  $("demoClassButton").disabled = true;
  $("demoClassButton").textContent = "Making the sample class…";
  try {
    const created = await api("/api/demo/class", { method: "POST" });
    const entry = { code: created.code, key: created.teacherKey, name: created.name };
    rememberClass(entry);
    history.replaceState(null, "", location.pathname);
    openClass(entry);
  } catch (error) {
    show("setupPanel");
    showError(error.message);
  } finally {
    $("demoClassButton").disabled = false;
    $("demoClassButton").textContent = "Try it with a sample class";
  }
}

$("demoClassButton").addEventListener("click", openDemoClass);

// ------------------------------------------------------------
// Study mode: a fair test of the twin
// ------------------------------------------------------------

function renderStudy(study) {
  if (!study) {
    $("studyBody").innerHTML = `
      <p class="muted">Does teaching the twin really help? Start a study and StudyTwin splits the class at random: half teach their twin, half practise without it. The comparison builds up here as they practise. Run it for at least two weeks.</p>
      <button class="ghost-button" type="button" data-study="on">Start a study</button>`;
    return;
  }
  const row = (label, g) => `<tr><td>${label}</td><td>${g.students.length}</td>
    <td>${percent(g.before.rate)} <span class="muted">(${g.before.errors} of ${g.before.attempts})</span></td>
    <td>${percent(g.after.rate)} <span class="muted">(${g.after.errors} of ${g.after.attempts})</span></td>
    <td>${g.change === null ? "–" : `${g.change < 0 ? "" : "+"}${Math.round(g.change * 100)}%`}</td></tr>`;
  const { twin, practice } = study.groups;
  $("studyBody").innerHTML = `
    <p class="muted">Running since ${escapeHtml(shortDate(study.startedAt))}. How often each group made a mistake, before the study and since.</p>
    <div class="table-scroll"><table class="attempts-table"><thead><tr><th>Group</th><th>Students</th><th>Before</th><th>Since</th><th>Change</th></tr></thead>
      <tbody>${row("Teach the twin", twin)}${row("Practice only", practice)}</tbody></table></div>
    <p class="teacher-row-detail">Teach the twin: ${escapeHtml(twin.students.join(", ") || "–")}<br>Practice only: ${escapeHtml(practice.students.join(", ") || "–")}</p>
    <p class="evidence-caveat">If the twin helps, the twin group's mistakes should fall more than the practice group's. With a small class, wait for a few hundred answers in each group before reading much into it.</p>
    <button class="ghost-button" type="button" data-study="off">End the study</button>`;
}

$("studyBody").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-study]");
  if (!button) return;
  if (button.dataset.study === "off" && !confirm("End the study? Everyone gets the twin again, and the comparison stops.")) return;
  try {
    await api(`/api/classes/${encodeURIComponent(state.current.code)}/study`, { method: "POST", key: state.current.key, body: { on: button.dataset.study === "on" } });
    openClass(state.current);
  } catch (error) {
    showError(error.message);
  }
});
