
"""
StudyTwin - Student Performance Prediction Model

This script trains a Logistic Regression model that predicts whether
a student will correctly answer their NEXT question.

Input:
    data/studytwin_ml_training_data.csv

Target:
    next_correct
        0 = incorrect
        1 = correct

Output:
    model/model.pkl

The saved model is a complete sklearn Pipeline containing:
    - preprocessing
    - one-hot encoding
    - feature scaling
    - logistic regression
"""

from pathlib import Path
import sys
import pickle

import numpy as np
import pandas as pd

from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.linear_model import LogisticRegression

from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    classification_report,
    confusion_matrix,
)


# ============================================================
# CONFIGURATION
# ============================================================

# Project root = folder containing the data and model folders
BASE_DIR = Path(__file__).resolve().parent
PROJECT_DIR = BASE_DIR.parent

# The CSV is stored in the data folder.
DATA_PATH = PROJECT_DIR / "data" / "studytwin_ml_training_data.csv"

MODEL_DIR = PROJECT_DIR / "model"
MODEL_PATH = MODEL_DIR / "model.pkl"

# Reproducibility
RANDOM_STATE = 42

# Test set size
TEST_SIZE = 0.20


# ============================================================
# FEATURE DEFINITIONS
# ============================================================

# Numerical features used by the model.
NUMERICAL_FEATURES = [
    "difficulty",
    "attempt_count",
    "correct_rate",
    "recent_accuracy",
    "misconception_count",
    "previous_correct",
]

# Categorical features.
CATEGORICAL_FEATURES = [
    "concept",
]

# Target variable.
TARGET = "next_correct"

# Columns that should NOT be used as predictive features.
# student_id is an identifier, not a meaningful learning feature.
EXCLUDED_COLUMNS = [
    "student_id",
]


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def print_section(title: str):
    """Print a clearly formatted section heading."""
    print()
    print("=" * 70)
    print(title)
    print("=" * 70)


def load_dataset(path: Path) -> pd.DataFrame:
    """Load and validate the training dataset."""

    print_section("1. Loading Dataset")

    if not path.exists():
        print(f"ERROR: Dataset not found:")
        print(f"       {path}")
        print()
        print("Expected structure:")
        print("studytwin/")
        print("├── train.py")
        print("└── data/")
        print("    └── studytwin_ml_training_data.csv")
        sys.exit(1)

    df = pd.read_csv(path)

    print(f"Dataset loaded successfully.")
    print(f"Rows:    {len(df):,}")
    print(f"Columns: {len(df.columns)}")

    return df


def validate_dataset(df: pd.DataFrame):
    """Check that the dataset contains everything required."""

    print_section("2. Validating Dataset")

    required_columns = (
        NUMERICAL_FEATURES
        + CATEGORICAL_FEATURES
        + [TARGET]
        + EXCLUDED_COLUMNS
    )

    missing_columns = [
        column
        for column in required_columns
        if column not in df.columns
    ]

    if missing_columns:
        print("ERROR: Missing required columns:")
        for column in missing_columns:
            print(f"  - {column}")
        sys.exit(1)

    # Check target values
    target_values = set(df[TARGET].dropna().unique())

    invalid_targets = target_values - {0, 1}

    if invalid_targets:
        print(
            f"ERROR: Target column '{TARGET}' contains "
            f"invalid values: {invalid_targets}"
        )
        sys.exit(1)

    # Check missing values
    missing_counts = df.isnull().sum()

    missing_counts = missing_counts[missing_counts > 0]

    if len(missing_counts) > 0:
        print("Missing values detected:")

        for column, count in missing_counts.items():
            print(f"  {column}: {count}")

        print()
        print("Filling missing numerical values with medians")
        print("and categorical values with the most frequent value.")

        for column in NUMERICAL_FEATURES:
            if column in df.columns:
                df[column] = df[column].fillna(df[column].median())

        for column in CATEGORICAL_FEATURES:
            if column in df.columns:
                mode = df[column].mode()

                if len(mode) > 0:
                    df[column] = df[column].fillna(mode.iloc[0])

    else:
        print("No missing values detected.")

    print("Dataset validation completed.")


def display_dataset_info(df: pd.DataFrame):
    """Display useful information about the dataset."""

    print_section("3. Dataset Overview")

    print("Columns:")
    for column in df.columns:
        print(f"  - {column}")

    print()
    print("Concept distribution:")

    concept_counts = df["concept"].value_counts()

    for concept, count in concept_counts.items():
        print(f"  {concept}: {count:,}")

    print()
    print("Target distribution:")

    target_counts = df[TARGET].value_counts().sort_index()

    total = len(df)

    for value, count in target_counts.items():
        percentage = (count / total) * 100

        label = "Correct" if value == 1 else "Incorrect"

        print(
            f"  {value} ({label}): "
            f"{count:,} ({percentage:.2f}%)"
        )


