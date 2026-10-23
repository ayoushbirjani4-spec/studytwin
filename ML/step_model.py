"""
StudyTwin Step Misconception Model

Trains a Random Forest classifier that identifies
common mistakes in students' mathematical steps.

Training data:
    generated_data/synthetic_step_training_data.csv

Output:
    step_misconception_model.pkl
"""

import pickle
from pathlib import Path

import pandas as pd

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
)


# ============================================================
# 1. PATHS
# ============================================================

BASE_DIR = Path(__file__).resolve().parent

DATA_PATH = (
    BASE_DIR
    / "generated_data"
    / "synthetic_step_training_data.csv"
)

MODEL_PATH = (
    BASE_DIR
    / "step_misconception_model.pkl"
)


# ============================================================
# 2. CONFIGURATION
# ============================================================

RANDOM_STATE = 42
TEST_SIZE = 0.20


# ============================================================
# 3. LOAD DATASET
# ============================================================

def load_dataset():

    print()
    print("=" * 70)
    print("1. LOADING STEP TRAINING DATA")
    print("=" * 70)

    if not DATA_PATH.exists():

        print()
        print("ERROR: Training dataset not found.")
        print()
        print(f"Expected file:")
        print(DATA_PATH)
        print()
        print("Run this first:")
        print()
        print("python generate_step_data.py --count 2000")
        print()

        raise FileNotFoundError(
            f"Dataset not found: {DATA_PATH}"
        )

    df = pd.read_csv(DATA_PATH)

    print()
    print("Dataset loaded successfully.")
    print(f"Rows:    {len(df):,}")
    print(f"Columns: {len(df.columns)}")

    return df


# ============================================================
# 4. DISPLAY DATASET INFORMATION
# ============================================================

def display_dataset_info(df):

    print()
    print("=" * 70)
    print("2. DATASET OVERVIEW")
    print("=" * 70)

    print()
    print("Columns:")

    for column in df.columns:
        print(f"  - {column}")

    print()
    print("Label distribution:")

    label_counts = df["label"].value_counts()

    for label, count in label_counts.items():

        percentage = (
            count / len(df)
        ) * 100

        print(
            f"  {label:<30} "
            f"{count:>5} "
            f"({percentage:.2f}%)"
        )


# ============================================================
# 5. PREPARE FEATURES
# ============================================================

def prepare_features(df):

    print()
    print("=" * 70)
    print("3. PREPARING FEATURES")
    print("=" * 70)

    # --------------------------------------------------------
    # Columns that are not ML features
    # --------------------------------------------------------
    excluded_columns = [
        "previous_step",
        "current_step",
        "label",
    ]

    # --------------------------------------------------------
    # Keep all generated numerical features
    # --------------------------------------------------------

    feature_columns = [
        column
        for column in df.columns
        if column not in excluded_columns
    ]

    X = df[feature_columns].copy()

    y = df["label"].copy()

    # --------------------------------------------------------
    # Convert categorical columns if they exist
    # --------------------------------------------------------

    categorical_columns = X.select_dtypes(
        include=["object", "category"]
    ).columns.tolist()

    if categorical_columns:

        print()
        print("Categorical features found:")

        for column in categorical_columns:
            print(f"  - {column}")

        X = pd.get_dummies(
            X,
            columns=categorical_columns,
            dtype=int
        )

    # --------------------------------------------------------
    # Handle missing values
    # --------------------------------------------------------

    if X.isnull().sum().sum() > 0:

        print()
        print("Missing values detected.")

        X = X.fillna(0)

    print()
    print("Features used by the model:")

    for feature in X.columns:
        print(f"  - {feature}")

    print()
    print(f"Total ML features: {len(X.columns)}")

    return X, y


# ============================================================
# 6. SPLIT DATA
# ============================================================

def split_dataset(X, y):

    print()
    print("=" * 70)
    print("4. SPLITTING DATASET")
    print("=" * 70)

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=TEST_SIZE,
        random_state=RANDOM_STATE,
        stratify=y,
    )

    print()
    print(f"Training samples: {len(X_train):,}")
    print(f"Testing samples:  {len(X_test):,}")

    print()
    print("Training label distribution:")

    print(
        y_train.value_counts()
    )

    print()
    print("Testing label distribution:")

    print(
        y_test.value_counts()
    )

    return (
        X_train,
        X_test,
        y_train,
        y_test,
    )


# ============================================================
# 7. BUILD RANDOM FOREST
# ============================================================

def build_model():

    print()
    print("=" * 70)
    print("5. BUILDING RANDOM FOREST")
    print("=" * 70)

    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=12,
        min_samples_leaf=2,
        class_weight="balanced",
        random_state=RANDOM_STATE,
        n_jobs=-1,
    )

    print()
    print("Random Forest configuration:")
    print()
    print("  Number of trees:      300")
    print("  Maximum depth:        12")
    print("  Minimum samples leaf: 2")
    print("  Class weight:         balanced")

    return model


