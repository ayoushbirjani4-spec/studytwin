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

// Sentence case: "distributive_property" -> "Distributive property"
const conceptName = (value) => {
  const text = String(value || "").replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

// Server hints sometimes shout a word ("BOTH"); show it in normal case.
const calmCase = (text) =>
  String(text || "").replace(/\b([A-Z]{2,})\b/g, (word) => word.toLowerCase());

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
  hintsSeen: new Set(),
  // Hint ladder for the first mistake: 0 = nudge only, 1 = mistake named,
  // 2 = correct step shown. Resets when the first mistake changes.
  hintLevel: 0,
  hintKey: "",
  correctStep: null,
  hintsUsed: 0,
  lastSteps: []
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
  liveSteps.hintLevel = 0;
  liveSteps.hintKey = "";
  liveSteps.correctStep = null;
  liveSteps.hintsUsed = 0;
  liveSteps.lastSteps = [];
  $("liveSteps").innerHTML = "";
  $("liveSteps").classList.add("hidden");
}

// ============================================================
// WORKING FROM A PHOTO
// ============================================================
//
// The photo is shrunk in the browser, read by the server (Gemini), and
// the lines go into the working box for the student to compare with their
// paper. Nothing is marked until they press Check answer, and the photo
// itself is never saved.

const PHOTO_MAX_SIDE = 1600;
let photoRequestId = 0;

function resetPhoto() {
  photoRequestId += 1;
  $("photoButton").disabled = false;
  $("photoStatus").textContent = "";
  $("photoStatus").classList.remove("is-error");
  $("photoInput").value = "";
}

async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.85);
}

function setPhotoStatus(text, isError = false) {
  $("photoStatus").textContent = text;
  $("photoStatus").classList.toggle("is-error", isError);
}