def prepare_data(df: pd.DataFrame):
    """Separate features X from target y."""

    print_section("4. Preparing Features")

    feature_columns = (
        NUMERICAL_FEATURES
        + CATEGORICAL_FEATURES
    )

    X = df[feature_columns].copy()
    y = df[TARGET].astype(int)

    print("Features used by the model:")

    for feature in feature_columns:
        print(f"  - {feature}")

    print()
    print(f"Number of features before encoding: {len(feature_columns)}")

    return X, y


def build_pipeline():
    """
    Build the complete preprocessing + ML pipeline.

    Numerical:
        StandardScaler

    Categorical:
        OneHotEncoder

    Model:
        LogisticRegression
    """

    print_section("5. Building ML Pipeline")

    numerical_transformer = Pipeline(
        steps=[
            (
                "scaler",
                StandardScaler(),
            )
        ]
    )

    categorical_transformer = Pipeline(
        steps=[
            (
                "onehot",
                OneHotEncoder(
                    handle_unknown="ignore"
                ),
            )
        ]
    )

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "numerical",
                numerical_transformer,
                NUMERICAL_FEATURES,
            ),
            (
                "categorical",
                categorical_transformer,
                CATEGORICAL_FEATURES,
            ),
        ]
    )

    classifier = LogisticRegression(
        max_iter=1000,
        random_state=RANDOM_STATE,
        class_weight="balanced",
    )

    pipeline = Pipeline(
        steps=[
            (
                "preprocessor",
                preprocessor,
            ),
            (
                "classifier",
                classifier,
            ),
        ]
    )

    print("Pipeline created:")
    print()
    print("Numerical features")
    print("        ↓")
    print("StandardScaler")
    print("        ↓")
    print("Categorical features")
    print("        ↓")
    print("OneHotEncoder")
    print("        ↓")
    print("Logistic Regression")

    return pipeline


def split_data(X, y):
    """Split data into training and testing sets."""

    print_section("6. Splitting Dataset")

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=TEST_SIZE,
        random_state=RANDOM_STATE,
        stratify=y,
    )

    print(f"Training samples: {len(X_train):,}")
    print(f"Testing samples:  {len(X_test):,}")

    print()
    print("Training target distribution:")
    print(y_train.value_counts(normalize=True).sort_index())

    print()
    print("Testing target distribution:")
    print(y_test.value_counts(normalize=True).sort_index())

    return X_train, X_test, y_train, y_test


def train_model(pipeline, X_train, y_train):
    """Train the Logistic Regression model."""

    print_section("7. Training Model")

    print("Training Logistic Regression...")

    pipeline.fit(X_train, y_train)

    print("Training completed successfully.")

    return pipeline


def evaluate_model(model, X_test, y_test):
    """Evaluate the trained model."""

    print_section("8. Model Evaluation")

    predictions = model.predict(X_test)

    probabilities = model.predict_proba(X_test)[:, 1]

    accuracy = accuracy_score(
        y_test,
        predictions,
    )

    precision = precision_score(
        y_test,
        predictions,
        zero_division=0,
    )

    recall = recall_score(
        y_test,
        predictions,
        zero_division=0,
    )

    f1 = f1_score(
        y_test,
        predictions,
        zero_division=0,
    )

    roc_auc = roc_auc_score(
        y_test,
        probabilities,
    )

    print("Performance:")
    print()
    print(f"Accuracy:  {accuracy:.4f}")
    print(f"Precision: {precision:.4f}")
    print(f"Recall:    {recall:.4f}")
    print(f"F1 Score:  {f1:.4f}")
    print(f"ROC-AUC:   {roc_auc:.4f}")

    print()
    print("Classification Report:")
    print()

    print(
        classification_report(
            y_test,
            predictions,
            target_names=[
                "Incorrect",
                "Correct",
            ],
            zero_division=0,
        )
    )

    print("Confusion Matrix:")
    print()

    matrix = confusion_matrix(
        y_test,
        predictions,
    )

    print(matrix)

    return {
        "accuracy": accuracy,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "roc_auc": roc_auc,
    }


