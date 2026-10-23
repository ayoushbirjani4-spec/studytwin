"""
StudyTwin Step Misconception Predictor
"""

import pickle
from pathlib import Path


# ============================================================
# 1. MODEL PATH
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

MODEL_PATH = BASE_DIR / "step_misconception_model.pkl"


# ============================================================
# 2. LOAD MODEL
# ============================================================

with open(MODEL_PATH, "rb") as file:
    model = pickle.load(file)


# ============================================================
# 3. PREDICT STEP
# ============================================================

def predict_step(
    previous_step,
    current_step,
    concept="distributive_property"
):

    text = (
        str(previous_step)
        + " -> "
        + str(current_step)
        + " "
        + str(concept)
    )

    prediction = model.predict([text])[0]

    probabilities = model.predict_proba([text])[0]

    classes = model.classes_

    probability_map = {
        label: float(probability)
        for label, probability in zip(
            classes,
            probabilities
        )
    }

    confidence = max(probability_map.values())

    return {
        "prediction": prediction,
        "confidence": round(confidence, 4),
        "probabilities": probability_map
    }


# ============================================================
# 4. TEST
# ============================================================

if __name__ == "__main__":

    tests = [

        {
            "previous": "4(x - 2) = 20",
            "current": "4x - 8 = 20",
        },

        {
            "previous": "4(x - 2) = 20",
            "current": "4x - 2 = 20",
        },

        {
            "previous": "4(x - 2) = 20",
            "current": "4x + 8 = 20",
        },

        {
            "previous": "4x - 8 = 20",
            "current": "4x = 28",
        },

        {
            "previous": "4x - 8 = 20",
            "current": "4x = 12",
        },
    ]


    print()
    print("=" * 60)
    print("       STUDYTWIN STEP ML TEST")
    print("=" * 60)


    for test in tests:

        result = predict_step(
            previous_step=test["previous"],
            current_step=test["current"]
        )

        print()
        print("Previous:", test["previous"])
        print("Current: ", test["current"])
        print("Prediction:", result["prediction"])
        print("Confidence:", result["confidence"])


    print()
    print("=" * 60)