"""Generate labeled synthetic algebra-step examples for StudyTwin.

This script deliberately does not train or overwrite the ML model.  It writes
CSV and JSON datasets that can be reviewed and used by a later training step.
"""

import argparse
import csv
import json
import random
from collections import Counter
from pathlib import Path

from step_features import extract_features


FEATURE_NAMES = list(extract_features("x = 1", "x = 1").keys())
VALID_LABEL = "correct_transformation"


def signed(value):
    """Return a number with an algebra-friendly leading sign."""
    return f"+ {value}" if value >= 0 else f"- {abs(value)}"


def term(coefficient):
    """Format a non-zero coefficient times x."""
    if coefficient == 1:
        return "x"
    if coefficient == -1:
        return "-x"
    return f"{coefficient}x"


def add_example(rows, previous, current, operation, label, is_valid):
    features = extract_features(previous, current)
    rows.append({
        "previous_step": previous,
        "current_step": current,
        "concept": operation,
        "operation": operation,
        "label": label,
        "is_valid": int(is_valid),
        **features,
    })


def distribution(rows, rng, valid):
    multiplier = rng.randint(2, 9)
    coefficient = rng.choice([1, 2, 3])
    constant = rng.randint(2, 12)
    sign = rng.choice([-1, 1])
    right = rng.randint(10, 70)
    inside = term(coefficient) + " " + signed(sign * constant)
    previous = f"{multiplier}({inside}) = {right}"
    expanded_x = term(multiplier * coefficient)
    correct_constant = multiplier * sign * constant

    if valid:
        current = f"{expanded_x} {signed(correct_constant)} = {right}"
        label = VALID_LABEL
    elif rng.choice([True, False]):
        current = f"{expanded_x} {signed(sign * constant)} = {right}"
        label = "failed_to_distribute"
    else:
        current = f"{expanded_x} {signed(-correct_constant)} = {right}"
        label = "sign_error"
    add_example(rows, previous, current, "distribution", label, valid)


def add_subtract_constants(rows, rng, valid):
    coefficient = rng.randint(2, 12)
    constant = rng.randint(2, 25) * rng.choice([-1, 1])
    right = rng.randint(10, 80)
    previous = f"{term(coefficient)} {signed(constant)} = {right}"
    correct_right = right - constant
    if valid:
        current, label = f"{term(coefficient)} = {correct_right}", VALID_LABEL
    elif rng.choice([True, False]):
        current, label = f"{term(coefficient)} = {right + constant}", "sign_error"
    else:
        current, label = f"{term(coefficient)} = {right}", "incorrect_operation"
    add_example(rows, previous, current, "add_subtract_constants", label, valid)


def moving_terms(rows, rng, valid):
    left_coefficient = rng.randint(3, 12)
    right_coefficient = rng.randint(1, left_coefficient - 1)
    left_constant = rng.randint(2, 20) * rng.choice([-1, 1])
    right_constant = rng.randint(2, 20) * rng.choice([-1, 1])
    previous = (
        f"{term(left_coefficient)} {signed(left_constant)} = "
        f"{term(right_coefficient)} {signed(right_constant)}"
    )
    result_coefficient = left_coefficient - right_coefficient
    result_constant = right_constant - left_constant
    if valid:
        current, label = (
            f"{term(result_coefficient)} = {result_constant}", VALID_LABEL
        )
    elif rng.choice([True, False]):
        current, label = (
            f"{term(result_coefficient)} = {left_constant - right_constant}", "sign_error"
        )
    else:
        current, label = (
            f"{term(left_coefficient + right_coefficient)} = {result_constant}",
            "incorrect_operation",
        )
    add_example(rows, previous, current, "moving_terms", label, valid)


def multiply_divide(rows, rng, valid):
    coefficient = rng.randint(2, 12)
    solution = rng.randint(-12, 12)
    if solution == 0:
        solution = 4
    right = coefficient * solution
    previous = f"{term(coefficient)} = {right}"
    if valid:
        current, label = f"x = {solution}", VALID_LABEL
    elif rng.choice([True, False]):
        current, label = f"x = {right}", "incorrect_operation"
    else:
        current, label = f"x = {-solution}", "sign_error"
    add_example(rows, previous, current, "multiplication_division", label, valid)


