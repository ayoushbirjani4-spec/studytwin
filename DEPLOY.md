# Deploying StudyTwin

StudyTwin runs as three hosted pieces:

| Piece | Host | Config in this repo |
|---|---|---|
| Database | MongoDB Atlas (free M0 cluster) | none needed |
| ML service (FastAPI) | Render (free web service, Docker) | `render.yaml`, `ML/Dockerfile` |
| Node API + frontend | Vercel | `vercel.json`, `api/[...path].js` |

Do them in this order. Each later step needs a value from an earlier one.

---

## 0. Before you start

1. **Use a fresh Gemini key.** Revoke any key that has ever been in a file, chat or screenshot (Google AI Studio → API keys), then create a new one.
2. **Commit your work** and check that `Server/.env` is *not* tracked:
   ```bash
   git status --short
   git check-ignore Server/.env
   ```
   The second command must print `Server/.env`.
3. **Push to GitHub.** Create an empty repository on github.com (private is fine), then:
   ```bash
   git remote add origin https://github.com/<you>/studytwin.git
   git push -u origin master
   ```

## 1. MongoDB Atlas

1. Create a free **M0** cluster at cloud.mongodb.com.
2. **Database Access** → add a database user with a generated password.
3. **Network Access** → add `0.0.0.0/0`. Vercel functions do not have fixed IP addresses, so this is required; the database user's password is what protects it.
4. **Connect → Drivers** → copy the connection string. It looks like
   `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority`
   Keep it for step 3. The app creates its collections on first use.

## 2. ML service on Render

1. At dashboard.render.com: **New → Blueprint**, connect GitHub, pick this repository. Render reads `render.yaml` and creates `studytwin-ml`.
2. Wait for the first build (several minutes: it installs scikit-learn and trains the student model inside the image).
3. Open `https://<your-service>.onrender.com/health`. It should return `{"status":"healthy","service":"studytwin-ml"}`.
4. Keep that base URL (no trailing slash) for step 3.

Free Render instances sleep after about 15 minutes idle and take up to a minute to wake. During that time the app uses its heuristic prediction instead of the ML model (it waits `ML_TIMEOUT_MS`, default 5 seconds). Upgrade the instance if that matters for a demo, or open `/health` a minute beforehand.

## 3. Node API + frontend on Vercel

1. At vercel.com: **Add New → Project**, import the repository.
   - Framework preset: **Other**
   - Root directory: the repository root (leave as is)
   - Build and output settings: leave the defaults; `vercel.json` sets them.
2. Before the first deploy, open **Environment Variables** and add:

| Variable | Value | Required |
|---|---|---|
| `MONGODB_URI` | Atlas connection string from step 1 | Yes |
| `MONGODB_DB_NAME` | `studytwin` | Yes |
| `ML_API_URL` | Render base URL from step 2 | Yes, for ML predictions |
| `GEMINI_API_KEY` | your new Gemini key | Yes, for LLM review |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Recommended |
| `TRUST_PROXY_HOPS` | `1` | Recommended (rate limiting sees real client IPs behind Vercel's proxy) |
| `ATTEMPT_EXPORT_TOKEN` | a long random string | Only if you will export attempts for labelling |
| `ML_TIMEOUT_MS` | `5000` | Optional |
| `MONGODB_TIMEOUT_MS` | `5000` | Optional |
| `RATE_LIMIT_ANSWER_PER_MIN` / `RATE_LIMIT_ANSWER_DAILY` | `30` / `200` | Optional |

   Do **not** set `MEMORY_STORE` on Vercel. Leave `CORS_ORIGINS` empty: the frontend and API share one domain.

3. **Deploy.** Your app is at `https://<project>.vercel.app`.

## 4. Verify the deployment

Run these against the live site. A passing local test does not prove the hosted one works.

1. **ML from the hosted side.** From your machine:
   ```bash
   ML_API_URL=https://<your-service>.onrender.com npm run check:ml
   ```
2. **Full journey in a browser** on the Vercel URL:
   - Start practice, answer one question correctly and one with a mistake (e.g. `2x+3=14` for `2(x+3)=14`).
   - Feedback should name the mistake and show "StudyTwin prediction" without "(ML service offline)".
   - Open **View My Progress**: the attempts and mistake should be listed.
   - Reload the page: progress should still be there (it is in Atlas now).
3. **Atlas.** In Atlas → Browse Collections, `studytwin.student_progress` and `studytwin.student_attempts` should contain your test student.
4. **Reset.** Click **Reset Student**, confirm, and check both collections no longer contain that student.
5. **Gemini.** In Vercel → your project → Logs, look for `[LLM] Review succeeded` after a submission the rules cannot explain. Correct answers and rule-detected mistakes intentionally skip Gemini.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Student progress storage is unavailable" on every request | `MONGODB_URI` wrong, Atlas user/password wrong, or `0.0.0.0/0` missing from Network Access |
| Prediction always says "ML service offline" | `ML_API_URL` missing or has a trailing slash; Render service asleep or failed to build |
| `[LLM] Review skipped: no provider is configured` in logs | `GEMINI_API_KEY` not set for the Production environment |
| Gemini HTTP 400 in logs | `GEMINI_MODEL` names a model your key cannot use |
| Requests time out after 60 s | Gemini or Render very slow; check their status pages |

Changing an environment variable in Vercel needs a redeploy to take effect (**Deployments → ⋯ → Redeploy**).
