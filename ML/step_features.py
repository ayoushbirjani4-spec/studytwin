import re


# ============================================================
# VALID OPERATIONS
# ============================================================

VALID_OPERATIONS = {
    "distribution",
    "add_subtract_constants",
    "moving_terms",
    "multiplication_division",
    "combining_terms",
    "sign_changes",
    "intentionally_incorrect",
}


# ============================================================
# NORMALIZATION
# ============================================================

def normalize(text):
    """Normalize algebra text for comparison."""

    text = str(text).strip().lower()

    replacements = {
        "Ã—": "*",
        "Â·": "*",
        "âˆ’": "-",
        "−": "-",
        "×": "*",
        "·": "*",
    }

    for old, new in replacements.items():
        text = text.replace(old, new)

    text = re.sub(r"\s+", "", text)

    return text


# ============================================================
# EQUATION SPLITTING
# ============================================================

def split_equation(equation):
    """
    Split an equation into left and right sides.

    Examples:
        '5x = 15' -> ('5x', '15')
        'x = 3'    -> ('x', '3')
    """

    equation = str(equation).strip()

    if "=" not in equation:
        return equation, ""

    left, right = equation.split("=", 1)

    return left.strip(), right.strip()


# ============================================================
# NUMBER EXTRACTION
# ============================================================

def extract_numbers(expression):
    return re.findall(r"-?\d+(?:\.\d+)?", expression)


# ============================================================
# BASIC FEATURES
# ============================================================

def extract_basic_features(previous, current):

    previous = normalize(previous)
    current = normalize(current)

    prev_left, prev_right = split_equation(previous)
    curr_left, curr_right = split_equation(current)

    return {
        "parentheses_removed": int(
            "(" in previous and "(" not in current
        ),

        "parentheses_added": int(
            "(" not in previous and "(" in current
        ),

        "x_removed": int(
            "x" in previous and "x" not in current
        ),

        "x_added": int(
            "x" not in previous and "x" in current
        ),

        "left_side_changed": int(
            prev_left != curr_left
        ),

        "right_side_changed": int(
            prev_right != curr_right
        ),

        "both_sides_changed": int(
            prev_left != curr_left
            and prev_right != curr_right
        ),

        "sign_changed": abs(
            current.count("-") - previous.count("-")
        ),

        "number_count_previous": len(
            extract_numbers(previous)
        ),

        "number_count_current": len(
            extract_numbers(current)
        ),

        "number_count_changed": abs(
            len(extract_numbers(current))
            - len(extract_numbers(previous))
        ),

        "length_previous": len(previous),

        "length_current": len(current),

        "length_changed": abs(
            len(current) - len(previous)
        ),
    }


# ============================================================
# DISTRIBUTION FEATURES
# ============================================================

def distribution_features(previous, current):

    previous = normalize(previous)
    current = normalize(current)

    match = re.search(
        r"(-?\d+(?:\.\d+)?)\(([^()]+)\)",
        previous
    )

    distribution_expected = int(
        match is not None
    )

    distribution_applied = int(
        "(" in previous and "(" not in current
    )

    coefficient = 0
    constant = 0

    if match:

        coefficient = float(
            match.group(1)
        )

        inside = match.group(2)

        constants = re.findall(
            r"[+-]\d+(?:\.\d+)?|\d+(?:\.\d+)?",
            inside
        )

        if constants:
            try:
                constant = float(
                    constants[-1]
                )
            except ValueError:
                constant = 0

    return {
        "distribution_expected":
            distribution_expected,

        "distribution_applied":
            distribution_applied,

        "distribution_coefficient":
            coefficient,

        "distribution_constant":
            constant,
    }


# ============================================================
# OPERATION FEATURES
# ============================================================

