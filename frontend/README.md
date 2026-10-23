# StudyTwin Frontend

This is the student-facing frontend for the existing StudyTwin Express API.

## Architecture

The frontend does not replace or modify the existing ML/server architecture.

Browser → `http://localhost:3000` Express API → Session Service → ML Service

## Start

1. Start the existing ML service.
2. Start the existing Express server:

```powershell
cd .\Server
node index.js
```

3. From the `frontend` folder, start a static server. For example:

```powershell
cd ..\frontend
python -m http.server 5500
```

4. Open:

`http://localhost:5500`

The frontend expects the API at `http://localhost:3000`.

## Current flow

- Start a study session with `POST /api/sessions`.
- Display the returned question without its answer or worked solution.
- Submit answer/work with `POST /api/sessions/answer`.
- Receive the correct answer and worked solution only in the submission response.
- Display correctness and feedback.
- Display detected misconception and hint when available.
- Display ML probability and recommended difficulty.
- Continue with the adaptive `nextQuestion` returned by the API.
- Reset the student's saved state with `DELETE /api/students/:studentId` and the browser's `X-Student-Token` header (stored in `localStorage` as `studytwin_student_token`).
