// StudyTwin for teachers.
//
// Teacher keys live only in this browser (localStorage) and in the private
// teacher link (#code=…&key=…). The part after # is never sent to the server.

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "studytwin_teacher_classes";
const API_BASE = location.protocol === "file:" ? "http://localhost:3000" : "";

const state = { classes: [], current: null };

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
  for (const id of ["setupPanel", "createdPanel", "reportPanel"]) {
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
      <td>${s.stuckOn ? `<span class="mistake-tag">${escapeHtml(s.stuckOn.label)}</span>` : `<span class="muted">–</span>`}</td>
      <td>${s.cured.length ? s.cured.map((c) => escapeHtml(c.label)).join(", ") : `<span class="muted">–</span>`}</td>
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

  $("curesSummary").innerHTML = cures.total
    ? `<strong>Trap rounds:</strong> ${plural(cures.total, "mistake")} cured. ${cures.held} stayed away for ${cures.settledAfter}+ answers since, ${cures.cameBack} came back, ${cures.tooSoon} too recent to tell.`
    : "";
}

function renderReport(report) {
  $("className").textContent = report.class.name;
  document.title = `${report.class.name} · StudyTwin for teachers`;
  $("reportUpdated").textContent = `Updated ${new Date(report.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  $("classCode").textContent = report.class.code;
  $("joinLink").textContent = `${location.origin}/?class=${report.class.code}`;

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
    `<option value="__new">New or other class…</option>`
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
} else if (state.classes.length) {
  openClass(state.classes[0]);
} else {
  show("setupPanel");
}