def show_feature_importance(model):
    """
    Extract Logistic Regression coefficients.

    Positive coefficient:
        increases probability of correct answer.

    Negative coefficient:
        decreases probability of correct answer.
    """

    print_section("9. Feature Importance")

    try:
        preprocessor = model.named_steps[
            "preprocessor"
        ]

        classifier = model.named_steps[
            "classifier"
        ]

        feature_names = (
            preprocessor
            .get_feature_names_out()
        )

        coefficients = (
            classifier.coef_[0]
        )

        importance = pd.DataFrame(
            {
                "feature": feature_names,
                "coefficient": coefficients,
                "absolute_importance": np.abs(
                    coefficients
                ),
            }
        )

        importance = importance.sort_values(
            "absolute_importance",
            ascending=False,
        )

        print(
            "Most influential features:"
        )
        print()

        for _, row in importance.head(15).iterrows():

            direction = (
                "increases success probability"
                if row["coefficient"] > 0
                else "decreases success probability"
            )

            print(
                f"{row['feature']:<45} "
                f"{row['coefficient']:>8.4f} "
                f"→ {direction}"
            )

        return importance

    except Exception as error:

        print(
            "Could not extract feature importance."
        )

        print(
            f"Reason: {error}"
        )

        return None


def save_model(model):
    """Save the complete sklearn pipeline."""

    print_section("10. Saving Model")

    MODEL_DIR.mkdir(
        parents=True,
        exist_ok=True,
    )

    with open(
        MODEL_PATH,
        "wb",
    ) as file:

        pickle.dump(
            model,
            file,
        )

    print("Model saved successfully:")
    print()
    print(MODEL_PATH)

    print()
    print(
        "The saved model contains both "
        "preprocessing and Logistic Regression."
    )


def test_saved_model(model):
    """Run a sample prediction."""

    print_section("11. Example Prediction")

    sample_student = pd.DataFrame(
        [
            {
                "difficulty": 2,
                "attempt_count": 5,
                "correct_rate": 0.40,
                "recent_accuracy": 0.33,
                "misconception_count": 2,
                "previous_correct": 0,
                "concept": "distributive_property",
            }
        ]
    )

    prediction = model.predict(
        sample_student
    )[0]

    probability = model.predict_proba(
        sample_student
    )[0][1]

    label = (
        "CORRECT"
        if prediction == 1
        else "INCORRECT"
    )

    print("Example student:")
    print()
    print(sample_student.to_string(index=False))

    print()
    print(f"Predicted outcome: {label}")
    print(
        f"Probability of correct answer: "
        f"{probability:.2%}"
    )

    print()
    print(
        "This probability is what StudyTwin "
        "can use to adapt the next question."
    )


def main():
    """Main training pipeline."""

    print()
    print("=" * 70)
    print("STUDYTWIN ML TRAINING")
    print("Student Next-Question Performance Prediction")
    print("=" * 70)

    # 1. Load
    df = load_dataset(DATA_PATH)

    # 2. Validate
    validate_dataset(df)

    # 3. Dataset information
    display_dataset_info(df)

    # 4. Prepare features
    X, y = prepare_data(df)

    # 5. Build pipeline
    pipeline = build_pipeline()

    # 6. Split
    X_train, X_test, y_train, y_test = split_data(
        X,
        y,
    )

    # 7. Train
    pipeline = train_model(
        pipeline,
        X_train,
        y_train,
    )

    # 8. Evaluate
    metrics = evaluate_model(
        pipeline,
        X_test,
        y_test,
    )

    # 9. Feature importance
    importance = show_feature_importance(
        pipeline
    )

    # 10. Save
    save_model(pipeline)

    # 11. Example prediction
    test_saved_model(pipeline)

    # Final summary
    print_section("TRAINING COMPLETE")

    print("StudyTwin ML model is ready.")
    print()
    print(f"Model: Logistic Regression")
    print(f"Training rows: {len(X_train):,}")
    print(f"Testing rows: {len(X_test):,}")
    print()
    print(
        f"Accuracy:  {metrics['accuracy']:.4f}"
    )
    print(
        f"Precision: {metrics['precision']:.4f}"
    )
    print(
        f"Recall:    {metrics['recall']:.4f}"
    )
    print(
        f"F1 Score:  {metrics['f1']:.4f}"
    )
    print(
        f"ROC-AUC:   {metrics['roc_auc']:.4f}"
    )

    print()
    print("Next step:")
    print(
        "Create predict.py / FastAPI service so the "
        "MERN backend can request predictions."
    )

    print()
    print("=" * 70)


if __name__ == "__main__":
    main()