async function readPhoto(file) {
  if (!file || !state.question || state.answered) return;
  if (!file.type.startsWith("image/")) {
    setPhotoStatus("That file isn't a photo.", true);
    return;
  }

  const requestId = ++photoRequestId;
  const questionId = state.question.id;
  $("photoButton").disabled = true;
  setPhotoStatus("Reading your working…");

  try {
    const image = await shrinkPhoto(file);
    const data = await api("/api/work/photo", {
      method: "POST",
      body: JSON.stringify({ studentId: state.studentId, questionId, image })
    });
    // The student may have moved on while the photo was being read.
    if (requestId !== photoRequestId || state.question?.id !== questionId || state.answered) return;

    if (!data.readable || !data.lines.length) {
      setPhotoStatus("Couldn't find maths working in that photo. Try a closer, brighter photo, or type it.", true);
      return;
    }
    $("workInput").value = data.lines.join("\n");
    if (data.answer && !$("answerInput").value.trim()) {
      $("answerInput").value = data.answer.replace(/^x\s*=\s*/i, "");
    }
    setPhotoStatus(
      `Read ${data.lines.length} line${data.lines.length === 1 ? "" : "s"}. Check they match your paper and fix any that don't, then press Check answer. The photo isn't saved.`
    );
    scheduleLiveCheck();
    $("workInput").focus();
  } catch (error) {
    if (requestId === photoRequestId) {
      setPhotoStatus(error.message || "Couldn't read that photo. Try again, or type your working.", true);
    }
  } finally {
    if (requestId === photoRequestId) {
      $("photoButton").disabled = false;
      $("photoInput").value = "";
    }
  }
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

  liveSteps.lastSteps = steps;
  // The first mistake is the one with a hint; a new first mistake starts the ladder again.
  const first = steps.find((step) => step.status === "invalid" && step.hint);
  const key = first ? `${first.line}|${first.label || ""}` : "";
  if (key !== liveSteps.hintKey) {
    liveSteps.hintKey = key;
    liveSteps.hintLevel = 0;
    liveSteps.correctStep = null;
  }

  $("liveSteps").innerHTML = steps
    .map((step, index) => {
      const status = LIVE_STATUS[step.status] || LIVE_STATUS.unreadable;
      let note = step.message
        ? `<span class="live-note">${escapeHtml(step.message)}</span>`
        : "";
      let hint = "";
      if (step.status === "invalid") {
        liveSteps.hintsSeen.add(`${step.line}|${step.label || ""}`);
        if (step !== first) {
          note = `<span class="live-note">Check this line too.</span>`;
        } else if (liveSteps.hintLevel === 0) {
          // Rung 1: a nudge. The student looks for the mistake themselves.
          note = `<span class="live-note">Something isn't right in line ${index + 1}. Can you spot it?</span>`;
          hint = `<button class="text-button live-hint-button" type="button">Hint</button>`;
        } else {
          // Rung 2: the mistake named. Rung 3: the correct step.
          hint = `<span class="live-hint">Hint: ${escapeHtml(step.hint)}</span>` +
            (liveSteps.hintLevel === 2 && liveSteps.correctStep
              ? `<span class="live-hint">This line should be: <code>${escapeHtml(liveSteps.correctStep)}</code></span>`
              : liveSteps.hintLevel === 1
                ? `<button class="text-button live-hint-button" type="button">Show the step</button>`
                : "");
        }
      }
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

// Climb one rung of the hint ladder for the first mistake.
async function nextHint() {
  if (liveSteps.hintLevel === 0) {
    liveSteps.hintLevel = 1;
    liveSteps.hintsUsed += 1;
    renderLiveSteps(liveSteps.lastSteps);
    return;
  }
  if (liveSteps.hintLevel !== 1 || !state.question) return;
  try {
    const data = await api("/api/steps/check", {
      method: "POST",
      body: JSON.stringify({ questionId: state.question.id, work: $("workInput").value, reveal: true })
    });
    const first = (data.steps || []).find((step) => step.status === "invalid" && step.hint);
    if (!first?.correctStep) return;
    liveSteps.correctStep = first.correctStep;
    liveSteps.hintLevel = 2;
    liveSteps.hintsUsed += 1;
    renderLiveSteps(data.steps);
  } catch {
    // The ladder is a helper: if this fails, the student can still submit.
  }
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
    question.question || "Question unavailable";

  // A word problem is a story: smaller text, and the working starts with the equation.
  const isStory = !/^(Solve|Simplify):/i.test(question.question || "");
  $("questionText").classList.toggle("is-story", isStory);
  $("workInput").placeholder = isStory
    ? "Write an equation for the story first, then one step per line"
    : "Start by copying the question, then one step per line";

  $("answerInput").value = "";
  $("workInput").value = "";
  resetLiveSteps();
  resetPhoto();

  $("answerInput").disabled = false;
  $("workInput").disabled = false;

  $("submitButton").disabled = false;
  $("submitButton").textContent = "Check answer";

  $("submitStatus").textContent = "";

  $("feedbackPanel").classList.add("hidden");

  const trap = state.targetedPractice?.active ? state.targetedPractice : null;
  if (trap) {
    // A trap round fills up with the streak, not the question count.
    const goal = trap.goal || 5;
    $("progressBar").style.width = `${Math.min(100, ((trap.streak || 0) / goal) * 100)}%`;
    $("progressText").textContent =
      `Trap ${trap.attempts + 1} · ${trap.streak || 0} of ${goal} in a row`;
  } else {
    const sessionLength = 5;
    const position = ((state.questionNumber - 1) % sessionLength) + 1;
    $("progressBar").style.width = `${position * (100 / sessionLength)}%`;
    $("progressText").textContent = `Question ${position} of ${sessionLength}`;
  }

  const targetedBanner = $("targetedPracticeBanner");
  if (trap) {
    targetedBanner.textContent =
      `Trap round: ${trap.label}. Each question is set to catch this mistake. Get ${trap.goal || 5} in a row right to cure it.`;
    targetedBanner.classList.remove("hidden");
  } else {
    targetedBanner.classList.add("hidden");
  }
  $("targetedPracticeResult").classList.add("hidden");
  $("nextButton").textContent = "Next question";
  document.querySelector(".solution-box")?.removeAttribute("open");

  updateSidebar();
  hideError();

  // Working comes first, the way students solve on paper.
  $("workInput").focus();
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
  $("startButton").textContent = "Starting…";

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

    showOnly("practicePanel");

    renderQuestion(data.question);
  } catch (error) {
    $("startError").textContent = error.message;
    $("startError").classList.remove("hidden");
  } finally {
    $("startButton").disabled = false;
    $("startButton").textContent = "Start practice";
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
  // Result header. The mark (tick or circled cross) comes from the
  // header's class; the title stays short so the student reads on.
  if (correct) {
    $("feedbackHeader").classList.remove("incorrect", "warning");
    $("feedbackTitle").textContent = "Correct";
    $("feedbackMessage").textContent = feedback.message || "Every step checks out.";
  } else if (rawAnswerCorrect && misconception.detected) {
    $("feedbackHeader").classList.remove("incorrect");
    $("feedbackHeader").classList.add("warning");
    $("feedbackTitle").textContent = "Right answer, but one step needs fixing";
    $("feedbackMessage").textContent =
      feedback.message || "Look at the step marked below.";
  } else {
    $("feedbackHeader").classList.remove("warning");
    $("feedbackHeader").classList.add("incorrect");
    $("feedbackTitle").textContent = "Not quite yet";
    $("feedbackMessage").textContent =
      feedback.message || "Look at your steps and try the next one.";
  }

  // Misconception
  if (misconception.detected) {
    $("misconceptionBox").classList.remove("hidden");

    $("misconceptionType").textContent =
      conceptName(misconception.type);

    // Don't repeat the sentence the header already shows.
    const detail = misconception.message || "";
    $("misconceptionMessage").textContent =
      detail === $("feedbackMessage").textContent ? "" : detail;
    $("misconceptionMessage").classList.toggle(
      "hidden",
      !$("misconceptionMessage").textContent
    );

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

    $("hintText").textContent = calmCase(
      misconception.hint ||
      "Open the full solution below."
    );
  } else {
    $("misconceptionBox").classList.add("hidden");
    $("stepCorrection").classList.add("hidden");
    $("incorrectStep").textContent = "";
    $("correctStep").textContent = "";
    $("correctStepRow").classList.add("hidden");
    $("stepExplanation").textContent = "";
    $("stepExplanation").classList.add("hidden");
  }

  // What comes next. The ML prediction still picks the difficulty; the
  // student sees one calm line instead of a "chance of success" figure.
  const nextLevel = difficultyName(adaptation.recommendedDifficulty).toLowerCase();
  const previousLevel = difficultyName(state.question?.difficulty).toLowerCase();
  const article = nextLevel === "easy" ? "an" : "a";
  $("nextLine").textContent = data.targetedPractice?.active
    ? "Next: another trap"
    : data.targetedPractice?.completed
      ? "Next: back to mixed practice"
      : nextLevel === previousLevel
        ? `Next: another ${nextLevel} question`
        : `Next: ${article} ${nextLevel} question`;

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
  photoRequestId += 1;
  $("photoButton").disabled = true;

  $("submitButton").disabled = true;
  $("submitButton").textContent = "Checked";
  $("submitStatus").textContent = "";

  const targetedResult = $("targetedPracticeResult");
  if (data.targetedPractice) {
    const target = data.targetedPractice;
    state.targetedPractice = target;
    const goal = target.goal || 5;
    let outcome;
    if (target.cured) {
      outcome = `Mistake cured. You got ${goal} traps in a row right.`;
    } else if (target.completed) {
      outcome = `Round over after ${target.attempts} questions. It caught you ${target.targetErrors} time${target.targetErrors === 1 ? "" : "s"}. Try another round later.`;
    } else if (target.caught) {
      outcome = "It caught you, so the streak starts again.";
    } else if (target.streak > 0) {
      outcome = `Trap beaten: ${target.streak} of ${goal} in a row.`;
    } else {
      outcome = "Not caught, but the answer wasn't right, so the streak starts again.";
    }
    targetedResult.textContent = [target.trapNote, outcome].filter(Boolean).join(" ");
    targetedResult.classList.toggle("is-cured", Boolean(target.cured));
    targetedResult.classList.remove("hidden");
    if (target.completed) {
      $("nextButton").textContent = "Return to mixed practice";
    }
  } else if (data.checkup && data.checkup.result !== "unsettled") {
    // A surprise check-up on a cured mistake, revealed only now.
    const c = data.checkup;
    const ago = `${c.daysSinceCure} day${c.daysSinceCure === 1 ? "" : "s"} ago`;
    targetedResult.textContent = c.result === "held"
      ? `Surprise check-up: that question was set to catch "${c.label}", which you cured ${ago}. Still cured.${c.final ? " That was the last check-up, so this one is sorted." : ""}`
      : `Surprise check-up: that question was set to catch "${c.label}", which you cured ${ago}, and it came back. A short trap round on your progress page will fix it again.`;
    targetedResult.classList.toggle("is-cured", c.result === "held");
    targetedResult.classList.remove("hidden");
  }

  $("feedbackPanel").classList.remove("hidden");

  // Bring the result into view, starting at its title.
  $("feedbackPanel").scrollIntoView({ behavior: "smooth", block: "start" });
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

  if (!work) {
    showError(
      "Write your working first. StudyTwin checks each step, not just the final answer."
    );

    $("workInput").focus();

    return;
  }

  if (!studentAnswer) {
    showError(
      "Add your final answer, then check it."
    );

    $("answerInput").focus();

    return;
  }

  hideError();

  state.submitting = true;
  $("submitButton").disabled = true;

  $("submitButton").textContent = "Checking…";

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

          liveHintsSeen: liveSteps.hintsSeen.size,

          hintsUsed: liveSteps.hintsUsed
        })
      }
    );

    if (data.persisted !== true) {
      throw new Error(
        "StudyTwin could not confirm that your answer and progress were fully saved. Check your profile before retrying."
      );
    }

    renderFeedback(data);
    // Refresh today's goal and streak (no need to wait for it).
    loadMotivation();
  } catch (error) {
    showError(error.message ||
      "StudyTwin could not confirm that your answer was fully saved. Check your profile before retrying.");

    $("submitButton").disabled = false;

    $("submitButton").textContent = "Check answer";
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
    renderMotivation(profile);

    // Whole percentages everywhere on the dashboard.
    $("profileAccuracy").textContent =
      `${Math.round(Number(profile.overall?.accuracyPercent || 0))}%`;

    const answered = profile.overall?.attempts || 0;
    $("profileAttempts").textContent =
      `${answered} answer${answered === 1 ? "" : "s"}`;

    // Show final-answer accuracy alongside demonstrated mastery
    // so the distinction is clear.
    const rawPct = Math.round(Number(profile.overall?.rawAccuracyPercent || 0));
    const masteryPct = Math.round(Number(profile.overall?.accuracyPercent || 0));
    const rawSub = $("profileRawAccuracy");
    if (rawSub) {
      if (rawPct !== masteryPct) {
        rawSub.textContent =
          `${rawPct}% right final answers`;
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
      "Keep practising";

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
            Answer a few questions to see your mastery by topic
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
        ? `Trap round: ${String(nextStep.topMistakeLabel || "").toLowerCase()}`
        : "Practice this skill";
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
          label: conceptName(type),
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
                  ? `<button class="practice-mistake-button" data-concept="${escapeHtml(m.concept)}" data-misconception="${escapeHtml(m.type)}">Try a trap round</button>`
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

    renderTwinEffect(profile.twinEffect || []);

    renderCuredMistakes(profile.curedMistakes || []);

    const targetedSummary = profile.targetedPractice;
    const targetedSummaryCard = $("targetedPracticeSummaryCard");
    if (targetedSummary && targetedSummary.attempts > 0) {
      const caught = targetedSummary.targetErrors;
      $("targetedPracticeSummary").textContent =
        `${labelFromType(targetedSummary.type)}: ${targetedSummary.cured ? "cured" : targetedSummary.active ? "in progress" : "not cured yet"}. ` +
        `Caught ${caught} time${caught === 1 ? "" : "s"} in ${targetedSummary.attempts} trap${targetedSummary.attempts === 1 ? "" : "s"}.`;
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
            resultHtml = `<span class="result-correct">Correct</span>`;
          } else if (attempt.answerCorrect && attempt.misconceptionDetected) {
            resultHtml = `<span class="result-warning">Right answer, flawed working</span>`;
          } else {
            resultHtml = `<span class="result-incorrect">Not quite</span>`;
          }

          const mistakeHtml = attempt.misconceptionType
            ? `<span class="mistake-tag">${escapeHtml(conceptName(attempt.misconceptionType))}</span>`
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

// Mistakes cured in a trap round, and whether they have stayed away.
function renderCuredMistakes(cured) {
  const card = $("curedMistakesCard");
  if (!cured.length) {
    card.classList.add("hidden");
    return;
  }
  const date = (iso) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  $("curedMistakesList").innerHTML = cured.map((item) => {
    const since = item.answersSince;
    let status;
    let statusClass = "";
    let button = "";
    const checkups = item.checkups || [];
    const trapButton = `<button class="practice-mistake-button" data-concept="${escapeHtml(item.concept)}" data-misconception="${escapeHtml(item.type)}">Try a trap round</button>`;

    if (checkups.length) {
      // Surprise check-ups 2 and 7 days after the cure.
      const describe = (c) => c.result === "held"
        ? `${c.days}-day check-up: held`
        : c.result === "slipped"
          ? `${c.days}-day check-up: it came back`
          : c.due ? `${c.days}-day check-up: due now` : `${c.days}-day check-up: ${date(c.dueAt)}`;
      status = item.status === "slipped"
        ? `${describe(checkups.find((c) => c.result === "slipped"))}. Another trap round will fix it again.`
        : item.status === "held"
          ? "Held at both surprise check-ups, after 2 and 7 days."
          : checkups.map(describe).join(" · ");
      statusClass = item.status === "slipped" ? "is-back" : item.status === "held" ? "is-holding" : "";
      if (item.status === "slipped") {
        button = trapButton;
      } else if (checkups.some((c) => c.due)) {
        status += `. It will turn up somewhere in your next ${conceptName(item.concept).toLowerCase()} practice.`;
        button = `<button class="practice-mistake-button practice-topic-button" data-concept="${escapeHtml(item.concept)}">Practise ${escapeHtml(conceptName(item.concept).toLowerCase())}</button>`;
      }
      return `
        <div class="cured-row">
          <div class="cured-head">
            <span class="cured-name">${escapeHtml(item.label)}</span>
            <span class="cured-date">Cured ${escapeHtml(date(item.curedAt))} · ${escapeHtml(conceptName(item.concept))}</span>
          </div>
          <p class="cured-status ${statusClass}">${escapeHtml(status)}</p>
          ${button}
        </div>
      `;
    }

    if (item.cameBack > 0) {
      status = `Came back ${item.cameBack}× in ${since} answer${since === 1 ? "" : "s"} since. Another round will help.`;
      statusClass = "is-back";
    } else if (since > 0) {
      status = `Not seen in ${since} answer${since === 1 ? "" : "s"} since`;
      statusClass = "is-holding";
    } else {
      status = "No answers on this topic since";
    }
    return `
      <div class="cured-row">
        <div class="cured-head">
          <span class="cured-name">${escapeHtml(item.label)}</span>
          <span class="cured-date">Cured ${escapeHtml(date(item.curedAt))} · ${escapeHtml(conceptName(item.concept))}</span>
        </div>
        <p class="cured-status ${statusClass}">${escapeHtml(status)}</p>
        ${item.cameBack > 0
          ? `<button class="practice-mistake-button" data-concept="${escapeHtml(item.concept)}" data-misconception="${escapeHtml(item.type)}">Try a trap round</button>`
          : ""}
      </div>
    `;
  }).join("");
  card.classList.remove("hidden");
}

// Ordinary practice in one topic (a due check-up is served first).
async function practiceTopic(concept) {
  if (!concept) return;
  $("conceptSelect").value = concept;
  state.concept = concept;
  $("dashboardPanel").classList.add("hidden");
  $("startPanel").classList.add("hidden");
  await startSession();
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

// ============================================================
// TEACH YOUR TWIN
// ============================================================
// The twin shows a worked solution containing the student's own most
// frequent mistake. The student taps the wrong line, then writes the
// correct step. The server grades both; the browser never knows which
// line is wrong until the student has fixed it.

const twin = {
  lesson: null,
  mode: "habit",
  lessonNumber: 0,
  progress: null,
  reviewing: false,
  selectedIndex: null,
  solved: false,
  seenQuestionIds: [],
  taughtCount: 0,
  returnTo: "startPanel"
};

function showOnly(panelId) {
  for (const id of ["startPanel", "practicePanel", "dashboardPanel", "twinPanel"]) {
    $(id).classList.toggle("hidden", id !== panelId);
  }
}

function visiblePanel() {
  return ["practicePanel", "dashboardPanel", "startPanel"]
    .find((id) => !$(id).classList.contains("hidden")) || "startPanel";
}

async function openTwin() {
  twin.returnTo = visiblePanel();
  showOnly("twinPanel");
  window.scrollTo({ top: 0, behavior: "smooth" });
  await loadTwinLesson();
}

function closeTwin() {
  showOnly(twin.returnTo === "twinPanel" ? "startPanel" : twin.returnTo);
}

function setTwinSays(text) {
  $("twinSays").textContent = text;
}

function showTwinError(message) {
  $("twinError").textContent = message;
  $("twinError").classList.toggle("hidden", !message);
}

// ------------------------------------------------------------
// Explain the fix: why was the twin's line wrong?
// ------------------------------------------------------------

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let explainingAvailable = true;

function showExplainForm() {
  if (!explainingAvailable) return;
  $("twinExplainInput").value = "";
  $("twinExplainInput").disabled = false;
  $("twinExplainButton").disabled = false;
  $("twinExplainResult").classList.add("hidden");
  $("twinMicButton").classList.toggle("hidden", !SpeechRecognition);
  $("twinExplainForm").classList.remove("hidden");
}

const EXPLAIN_TITLES = {
  right: "Your twin gets it now.",
  partly: "Nearly.",
  not_yet: "Not quite."
};

async function explainTwin(event) {
  event.preventDefault();
  const explanation = $("twinExplainInput").value.trim();
  if (!explanation || !twin.lesson) {
    $("twinExplainInput").focus();
    return;
  }
  $("twinExplainButton").disabled = true;
  $("twinExplainButton").textContent = "Thinking…";
  try {
    const result = await api("/api/twin/explain", {
      method: "POST",
      body: JSON.stringify({
        studentId: state.studentId,
        questionId: twin.lesson.questionId,
        misconceptionType: twin.lesson.misconceptionType,
        variant: twin.lesson.variant,
        correctedLine: twin.correctedLine,
        explanation
      })
    });
    $("twinExplainResult").textContent = `${EXPLAIN_TITLES[result.verdict]} ${result.feedback}`;
    $("twinExplainResult").dataset.verdict = result.verdict;
    $("twinExplainResult").classList.remove("hidden");
    // A right reason ends it; otherwise the student can have another go.
    $("twinExplainInput").disabled = result.verdict === "right";
    $("twinExplainButton").disabled = result.verdict === "right";
  } catch (error) {
    if (error.status === 503 && /set up/.test(error.message)) {
      // No Gemini on this server: explaining is simply not offered.
      explainingAvailable = false;
      $("twinExplainForm").classList.add("hidden");
      return;
    }
    $("twinExplainResult").textContent = error.message;
    $("twinExplainResult").dataset.verdict = "error";
    $("twinExplainResult").classList.remove("hidden");
    $("twinExplainButton").disabled = false;
  } finally {
    $("twinExplainButton").textContent = "Explain";
  }
}

function listenForExplanation() {
  const recognition = new SpeechRecognition();
  recognition.lang = navigator.language || "en-GB";
  recognition.interimResults = false;
  $("twinMicButton").disabled = true;
  $("twinMicButton").lastChild.textContent = "Listening…";
  recognition.onresult = (event) => {
    $("twinExplainInput").value = event.results[0][0].transcript.slice(0, 300);
  };
  recognition.onend = () => {
    $("twinMicButton").disabled = false;
    $("twinMicButton").lastChild.textContent = "Say it";
    $("twinExplainInput").focus();
  };
  recognition.start();
}

async function loadTwinLesson() {
  showTwinError("");
  twin.lesson = null;
  twin.selectedIndex = null;
  twin.solved = false;

  $("twinLines").innerHTML = "";
  $("twinQuestion").textContent = "";
  $("twinFixForm").classList.add("hidden");
  $("twinResult").classList.add("hidden");
  $("twinExplainForm").classList.add("hidden");
  $("twinNextButton").classList.add("hidden");
  $("twinInstruction").classList.remove("hidden");
  $("twinMistakeLabel").textContent = "Getting ready…";
  setTwinSays("Let me show you how I solved this…");

  try {
    const data = await api("/api/twin/lesson", {
      method: "POST",
      body: JSON.stringify({
        studentId: state.studentId,
        excludeQuestionIds: twin.seenQuestionIds,
        // Lets the server alternate habit lessons with mixed-step ones.
        lessonNumber: twin.lessonNumber
      })
    });
    twin.lessonNumber += 1;
    twin.lesson = data.lesson;
    twin.mode = data.mode || "habit";
    twin.seenQuestionIds.push(data.lesson.questionId);
    renderTwinLesson(data.lesson, data.personalised, twin.mode);
    twin.progress = data.progress;
    twin.reviewing = data.reviewing;
    renderTwinProgress(data.progress, data.reviewing, twin.mode);
  } catch (error) {
    setTwinSays("Hmm, I can't find my notebook right now.");
    showTwinError(error.message || "Could not load a lesson. Please try again.");
  }
}

function renderTwinLesson(lesson, personalised, mode) {
  const isMixed = mode === "mixed";
  // A mixed lesson doesn't name the mistake: finding the step is the point.
  $("twinMistakeLabel").textContent = isMixed
    ? "Mixed lesson: the mistake could be in any step"
    : `Struggles with: ${TWIN_MISTAKE_NAMES[lesson.misconceptionType] || conceptName(lesson.misconceptionType)}`;
  $("twinPersonalBadge").classList.toggle("hidden", !personalised || isMixed);
  $("twinQuestion").textContent = lesson.question;
  setTwinSays(isMixed
    ? `I tried a new problem and got ${lesson.twinAnswer}. I think I slipped somewhere. Can you find it?`
    : `I got ${lesson.twinAnswer}. Can you check my working?`);

  const list = $("twinLines");
  list.innerHTML = "";
  lesson.lines.forEach((line, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "twin-line";
    button.dataset.index = String(index);

    const number = document.createElement("span");
    number.className = "twin-line-number";
    number.textContent = String(index + 1);

    const text = document.createElement("code");
    text.className = "twin-line-text";
    text.textContent = line;

    button.append(number, text);
    if (index === 0) {
      // The question itself; never the mistake.
      button.disabled = true;
      button.classList.add("twin-line-given");
      button.setAttribute("aria-label", `Line 1, the question: ${line}`);
    } else {
      button.setAttribute("aria-label", `Line ${index + 1}: ${line}`);
    }
    item.append(button);
    list.append(item);
  });
}

// How far the twin has come with this student (saved between visits).
function renderTwinProgress(progress, reviewing, mode = "habit") {
  const box = $("twinProgress");
  if (!progress || !progress.totalCount) {
    box.classList.add("hidden");
    return;
  }

  const { learnedCount, totalCount, current } = progress;
  $("twinProgressText").textContent =
    totalCount === 1
      ? (learnedCount === 1
        ? "Your twin has learned your mistake"
        : "Your twin is learning your mistake")
      : learnedCount === totalCount
        ? `Your twin has learned all ${totalCount} of your mistakes`
        : `Your twin has learned ${learnedCount} of ${totalCount} of your mistakes`;

  $("twinProgressHabit").textContent = mode === "mixed"
    ? "Mixed lesson"
    : reviewing
    ? "Review lesson"
    : current
      ? `This habit: ${current.taught} of ${current.needed} lessons`
      : "";

  $("twinProgressFill").style.width =
    `${Math.round((learnedCount / totalCount) * 100)}%`;
  box.classList.remove("hidden");
}

function twinLineButton(index) {
  return $("twinLines").querySelector(`.twin-line[data-index="${index}"]`);
}

// Feedback shown on the tapped line itself, where the student is looking
// (the twin's speech bubble may be scrolled out of view).
function setTwinLineNote(button, text, kind) {
  let note = button.querySelector(".twin-line-note");
  if (!note) {
    note = document.createElement("span");
    note.className = "twin-line-note";
    button.append(note);
  }
  note.textContent = text;
  note.dataset.kind = kind;
}

const TWIN_MISTAKE_NAMES = {
  failed_to_distribute: "Forgetting to multiply every term in the brackets",
  sign_error: "Mixing up + and − signs",
  wrong_inverse_op: "Using the wrong inverse operation",
  one_sided_op: "Changing only one side of the equation",
  combining_unlike_terms: "Combining terms that aren't alike",
  arithmetic_slip: "Small calculation slips"
};

async function chooseTwinLine(index) {
  if (!twin.lesson || twin.solved) return;
  showTwinError("");

  for (const button of $("twinLines").querySelectorAll(".twin-line")) {
    button.classList.remove("twin-line-selected");
  }
  const button = twinLineButton(index);
  button.classList.add("twin-line-selected");

  try {
    const result = await api("/api/twin/check", {
      method: "POST",
      body: JSON.stringify({
        questionId: twin.lesson.questionId,
        misconceptionType: twin.lesson.misconceptionType,
        variant: twin.lesson.variant,
        chosenIndex: index
      })
    });
    setTwinSays(result.twinSays);

    if (!result.foundMistake) {
      button.classList.remove("twin-line-selected");
      button.classList.add("twin-line-fine");
      setTwinLineNote(button, "This line is fine, look again", "fine");
      $("twinFixForm").classList.add("hidden");
      twin.selectedIndex = null;
      return;
    }

    twin.selectedIndex = index;
    button.classList.add("twin-line-found");
    setTwinLineNote(button, "Your twin went wrong here", "found");
    $("twinInstruction").classList.add("hidden");
    $("twinFixLabel").textContent = `How should line ${index + 1} look?`;
    $("twinFixInput").value = twin.lesson.lines[index];
    $("twinFixForm").classList.remove("hidden");
    $("twinFixInput").focus();
    $("twinFixInput").select();
  } catch (error) {
    showTwinError(error.message || "Could not check that line.");
  }
}

async function teachTwin(event) {
  event.preventDefault();
  if (!twin.lesson || twin.solved || twin.selectedIndex === null) return;

  const correctedLine = $("twinFixInput").value.trim();
  if (!correctedLine) {
    $("twinFixInput").focus();
    return;
  }

  $("twinTeachButton").disabled = true;
  showTwinError("");

  try {
    const result = await api("/api/twin/check", {
      method: "POST",
      body: JSON.stringify({
        studentId: state.studentId,
        questionId: twin.lesson.questionId,
        misconceptionType: twin.lesson.misconceptionType,
        variant: twin.lesson.variant,
        chosenIndex: twin.selectedIndex,
        correctedLine
      })
    });
    setTwinSays(result.twinSays);

    if (!result.fixedIt) {
      // Shown above the input, where the student is looking.
      $("twinFixLabel").textContent = `Your twin says: “${result.twinSays}”`;
      $("twinFixInput").classList.remove("twin-shake");
      void $("twinFixInput").offsetWidth;  // restart the animation
      $("twinFixInput").classList.add("twin-shake");
      return;
    }

    twin.solved = true;
    twin.taughtCount += 1;
    loadMotivation();

    const button = twinLineButton(twin.selectedIndex);
    button.classList.remove("twin-line-selected", "twin-line-found");
    button.classList.add("twin-line-fixed");
    button.querySelector(".twin-line-note")?.remove();
    const fixed = document.createElement("span");
    fixed.className = "twin-line-correction";
    fixed.textContent = `→ ${correctedLine}`;
    button.append(fixed);

    for (const line of $("twinLines").querySelectorAll(".twin-line")) {
      line.disabled = true;
    }

    $("twinFixForm").classList.add("hidden");
    twin.correctedLine = correctedLine;
    showExplainForm();

    const memory = result.memory;
    let progressNote = "";
    if (memory?.justLearned) {
      progressNote = "Your twin has learned this mistake for good. Next time it will need help with something new.";
    } else if (twin.mode === "mixed") {
      progressNote = "Great spotting! That slip was in a different step from your usual mistake.";
    } else if (memory?.remembered && memory.counted) {
      const left = memory.needed - memory.taught;
      progressNote = `Your twin will remember this. ${left} more lesson${left === 1 ? "" : "s"} and it will have learned this mistake.`;
    } else if (memory && memory.remembered === false) {
      progressNote = "Your twin couldn't save this lesson right now, but you still taught it well.";
    }

    $("twinResult").classList.toggle("twin-result-learned", Boolean(memory?.justLearned));
    $("twinResult").querySelector("strong").textContent = memory?.justLearned
      ? "Your twin learned it"
      : "You taught your twin";
    $("twinResultText").textContent =
      `The right answer is ${result.correctAnswer}. ${progressNote}`.trim();
    $("twinResult").classList.remove("hidden");

    // Keep the headline, bar and habit line consistent with what was saved.
    if (memory?.remembered && memory.counted && twin.progress?.current &&
        twin.lesson.misconceptionType === twin.progress.current.type) {
      twin.progress.current.taught = memory.taught;
      if (memory.justLearned && !twin.progress.current.learned) {
        twin.progress.current.learned = true;
        twin.progress.learnedCount += 1;
      }
      renderTwinProgress(twin.progress, false);
      if (memory.justLearned) {
        $("twinProgressHabit").textContent = "Learned";
      }
    }
    $("twinNextButton").classList.remove("hidden");
    $("twinNextButton").focus();
  } catch (error) {
    showTwinError(error.message || "Could not check your correction.");
  } finally {
    $("twinTeachButton").disabled = false;
  }
}

// ------------------------------------------------------------
// The Twin Effect (dashboard)
// ------------------------------------------------------------
// For each mistake the student has taught their twin: how often they made
// it in their own practice before teaching started, and how often since.

function percent(rate) {
  return `${Math.round((rate || 0) * 100)}%`;
}

function twinEffectRate(label, stats) {
  const width = Math.max(stats.rate ? 3 : 0, Math.round((stats.rate || 0) * 100));
  return `
    <div class="twin-effect-rate">
      <span class="twin-effect-rate-label">${label}</span>
      <div class="twin-effect-track" aria-hidden="true"><div class="twin-effect-fill" style="width:${width}%"></div></div>
      <span class="twin-effect-rate-value">${stats.errors} in ${stats.attempts} answers (${percent(stats.rate)})</span>
    </div>`;
}

function renderTwinEffect(effects) {
  const card = $("twinEffectCard");
  if (!effects.length) {
    card.classList.add("hidden");
    return;
  }

  $("twinEffectList").innerHTML = effects.map((effect) => {
    const name = escapeHtml(TWIN_MISTAKE_NAMES[effect.type] || conceptName(effect.type));
    const badge = effect.learned
      ? `<span class="twin-effect-badge">Twin learned it</span>`
      : `<span class="twin-effect-badge twin-effect-badge-muted">Taught ${effect.taughtCount}×</span>`;

    let headline;
    let detail = "";
    switch (effect.status) {
      case "improved": {
        const drop = effect.before.rate > 0
          ? Math.round((1 - effect.after.rate / effect.before.rate) * 100)
          : 0;
        headline = `<strong class="twin-effect-good">Down ${drop}%</strong> since you started teaching your twin.`;
        detail = twinEffectRate("Before", effect.before) + twinEffectRate("Since", effect.after);
        break;
      }
      case "unchanged":
        headline = "About the same as before so far. Keep teaching and practising.";
        detail = twinEffectRate("Before", effect.before) + twinEffectRate("Since", effect.after);
        break;
      case "not_yet":
        headline = "Not lower yet. Teaching your twin a few more times can help it stick.";
        detail = twinEffectRate("Before", effect.before) + twinEffectRate("Since", effect.after);
        break;
      case "no_baseline":
        headline = "You started teaching before we had enough of your earlier answers to compare.";
        detail = twinEffectRate("Since", effect.after);
        break;
      default: // collecting
        headline = `Answer ${effect.attemptsNeeded} more question${effect.attemptsNeeded === 1 ? "" : "s"} on this topic to see your twin effect.`;
    }

    return `
      <div class="twin-effect-row">
        <div class="twin-effect-row-head"><span class="twin-effect-name">${name}</span>${badge}</div>
        <p class="twin-effect-headline">${headline}</p>
        ${detail}
      </div>`;
  }).join("");

  card.classList.remove("hidden");
}

async function openDashboard() {

  $("startPanel").classList.add("hidden");

  $("practicePanel").classList.add("hidden");

  $("twinPanel").classList.add("hidden");

  $("dashboardPanel").classList.remove("hidden");

  await loadDashboard();

  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });
}

function backToPractice() {
  showOnly(state.question ? "practicePanel" : "startPanel");
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

// ============================================================
// LIGHT / DARK THEME
// ============================================================
// Default follows the device. A choice made here is remembered and
// applied before the page draws (see the script in index.html).

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function currentTheme() {
  return document.documentElement.dataset.theme ||
    (darkQuery.matches ? "dark" : "light");
}

function updateThemeButton() {
  const dark = currentTheme() === "dark";
  $("themeIcon").setAttribute("href", dark ? "#i-sun" : "#i-moon");
  $("themeLabel").textContent = dark ? "Light mode" : "Dark mode";
  $("themeButton").setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
}

function toggleTheme() {
  const next = currentTheme() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem("studytwin_theme", next);
  } catch {
    // Private mode: the choice lasts for this visit only.
  }
  updateThemeButton();
}

// ============================================================
// MOTIVATION: daily goal, streak, twin growth
// ============================================================
// Counted in the student's own time zone from the times their
// answers were checked (profile.activity.checkedAt).

const DAILY_GOAL = 5;

function localDayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

// Today's count, and the run of consecutive days with at least one
// checked answer, ending today (or yesterday, if today has none yet).
function studyActivity(checkedAt, now = new Date()) {
  const days = new Set((checkedAt || []).map(localDayKey));
  const todayKey = localDayKey(now);
  const todayCount = (checkedAt || []).filter((time) => localDayKey(time) === todayKey).length;

  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!days.has(todayKey)) {
    day.setDate(day.getDate() - 1);
  }
  let streak = 0;
  while (days.has(localDayKey(day))) {
    streak += 1;
    day.setDate(day.getDate() - 1);
  }
  return { todayCount, streak, studiedToday: days.has(todayKey) };
}

function renderMotivation(profile) {
  const { todayCount, streak, studiedToday } = studyActivity(profile?.activity?.checkedAt);
  const done = todayCount >= DAILY_GOAL;

  $("goalRing").classList.toggle("is-done", done);
  $("goalProgress").style.strokeDashoffset =
    String(100 - Math.min(todayCount / DAILY_GOAL, 1) * 100);
  $("goalCount").textContent = String(Math.min(todayCount, 99));
  $("goalText").textContent = done
    ? "Today's goal done"
    : `${todayCount} of ${DAILY_GOAL} today`;

  $("streakText").textContent =
    streak >= 2
      ? `${streak}-day streak`
      : streak === 1
        ? (studiedToday ? "Day 1 of your streak" : "Answer one today to keep your streak")
        : "Answer one to start a streak";

  $("todayBlock").setAttribute(
    "aria-label",
    `${todayCount} of ${DAILY_GOAL} questions today. ${$("streakText").textContent}`
  );

  // Twin growth on the start screen.
  const growth = profile?.twinProgress;
  if (growth && growth.totalCount > 0) {
    $("twinGrowthText").textContent =
      growth.totalCount === 1
        ? (growth.learnedCount === 1 ? "Your twin has learned your mistake" : "Your twin is still learning your mistake")
        : `Your twin has learned ${growth.learnedCount} of ${growth.totalCount} of your mistakes`;
    $("twinGrowthFill").style.width =
      `${Math.round((growth.learnedCount / growth.totalCount) * 100)}%`;
    $("twinGrowth").classList.remove("hidden");
  } else {
    $("twinGrowth").classList.add("hidden");
  }
}

// ============================================================
// CLASS MEMBERSHIP
// ============================================================

async function renderClassMembership(membership) {
  if (!membership) {
    $("classJoined").classList.add("hidden");
    $("classJoin").classList.remove("hidden");
    return;
  }
  let className = membership.code;
  try {
    className = (await api(`/api/classes/${encodeURIComponent(membership.code)}`)).name;
  } catch {
    // Keep the code if the name can't be looked up.
  }
  $("classJoinedText").textContent = `In ${className} as ${membership.displayName}.`;
  $("classJoined").classList.remove("hidden");
  $("classJoin").classList.add("hidden");
}

async function setClass(code, displayName) {
  const data = await api(`/api/students/${encodeURIComponent(state.studentId)}/class`, {
    method: "POST",
    body: JSON.stringify({ code, displayName })
  });
  localStorage.setItem("studytwin_student_id", state.studentId);
  await renderClassMembership(data.classCode ? { code: data.classCode, displayName: data.displayName } : null);
}

async function joinClass(event) {
  event.preventDefault();
  $("classJoinError").classList.add("hidden");
  try {
    await setClass($("classCodeInput").value.trim(), $("classNameInput").value.trim());
  } catch (error) {
    $("classJoinError").textContent = error.message;
    $("classJoinError").classList.remove("hidden");
  }
}

async function leaveClass() {
  if (!confirm("Leave this class? Your teacher will no longer see your progress.")) return;
  try {
    await setClass(null);
  } catch (error) {
    showError(error.message);
  }
}

// A teacher's join link: ?class=ABC234 opens the form with the code filled in.
function prefillClassFromLink() {
  const code = new URLSearchParams(location.search).get("class");
  if (!code) return;
  $("classCodeInput").value = code.toUpperCase().slice(0, 8);
  $("classJoin").open = true;
}

// Homework from the student's class: what is left, and what is done.
function renderStudentHomework(homework) {
  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  // Unfinished work, plus finished work until its due date passes.
  const shown = homework.filter((a) => !a.finished || a.dueDate >= today);
  $("homeworkBox").classList.toggle("hidden", shown.length === 0);
  $("homeworkItems").innerHTML = shown.map((a) => {
    const due = new Date(`${a.dueDate}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    const status = a.finished
      ? `<span class="is-done">Done</span>`
      : `<span class="${a.dueDate < today ? "is-overdue" : ""}">${a.done} of ${a.count} done · ${a.dueDate < today ? "was due" : "due"} ${escapeHtml(due)}</span>`;
    return `
      <div class="homework-item">
        <div><strong>${a.count} questions on ${escapeHtml(conceptName(a.concept).toLowerCase())}</strong>${status}</div>
        ${a.finished ? "" : `<button class="ghost-button homework-start" type="button" data-concept="${escapeHtml(a.concept)}">${a.done ? "Carry on" : "Start"}</button>`}
      </div>`;
  }).join("");
}

async function loadMotivation() {
  try {
    const data = await api(`/api/students/${encodeURIComponent(state.studentId)}`);
    renderMotivation(data.profile);
    renderClassMembership(data.profile?.classMembership || null);
    renderStudentHomework(data.profile?.homework || []);
  } catch (error) {
    // A new student has no record yet: show an empty goal.
    if (error.status === 404) {
      renderMotivation(null);
    }
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

    // Nothing to show when everything works.
    $("connectionStatus").classList.add("hidden");
  } catch {
    $("connectionStatus").textContent =
      "StudyTwin can't be reached right now, so answers won't be saved. Check your connection and refresh.";
    $("connectionStatus").classList.remove("hidden");
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

for (const list of ["commonMistakesList", "curedMistakesList"]) {
  $(list).addEventListener("click", (event) => {
    const button = event.target.closest(".practice-mistake-button");
    if (!button) return;
    if (button.classList.contains("practice-topic-button")) {
      practiceTopic(button.dataset.concept);
      return;
    }
    practiceMisconception(
      button.dataset.concept,
      button.dataset.misconception
    );
  });
}

$("backToPracticeButton").addEventListener(
  "click",
  backToPractice
);

$("practiceNavButton").addEventListener("click", backToPractice);

$("twinStartButton").addEventListener("click", openTwin);
$("twinSidebarButton").addEventListener("click", openTwin);
$("twinBackButton").addEventListener("click", closeTwin);
$("twinNextButton").addEventListener("click", loadTwinLesson);
$("twinFixForm").addEventListener("submit", teachTwin);
$("twinExplainForm").addEventListener("submit", explainTwin);
$("twinMicButton").addEventListener("click", listenForExplanation);
$("twinLines").addEventListener("click", (event) => {
  const button = event.target.closest(".twin-line");
  if (!button || button.disabled) return;
  chooseTwinLine(Number(button.dataset.index));
});

$("workInput").addEventListener("input", scheduleLiveCheck);
$("liveSteps").addEventListener("click", (event) => {
  if (event.target.closest(".live-hint-button")) nextHint();
});
$("photoButton").addEventListener("click", () => $("photoInput").click());
$("photoInput").addEventListener("change", (event) => readPhoto(event.target.files?.[0]));

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

updateThemeButton();
$("themeButton").addEventListener("click", toggleTheme);
// Follow the device's light/dark setting until the student picks one.
darkQuery.addEventListener("change", updateThemeButton);

loadMotivation();

$("classJoinForm").addEventListener("submit", joinClass);
$("homeworkItems").addEventListener("click", (event) => {
  const button = event.target.closest(".homework-start");
  if (button) practiceTopic(button.dataset.concept);
});
$("leaveClassButton").addEventListener("click", leaveClass);
prefillClassFromLink();

// Installable app: works offline for pages; answers still need the network (see sw.js).
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
