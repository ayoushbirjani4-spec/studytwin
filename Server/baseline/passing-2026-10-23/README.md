# StudyTwin passing baseline — 2026-10-23

This snapshot records the workspace before persistence, reset, trend, and targeted-practice changes.

Validation:
- `npm test`: 35 passed, 0 failed.
- `npm run eval`: 118 cases across main (63), stress (24), and unseen (31); final-answer checking 100%, false positives 0%, exact misconception labels 100% (65/65 diagnosable wrong answers), and all no-work cases did not guess.
- Full command output: `npm-test.txt` and `npm-eval.txt`.
- Per-case evaluation results: `last_results_main.json`, `last_results_stress.json`, and `last_results_unseen.json`.

Baseline data policy: reset currently removes the progress record only, and attempt rows can remain. The changes after this snapshot define reset as complete deletion of both progress and raw attempt history. `.env`, dependencies, and Python bytecode are excluded from Git. The packaged step-classifier model is included because the runtime uses it; the separately trained `model/model.pkl` is ignored.
