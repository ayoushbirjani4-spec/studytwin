# StudyTwin

StudyTwin is an adaptive math-practice demo. The browser talks to an Express API; student progress is stored in MongoDB, and a separate FastAPI service can provide ML recommendations and step-classifier signals.

## Run locally

1. Install Node.js 20 or newer and Python 3.10 or newer.
2. Copy `Server/.env.example` to `Server/.env`. Set `MONGODB_URI` for persistent progress, **or** set `MEMORY_STORE=1` for a local demo without MongoDB. Never commit `.env` or credentials.
3. Install server dependencies from the project root:

   ```powershell
   npm install
   ```

4. Start the API:

   ```powershell
   npm start
   ```

5. Optionally start the Python ML API from `ML` in another terminal:

   ```powershell
   python -m pip install fastapi uvicorn pandas scikit-learn
   uvicorn api:app --host 127.0.0.1 --port 8000
   ```

   If the ML API is unavailable, the Node service uses a simple accuracy-based recommendation. ML predictions are supporting signals, not validated assessments of a learner.
6. The Express server also serves the frontend as static files, so opening `http://localhost:3000` is enough.

## ML model

The trained model file (`model/model.pkl`) is excluded from the repository because `.gitignore` omits all `*.pkl` files. After a fresh clone you must retrain it before starting the ML service:

```powershell
cd ML
python model.py
```

`model.py` reads `data/studytwin_ml_training_data.csv`, trains a Logistic Regression pipeline, and writes the model to `model/model.pkl`. The training data **is** checked in, so no data download is needed. Required packages: `pandas scikit-learn`.

## MongoDB progress storage

The server stores each student document in the `student_progress` collection of `MONGODB_DB_NAME` (default: `studytwin`). Each browser gets its own random student id and session token generated in `localStorage`.

Starting a session, submitting an answer, reading either profile endpoint, and resetting a student require the `X-Student-Token` header. Missing or mismatched tokens are rejected with HTTP 403. The frontend sends the token automatically on every request. Profiles created before token binding are denied rather than exposed by student ID.

This is a demo-level browser-session check, **not authentication**. The token is stored in browser local storage and protects against accidental access by someone who only knows a student ID; it does not establish a verified identity or protect against a compromised browser. Do not collect real student data or expose the demo publicly without server-side authentication and authorization.

The attempt-export API is disabled unless `ATTEMPT_EXPORT_TOKEN` is configured. When enabled, send it in the `X-Admin-Token` header. The CLI export command accesses MongoDB directly and should be run only by an authorized operator.

Raw submissions (answer, work, labels) append to the separate `student_attempts` collection for labeling and evaluation. Export them with:

```powershell
npm run export-attempts -- --format csv --out attempts.csv
```

For blind labeling (system labels omitted, empty `gold` column added):

```powershell
npm run export-attempts -- --blind --format csv --out to_label.csv
```

With `MEMORY_STORE=1`, progress and attempts stay in memory until the process exits (fine for local demos). The export script reads from MongoDB and will see zero rows in memory-store mode.

## Personalized learning dashboard

The dashboard (click **View My Progress** in the sidebar) shows:

- **Demonstrated mastery** (correct answer and sound work) and **final-answer accuracy** (numerical answer correctness), alongside learning level and misconception count.
- **Common mistakes** with the most affected concept and recurrence count.
- **Next learning step** — the concept that needs the most attention right now, with an explanation of why, plus a **Practice this skill** button that immediately starts a targeted session at the recommended difficulty.
- **Concept mastery** — a progress bar per concept, showing accuracy and current difficulty.
- **Concepts needing most practice** — the same list ranked by accuracy, showing the count of detected errors per concept.
- **Recent attempts** — the last five submissions with concept, difficulty, result, and the mistake label if one was detected.
- **StudyTwin recommendation** — a plain-language summary derived from overall accuracy.

## Adaptive learning loop

After each answer, the ML model (or heuristic fallback) estimates the probability of the student answering correctly at the current difficulty. The system then:

- **Decreases difficulty** if the probability is below 40 %, so the student gets stabilising practice.
- **Holds difficulty** if the probability is between 40 % and 75 %, to consolidate the current level.
- **Increases difficulty** if the probability exceeds 75 %, to keep the student challenged.

The feedback panel shows the current probability, the resulting difficulty change, and the ML recommendation text after every submission.

