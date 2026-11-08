#!/usr/bin/env bash
# Publish the StudyTwin ML service to a Hugging Face Space (Gradio SDK).
#
#   bash deploy/push_hf_space.sh <hf-username>/<space-name>
#
# Builds the Space from the last *commit* (git archive), so uncommitted or
# git-ignored files such as Server/.env can never be uploaded. The Space's
# contents are replaced each time (force push); edit code in this repo only.
# Git asks for your Hugging Face username and an access token with write
# permission (huggingface.co/settings/tokens) the first time you push.
set -euo pipefail

SPACE="${1:?usage: bash deploy/push_hf_space.sh <hf-username>/<space-name>}"
ROOT="$(git rev-parse --show-toplevel)"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

cd "$ROOT"
git archive HEAD ML data | tar -x -C "$OUT"
# Gradio SDK Space (runs on free CPU or ZeroGPU hardware): app.py serves the
# FastAPI app from ML/api.py; README.md holds the Space configuration.
cp deploy/huggingface/README.md deploy/huggingface/app.py \
   deploy/huggingface/requirements.txt "$OUT/"
rm -rf "$OUT/ML/__pycache__"

cd "$OUT"
git init -q -b main
git lfs install --local >/dev/null
git lfs track "*.pkl" >/dev/null               # Hugging Face rejects plain binary files
git add .gitattributes .
git -c user.name="studytwin-deploy" -c user.email="deploy@studytwin.local" \
    commit -q -m "Deploy StudyTwin ML service from $(git -C "$ROOT" rev-parse --short HEAD)"

echo "Files going to the Space:"
git ls-files | sed 's/^/  /'

git push --force "https://huggingface.co/spaces/${SPACE}" main
echo "Pushed. Build progress: https://huggingface.co/spaces/${SPACE}"