def combining_terms(rows, rng, valid):
    first = rng.randint(2, 12)
    second = rng.randint(1, first - 1) * rng.choice([-1, 1])
    constant = rng.randint(2, 20) * rng.choice([-1, 1])
    right = rng.randint(10, 80)
    previous = f"{term(first)} {signed(second)}x {signed(constant)} = {right}"
    combined = first + second
    if valid:
        current, label = f"{term(combined)} {signed(constant)} = {right}", VALID_LABEL
    else:
        wrong = first - second
        current, label = f"{term(wrong)} {signed(constant)} = {right}", "incorrect_operation"
    add_example(rows, previous, current, "combining_terms", label, valid)


def sign_changes(rows, rng, valid):
    coefficient = rng.randint(2, 12)
    constant = rng.randint(2, 20)
    right = rng.randint(10, 80)
    previous = f"-{coefficient}x {signed(constant)} = {right}"
    if valid:
        current, label = f"{coefficient}x - {constant} = {-right}", VALID_LABEL
    elif rng.choice([True, False]):
        current, label = f"{coefficient}x - {constant} = {right}", "sign_error"
    else:
        current, label = f"{coefficient}x + {constant} = {-right}", "sign_error"
    add_example(rows, previous, current, "sign_changes", label, valid)


def incorrect_transformations(rows, rng):
    """A mixed bucket of common, explicitly invalid student transformations."""
    coefficient = rng.randint(2, 12)
    constant = rng.randint(2, 20)
    right = rng.randint(10, 80)
    previous = f"{term(coefficient)} - {constant} = {right}"
    if rng.choice([True, False]):
        current, label = f"{term(coefficient)} = {right - constant}", "sign_error"
    else:
        current, label = f"x = {right - constant}", "incorrect_operation"
    add_example(rows, previous, current, "intentionally_incorrect", label, False)


GENERATORS = [
    distribution,
    add_subtract_constants,
    moving_terms,
    multiply_divide,
    combining_terms,
    sign_changes,
]


def generate_examples(count=800, seed=42):
    """Return a deterministic, approximately balanced collection of examples."""
    if count < 1:
        raise ValueError("count must be at least 1")
    rng = random.Random(seed)
    rows = []
    for index in range(count):
        operation_index = index % 7
        if operation_index == 6:
            incorrect_transformations(rows, rng)
        else:
            # A full seven-operation cycle alternates between correct and
            # incorrect variants, so every operation receives both kinds.
            valid = (index // 7) % 2 == 0
            GENERATORS[operation_index](rows, rng, valid=valid)
    rng.shuffle(rows)
    return rows


def write_dataset(rows, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / "synthetic_step_training_data.csv"
    json_path = output_dir / "synthetic_step_training_data.json"
    fieldnames = [
        "previous_step", "current_step", "concept", "operation", "label", "is_valid", *FEATURE_NAMES
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    with json_path.open("w", encoding="utf-8") as file:
        json.dump(rows, file, indent=2)
    return csv_path, json_path


def main():
    parser = argparse.ArgumentParser(description="Generate StudyTwin synthetic algebra-step data.")
    parser.add_argument("--count", type=int, default=800, help="Number of examples to create (default: 800).")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducible data (default: 42).")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parent / "generated_data")
    args = parser.parse_args()

    rows = generate_examples(args.count, args.seed)
    csv_path, json_path = write_dataset(rows, args.output_dir)
    print(f"Generated {len(rows)} examples")
    print("Labels:", dict(sorted(Counter(row["label"] for row in rows).items())))
    print("Operations:", dict(sorted(Counter(row["operation"] for row in rows).items())))
    print(f"CSV:  {csv_path}")
    print(f"JSON: {json_path}")
    print("\nSample rows:")
    for row in rows[:5]:
        print(f"[{row['label']}] {row['previous_step']} -> {row['current_step']}")


if __name__ == "__main__":
    main()