def operation_features(previous, current):

    previous = normalize(previous)
    current = normalize(current)

    previous_left, previous_right = split_equation(
        previous
    )

    current_left, current_right = split_equation(
        current
    )

    addition_or_subtraction = int(
        ("+" in previous or "-" in previous)
        and (
            previous_left != current_left
            or previous_right != current_right
        )
    )

    multiplication_or_division = int(
        "/" in previous
        or "/" in current
        or "*" in previous
        or "*" in current
    )

    def get_x_coefficient(expression):

        match = re.search(
            r"(-?\d*\.?\d*)x",
            expression
        )

        if not match:
            return 0.0

        value = match.group(1)

        if value in ("", "+"):
            return 1.0

        if value == "-":
            return -1.0

        try:
            return float(value)

        except ValueError:
            return 0.0

    previous_x = get_x_coefficient(
        previous
    )

    current_x = get_x_coefficient(
        current
    )

    x_coefficient_changed = int(
        previous_x != current_x
    )

    def count_terms(expression):

        expression = expression.replace(
            "-", "+-"
        )

        return len([
            term
            for term in expression.split("+")
            if term
        ])

    previous_terms = count_terms(
        previous_left
    )

    current_terms = count_terms(
        current_left
    )

    return {
        "addition_or_subtraction":
            addition_or_subtraction,

        "multiplication_or_division":
            multiplication_or_division,

        "x_coefficient_changed":
            x_coefficient_changed,

        "term_count_previous":
            previous_terms,

        "term_count_current":
            current_terms,

        "term_count_changed":
            abs(
                current_terms
                - previous_terms
            ),
    }


# ============================================================
# MAIN FEATURE FUNCTION
# ============================================================

def extract_features(
    previous,
    current,
    concept=None
):

    features = {}

    features.update(
        extract_basic_features(
            previous,
            current
        )
    )

    features.update(
        distribution_features(
            previous,
            current
        )
    )

    features.update(
        operation_features(
            previous,
            current
        )
    )

    if concept is not None:
        features["concept"] = concept

    return features


# ============================================================
# LINEAR EXPRESSION PARSER
# ============================================================
def parse_linear_expression(expression):
    """
    Parse a linear expression into:

        (x_coefficient, constant)

    Examples:
        5x              -> (5, 0)
        x               -> (1, 0)
        -4x             -> (-4, 0)
        3x + 5          -> (3, 5)
        3x + 2x         -> (5, 0)
        2x + 3x + 5     -> (5, 5)
        20              -> (0, 20)
        -8              -> (0, -8)

    Also supports simple distribution:

        5(x + 4)        -> (5, 20)
        3(x - 6)        -> (3, -18)
        -2(x + 5)       -> (-2, -10)
    """

    expression = normalize(expression)
    expression = expression.replace(" ", "")

    if not expression:
        return None

    # ---------------------------------------------------------
    # Handle simple distribution:
    #
    #   a(x + b)
    #   a(x - b)
    # ---------------------------------------------------------

    distribution_match = re.fullmatch(
        r"([+-]?\d*\.?\d*)\(x([+-]\d*\.?\d+)\)",
        expression
    )

    if distribution_match:
        coefficient_text = distribution_match.group(1)
        constant_text = distribution_match.group(2)

        if coefficient_text in ("", "+"):
            coefficient = 1.0
        elif coefficient_text == "-":
            coefficient = -1.0
        else:
            coefficient = float(coefficient_text)

        inner_constant = float(constant_text)

        return (
            coefficient,
            coefficient * inner_constant
        )

    # ---------------------------------------------------------
    # General linear expression parser
    #
    # Handles:
    #   3x
    #   2x + 5
    #   3x + 2x
    #   2x + 3x + 5
    #   7x - 12
    #   -4x + 8 - 2x
    # ---------------------------------------------------------

    # Make subtraction explicit:
    #
    # 3x-5 -> 3x+-5
    #
    # But don't split the leading minus.
    expression = expression.replace("-", "+-")

    if expression.startswith("+-"):
        expression = "-" + expression[2:]

    terms = expression.split("+")

    x_coefficient = 0.0
    constant = 0.0

    for term in terms:
        if not term:
            continue

        # ---------------------------------------------
        # x term
        # ---------------------------------------------

        if "x" in term:
            # A simple linear term should contain x once.
            if term.count("x") != 1:
                return None

            coefficient_text = term.replace("x", "")

            if coefficient_text in ("", "+"):
                coefficient = 1.0
            elif coefficient_text == "-":
                coefficient = -1.0
            else:
                try:
                    coefficient = float(coefficient_text)
                except ValueError:
                    return None

            x_coefficient += coefficient

        # ---------------------------------------------
        # Constant term
        # ---------------------------------------------

        else:
            try:
                constant += float(term)
            except ValueError:
                return None

    return x_coefficient, constant

