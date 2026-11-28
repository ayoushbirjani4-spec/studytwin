// One student's progress report, shared by the teacher's printed reports
// and the parent link. Exposes window.studentReportHtml(student, className).
(() => {
  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const percent = (rate) => (rate === null || rate === undefined ? "–" : `${Math.round(rate * 100)}%`);
  const topicName = (value) => {
    if (value === "class_questions") return "Your teacher's questions";
    const text = String(value || "").replace(/_/g, " ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  };
  const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "–");

  window.studentReportHtml = (student, className) => {
    const topics = student.topics.length
      ? `<table><thead><tr><th>Topic</th><th>Answers</th><th>Mastery</th></tr></thead><tbody>${student.topics.map((t) =>
          `<tr><td>${escapeHtml(topicName(t.concept))}</td><td>${t.attempts}</td><td>${percent(t.mastery)}</td></tr>`).join("")}</tbody></table>`
      : "<p>No answers yet.</p>";

    const mistakes = Object.entries(student.recentMistakes || {});
    const twin = student.twinEffect.filter((e) => ["improved", "unchanged", "not_yet"].includes(e.status));
    const recent = student.recentWork.length
      ? `<table><thead><tr><th>Date</th><th>Topic</th><th>Result</th><th>Mistake</th></tr></thead><tbody>${student.recentWork.map((r) =>
          `<tr><td>${escapeHtml(shortDate(r.createdAt))}</td><td>${escapeHtml(topicName(r.concept))}</td><td>${r.correct ? "Correct" : "Not yet"}</td><td>${escapeHtml(r.mistake || "–")}</td></tr>`).join("")}</tbody></table>`
      : "<p>No answers yet.</p>";

    // Parent link only: the server sends these just for the parent's report.
    const tips = student.helpAtHome || [];
    const helpAtHome = tips.length
      ? `<h2>How to help at home</h2>${tips.map((tip) => `
          <div class="help-tip">
            <h3>${escapeHtml(tip.label)} <span class="muted">(${tip.count} of the last 20 answers)</span></h3>
            <p>${escapeHtml(tip.what)}</p>
            <p class="help-example"><span>Mistake:</span> <code>${escapeHtml(tip.wrong)}</code><br><span>Right:</span> <code>${escapeHtml(tip.right)}</code></p>
            <p><strong>What you can do:</strong> ${escapeHtml(tip.help)}</p>
            ${tip.tryThis ? `<details><summary>Try one together: ${escapeHtml(tip.tryThis.question)}</summary><p>Answer: <code>${escapeHtml(/^-?[\d./]+$/.test(tip.tryThis.answer) ? `x = ${tip.tryThis.answer}` : tip.tryThis.answer)}</code></p></details>` : ""}
          </div>`).join("")}`
      : "";

    return `
      <section class="print-page">
        <header class="print-head">
          <div><p class="print-kicker">StudyTwin progress report</p><h1>${escapeHtml(student.name)}</h1></div>
          <p>${escapeHtml(className)}<br>${escapeHtml(shortDate(new Date().toISOString()))}</p>
        </header>
        <div class="print-stats">
          <div><strong>${student.answers}</strong><span>${student.answers === 1 ? "answer" : "answers"} checked</span></div>
          <div><strong>${percent(student.recentAccuracy)}</strong><span>mastery, last 20 answers</span></div>
          <div><strong>${student.hintsPerAnswer ?? "–"}</strong><span>hints per answer</span></div>
          <div><strong>${escapeHtml(shortDate(student.lastActive))}</strong><span>last practised</span></div>
        </div>
        ${helpAtHome}
        <h2>Topics</h2>${topics}
        <h2>Mistakes</h2>
        <p>${student.stuckOn ? `Working on: <strong>${escapeHtml(student.stuckOn.label)}</strong> (${student.stuckOn.count} of the last ${student.stuckOn.outOf} answers).` : "Not stuck on any one mistake right now."}</p>
        ${mistakes.length ? `<p>In the last 20 answers: ${mistakes.map(([type, n]) => `${escapeHtml(topicName(type))} ×${n}`).join(", ")}.</p>` : ""}
        ${student.cured.length ? `<p>Cured in a trap round: ${student.cured.map((c) => `${escapeHtml(c.label)}${c.status === "held" ? " (held at both check-ups)" : c.status === "slipped" ? " (came back since)" : ""}`).join(", ")}.</p>` : ""}
        ${twin.length ? `<h2>Teaching the twin</h2><ul>${twin.map((e) =>
          `<li>${escapeHtml(e.label)}: in ${percent(e.before.rate)} of answers before (${e.before.errors} of ${e.before.attempts}), ${percent(e.after.rate)} since (${e.after.errors} of ${e.after.attempts}).</li>`).join("")}</ul>` : ""}
        <h2>Recent work</h2>${recent}
        <p class="print-foot">Mastery counts answers where both the working and the final answer were right.</p>
      </section>`;
  };
})();