# ============================================================
# 8. TRAIN MODEL
# ============================================================

def train_model(
    model,
    X_train,
    y_train,
):

    print()
    print("=" * 70)
    print("6. TRAINING MODEL")
    print("=" * 70)

    print()
    print("Training Random Forest...")

    model.fit(
        X_train,
        y_train,
    )

    print()
    print("Training completed successfully.")

    return model


# ============================================================
# 9. EVALUATE MODEL
# ============================================================

def evaluate_model(
    model,
    X_test,
    y_test,
):

    print()
    print("=" * 70)
    print("7. MODEL EVALUATION")
    print("=" * 70)

    predictions = model.predict(
        X_test
    )

    accuracy = accuracy_score(
        y_test,
        predictions,
    )

    print()
    print(f"Accuracy: {accuracy:.4f}")

    print()
    print(
        "Classification Report:"
    )

    print()

    print(
        classification_report(
            y_test,
            predictions,
            zero_division=0,
        )
    )

    print()
    print(
        "Confusion Matrix:"
    )

    print()

    print(
        confusion_matrix(
            y_test,
            predictions,
        )
    )

    return accuracy


# ============================================================
# 10. FEATURE IMPORTANCE
# ============================================================

def show_feature_importance(
    model,
    feature_names,
):

    print()
    print("=" * 70)
    print("8. FEATURE IMPORTANCE")
    print("=" * 70)

    importance = pd.DataFrame(
        {
            "feature": feature_names,
            "importance": (
                model.feature_importances_
            ),
        }
    )

    importance = importance.sort_values(
        "importance",
        ascending=False,
    )

    print()
    print(
        "Most important features:"
    )

    print()

    for _, row in importance.head(15).iterrows():

        print(
            f"{row['feature']:<40}"
            f"{row['importance']:.4f}"
        )

    return importance


# ============================================================
# 11. SAVE MODEL
# ============================================================

def save_model(
    model,
    feature_names,
):

    print()
    print("=" * 70)
    print("9. SAVING MODEL")
    print("=" * 70)

    model_bundle = {
        "model": model,
        "feature_names": list(
            feature_names
        ),
    }

    with open(
        MODEL_PATH,
        "wb",
    ) as file:

        pickle.dump(
            model_bundle,
            file,
        )

    print()
    print("Model saved successfully.")

    print()
    print(
        f"Location:"
    )

    print(
        MODEL_PATH
    )

    print()
    print(
        "Saved bundle contains:"
    )

    print(
        "  - Random Forest model"
    )

    print(
        "  - Feature names"
    )


# ============================================================
# 12. MAIN
# ============================================================

def main():

    print()
    print("=" * 70)
    print("       STUDYTWIN STEP MISCONCEPTION MODEL")
    print("=" * 70)

    # --------------------------------------------------------
    # Load dataset
    # --------------------------------------------------------

    df = load_dataset()

    # --------------------------------------------------------
    # Dataset information
    # --------------------------------------------------------

    display_dataset_info(
        df
    )

    # --------------------------------------------------------
    # Prepare features
    # --------------------------------------------------------

    X, y = prepare_features(
        df
    )

    # --------------------------------------------------------
    # Split dataset
    # --------------------------------------------------------

    (
        X_train,
        X_test,
        y_train,
        y_test,
    ) = split_dataset(
        X,
        y,
    )

    # --------------------------------------------------------
    # Build model
    # --------------------------------------------------------

    model = build_model()

    # --------------------------------------------------------
    # Train
    # --------------------------------------------------------

    model = train_model(
        model,
        X_train,
        y_train,
    )

    # --------------------------------------------------------
    # Evaluate
    # --------------------------------------------------------

    accuracy = evaluate_model(
        model,
        X_test,
        y_test,
    )

    # --------------------------------------------------------
    # Feature importance
    # --------------------------------------------------------

    show_feature_importance(
        model,
        X.columns,
    )

    # --------------------------------------------------------
    # Save
    # --------------------------------------------------------

    save_model(
        model,
        X.columns,
    )

    # --------------------------------------------------------
    # Final summary
    # --------------------------------------------------------

    print()
    print("=" * 70)
    print("TRAINING COMPLETE")
    print("=" * 70)

    print()
    print(
        "Model: Random Forest"
    )

    print(
        f"Training examples: {len(X_train):,}"
    )

    print(
        f"Testing examples:  {len(X_test):,}"
    )

    print(
        f"Features:          {len(X.columns)}"
    )

    print(
        f"Accuracy:          {accuracy:.4f}"
    )

    print()
    print(
        "StudyTwin step misconception model"
    )

    print(
        "is ready for testing."
    )

    print()


# ============================================================
# 13. RUN
# ============================================================

if __name__ == "__main__":
    main()