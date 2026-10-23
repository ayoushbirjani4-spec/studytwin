
"""
StudyTwin - ML Prediction Script

Loads the trained Logistic Regression pipeline from model.pkl
and predicts the probability that a student will correctly
answer their next question.

Usage:

    python predict.py

Or import the function:

    from predict import predict_student
"""

from pathlib import Path
import pickle
import pandas as pd


# ============================================================
# PATH CONFIGURATION
# ============================================================

BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent

MODEL_PATH = (
    PROJECT_DIR
    / "model"
    / "model.pkl"
)


# ============================================================
# LOAD MODEL
# ============================================================

def load_model():
    """
    Load the trained StudyTwin ML model.
    """

    if not MODEL_PATH.exists():

        raise FileNotFoundError(
            f"Model not found at:\n{MODEL_PATH}\n\n"
            "Run train.py first."
        )

    with open(
        MODEL_PATH,
        "rb"
    ) as file:

        model = pickle.load(file)

    return model


# ============================================================
# PREDICTION FUNCTION
# ============================================================

def predict_student(
    difficulty,
    attempt_count,
    correct_rate,
    recent_accuracy,
    misconception_count,
    previous_correct,
    concept
):
    """
    Predict the probability that a student will
    correctly answer their next question.

    Parameters
    ----------
    difficulty : int
        Question difficulty: 1, 2, or 3

    attempt_count : int
        Number of previous attempts for this concept.

    correct_rate : float
        Historical accuracy for this concept.
        Example: 0.75 = 75%

    recent_accuracy : float
        Accuracy over recent attempts.

    misconception_count : int
        Number of detected misconceptions.

    previous_correct : int
        Whether the previous answer was correct.
        0 = incorrect
        1 = correct

    concept : str
        Algebra concept.

    Returns
    -------
    dict
        Prediction information.
    """

    # --------------------------------------------------------
    # Load trained model
    # --------------------------------------------------------

    model = load_model()

    # --------------------------------------------------------
    # Create input DataFrame
    # --------------------------------------------------------

    student_data = pd.DataFrame(
        [
            {
                "difficulty": difficulty,
                "attempt_count": attempt_count,
                "correct_rate": correct_rate,
                "recent_accuracy": recent_accuracy,
                "misconception_count": misconception_count,
                "previous_correct": previous_correct,
                "concept": concept,
            }
        ]
    )

    # --------------------------------------------------------
    # Make prediction
    # --------------------------------------------------------

    prediction = model.predict(
        student_data
    )[0]

    # Probability of class 1 = correct
    probability = model.predict_proba(
        student_data
    )[0][1]

    # --------------------------------------------------------
    # Determine recommended difficulty
    # --------------------------------------------------------

    if probability < 0.40:

        recommended_difficulty = max(
            1,
            difficulty - 1
        )

        recommendation = (
            "Student may need an easier "
            "targeted question."
        )

    elif probability < 0.75:

        recommended_difficulty = difficulty

        recommendation = (
            "Keep the student at the "
            "current difficulty."
        )

    else:

        recommended_difficulty = min(
            3,
            difficulty + 1
        )

        recommendation = (
            "Student appears ready for "
            "a harder question."
        )

    # --------------------------------------------------------
    # Return result
    # --------------------------------------------------------

    return {
        "prediction": int(prediction),

        "probability_correct": round(
            float(probability),
            4
        ),

        "probability_percent": round(
            float(probability) * 100,
            2
        ),

        "recommended_difficulty": (
            recommended_difficulty
        ),

        "recommendation": recommendation,
    }


# ============================================================
# COMMAND-LINE TEST
# ============================================================

def main():

    print()
    print("=" * 65)
    print("STUDYTWIN ML PREDICTION")
    print("=" * 65)

    print()
    print("Loading model...")

    try:

        load_model()

        print("✓ Model loaded successfully.")

    except FileNotFoundError as error:

        print()
        print("ERROR:")
        print(error)

        return

    # --------------------------------------------------------
    # Example student
    # --------------------------------------------------------

    print()
    print("Testing example student...")

    result = predict_student(

        difficulty=2,

        attempt_count=5,

        correct_rate=0.40,

        recent_accuracy=0.33,

        misconception_count=2,

        previous_correct=0,

        concept="distributive_property",
    )

    # --------------------------------------------------------
    # Display prediction
    # --------------------------------------------------------

    print()
    print("-" * 65)

    print(
        f"Probability of correct answer: "
        f"{result['probability_percent']}%"
    )

    print(
        f"Prediction: "
        f"{'CORRECT' if result['prediction'] == 1 else 'INCORRECT'}"
    )

    print(
        f"Current difficulty: "
        f"{2}"
    )

    print(
        f"Recommended difficulty: "
        f"{result['recommended_difficulty']}"
    )

    print(
        f"Recommendation: "
        f"{result['recommendation']}"
    )

    print("-" * 65)

    print()
    print("Prediction completed.")


# ============================================================
# ENTRY POINT
# ============================================================

if __name__ == "__main__":

    main()

