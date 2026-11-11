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
  submitting: false,
  targetedPractice: null,
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
    const error = new Error(
      data.error || `API returned HTTP ${response.status}`
    );
    error.status = response.status;
    error.data = data;
    throw error;
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

// ============================================================
// LIVE STEP CHECKING
// ============================================================
// Checks each line of working against the previous one while the
// student types. The final "x = number" line is never judged here;
// the student presses Check Answer for that.

const LIVE_CHECK_DELAY_MS = 450;

const liveSteps = {
  timer: null,
  requestId: 0,
  // Distinct mistakes the checker has pointed out for this question.
  hintsSeen: new Set()
};

const LIVE_STATUS = {
  given: { icon: "•", label: "The question" },
  valid: { icon: "✓", label: "Correct step" },
  invalid: { icon: "✗", label: "Mistake in this step" },
  final: { icon: "→", label: "Final line" },
  unreadable: { icon: "?", label: "Can't read this line" }
};

function resetLiveSteps() {
  clearTimeout(liveSteps.timer);
  liveSteps.requestId += 1;
  liveSteps.hintsSeen = new Set();
  $("liveSteps").innerHTML = "";
  $("liveSteps").classList.add("hidden");
}

function scheduleLiveCheck() {
  clearTimeout(liveSteps.timer);
  liveSteps.timer = setTimeout(runLiveCheck, LIVE_CHECK_DELAY_MS);
}

async function runLiveCheck() {
  const work = $("workInput").value;
  if (!state.question || state.answered || !work.trim()) {
    $("liveSteps").classList.add("hidden");
    return;
  }

  const requestId = ++liveSteps.requestId;
  try {
    const data = await api("/api/steps/check", {
      method: "POST",
      body: JSON.stringify({ questionId: state.question.id, work })
    });
    // Ignore replies to older keystrokes or a question that has moved on.
    if (requestId !== liveSteps.requestId || state.answered) {
      return;
    }
    renderLiveSteps(data.steps || []);
  } catch (_error) {
    // Live checking is a helper; if it fails, the student can still submit.
    $("liveSteps").classList.add("hidden");
  }
}

function renderLiveSteps(steps) {
  if (steps.length === 0) {
    $("liveSteps").classList.add("hidden");
    return;
  }

  $("liveSteps").innerHTML = steps
    .map((step) => {
      const status = LIVE_STATUS[step.status] || LIVE_STATUS.unreadable;
      if (step.status === "invalid") {
        liveSteps.hintsSeen.add(`${step.line}|${step.label || ""}`);
      }
      const note = step.message
        ? `<span class="live-note">${escapeHtml(step.message)}</span>`
        : "";
      const hint = step.hint
        ? `<span class="live-hint">Hint: ${escapeHtml(step.hint)}</span>`
        : "";
      return `
        <li class="live-step live-${escapeHtml(step.status)}">
          <span class="live-icon" role="img" aria-label="${status.label}">${status.icon}</span>
          <span class="live-body">
            <code class="live-line">${escapeHtml(step.line)}</code>
            ${note}${hint}
          </span>
        </li>`;
    })
    .join("");
  $("liveSteps").classList.remove("hidden");
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
  resetLiveSteps();

  $("answerInput").disabled = false;
  $("workInput").disabled = false;

  $("submitButton").disabled = false;
  $("submitButton").innerHTML = "Check Answer <span>→</span>";

  $("submitStatus").textContent = "";

  $("feedbackPanel").classList.add("hidden");

  const sessionLength = state.targetedPractice?.active ? 3 : 5;
  const progress = Math.min(
    100,
    (((state.questionNumber - 1) % sessionLength) + 1) *
      (100 / sessionLength)
  );

  $("progressBar").style.width = `${progress}%`;

  $("progressText").textContent =
    `Question ${((state.questionNumber - 1) % sessionLength) + 1} of ${sessionLength}`;

  const targetedBanner = $("targetedPracticeBanner");
  if (state.targetedPractice?.active) {
    targetedBanner.textContent =
      `Focused practice: ${state.targetedPractice.label}. Three questions build from easier to harder.`;
    targetedBanner.classList.remove("hidden");
  } else {
    targetedBanner.classList.add("hidden");
  }
  $("targetedPracticeResult").classList.add("hidden");
  $("nextButton").textContent = "Continue to Next Question →";

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

async function startSession({ misconceptionType = null } = {}) {
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
        difficulty,
        ...(misconceptionType ? { misconceptionType } : {})
      })
    });

    if (data.persisted !== true) {
      throw new Error(
        "StudyTwin could not confirm that your session was saved. Please try again."
      );
    }

    state.concept = data.concept;
    state.difficulty = data.difficulty;
    state.targetedPractice = data.targetedPractice || null;
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
  // Stop any pending live check; the full feedback below replaces it.
  clearTimeout(liveSteps.timer);
  liveSteps.requestId += 1;

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

  const targetedResult = $("targetedPracticeResult");
  if (data.targetedPractice) {
    const target = data.targetedPractice;
    state.targetedPractice = target;
    targetedResult.textContent = target.completed
      ? `Focused practice complete: ${target.targetErrors} ${target.label.toLowerCase()} error${target.targetErrors === 1 ? "" : "s"} in ${target.attempts} questions.`
      : `Focused practice: ${target.attempts} of 3 questions completed.`;
    targetedResult.classList.remove("hidden");
    if (target.completed) {
      $("nextButton").textContent = "Return to mixed practice";
    }
  }

  $("feedbackPanel").classList.remove("hidden");

  window.scrollTo({
    top: document.body.scrollHeight,
    behavior: "smooth"
  });
}

