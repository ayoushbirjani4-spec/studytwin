"""Hugging Face Space entry point for the StudyTwin ML service.

Hugging Face runs this file (sdk: gradio). It starts a small Gradio demo with
demo.launch() (required on ZeroGPU hardware) and serves the existing FastAPI
endpoints from ML/api.py alongside it, so the Node API calls the same
/health, /predict and /predict-step as locally. Nothing here uses a GPU.
"""

import subprocess
import sys
from pathlib import Path

# ZeroGPU hardware refuses to start unless the app declares at least one
# @spaces.GPU function. The placeholder below is never called, so no GPU
# quota is used; all predictions run on CPU. On plain CPU hosts `spaces`
# is not installed and this is skipped.
try:
    import spaces
except ImportError:
    spaces = None

ROOT = Path(__file__).resolve().parent
STUDENT_MODEL = ROOT / "model" / "model.pkl"

# The student-performance model is trained from the bundled CSV (a few
# seconds) rather than shipped, exactly as the Docker image does.
if not STUDENT_MODEL.exists():
    subprocess.run([sys.executable, str(ROOT / "ML" / "model.py")], check=True)

sys.path.insert(0, str(ROOT))

import gradio as gr  # noqa: E402

from ML.api import app as api_app  # noqa: E402
from ML.predict_step import predict_step  # noqa: E402

API_PATHS = {"/health", "/predict", "/predict-step"}

if spaces is not None:
    @spaces.GPU
    def _zerogpu_placeholder():
        return None


def classify_step(previous_step, current_step):
    if not previous_step.strip() or not current_step.strip():
        return {"error": "Enter both steps."}
    return predict_step(previous_step, current_step)


with gr.Blocks(title="StudyTwin ML") as demo:
    gr.Markdown(
        "## StudyTwin step classifier\n"
        "API endpoints: `/health`, `/predict`, `/predict-step`."
    )
    previous = gr.Textbox(label="Previous step", value="2(x+3)=14")
    current = gr.Textbox(label="Next step", value="2x+3=14")
    result = gr.JSON(label="Prediction")
    gr.Button("Classify step").click(classify_step, [previous, current], result)


if __name__ == "__main__":
    # ssr_mode=False: otherwise Gradio puts a Node front server on the public
    # port that only forwards Gradio's own paths, hiding the API routes.
    demo.launch(prevent_thread_lock=True, ssr_mode=False)

    # Put the StudyTwin API routes ahead of Gradio's own routes so they win.
    api_routes = [
        route for route in api_app.router.routes
        if getattr(route, "path", None) in API_PATHS
    ]
    demo.app.router.routes[0:0] = api_routes
    print("StudyTwin API routes active:", sorted(route.path for route in api_routes))

    demo.block_thread()
