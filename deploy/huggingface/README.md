---
title: StudyTwin ML
emoji: 🧮
colorFrom: indigo
colorTo: blue
sdk: gradio
sdk_version: "6.31.0"
python_version: "3.12"
app_file: app.py
pinned: false
short_description: ML prediction API for the StudyTwin maths tutor
---

# StudyTwin ML service

FastAPI service used by the StudyTwin Node API:

- `GET /health` reports whether the service is up
- `POST /predict` predicts a student's chance of answering the next question correctly
- `POST /predict-step` classifies a single algebra step (e.g. `failed_to_distribute`)
- `/ui` is a small demo page for trying the step classifier

It runs on CPU; no GPU is requested even on ZeroGPU hardware.

This Space is built from the `ML/` folder of the StudyTwin repository by
`deploy/push_hf_space.sh`. Edit the code there, not here.