async function submitAnswer() {
  // The Enter key bypasses the disabled button, so guard in-flight requests here.
  if (!state.question || state.answered || state.submitting) {
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

  state.submitting = true;
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

          work,

          liveHintsSeen: liveSteps.hintsSeen.size
        })
      }
    );

    if (data.persisted !== true) {
      throw new Error(
        "StudyTwin could not confirm that your answer and progress were fully saved. Check your profile before retrying."
      );
    }

    renderFeedback(data);
  } catch (error) {
    showError(error.message ||
      "StudyTwin could not confirm that your answer was fully saved. Check your profile before retrying.");

    $("submitButton").disabled = false;

    $("submitButton").innerHTML =
      'Check Answer <span>→</span>';
  } finally {
    state.submitting = false;
  }
}

async function continueToNext() {
  const nextQuestion =
    window.lastResponse?.nextQuestion;
  const targetedComplete = window.lastResponse?.targetedPractice?.completed;

  if (!nextQuestion) {
    if (targetedComplete) {
      await openDashboard();
      return;
    }
    showError(
      "The server did not provide another question."
    );

    return;
  }

  if (targetedComplete) {
    state.targetedPractice = null;
    state.questionNumber = 0;
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
      nextCard.dataset.misconceptionType =
        nextStep.topMistakeCount >= 2 ? nextStep.topMistakeType || "" : "";
      $("practiceSkillButton").textContent = nextStep.topMistakeCount >= 2
        ? `Practice ${nextStep.topMistakeLabel} →`
        : "Practice this skill →";
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
                ${m.count >= 2 && m.concept
                  ? `<button class="practice-mistake-button" data-concept="${escapeHtml(m.concept)}" data-misconception="${escapeHtml(m.type)}">Practice this mistake</button>`
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

    const trendRows = profile.misconceptionTrends || [];
    const trendCard = $("misconceptionTrendsCard");
    if (trendRows.length > 0) {
      $("misconceptionTrendsList").innerHTML = trendRows.map((trend) => {
        const rates = trend.previous && trend.recent
          ? `Previous 10: ${Math.round(trend.previous.rate * 100)}% (${trend.previous.errors}/10) · Last 10: ${Math.round(trend.recent.rate * 100)}% (${trend.recent.errors}/10)`
          : `Based on ${profile.trendAttemptCount || 0} saved attempt records; 20 are needed for a comparison.`;
        return `<div class="trend-row"><div><span class="trend-label">${escapeHtml(trend.label)}</span><span class="trend-rates">${rates}</span></div><span class="trend-status">${escapeHtml(trend.status)}</span></div>`;
      }).join("");
      trendCard.classList.remove("hidden");
    } else {
      trendCard.classList.add("hidden");
    }

    const targetedSummary = profile.targetedPractice;
    const targetedSummaryCard = $("targetedPracticeSummaryCard");
    if (targetedSummary && targetedSummary.attempts > 0) {
      $("targetedPracticeSummary").textContent =
        `${labelFromType(targetedSummary.type)}: ${targetedSummary.targetErrors} matching errors in ${targetedSummary.attempts} focused questions (${Math.round((targetedSummary.targetErrors / targetedSummary.attempts) * 100)}%).`;
      targetedSummaryCard.classList.remove("hidden");
    } else {
      targetedSummaryCard.classList.add("hidden");
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

  await startSession({
    misconceptionType: card?.dataset.misconceptionType || null
  });
}

function labelFromType(type) {
  return String(type || "misconception")
    .replace(/_/g, " ")
    .replace(/\b\w/g, character => character.toUpperCase());
}

async function practiceMisconception(concept, misconceptionType) {
  if (!concept || !misconceptionType) return;
  $("conceptSelect").value = concept;
  state.concept = concept;
  $("dashboardPanel").classList.add("hidden");
  $("startPanel").classList.add("hidden");
  await startSession({ misconceptionType });
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
    "Permanently delete this browser session's progress and all saved answer and working history? This cannot be undone."
  );

  if (!confirmed) return;

  try {
    const result = await api(
      `/api/students/${encodeURIComponent(
        state.studentId
      )}`,
      {
        method: "DELETE"
      }
    );

    if (result.deleted !== true || result.reset?.complete !== true) {
      throw new Error(
        "StudyTwin could not confirm that all progress and answer history were deleted. Retry reset to finish."
      );
    }

    localStorage.removeItem("studytwin_student_id");
    localStorage.removeItem("studytwin_student_token");

    window.location.reload();
  } catch (error) {
    showError(error.message ||
      "Reset could not be confirmed. Some or all session data may already have been removed; retry reset to confirm completion.");
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
    await api("/api/health");

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

$("commonMistakesList").addEventListener("click", (event) => {
  const button = event.target.closest(".practice-mistake-button");
  if (!button) return;
  practiceMisconception(
    button.dataset.concept,
    button.dataset.misconception
  );
});

$("backToPracticeButton").addEventListener(
  "click",
  backToPractice
);

$("workInput").addEventListener("input", scheduleLiveCheck);

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
