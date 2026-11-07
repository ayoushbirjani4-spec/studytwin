import pickle
from pathlib import Path
import pandas as pd

from step_features import (
    extract_features,
    is_valid_transformation,
    infer_operation,
)


MODEL_PATH = Path(__file__).resolve().parent / "step_misconception_model.pkl"


# ------------------------------------------------------------
# LOAD MODEL
# ------------------------------------------------------------

with open(MODEL_PATH, "rb") as file:
    bundle = pickle.load(file)

model = bundle["model"]
FEATURE_NAMES = bundle["feature_names"]


# ------------------------------------------------------------
# PREPARE FEATURES
# ------------------------------------------------------------

def prepare_features(previous, current, concept=None):

    # Original 25 feature set
    features = extract_features(
        previous,
        current,
        concept=concept
    )

    # IMPORTANT:
    # These two existed in the training CSV.
    features["is_valid"] = int(
        is_valid_transformation(
            previous,
            current
        )
    )

    features["operation"] = infer_operation(
        previous,
        current,
        concept
    )

    # Convert to dataframe
    df = pd.DataFrame([features])

    # One-hot encode exactly like training
    df = pd.get_dummies(df)

    # Guarantee exact training schema
    df = df.reindex(
        columns=FEATURE_NAMES,
        fill_value=0
    )

    return df


# ------------------------------------------------------------
# PREDICTION
# ------------------------------------------------------------

def predict_step(previous, current, concept=None):

    X = prepare_features(
        previous,
        current,
        concept
    )

    prediction = model.predict(X)[0]

    probabilities = model.predict_proba(X)[0]

    classes = model.classes_

    probability_map = {
        str(label): float(probability)
        for label, probability
        in zip(classes, probabilities)
    }

    confidence = max(probability_map.values())

    return {
        "prediction": str(prediction),
        "confidence": round(confidence, 4),
        "probabilities": {
            key: round(value, 4)
            for key, value in probability_map.items()
        },
        "mathematically_valid": bool(
            is_valid_transformation(
                previous,
                current
            )
        ),
        "operation": infer_operation(
            previous,
            current,
            concept
        ),
    }


# ------------------------------------------------------------
# TEST
# ------------------------------------------------------------

if __name__ == "__main__":

    tests = [

    # 6 — Correct distribution
    (
        "5(x + 4) = 35",
        "5x + 20 = 35",
        "distribution"
    ),

    # 7 — Failed distribution
    (
        "5(x + 4) = 35",
        "5x + 4 = 35",
        "distribution"
    ),

    # 8 — Correct negative distribution
    (
        "3(x - 6) = 18",
        "3x - 18 = 18",
        "distribution"
    ),

    # 9 — Distribution sign error
    (
        "3(x - 6) = 18",
        "3x + 18 = 18",
        "distribution"
    ),

    # 10 — Correct moving constant
    (
        "5x + 20 = 35",
        "5x = 15",
        "add_subtract_constants"
    ),

    # 11 — Wrong sign moving constant
    (
        "5x + 20 = 35",
        "5x = 55",
        "add_subtract_constants"
    ),

    # 12 — Correct subtraction
    (
        "7x - 12 = 30",
        "7x = 42",
        "add_subtract_constants"
    ),

    # 13 — Wrong subtraction
    (
        "7x - 12 = 30",
        "7x = 18",
        "add_subtract_constants"
    ),

    # 14 — Correct moving terms
    (
        "5x + 8 = 2x + 20",
        "3x = 12",
        "moving_terms"
    ),

    # 15 — Wrong coefficient
    (
        "5x + 8 = 2x + 20",
        "7x = 12",
        "moving_terms"
    ),

    # 16 — Wrong constant
    (
        "5x + 8 = 2x + 20",
        "3x = 28",
        "moving_terms"
    ),

    # 17 — Correct division
    (
        "5x = 15",
        "x = 3",
        "multiplication_division"
    ),

    # 18 — Wrong division
    (
        "5x = 15",
        "x = 75",
        "multiplication_division"
    ),

    # 19 — Correct negative solution
    (
        "-4x = 20",
        "x = -5",
        "multiplication_division"
    ),

    # 20 — Wrong negative handling
    (
        "-4x = 20",
        "x = 5",
        "multiplication_division"
    ),

    # 21 — Correct combining terms
    (
        "3x + 2x = 20",
        "5x = 20",
        "combining_terms"
    ),

    # 22 — Wrong combining terms
    (
        "3x + 2x = 20",
        "6x = 20",
        "combining_terms"
    ),

    # 23 — Correct combining terms with constant
    (
        "2x + 3x + 5 = 20",
        "5x + 5 = 20",
        "combining_terms"
    ),

    # 24 — Wrong combining terms
    (
        "2x + 3x + 5 = 20",
        "6x + 5 = 20",
        "combining_terms"
    ),

    # 25 — Correct sign change
    (
        "-5x = -20",
        "5x = 20",
        "sign_changes"
    ),

    # 26 — Sign error
    (
        "-5x = -20",
        "5x = -20",
        "sign_changes"
    ),
]
    print("\n" + "=" * 60)
    print("STUDYTWIN STEP MODEL TEST")
    print("=" * 60)

    for i, (previous, current, concept) in enumerate(
        tests,
        start=1
    ):

        result = predict_step(
            previous,
            current,
            concept
        )

        print(f"\nTest {i}")
        print("Previous :", previous)
        print("Current  :", current)
        print("Operation:", result["operation"])
        print(
            "Valid    :",
            result["mathematically_valid"]
        )
        print(
            "Prediction:",
            result["prediction"]
        )
        print(
            "Confidence:",
            result["confidence"]
        )
        print(
            "Probabilities:",
            result["probabilities"]
        )