# ============================================================
# EQUATION FORM
# ============================================================

def equation_form(equation):
    """
    Convert an equation into:

        ax + b = 0

    Examples:

        5x = 15
            -> (5, -15)

        x = 3
            -> (1, -3)

        -4x = 20
            -> (-4, -20)

        x = -5
            -> (1, 5)
    """

    left, right = split_equation(
        equation
    )

    if not left or not right:
        raise ValueError(
            "Invalid equation"
        )

    left_form = parse_linear_expression(
        left
    )

    right_form = parse_linear_expression(
        right
    )

    return (
        left_form[0] - right_form[0],
        left_form[1] - right_form[1]
    )


# ============================================================
# MATHEMATICAL VALIDATION
# ============================================================
def is_valid_transformation(previous, current):
    """
    Check whether two linear equations are mathematically equivalent.

    Supports:
    - distribution
    - combining like terms
    - moving terms
    - multiplication/division
    - sign changes
    """

    try:
        prev_left, prev_right = split_equation(previous)
        curr_left, curr_right = split_equation(current)

        # Parse every side independently.
        prev_left_form = parse_linear_expression(prev_left)
        prev_right_form = parse_linear_expression(prev_right)

        curr_left_form = parse_linear_expression(curr_left)
        curr_right_form = parse_linear_expression(curr_right)

        if None in (
            prev_left_form,
            prev_right_form,
            curr_left_form,
            curr_right_form,
        ):
            return False

        # Convert:
        #
        #   ax + b = cx + d
        #
        # into:
        #
        #   (a-c)x + (b-d) = 0
        #
        def equation_coefficients(left, right):
            a = left[0] - right[0]
            b = left[1] - right[1]
            return a, b

        prev_a, prev_b = equation_coefficients(
            prev_left_form,
            prev_right_form
        )

        curr_a, curr_b = equation_coefficients(
            curr_left_form,
            curr_right_form
        )

        tolerance = 1e-9

        # Both represent the same constant equation.
        if abs(prev_a) < tolerance and abs(curr_a) < tolerance:
            return abs(prev_b - curr_b) < tolerance

        # One is constant while the other contains x.
        if abs(prev_a) < tolerance or abs(curr_a) < tolerance:
            return False

        # Check proportionality.
        scale = curr_a / prev_a

        return abs(curr_b - (prev_b * scale)) < tolerance

    except Exception:
        return False

# ============================================================
# OPERATION INFERENCE
# ============================================================

def infer_operation(
    previous,
    current,
    concept=None
):

    # If the caller already knows the operation,
    # use it directly.
    if concept in VALID_OPERATIONS:
        return concept

    features = extract_features(
        previous,
        current
    )

    # Distribution
    if features[
        "distribution_expected"
    ]:
        return "distribution"

    # Multiplication / division
    if features[
        "x_coefficient_changed"
    ]:
        return "multiplication_division"

    # Sign change
    if features[
        "sign_changed"
    ] > 0:
        return "sign_changes"

    # Combining terms
    if features[
        "term_count_changed"
    ] > 0:
        return "combining_terms"

    # Moving constants
    if features[
        "right_side_changed"
    ]:
        return "add_subtract_constants"

    # Default
    return "moving_terms"