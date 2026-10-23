const API_BASE =
  window.STUDYTWIN_API_BASE ||
  (["localhost", "127.0.0.1"].includes(window.location.hostname)
    ? `${window.location.protocol}//${window.location.hostname}:3000`
    : "");
function ensureStudentIdentity() {
  let studentId = localStorage.getItem("studytwin_student_id");
  let studentToken = localStorage.getItem("studytwin_student_token");

  if (!studentId) {
    studentId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? `st_${crypto.randomUUID()}`
        : `st_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("studytwin_student_id", studentId);
  }

  if (!studentToken) {
    studentToken =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
    localStorage.setItem("studytwin_student_token", studentToken);
  }

  return { studentId, studentToken };
}

const identity = ensureStudentIdentity();

const state = {
  studentId: identity.studentId,
  studentToken: identity.studentToken,
  concept: "distributive_property",
  difficulty: 1,
  question: null,
  questionNumber: 0,
  answered: false,
  stats: {
    attempts: 0,
    correct: 0,
    accuracy: 0
  }
};

const $ = (id) => document.getElementById(id);

const difficultyName = (value) =>
  ({
    1: "Easy",
    2: "Medium",
    3: "Hard"
  })[Number(value)] || "Easy";

const conceptName = (value) =>
  String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

function showError(message) {
  const error = $("globalError");

  if (!error) return;

  error.textContent = message;
  error.classList.remove("hidden");
}

function hideError() {
  const error = $("globalError");

  if (!error) return;

  error.classList.add("hidden");
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Student-Token": state.studentToken,
      ...(options.headers || {})
    }
  });

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(`API returned HTTP ${response.status}`);
  }

  if (!response.ok || data.success === false) {
    throw new Error(
      data.error || `API returned HTTP ${response.status}`
    );
  }

  return data;
}

function updateSidebar() {
  $("studentIdLabel").textContent = "You";

  $("questionCount").textContent = state.stats.attempts;

  $("correctCount").textContent = state.stats.correct;

  $("accuracyValue").textContent =
    `${Math.round((state.stats.accuracy || 0) * 100)}%`;

  $("conceptLabel").textContent = conceptName(state.concept);

  $("levelLabel").textContent = difficultyName(state.difficulty);
}

function renderQuestion(question) {
  if (!question) {
    showError("No next question was returned by the server.");
    return;
  }

  state.question = question;
  state.difficulty = Number(question.difficulty) || 1;
  state.answered = false;

  $("questionNumber").textContent = state.questionNumber;

  $("difficultyBadge").textContent =
    difficultyName(question.difficulty);

  $("questionConcept").textContent =
    conceptName(question.concept);

  

  $("questionText").textContent =
    question.question || "Question unavailable.";

  $("answerInput").value = "";
  $("workInput").value = "";

  $("answerInput").disabled = false;
  $("workInput").disabled = false;

  $("submitButton").disabled = false;
  $("submitButton").innerHTML = "Check Answer <span>→</span>";

  $("submitStatus").textContent = "";

  $("feedbackPanel").classList.add("hidden");

  const progress =
    Math.min(100, ((state.questionNumber - 1) % 5 + 1) * 20);

  $("progressBar").style.width = `${progress}%`;

  $("progressText").textContent =
    `Question ${((state.questionNumber - 1) % 5) + 1} of 5`;

  updateSidebar();
  hideError();

  $("answerInput").focus();
}

async function loadConcepts() {
  try {
    const data = await api("/api/questions/concepts");

    const concepts = Array.isArray(data)
      ? data
      : data.concepts || [];

    if (concepts.length) {
      $("conceptSelect").innerHTML = concepts
        .map(
          (concept) =>
            `<option value="${escapeHtml(concept)}">
              ${escapeHtml(conceptName(concept))}
            </option>`
        )
        .join("");
    }
  } catch {
    // Keep the default concept if the API is unavailable.
  }
}

async function startSession() {
  const concept = $("conceptSelect").value;
  const difficulty =
    Number($("difficultySelect").value);

  $("startButton").disabled = true;
  $("startButton").innerHTML = "Starting...";

  $("startError").classList.add("hidden");

  try {
    localStorage.setItem(
      "studytwin_student_id",
      state.studentId
    );

    const data = await api("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        studentId: state.studentId,
        concept,
        difficulty
      })
    });

    state.concept = data.concept;
    state.difficulty = data.difficulty;
    state.questionNumber = 1;

    state.stats = {
      attempts: 0,
      correct: 0,
      accuracy: 0
    };

    $("startPanel").classList.add("hidden");
    $("dashboardPanel").classList.add("hidden");
    $("practicePanel").classList.remove("hidden");

    renderQuestion(data.question);
  } catch (error) {
    $("startError").textContent = error.message;
    $("startError").classList.remove("hidden");
  } finally {
    $("startButton").disabled = false;
    $("startButton").innerHTML =
      'Start Practice <span>→</span>';
  }
}

function renderFeedback(data) {
  const feedback = data.feedback || {};
  const misconception = data.misconception || {};
  const adaptation = data.adaptation || {};
  const solution = data.solution || {};
  const student = data.student || {};

  window.lastResponse = data;

  state.answered = true;

  state.stats = {
    attempts:
      student.attempts ?? state.stats.attempts + 1,

    correct:
      student.correct ?? state.stats.correct,

    accuracy:
      student.correctRate ?? state.stats.accuracy
  };

  state.difficulty =
    adaptation.recommendedDifficulty ??
    state.difficulty;

  updateSidebar();

  const rawAnswerCorrect = Boolean(data.answer?.correct);
  const demonstratedCorrect = Boolean(feedback.correct);
  const correct = demonstratedCorrect;

  // Result header styling and messaging
  if (correct) {
    $("feedbackHeader").classList.remove("incorrect", "warning");
    $("feedbackIcon").textContent = "✓";
    $("feedbackTitle").textContent = "Correct!";
    $("feedbackMessage").textContent = feedback.message || "Nice work.";
  } else if (rawAnswerCorrect && misconception.detected) {
    $("feedbackHeader").classList.remove("incorrect");
    $("feedbackHeader").classList.add("warning");
    $("feedbackIcon").textContent = "⚠";
    $("feedbackTitle").textContent =
      "Your final answer is correct, but there is an error in your working.";
    $("feedbackMessage").textContent =
      feedback.message || "Review the step identified below.";
  } else {
    $("feedbackHeader").classList.remove("warning");
    $("feedbackHeader").classList.add("incorrect");
    $("feedbackIcon").textContent = "!";
    $("feedbackTitle").textContent = "Let's learn from this.";
    $("feedbackMessage").textContent =
      feedback.message || "Review the steps and try again.";
  }

  // Misconception
  if (misconception.detected) {
    $("misconceptionBox").classList.remove("hidden");

    $("misconceptionType").textContent =
      conceptName(misconception.type);

    $("misconceptionMessage").textContent =
      misconception.message ||
      "A misconception was detected.";

    const incorrectStep = $("incorrectStep");
    if (misconception.incorrectStep) {
      incorrectStep.textContent = misconception.incorrectStep;
      $("stepCorrection").classList.remove("hidden");
    } else {
      $("stepCorrection").classList.add("hidden");
      incorrectStep.textContent = "";
    }

    const correctStepRow = $("correctStepRow");
    if (misconception.correctStep) {
      $("correctStep").textContent = misconception.correctStep;
      correctStepRow.classList.remove("hidden");
    } else {
      $("correctStep").textContent = "";
      correctStepRow.classList.add("hidden");
    }
    $("stepExplanation").textContent =
      misconception.explanation || "";
    $("stepExplanation").classList.toggle(
      "hidden",
      !misconception.explanation
    );

    $("hintText").textContent =
      misconception.hint ||
      "Review the worked solution.";
  } else {
    $("misconceptionBox").classList.add("hidden");
    $("stepCorrection").classList.add("hidden");
    $("incorrectStep").textContent = "";
    $("correctStep").textContent = "";
    $("correctStepRow").classList.add("hidden");
    $("stepExplanation").textContent = "";
    $("stepExplanation").classList.add("hidden");
  }

  // ML prediction
  const probability = Math.max(
    0,
    Math.min(
      1,
      Number(adaptation.probabilityCorrect ?? 0)
    )
  );

  const percent = Math.round(probability * 100);

  $("probabilityText").textContent =
    `${percent}%`;

  $("probabilityBar").style.width =
    `${percent}%`;

  $("recommendationShort").textContent =
    percent >= 76
      ? "Strong"
      : percent >= 40
        ? "Balanced"
        : "Needs support";

  $("recommendationText").textContent =
    adaptation.recommendation ||
    "No recommendation returned.";

  $("nextDifficultyText").textContent =
    difficultyName(
      adaptation.recommendedDifficulty
    );

  // Worked solution
  $("solutionSteps").innerHTML =
    (solution.steps || [])
      .map(
        (step) =>
          `<li>${escapeHtml(step)}</li>`
      )
      .join("");

  const submittedSteps = solution.submittedSteps || [];
  const submittedWorkBox = $("submittedWorkBox");
  const submittedWorkList = $("submittedWorkSteps");
  submittedWorkList.replaceChildren();

  if (submittedSteps.length > 0) {
    const incorrectStep = misconception.incorrectStep;
    for (const step of submittedSteps) {
      const item = document.createElement("li");
      item.textContent = step;
      if (incorrectStep && step === incorrectStep) {
        item.classList.add("incorrect-work-step");
      }
      submittedWorkList.append(item);
    }
    submittedWorkBox.classList.remove("hidden");
  } else {
    submittedWorkBox.classList.add("hidden");
  }

  $("solutionExplanation").textContent =
    solution.explanation || "";

  // Disable answer controls
  $("answerInput").disabled = true;
  $("workInput").disabled = true;

  $("submitButton").disabled = true;
  $("submitButton").textContent =
    "Answer Submitted";

  $("submitStatus").textContent =
    correct
      ? "Answer recorded."
      : "Answer recorded — review the feedback below.";

  $("feedbackPanel").classList.remove("hidden");

  window.scrollTo({
    top: document.body.scrollHeight,
    behavior: "smooth"
  });
}

async function submitAnswer() {
  if (!state.question || state.answered) {
    return;
  }

  const studentAnswer =
    $("answerInput").value.trim();

  const work =
    $("workInput").value.trim();

  if (!studentAnswer) {
    showError(
      "Enter an answer before checking it."
    );

    $("answerInput").focus();

    return;
  }

  if (!work) {
    showError(
      "Show your steps first. StudyTwin finds the mistake in your work, not just your final answer."
    );

    $("workInput").focus();

    return;
  }

  hideError();

  $("submitButton").disabled = true;

  $("submitButton").innerHTML =
    "Analyzing...";

  try {
    const data = await api(
      "/api/sessions/answer",
      {
        method: "POST",

        body: JSON.stringify({
          studentId: state.studentId,

          question: {
            id: state.question.id
          },

          studentAnswer,

          work
        })
      }
    );

    renderFeedback(data);
  } catch (error) {
    // If the server explicitly says the answer was not persisted
    // (e.g. MongoDB unavailable), make that clear to the student.
    const message =
      error.message.includes("could not save") ||
      error.message.includes("503")
        ? "Your answer could not be saved right now — the server is temporarily unavailable. Please try again in a moment."
        : error.message;

    showError(message);

    $("submitButton").disabled = false;

    $("submitButton").innerHTML =
      'Check Answer <span>→</span>';
  }
}

function continueToNext() {
  const nextQuestion =
    window.lastResponse?.nextQuestion;

  if (!nextQuestion) {
    showError(
      "The server did not provide another question."
    );

    return;
  }

  state.questionNumber += 1;

  renderQuestion(nextQuestion);

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

async function loadDashboard() {
  $("dashboardError").classList.add("hidden");

  try {
    const data = await api(
      `/api/students/${encodeURIComponent(
        state.studentId
      )}`
    );

    const profile = data.profile;

    $("profileAccuracy").textContent =
      `${Number(
        profile.overall?.accuracyPercent || 0
      )}%`;

    $("profileAttempts").textContent =
      `${profile.overall?.attempts || 0} attempts`;

    // Show final-answer accuracy alongside demonstrated mastery
    // so the distinction is clear.
    const rawPct = Number(profile.overall?.rawAccuracyPercent || 0);
    const masteryPct = Number(profile.overall?.accuracyPercent || 0);
    const rawSub = $("profileRawAccuracy");
    if (rawSub) {
      if (rawPct !== masteryPct) {
        rawSub.textContent =
          `${rawPct}% final-answer accuracy`;
      } else {
        rawSub.textContent = "";
      }
    }

    $("profileLevel").textContent =
      profile.learningLevel || "Beginning";

    $("profileMisconceptions").textContent =
      profile.overall?.misconceptionCount || 0;

    $("profileRecommendation").textContent =
      profile.recommendation ||
      "Keep practicing.";

    // Concept mastery
    const concepts =
      profile.concepts || {};

    const entries =
      Object.entries(concepts);

    $("conceptMastery").innerHTML =
      entries.length
        ? entries
            .map(([name, value]) => {
              const percent = Math.round(
                Number(value.correctRate || 0) * 100
              );

              return `
                <div class="mastery-row">
                  <div class="mastery-head">
                    <strong>
                      ${escapeHtml(
                        conceptName(name)
                      )}
                    </strong>

                    <span>
                      ${percent}% ·
                      ${difficultyName(
                        value.currentDifficulty
                      )}
                    </span>
                  </div>

                  <div class="mastery-track">
                    <div
                      class="mastery-fill"
                      style="width:${percent}%"
                    ></div>
                  </div>
                </div>
              `;
            })
            .join("")
        : `
          <p class="muted">
            Complete a few questions to build
            your learning profile.
          </p>
        `;

    // Next learning step
    const nextStep = profile.nextLearningStep;
    const nextCard = $("nextLearningStepCard");
    if (nextStep) {
      $("nextLearningStepContent").innerHTML = `
        <div class="next-step-content">
          <div>
            <p class="next-step-concept">${escapeHtml(nextStep.conceptDisplay)}</p>
            <p class="next-step-reason">${escapeHtml(nextStep.reason)}</p>
          </div>
          <span class="next-step-badge">${escapeHtml(
            difficultyName(nextStep.recommendedDifficulty)
          )}</span>
        </div>
      `;
      // Store for the button handler
      nextCard.dataset.concept = nextStep.concept;
      nextCard.dataset.difficulty =
        String(nextStep.recommendedDifficulty || 1);
      nextCard.classList.remove("hidden");
    } else {
      nextCard.classList.add("hidden");
    }

    // Weakest concepts
    const weakest = profile.weakestConcepts || [];
    const weakCard = $("weakestConceptsCard");
    if (weakest.length > 0) {
      $("weakestConceptsList").innerHTML = weakest
        .map(
          (item) => `
            <div class="mastery-row">
              <div class="mastery-head">
                <strong>${escapeHtml(conceptName(item.concept))}</strong>
                <span>${item.accuracyPercent}% · ${item.misconceptionCount} mistake${item.misconceptionCount === 1 ? "" : "s"}</span>
              </div>
              <div class="mastery-track">
                <div class="mastery-fill" style="width:${item.accuracyPercent}%"></div>
              </div>
            </div>
          `
        )
        .join("");
      weakCard.classList.remove("hidden");
    } else {
      weakCard.classList.add("hidden");
    }

    // Common mistakes — prefer the per-concept breakdown already
    // in the profile, then fall back to the attempt-log-derived list.
    let mistakes = profile.commonMistakes || [];
    if (mistakes.length === 0 && profile.overall?.misconceptionsByType) {
      mistakes = Object.entries(profile.overall.misconceptionsByType)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([type, count]) => ({
          type,
          label: String(type).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
          count
        }));
    }
    const mistakesCard = $("commonMistakesCard");
    if (mistakes.length > 0) {
      $("commonMistakesList").innerHTML = mistakes
        .map(
          (m) => `
            <div class="mistake-row">
              <span>
                <span class="mistake-label">${escapeHtml(m.label)}</span>
                ${m.concept
                  ? `<span class="mistake-concept">${escapeHtml(conceptName(m.concept))}</span>`
                  : ""}
              </span>
              <span class="mistake-count">${m.count}×</span>
            </div>
          `
        )
        .join("");
      mistakesCard.classList.remove("hidden");
    } else {
      mistakesCard.classList.add("hidden");
    }

    // Recent attempts
    const recentAttempts = profile.recentAttempts || [];
    const attemptsCard = $("recentAttemptsCard");
    if (recentAttempts.length > 0) {
      $("recentAttemptsList").innerHTML = recentAttempts
        .map((attempt) => {
          let resultHtml;
          if (attempt.demonstratedCorrect) {
            resultHtml = `<span class="result-correct">✓ Correct</span>`;
          } else if (attempt.answerCorrect && attempt.misconceptionDetected) {
            resultHtml = `<span class="result-warning">⚠ Flawed work</span>`;
          } else {
            resultHtml = `<span class="result-incorrect">✗ Incorrect</span>`;
          }

          const mistakeHtml = attempt.misconceptionType
            ? `<span class="mistake-tag">${escapeHtml(attempt.misconceptionType)}</span>`
            : `<span class="muted">—</span>`;

          return `
            <tr>
              <td>${escapeHtml(conceptName(attempt.concept))}</td>
              <td>${escapeHtml(difficultyName(attempt.difficulty))}</td>
              <td>${resultHtml}</td>
              <td>${mistakeHtml}</td>
            </tr>
          `;
        })
        .join("");
      attemptsCard.classList.remove("hidden");
    } else {
      attemptsCard.classList.add("hidden");
    }

  } catch (error) {
    $("dashboardError").textContent =
      error.message;

    $("dashboardError").classList.remove("hidden");
  }
}

async function practiceRecommendedSkill() {
  const card = $("nextLearningStepCard");
  const concept = card?.dataset.concept;
  const difficulty = Number(card?.dataset.difficulty) || 1;

  if (!concept) return;

  // Update the concept/difficulty selectors so the session
  // starts with the recommended settings.
  const conceptSelect = $("conceptSelect");
  const difficultySelect = $("difficultySelect");

  if (conceptSelect) conceptSelect.value = concept;
  if (difficultySelect) difficultySelect.value = String(difficulty);

  state.concept = concept;
  state.difficulty = difficulty;

  // Hide the dashboard and start the session.
  $("dashboardPanel").classList.add("hidden");
  $("startPanel").classList.add("hidden");

  await startSession();
}

async function openDashboard() {

  $("startPanel").classList.add("hidden");

  $("practicePanel").classList.add("hidden");

  $("dashboardPanel").classList.remove("hidden");

  await loadDashboard();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function backToPractice() {
  if (state.question) {
    $("dashboardPanel").classList.add("hidden");

    $("practicePanel").classList.remove("hidden");
  } else {
    $("dashboardPanel").classList.add("hidden");

    $("startPanel").classList.remove("hidden");
  }
}

async function resetStudent() {
  const confirmed = confirm(
    "Reset this student's saved session data?"
  );

  if (!confirmed) return;

  try {
    await api(
      `/api/students/${encodeURIComponent(
        state.studentId
      )}`,
      {
        method: "DELETE"
      }
    );

    localStorage.removeItem("studytwin_student_id");
    localStorage.removeItem("studytwin_student_token");

    window.location.reload();
  } catch (error) {
    showError(error.message);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function checkConnection() {
  try {
    await api("/health");

    $("connectionStatus").innerHTML =
      '<span class="status-dot"></span> API connected';
  } catch {
    $("connectionStatus").innerHTML =
      '<span class="status-dot offline"></span> API offline';
  }
}


// ------------------------------------------
// Event listeners
// ------------------------------------------

$("startButton").addEventListener(
  "click",
  startSession
);

$("submitButton").addEventListener(
  "click",
  submitAnswer
);

$("nextButton").addEventListener(
  "click",
  continueToNext
);

$("resetButton").addEventListener(
  "click",
  resetStudent
);

$("dashboardButton").addEventListener(
  "click",
  openDashboard
);

$("practiceSkillButton").addEventListener(
  "click",
  practiceRecommendedSkill
);

$("backToPracticeButton").addEventListener(
  "click",
  backToPractice
);

$("answerInput").addEventListener(
  "keydown",
  (event) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey
    ) {
      event.preventDefault();
      submitAnswer();
    }
  }
);

$("conceptSelect").addEventListener(
  "change",
  (event) => {
    state.concept = event.target.value;
  }
);


// ------------------------------------------
// Initialisation
// ------------------------------------------

updateSidebar();

loadConcepts();

checkConnection();