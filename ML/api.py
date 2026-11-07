
"""
StudyTwin ML API

FastAPI service for the StudyTwin machine-learning model.

Run:
    uvicorn api:app --reload --port 8000

API documentation:
    http://127.0.0.1:8000/docs
"""

from pathlib import Path
import sys


# ============================================================
# 1. PROJECT PATH
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

# Make sure Python can find predict.py
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from predict_step import predict_step
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field


# ============================================================
# 2. IMPORT ML PREDICTION FUNCTION
# ============================================================

from predict import predict_student


# ============================================================
# 3. CREATE FASTAPI APPLICATION
# ============================================================

app = FastAPI(
    title="StudyTwin ML API",
    description=(
        "Machine Learning API for StudyTwin. "
        "Predicts a student's probability of answering "
        "the next question correctly and recommends "
        "an appropriate difficulty."
    ),
    version="1.0.0",
)


# ============================================================
# 4. REQUEST DATA MODEL
# ============================================================

class PredictionRequest(BaseModel):
    """
    Data received from the Node.js StudyTwin backend.
    """

    difficulty: int = Field(
        ...,
        ge=1,
        le=3,
        description="Question difficulty: 1 = Easy, 2 = Medium, 3 = Hard",
    )

    attempt_count: int = Field(
        ...,
        ge=0,
        description="Number of previous attempts",
    )

    correct_rate: float = Field(
        ...,
        ge=0,
        le=1,
        description="Historical accuracy from 0 to 1",
    )

    recent_accuracy: float = Field(
        ...,
        ge=0,
        le=1,
        description="Recent accuracy from 0 to 1",
    )

    misconception_count: int = Field(
        ...,
        ge=0,
        description="Number of detected misconceptions",
    )

    previous_correct: int = Field(
        ...,
        ge=0,
        le=1,
        description="Previous answer: 0 = incorrect, 1 = correct",
    )

    concept: str = Field(
        ...,
        min_length=1,
        description="Learning concept",
    )


# ============================================================
# 5. ROOT ENDPOINT
# ============================================================

@app.get("/")
def root():
    """
    Basic API information.
    """

    return {
        "name": "StudyTwin ML API",
        "status": "running",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
        "prediction": "/predict",
    }


# ============================================================
# 6. HEALTH CHECK
# ============================================================

@app.get("/health")
def health():
    """
    Health-check endpoint.

    Node.js uses this endpoint to determine whether
    the Python ML service is available.
    """

    return {
        "status": "healthy",
        "service": "studytwin-ml",
    }


# ============================================================
# 7. PREDICTION ENDPOINT
# ============================================================

@app.post("/predict")
def predict(request: PredictionRequest):
    """
    Predict whether the student will correctly answer
    their next question.

    Example request:

    {
        "difficulty": 2,
        "attempt_count": 5,
        "correct_rate": 0.4,
        "recent_accuracy": 0.33,
        "misconception_count": 2,
        "previous_correct": 0,
        "concept": "distributive_property"
    }
    """

    try:

        # ----------------------------------------------------
        # Send validated request data to the ML model
        # ----------------------------------------------------

        result = predict_student(
            difficulty=request.difficulty,
            attempt_count=request.attempt_count,
            correct_rate=request.correct_rate,
            recent_accuracy=request.recent_accuracy,
            misconception_count=request.misconception_count,
            previous_correct=request.previous_correct,
            concept=request.concept,
        )

        # ----------------------------------------------------
        # Return prediction
        # ----------------------------------------------------

        return {
            "success": True,
            "data": result,
        }

    except FileNotFoundError as error:

        raise HTTPException(
            status_code=500,
            detail=f"ML model not found: {str(error)}",
        )

    except Exception as error:

        raise HTTPException(
            status_code=500,
            detail=f"Prediction failed: {str(error)}",
        )




@app.post("/predict-step")
def predict_step_endpoint(data: dict):
    try:
        previous = data.get("previous_step", "")
        current = data.get("current_step", "")

        if not previous or not current:
            return {
                "success": False,
                "error": "previous_step and current_step are required"
            }

        result = predict_step(previous, current)

        return {
            "success": True,
            "data": result
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

# ============================================================
# 8. STARTUP MESSAGE
# ============================================================

@app.on_event("startup")
def startup_event():

    print()
    print("=" * 65)
    print("                 STUDYTWIN ML API")
    print("=" * 65)

    print("[OK] FastAPI application started")
    print("[OK] ML prediction service is ready")

    print()
    print("API:")
    print("  http://127.0.0.1:8000")

    print()
    print("Documentation:")
    print("  http://127.0.0.1:8000/docs")

    print()
    print("Health:")
    print("  GET  /health")

    print()
    print("Prediction:")
    print("  POST /predict")

    print("=" * 65)
    print()