If a student is repeatedly making a distribution error, the dashboard's **Next learning step** card identifies that pattern, explains it, and the **Practice this skill** button starts a Distributive Property session at the student's current difficulty. As accuracy improves, the ML raises the difficulty automatically.

## LLM step review

Set `LLM_API_URL`, `LLM_API_KEY`, and `LLM_MODEL` to enable the OpenAI-compatible chat-completions review. It helps interpret submitted work, including arrow chains, prose, and parser-readable equations, and can suggest one of these five step labels:

- `sign_error`
- `wrong_inverse_op`
- `one_sided_op`
- `combining_unlike_terms`
- `arithmetic_slip`

Final-answer correctness is determined locally by deterministic comparison; the LLM cannot mark a wrong answer correct or a correct answer wrong. If its response does not identify a permitted label and an exact submitted line, deterministic rules and then ML supporting signals still analyze the work. LLM corrections are displayed only when the equation parser confirms they are equivalent to the preceding submitted equation and distinct from the invalid step. Otherwise, feedback uses a hint without presenting an unverified correction. The service sends the question, submitted answer, correct answer, and at most 4,000 characters of work to the configured provider; it does not send the student ID. Do not enable a provider unless its data-handling terms are suitable for the students using the app.

After submission, feedback shows the identified incorrect line, an equivalent corrected step when the rule path is known, an explanation, and a targeted hint. The submitted work and worked solution are returned with the submission response; answer and solution content are not included when the question is first loaded. A correct final answer with a detected error in the written work is not counted as demonstrated mastery. If there is no work to inspect, the app asks the student to show steps rather than inventing a diagnosis.

## Reliability and privacy

**MongoDB unavailable during submission.** If the student store raises a connection error (ECONNREFUSED, MongoServerSelectionError, or similar), `POST /api/sessions/answer` returns HTTP 503 with `success: false` and `persisted: false`. The frontend shows a clear "your answer could not be saved" message rather than a generic error. The student is not told their answer was recorded when it was not.

**Express server unavailable.** The frontend's `api()` helper catches network errors and shows a user-facing message. The connection pill in the top-right updates to "API offline" via the `/health` ping on load.

**Demo-level profile isolation.** Session creation, answer submission, profile reads (including concept profiles), and resets require a matching `X-Student-Token` header. The public attempt-export API is disabled unless an `ATTEMPT_EXPORT_TOKEN` is configured. These checks reduce accidental cross-profile access, but they are not user authentication or a substitute for server-side authorization.

**Anonymous demo profiles.** Each browser independently generates a UUID student ID and a separate session token on first load, persisted in `localStorage`. There is no shared login and no name or email collected. A user can still manipulate browser state or make direct API requests; do not use this setup for real student data.

## Deploy to Vercel

The repository includes Vercel configuration for the static frontend and a serverless Express API. In Vercel, import the project with the project root set to this directory, then configure these environment variables before deploying:

- `MONGODB_URI` (required; use a MongoDB Atlas connection string)
- `MONGODB_DB_NAME` (optional; defaults to `studytwin`)
- `ATTEMPT_EXPORT_TOKEN` (optional; required to enable the protected attempt-export API)
- `LLM_API_URL`, `LLM_API_KEY`, `LLM_MODEL` (optional)
- `ML_API_URL` (optional; point it to a separately hosted FastAPI ML service)

Deploy with the Vercel CLI (`vercel --prod`) or the Vercel dashboard. Vercel does not host the included FastAPI service through this configuration. If no reachable `ML_API_URL` is provided, adaptive recommendations use the heuristic fallback. Never commit credentials or add them to frontend code.

## Rate limiting

`POST /api/sessions/answer` is rate-limited per client IP (defaults: 30 requests/minute and 200 requests/day). Override with `RATE_LIMIT_ANSWER_PER_MIN` and `RATE_LIMIT_ANSWER_DAILY`.

The limiter reads the client IP from the **last** entry in `X-Forwarded-For`, which is appended by the platform and cannot be spoofed by the client. On a direct connection it falls back to the socket address.

The counters are in-memory. On Vercel each serverless instance has its own counters, so they do not accumulate across instances. For a shared persistent counter, replace `windowCount()` in `Server/middleware/rateLimit.js` with an atomic increment against Upstash Redis or MongoDB. Enable the LLM only after confirming rate limits work end-to-end.

## Evaluation

Run automated checks from the project root:

```powershell
npm test
npm run eval
```

`npm run eval` runs three hand-written sets with the LLM disabled. Results as of 22 October 2026:

| Set | Cases | Final-answer accuracy | Exact misconception label | Notes |
|-----|------:|----------------------:|-------------------------:|-------|
| Main | 63 | 100% | 100% | Written alongside rule development |
| Stress | 24 | 100% | 100% | Designed to break the rules; rules fixed against them |
| Unseen | 31 | 100% | 100% | Written independently, not used during tuning |

**Important:** All three sets score 100% and that metric is now saturated. The cases were written by the same person who wrote the detection rules. Treat `npm run eval` as a **regression guard**, not proof of generalization to real students. The meaningful benchmark is real student work collected, exported blind, and labeled by a second person (see below).

### Real-data benchmark (the meaningful number)

1. Collect attempts by running the server with `MONGODB_URI` set and having classmates use the app.
2. Export a blind copy (system labels hidden):

   ```powershell
   npm run export-attempts -- --blind --format csv --out to_label.csv
   ```

3. Open `to_label.csv` and fill in the empty `gold` column for each row. Valid labels: `correct`, `failed_to_distribute`, `sign_error`, `wrong_inverse_op`, `one_sided_op`, `arithmetic_slip`, `combining_unlike_terms`, `no_evidence`. Leave rows blank to skip them.

4. Score against the real data:

   ```powershell
   npm run eval -- --real-data to_label.csv
   ```

This is the number to quote when discussing how well the system generalises to real students.

## Demo journey

The following five-step sequence demonstrates the complete adaptive loop. You can run it with `MEMORY_STORE=1` (no MongoDB needed) and the ML service either running or offline (the heuristic fallback covers both).

**Step 1 — Student answers a question and shows their working.**

Open `http://localhost:3000`. Select *Distributive Property*, difficulty *Easy*, and click **Start Practice**. You'll see a question like `Solve: 2(x + 3) = 14`. Enter a wrong answer and work that contains a distribution error, for example:

```
Answer: 5
Work:
2(x+3)=14
2x+3=14
2x=11
x=5.5
```

**Step 2 — StudyTwin identifies the mathematical mistake.**

Click **Check Answer**. The feedback panel highlights:

- The misconception type: *Failed to distribute*
- The incorrect step: `2x+3=14`
- The correct step: `2x+6=14`
- An explanation: "Multiply both x and +3 by 2."

**Step 3 — The student receives a correction and explanation.**

The amber *Misconception Detected* box shows the targeted hint: "Distribute 2 to BOTH terms inside the parentheses." The worked solution below confirms the correct path.

**Step 4 — The next question adapts to their performance.**

The *StudyTwin prediction* card shows a low probability (e.g. 28 %), so the next difficulty stays at Easy or steps down. Click **Continue to Next Question** — the difficulty badge confirms the adapted level.

**Step 5 — The dashboard records progress and recommends what to learn next.**

Click **View My Progress**. The dashboard shows:

- Overall accuracy and learning level.
- Separate final-answer accuracy and demonstrated mastery.
- *Common mistakes*: "Failed to distribute — 1×"
- *Next learning step*: "Distributive Property — Targeted practice will help fix this pattern."
- A **Practice this skill** button that immediately restarts a Distributive Property session at the recommended difficulty.

After a few sessions on the same concept, the misconception count falls and accuracy rises. The ML raises the difficulty and the next-step recommendation shifts to a different concept.

## Limitations

- The student-model training data is synthetic. It does not establish generalization to real learners or classrooms.
- All three hand-written evaluation sets score 100%; that is a regression guard, not proof of generalization. Use exported and labeled real attempts for an unbiased benchmark.
- The LLM review is optional, has not been benchmarked on real student data, can make mistakes, and depends on the configured provider. It cannot determine final-answer correctness; it can still produce inaccurate step labels or explanations.
- Exact step corrections depend on the supported rule checks or configured LLM review. Alternative valid methods and unclear work may not yield a specific correction.
- ML is supporting data for adaptation and step analysis; its probabilities and labels are not calibrated educational or high-stakes decisions.
- The in-memory rate limiter is per-process and resets when the process restarts. A shared classroom or NAT network shares one IP budget across all students.
- Progress is persisted in MongoDB; this demo does not include multi-user authentication beyond the per-browser session token. Do not expose real student records publicly without adding proper authentication.
- The Vercel setup hosts the Node API and frontend only. The Python ML API must be hosted separately if its predictions are needed.
- `model/model.pkl` is not committed to the repository. Run `python ML/model.py` after cloning to retrain it.
