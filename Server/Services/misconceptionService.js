
// ============================================================
// StudyTwin Misconception Service
// ============================================================
//
// Purpose:
// Analyze a student's answer AND validate their written work.
//
// Design:
//
// Student Work
//      ↓
// Parse equations
//      ↓
// Compare consecutive mathematical states
//      ↓
// Determine whether transformation is valid
//      ↓
// Identify operation
//      ↓
// Detect misconception
//      ↓
// ML step classifier
//
// ============================================================

const questionService = require("./questionService");
const llmReviewService = require("./llmReviewService");

const ML_API_URL =
    process.env.ML_API_URL ||
    "http://127.0.0.1:8000";


// ============================================================
// 1. NORMALIZE ANSWER
// ============================================================

function normalizeAnswer(answer) {

    if (answer === undefined || answer === null) {
        return "";
    }

    return String(answer)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/^x=/, "");
}


// ============================================================
// 2. CHECK FINAL ANSWER
// ============================================================
//
// IMPORTANT: An empty or blank student answer is never
// correct.  JavaScript's Number("") === 0, which would
// cause a blank submission to match any question whose
// correct answer is also "0".  We reject empty inputs
// before any numeric conversion.
//
// We also guard against an absent correct answer so that
// a misconfigured question cannot accidentally match.
//
// ============================================================

function isAnswerCorrect(studentAnswer, correctAnswer) {

    const student =
        normalizeAnswer(studentAnswer);

    const correct =
        normalizeAnswer(correctAnswer);

    // Reject blank student submissions unconditionally.
    if (student.length === 0) {
        return false;
    }

    // Reject missing or blank correct answers (bad question data).
    if (correct.length === 0) {
        return false;
    }

    if (student === correct) {
        return true;
    }

    const studentNumber =
        Number(student);

    const correctNumber =
        Number(correct);

    if (
        !Number.isNaN(studentNumber) &&
        !Number.isNaN(correctNumber)
    ) {

        return Math.abs(
            studentNumber - correctNumber
        ) < 0.000001;
    }

    return false;
}


// ============================================================
// 3. CLEAN WORK
// ============================================================

function cleanWork(work) {

    if (!work) {
        return [];
    }

    return String(work)
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
}


// ============================================================
// 4. NORMALIZE EQUATION
// ============================================================

function normalizeEquation(equation) {

    return String(equation || "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/−/g, "-")
        .replace(/×/g, "*")
        .replace(/÷/g, "/");
}


// ============================================================
// 5. SPLIT EQUATION
// ============================================================

function splitEquation(equation) {

    const normalized =
        normalizeEquation(equation);

    const equalIndex =
        normalized.indexOf("=");

    if (equalIndex === -1) {
        return null;
    }

    return {
        left:
            normalized.substring(
                0,
                equalIndex
            ),

        right:
            normalized.substring(
                equalIndex + 1
            )
    };
}


// ============================================================
// 6. TOKENIZER
// ============================================================

function tokenize(expression) {

    let text =
        normalizeEquation(expression);

    const tokens = [];

    let i = 0;

    while (i < text.length) {

        const char =
            text[i];

        // Number
        if (/[0-9.]/.test(char)) {

            let number = "";

            while (
                i < text.length &&
                /[0-9.]/.test(text[i])
            ) {

                number += text[i];
                i++;
            }

            tokens.push({
                type: "number",
                value: Number(number)
            });

            continue;
        }

        // Variable
        if (char === "x") {

            tokens.push({
                type: "variable",
                value: "x"
            });

            i++;

            continue;
        }

        // Operators
        if (
            char === "+" ||
            char === "-" ||
            char === "*" ||
            char === "/"
        ) {

            tokens.push({
                type: "operator",
                value: char
            });

            i++;

            continue;
        }

        // Parentheses
        if (
            char === "(" ||
            char === ")"
        ) {

            tokens.push({
                type: "parenthesis",
                value: char
            });

            i++;

            continue;
        }

        return null;
    }

    return tokens;
}


// ============================================================
// 7. INSERT IMPLIED MULTIPLICATION
// ============================================================
//
// Examples:
//
// 3(2x-4)
//      ↓
// 3 * (2 * x - 4)
//
// 5x
//  ↓
// 5 * x
//
// ============================================================

function addImplicitMultiplication(tokens) {

    if (!tokens) {
        return null;
    }

    const result = [];

    for (
        let i = 0;
        i < tokens.length;
        i++
    ) {

        const current =
            tokens[i];

        const previous =
            result[result.length - 1];

        if (previous) {

            const previousCanMultiply =
                (
                    previous.type === "number" ||
                    previous.type === "variable" ||
                    (
                        previous.type === "parenthesis" &&
                        previous.value === ")"
                    )
                );

            const currentCanMultiply =
                (
                    current.type === "variable" ||
                    current.type === "number" ||
                    (
                        current.type === "parenthesis" &&
                        current.value === "("
                    )
                );

            if (
                previousCanMultiply &&
                currentCanMultiply
            ) {

                result.push({
                    type: "operator",
                    value: "*"
                });
            }
        }

        result.push(current);
    }

    return result;
}


// ============================================================
// 8. LINEAR EXPRESSION OPERATIONS
// ============================================================

function addLinear(a, b) {

    return {
        a: a.a + b.a,
        b: a.b + b.b
    };
}


function subtractLinear(a, b) {

    return {
        a: a.a - b.a,
        b: a.b - b.b
    };
}


function multiplyLinear(a, b) {

    const aIsConstant =
        Math.abs(a.a) < 0.000001;

    const bIsConstant =
        Math.abs(b.a) < 0.000001;

    if (
        !aIsConstant &&
        !bIsConstant
    ) {

        throw new Error(
            "Non-linear multiplication is not supported."
        );
    }

    if (aIsConstant) {

        return {
            a: b.a * a.b,
            b: b.b * a.b
        };
    }

    return {
        a: a.a * b.b,
        b: a.b * b.b
    };
}


function divideLinear(a, b) {

    if (
        Math.abs(b.a) > 0.000001
    ) {

        throw new Error(
            "Division by an expression containing x is not supported."
        );
    }

    if (
        Math.abs(b.b) < 0.000001
    ) {

        throw new Error(
            "Division by zero."
        );
    }

    return {
        a: a.a / b.b,
        b: a.b / b.b
    };
}


// ============================================================
// 9. EXPRESSION PARSER
// ============================================================

function parseExpression(expression) {

    let tokens =
        tokenize(expression);

    if (
        !tokens ||
        tokens.length === 0
    ) {

        throw new Error(
            "Invalid expression."
        );
    }

    tokens =
        addImplicitMultiplication(tokens);

    let position = 0;


    // --------------------------------------------------------
    // Parse primary
    // --------------------------------------------------------

    function parsePrimary() {

        const token =
            tokens[position];

        if (!token) {

            throw new Error(
                "Unexpected end of expression."
            );
        }


        // Number
        if (
            token.type === "number"
        ) {

            position++;

            return {
                a: 0,
                b: token.value
            };
        }


        // Variable
        if (
            token.type === "variable"
        ) {

            position++;

            return {
                a: 1,
                b: 0
            };
        }


        // Parentheses
        if (
            token.type === "parenthesis" &&
            token.value === "("
        ) {

            position++;

            const value =
                parseAddSubtract();

            const closing =
                tokens[position];

            if (
                !closing ||
                closing.value !== ")"
            ) {

                throw new Error(
                    "Missing closing parenthesis."
                );
            }

            position++;

            return value;
        }


        throw new Error(
            "Invalid expression."
        );
    }


    // --------------------------------------------------------
    // Unary + / -
    // --------------------------------------------------------

    function parseUnary() {

        const token =
            tokens[position];

        if (
            token &&
            token.type === "operator" &&
            (
                token.value === "+" ||
                token.value === "-"
            )
        ) {

            position++;

            const value =
                parseUnary();

            if (
                token.value === "-"
            ) {

                return {
                    a: -value.a,
                    b: -value.b
                };
            }

            return value;
        }

        return parsePrimary();
    }


    // --------------------------------------------------------
    // Multiplication / division
    // --------------------------------------------------------

    function parseMultiplyDivide() {

        let left =
            parseUnary();

        while (
            position < tokens.length
        ) {

            const token =
                tokens[position];

            if (
                token.type !== "operator" ||
                (
                    token.value !== "*" &&
                    token.value !== "/"
                )
            ) {

                break;
            }

            position++;

            const right =
                parseUnary();

            if (
                token.value === "*"
            ) {

                left =
                    multiplyLinear(
                        left,
                        right
                    );

            } else {

                left =
                    divideLinear(
                        left,
                        right
                    );
            }
        }

        return left;
    }


    // --------------------------------------------------------
    // Addition / subtraction
    // --------------------------------------------------------

    function parseAddSubtract() {

        let left =
            parseMultiplyDivide();

        while (
            position < tokens.length
        ) {

            const token =
                tokens[position];

            if (
                token.type !== "operator" ||
                (
                    token.value !== "+" &&
                    token.value !== "-"
                )
            ) {

                break;
            }

            position++;

            const right =
                parseMultiplyDivide();

            if (
                token.value === "+"
            ) {

                left =
                    addLinear(
                        left,
                        right
                    );

            } else {

                left =
                    subtractLinear(
                        left,
                        right
                    );
            }
        }

        return left;
    }


    const result =
        parseAddSubtract();


    if (
        position !== tokens.length
    ) {

        throw new Error(
            "Unable to parse complete expression."
        );
    }

    return result;
}


// ============================================================
// 10. PARSE EQUATION INTO NORMAL FORM
// ============================================================

function parseEquation(equation) {

    const sides =
        splitEquation(equation);

    if (!sides) {
        return null;
    }

    try {

        const left =
            parseExpression(
                sides.left
            );

        const right =
            parseExpression(
                sides.right
            );

        return subtractLinear(
            left,
            right
        );

    } catch (error) {

        return null;
    }
}


// ============================================================
// 11. EQUATION EQUIVALENCE
// ============================================================

function equationsEquivalent(
    equationA,
    equationB
) {

    const a =
        parseEquation(equationA);

    const b =
        parseEquation(equationB);

    if (!a || !b) {
        return false;
    }


    // Both equations are identities
    if (
        Math.abs(a.a) < 0.000001 &&
        Math.abs(a.b) < 0.000001 &&
        Math.abs(b.a) < 0.000001 &&
        Math.abs(b.b) < 0.000001
    ) {

        return true;
    }


    const magnitudeA =
        Math.sqrt(
            a.a * a.a +
            a.b * a.b
        );

    const magnitudeB =
        Math.sqrt(
            b.a * b.a +
            b.b * b.b
        );


    if (
        magnitudeA < 0.000001 ||
        magnitudeB < 0.000001
    ) {

        return false;
    }


    const normalizedA = {
        a: a.a / magnitudeA,
        b: a.b / magnitudeA
    };

    const normalizedB = {
        a: b.a / magnitudeB,
        b: b.b / magnitudeB
    };


    return (
        Math.abs(
            normalizedA.a -
            normalizedB.a
        ) < 0.000001
        &&
        Math.abs(
            normalizedA.b -
            normalizedB.b
        ) < 0.000001
    );
}


// ============================================================
// 12. DETECT OPERATION BETWEEN TWO STEPS
// ============================================================

function detectOperation(
    previous,
    current
) {

    const previousEquation =
        parseEquation(previous);

    const currentEquation =
        parseEquation(current);

    if (
        !previousEquation ||
        !currentEquation
    ) {

        return "unknown";
    }


    const previousSides =
        splitEquation(previous);

    const currentSides =
        splitEquation(current);

    if (
        !previousSides ||
        !currentSides
    ) {

        return "unknown";
    }


    // Distributive property
    if (
        previous.includes("(") &&
        !current.includes("(")
    ) {

        return "distribute";
    }


    // Equivalent transformation
    if (
        equationsEquivalent(
            previous,
            current
        )
    ) {

        const previousLeft =
            parseExpression(
                previousSides.left
            );

        const previousRight =
            parseExpression(
                previousSides.right
            );

        const currentLeft =
            parseExpression(
                currentSides.left
            );

        const currentRight =
            parseExpression(
                currentSides.right
            );


        const leftDifference =
            subtractLinear(
                currentLeft,
                previousLeft
            );

        const rightDifference =
            subtractLinear(
                currentRight,
                previousRight
            );


        // Add/subtract same constant
        if (
            Math.abs(
                leftDifference.a
            ) < 0.000001
            &&
            Math.abs(
                rightDifference.a
            ) < 0.000001
            &&
            Math.abs(
                leftDifference.b -
                rightDifference.b
            ) < 0.000001
        ) {

            if (
                leftDifference.b > 0
            ) {

                return "add_to_both_sides";
            }

            if (
                leftDifference.b < 0
            ) {

                return "subtract_from_both_sides";
            }
        }


        // Multiplication/division
        if (
            Math.abs(
                previousEquation.a
            ) > 0.000001
        ) {

            const scale =
                currentEquation.a /
                previousEquation.a;

            if (
                Math.abs(
                    currentEquation.b -
                    previousEquation.b * scale
                ) < 0.000001
            ) {

                if (
                    scale > 1
                ) {

                    return "multiply_both_sides";
                }

                if (
                    scale > 0 &&
                    scale < 1
                ) {

                    return "divide_both_sides";
                }
            }
        }


        return "equivalent_transformation";
    }


    return "invalid_transformation";
}


// ============================================================
// 13. VALIDATE INDIVIDUAL WORK STEPS
// ============================================================

function validateWorkSteps(work) {

    const steps =
        cleanWork(work);


    if (
        steps.length === 0
    ) {

        return {

            available: false,

            valid: true,

            steps: [],

            invalidStep: null,

            message:
                "No written work was provided."
        };
    }


    if (
        steps.length === 1
    ) {
        if (/(?:->|=>|→|⇒)/.test(steps[0])) {
            const arrowSteps = steps[0].split(/\s*(?:->|=>|→|⇒)\s*/).filter(Boolean);
            if (arrowSteps.length > 1) {
                const validated = [];
                let allValid = true;
                let invalidStep = null;
                for (let i = 1; i < arrowSteps.length; i++) {
                    const prev = arrowSteps[i - 1];
                    const curr = arrowSteps[i];
                    const prevP = parseEquation(prev);
                    const currP = parseEquation(curr);
                    let valid = false;
                    let op = "invalid_transformation";
                    if (prevP && currP) {
                        valid = equationsEquivalent(prev, curr);
                        op = valid ? "valid_transformation" : "invalid_transformation";
                    }
                    if (!valid && allValid) {
                        allValid = false;
                        invalidStep = {
                            step: i + 1,
                            from: prev,
                            to: curr,
                            valid: false,
                            operation: op,
                            message: "This step changes the equation incorrectly."
                        };
                    }
                    validated.push({
                        step: i + 1,
                        from: prev,
                        to: curr,
                        valid,
                        operation: op
                    });
                }
                return {
                    available: true,
                    valid: allValid,
                    steps: validated,
                    invalidStep,
                    message: allValid
                        ? "All written steps are valid transformations."
                        : "One or more written steps contain an invalid transformation."
                };
            }
        }

        return {

            available: true,

            valid: true,

            steps: [{

                step: 1,

                expression:
                    steps[0],

                valid: true,

                operation:
                    "initial_expression"
            }],

            invalidStep: null,

            message:
                "Only the final expression was provided."
        };
    }


    const validated = [];

    let allValid = true;

    let invalidStep = null;


    for (
        let i = 1;
        i < steps.length;
        i++
    ) {

        const previous =
            steps[i - 1];

        const current =
            steps[i];


        const previousParsed =
            parseEquation(previous);

        const currentParsed =
            parseEquation(current);


        // Could not parse
        if (
            !previousParsed ||
            !currentParsed
        ) {

            const result = {

                step:
                    i + 1,

                from:
                    previous,

                to:
                    current,

                valid: false,

                operation:
                    "unparseable",

                message:
                    "I could not understand this equation step."
            };


            validated.push(result);

            allValid = false;

            if (!invalidStep) {
                invalidStep = result;
            }

            continue;
        }


        const valid =
            equationsEquivalent(
                previous,
                current
            );


        const operation =
            detectOperation(
                previous,
                current
            );


        const result = {

            step:
                i + 1,

            from:
                previous,

            to:
                current,

            valid,

            operation,

            message:
                valid
                    ? "Valid mathematical transformation."
                    : "This step changes the equation incorrectly."
        };


        validated.push(result);


        if (!valid) {

            allValid = false;

            if (!invalidStep) {
                invalidStep = result;
            }
        }
    }


    return {

        available: true,

        valid: allValid,

        steps: validated,

        invalidStep,

        message:
            allValid
                ? "All written steps are mathematically valid."
                : "One or more written steps contain an invalid transformation."
    };
}


// ============================================================
// 14. DISTRIBUTIVE PROPERTY MISCONCEPTION
// ============================================================

function detectDistributiveMisconception(
    question,
    work,
    validation = null
) {

    const text =
        String(work || "")
            .toLowerCase()
            .replace(/\s+/g, "");


    if (!text) {
        return null;
    }


    // ========================================================
    // Analyze actual invalid transition
    // ========================================================

    if (
        validation &&
        validation.invalidStep
    ) {

        const invalid =
            validation.invalidStep;

        const from =
            normalizeEquation(
                invalid.from
            );

        const to =
            normalizeEquation(
                invalid.to
            );




        if (
            from.includes("(") &&
            !to.includes("(")
        ) {

            const fromSides =
                splitEquation(from);

            const toSides =
                splitEquation(to);


            if (
                fromSides &&
                toSides
            ) {

                const leftBefore =
                    fromSides.left;

                const leftAfter =
                    toSides.left;


                // ------------------------------------------------
                // Match:
                //
                // 3(x+2)
                // 2(x+3)
                // 5(x-4)
                //
                // ------------------------------------------------

                const distributionMatch =
                    leftBefore.match(
                        /^(-?\d+(?:\.\d+)?)\(([^()]+)\)$/
                    );


                if (distributionMatch) {

                    const outsideNumber =
                        Number(
                            distributionMatch[1]
                        );

                    const insideExpression =
                        distributionMatch[2];


                    // ------------------------------------------------
                    // Match:
                    //
                    // x+2
                    // 2x+4
                    // x-4
                    //
                    // ------------------------------------------------

                    const insideParts =
                        insideExpression.match(
                            /^(-?\d*\.?\d*)x([+-]\d+(?:\.\d+)?)$/
                        );


                    if (insideParts) {

                        let xCoefficient =
                            insideParts[1];


                        if (
                            xCoefficient === "" ||
                            xCoefficient === "+"
                        ) {

                            xCoefficient = 1;

                        } else if (
                            xCoefficient === "-"
                        ) {

                            xCoefficient = -1;

                        } else {

                            xCoefficient =
                                Number(
                                    xCoefficient
                                );
                        }


                        const constant =
                            Number(
                                insideParts[2]
                            );


                        const correctXCoefficient =
                            outsideNumber *
                            xCoefficient;

                        const correctConstant =
                            outsideNumber *
                            constant;


                        let expectedLeft =
                            `${correctXCoefficient}x`;


                        if (
                            correctConstant > 0
                        ) {

                            expectedLeft +=
                                `+${correctConstant}`;

                        } else if (
                            correctConstant < 0
                        ) {

                            expectedLeft +=
                                `${correctConstant}`;
                        }

                        const expectedEquation =
                            `${expectedLeft}=${toSides.right}`;

                        const normalizedStudent =
                            normalizeEquation(
                                leftAfter
                            );


                        // ------------------------------------------------
                        // Detect incomplete distribution
                        // ------------------------------------------------

                        const studentHasCorrectX =
                            normalizedStudent
                                .includes(
                                    `${correctXCoefficient}x`
                                );


                        const studentHasOriginalConstant =
                            normalizedStudent
                                .includes(
                                    String(
                                        Math.abs(
                                            constant
                                        )
                                    )
                                );


                        const studentHasCorrectConstant =
                            normalizedStudent
                                .includes(
                                    String(
                                        Math.abs(
                                            correctConstant
                                        )
                                    )
                                );


                        if (
                            studentHasCorrectX &&
                            studentHasOriginalConstant &&
                            !studentHasCorrectConstant
                        ) {

                            return {

                                type:
                                    "failed_to_distribute",

                                concept:
                                    "distributive_property",

                                confidence:
                                    0.98,

                                message:
                                    `You multiplied ${outsideNumber} by the x term, but did not multiply it by ${constant}.`,

                                hint:
                                    `Distribute ${outsideNumber} to BOTH terms inside the parentheses.`,

                                incorrectStep:
                                    invalid.to,

                                correctStep:
                                    expectedEquation,

                                explanation:
                                    `Multiply both ${insideParts[1]} and ${insideParts[2]} by ${outsideNumber}. Keep the right side at ${toSides.right}.`
                            };
                        }


                        // ------------------------------------------------
                        // General distribution error
                        // ------------------------------------------------

                        return {

                            type:
                                "failed_to_distribute",

                            concept:
                                "distributive_property",

                            confidence:
                                0.95,

                            message:
                                "The number outside the parentheses was not distributed correctly.",

                            hint:
                                `Multiply ${outsideNumber} by every term inside the parentheses.`,

                            incorrectStep:
                                invalid.to,

                            correctStep:
                                expectedEquation,

                            explanation:
                                `Multiply every term inside the parentheses by ${outsideNumber}. Keep the right side at ${toSides.right}.`
                        };
                    }


                    // Parentheses exist but expression
                    // could not be analyzed precisely.
                    return {

                        type:
                            "failed_to_distribute",

                        concept:
                            "distributive_property",

                        confidence:
                            0.90,

                        message:
                            "The number outside the parentheses was not distributed correctly.",

                        hint:
                            `Multiply ${outsideNumber} by every term inside the parentheses.`,

                        incorrectStep:
                            invalid.to,

                        explanation:
                            "Remember to distribute the coefficient to every term inside the parentheses."
                    };
                }
            }
        }
    }


    // ========================================================
    // Generic distributive-property fallback
    // ========================================================

    if (
        question &&
        question.concept ===
            "distributive_property"
    ) {

        if (
            text.includes("(") &&
            /\d+x[+-]\d+/.test(text)
        ) {

            return {

                type:
                    "possible_distribution_error",

                concept:
                    "distributive_property",

                confidence:
                    0.70,

                message:
                    "Check whether the number outside the parentheses was multiplied by every term inside.",

                hint:
                    "Use the distributive property: a(b + c) = ab + ac."
            };
        }
    }


    return null;
}


// ============================================================
// 15. STEP ML PREDICTION
// ============================================================

async function predictStepWithML(
    previousStep,
    currentStep
) {

    try {

        const response =
            await fetch(
                `${ML_API_URL}/predict-step`,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            previous_step:
                                previousStep,

                            current_step:
                                currentStep
                        })
                }
            );


        if (!response.ok) {

            const errorText =
                await response.text();

            console.error(
                "ML API error:",
                response.status,
                errorText
            );

            return null;
        }


        const result =
            await response.json();


        console.log(
            "ML step prediction:",
            result
        );


        return (
            result.data ||
            result
        );

    } catch (error) {

        console.error(
            "Unable to get prediction from ML service:",
            error
        );

        return null;
    }
}


// ============================================================
// 16. GENERAL MISCONCEPTION DETECTION
// ============================================================

// ============================================================
// 15b. RULE-BASED STEP CLASSIFIER
// ============================================================
//
// Looks at the first invalid step in the student's work and names
// the likely cause using exact linear algebra on both sides:
//
//   sign_error              constant/term sign flipped
//   wrong_inverse_op        moved a term with the wrong sign, or
//                           multiplied instead of divided (or reverse)
//   one_sided_op            changed only one side of the equation
//   combining_unlike_terms  x-terms and plain numbers merged
//   arithmetic_slip         right idea, wrong arithmetic
//
// Steps that expand parentheses are left to the distributive
// detector (except a flipped sign), so distribution errors keep
// their own label.
// ============================================================

const STEP_LABELS = {
    sign_error: {
        message: "There is a sign error in this step.",
        hint: "Check every + and - carefully when you expand or combine terms."
    },
    wrong_inverse_op: {
        message: "You used the wrong inverse operation in this step.",
        hint: "To undo + you subtract, to undo - you add, to undo multiplication you divide, and to undo division you multiply. Do it on both sides."
    },
    one_sided_op: {
        message: "You changed only one side of the equation.",
        hint: "Whatever you do to one side of an equation, you must do to the other side too."
    },
    combining_unlike_terms: {
        message: "You combined terms that are not like terms.",
        hint: "Only terms with the same variable part can be combined. x-terms and plain numbers stay separate."
    },
    arithmetic_slip: {
        message: "The method in this step looks right, but there is an arithmetic slip.",
        hint: "Recompute this step carefully."
    }
};

function linNear(x, y) {
    return Math.abs(x - y) < 0.000001;
}

function linSame(p, q) {
    return linNear(p.a, q.a) && linNear(p.b, q.b);
}

function linZero(p) {
    return linNear(p.a, 0) && linNear(p.b, 0);
}

function linDiff(p, q) {
    return { a: q.a - p.a, b: q.b - p.b };
}

// Ratio k such that q = k * p, or null if not proportional.
function linRatio(p, q) {
    if (linZero(p)) {
        return null;
    }
    const k = !linNear(p.a, 0) ? q.a / p.a : q.b / p.b;
    if (linNear(q.a, k * p.a) && linNear(q.b, k * p.b)) {
        return k;
    }
    return null;
}

function safeParse(expression) {
    try {
        return parseExpression(expression);
    } catch (error) {
        return null;
    }
}

// Returns undefined when the step is valid or unreadable,
// otherwise a label string, or null (invalid but unclassified).
function classifyStepError(from, to) {

    const f = normalizeEquation(from);
    const t = normalizeEquation(to);

    const fe = splitEquation(f);
    const te = splitEquation(t);

    // ---------------- equation steps ----------------
    if (fe && te) {

        const L1 = safeParse(fe.left),  R1 = safeParse(fe.right);
        const L2 = safeParse(te.left),  R2 = safeParse(te.right);

        if (!L1 || !R1 || !L2 || !R2) {
            return undefined;
        }

        if (equationsEquivalent(f, t)) {
            return undefined;
        }

        // Expansion steps: only flag a flipped constant sign here.
        if (f.includes("(")) {
            if (
                linNear(L2.a, L1.a) &&
                linNear(L2.b, -L1.b) &&
                !linNear(L1.b, 0) &&
                linSame(R1, R2)
            ) {
                return "sign_error";
            }
            return null;
        }

        const dL = linDiff(L1, L2);
        const dR = linDiff(R1, R2);

        // Only one side changed
        if (linZero(dL) !== linZero(dR)) {
            return "one_sided_op";
        }

        // Added/subtracted the opposite amount on each side
        if (!linZero(dL) && linNear(dL.a, -dR.a) && linNear(dL.b, -dR.b)) {
            const rightRaw = t.split("=")[1]?.trim() || "";
            if (
                linNear(L1.a, 1) && linNear(L2.a, 1) &&
                linNear(L2.b, 0) && linNear(R2.a, 0) &&
                /^[-+]?\d+(?:\.\d+)?$/.test(rightRaw)
            ) {
                return "arithmetic_slip";
            }
            return "wrong_inverse_op";
        }

        // Subtracted or added coefficient instead of dividing (or reverse)
        if (
            linNear(L1.b, 0) && linNear(L2.b, 0) && linNear(L2.a, 1) &&
            !linNear(L1.a, 1) && !linNear(L1.a, 0) &&
            linNear(R1.a, 0) && linNear(R2.a, 0)
        ) {
            const coeff = L1.a;
            if (linNear(R2.b, R1.b - coeff) || linNear(R2.b, R1.b + coeff)) {
                return "wrong_inverse_op";
            }
        }
        if (
            linNear(R1.b, 0) && linNear(R2.b, 0) && linNear(R2.a, 1) &&
            !linNear(R1.a, 1) && !linNear(R1.a, 0) &&
            linNear(L1.a, 0) && linNear(L2.a, 0)
        ) {
            const coeff = R1.a;
            if (linNear(L2.b, L1.b - coeff) || linNear(L2.b, L1.b + coeff)) {
                return "wrong_inverse_op";
            }
        }

        // Multiplied one side by k and the other by 1/k
        const kL = linRatio(L1, L2);
        const kR = linRatio(R1, R2);

        if (
            kL !== null && kR !== null &&
            !linNear(kL, 1) &&
            linNear(kL * kR, 1)
        ) {
            return "wrong_inverse_op";
        }

        return "arithmetic_slip";
    }

    // ---------------- expression steps ----------------
    if (!fe && !te) {

        const E1 = safeParse(f);
        const E2 = safeParse(t);

        if (!E1 || !E2 || linSame(E1, E2)) {
            return undefined;
        }

        // Constant sign flipped
        if (
            linNear(E2.a, E1.a) &&
            linNear(E2.b, -E1.b) &&
            !linNear(E1.b, 0)
        ) {
            return "sign_error";
        }

        // Every minus treated as plus
        const asPlus = safeParse(f.replace(/(?!^)-/g, "+"));
        if (asPlus && linSame(asPlus, E2)) {
            return "sign_error";
        }

        // Constant disappeared into the x-term
        if (linNear(E2.b, 0) && !linNear(E1.b, 0)) {
            return "combining_unlike_terms";
        }

        return "arithmetic_slip";
    }

    return undefined;
}

// Walks the written work and returns the first genuinely invalid step.
function findArrowStepError(work) {
    const steps = cleanWork(work);
    if (steps.length === 1 && /(?:->|=>|→|⇒)/.test(steps[0])) {
        const arrowSteps = steps[0].split(/\s*(?:->|=>|→|⇒)\s*/).filter(Boolean);
        for (let i = 1; i < arrowSteps.length; i++) {
            const label = classifyStepError(arrowSteps[i - 1], arrowSteps[i]);
            if (label !== undefined) {
                return {
                    from: arrowSteps[i - 1],
                    to: arrowSteps[i],
                    label
                };
            }
        }
    }
    return null;
}

function findFirstStepError(work) {

    // Treat arrows and newlines as equivalent step separators so every
    // answer path validates the same transitions in the student's work.
    const steps = cleanWork(work).flatMap(line =>
        line.split(/\s*(?:->|=>|→|⇒)\s*/).filter(Boolean)
    );

    for (let i = 1; i < steps.length; i++) {

        const label = classifyStepError(steps[i - 1], steps[i]);

        if (label !== undefined) {
            return {
                from: steps[i - 1],
                to: steps[i],
                label
            };
        }
    }

    return null;
}

function buildStepDiagnosis(question, stepError, finalAnswerCorrect) {

    const info = STEP_LABELS[stepError.label];
    const correctStep =
        getCanonicalCorrectStep(question, stepError.from);

    const prefix = finalAnswerCorrect
        ? "Your final answer is right, but one of your steps is not: "
        : "";

    return {
        detected: true,
        type: stepError.label,
        concept: question.concept,
        confidence: 0.9,
        message: prefix + info.message,
        hint: info.hint,
        incorrectStep: stepError.to,
        previousStep: stepError.from,
        correctStep,
        explanation: correctStep
            ? `From ${stepError.from}, the matching worked-solution step is ${correctStep}.`
            : null,
        source: "rules"
    };
}

function getCanonicalCorrectStep(question, fromStep) {
    const equationSteps = (question.solution_steps || [])
        .filter(step => splitEquation(step));

    for (let index = 0; index < equationSteps.length - 1; index++) {
        if (equationsEquivalent(fromStep, equationSteps[index])) {
            return equationSteps[index + 1];
        }
    }

    return null;
}

function diagnoseFromLlmReview({
    question,
    work,
    finalAnswerCorrect,
    llmReview
}) {
    if (
        !llmReview ||
        !llmReview.label
    ) {
        return null;
    }

    const info = STEP_LABELS[llmReview.label];

    if (!info) {
        return null;
    }

    const workLines = cleanWork(work);
    if (
        typeof llmReview.incorrectStep !== "string" ||
        !workLines.includes(llmReview.incorrectStep)
    ) {
        return null;
    }

    const prefix = finalAnswerCorrect
        ? "Your final answer is right, but one of your steps may be incorrect: "
        : "";
    const correctStep = getVerifiedLlmCorrection(workLines, llmReview);

    return {
        detected: true,
        type: llmReview.label,
        concept: question.concept,
        confidence: Number.isFinite(llmReview.confidence)
            ? Math.min(llmReview.confidence, 0.75)
            : 0,
        message: prefix + info.message,
        hint: info.hint,
        incorrectStep: llmReview.incorrectStep,
        correctStep,
        explanation: correctStep ? llmReview.explanation : null,
        source: "llm"
    };
}

function getVerifiedLlmCorrection(workLines, llmReview) {
    if (typeof llmReview.correctStep !== "string") {
        return null;
    }

    const incorrectIndex = workLines.indexOf(llmReview.incorrectStep);
    if (incorrectIndex < 1) {
        return null;
    }

    const previousStep = workLines[incorrectIndex - 1];
    const incorrectStep = workLines[incorrectIndex];
    const correctStep = llmReview.correctStep;

    if (
        !splitEquation(previousStep) ||
        !splitEquation(incorrectStep) ||
        !splitEquation(correctStep) ||
        equationsEquivalent(previousStep, incorrectStep) ||
        !equationsEquivalent(previousStep, correctStep) ||
        equationsEquivalent(correctStep, incorrectStep)
    ) {
        return null;
    }

    return correctStep;
}

async function detectMisconception(
    question,
    studentAnswer,
    work,
    {
        llmReview
    } = {}
) {

    const submittedWork = String(work || "");
    work = submittedWork.replace(/\*\s*\(/g, "(");
    const correct = isAnswerCorrect(studentAnswer, question.answer);


    const validation =
        validateWorkSteps(work);

    const llmDiagnosis = llmReview
        ? diagnoseFromLlmReview({
            question,
            work: submittedWork,
            finalAnswerCorrect: correct,
            llmReview
        })
        : null;


    // ========================================================
    // Correct final answer
    // ========================================================

    if (correct) {

        // Right answer, but do the written steps hold up?
        const flawedStep = findFirstStepError(work);

        if (flawedStep) {

            let diagnosis = null;

            if (
                question.concept === "distributive_property" &&
                (!flawedStep.label ||
                    flawedStep.label === "failed_to_distribute")
            ) {
                const dist = detectDistributiveMisconception(question, work, validation);
                if (dist && dist.type === "failed_to_distribute") {
                    diagnosis = {
                        detected: true,
                        ...dist,
                        explanation:
                            dist.explanation ||
                            "Multiply every term inside the parentheses by the outside coefficient.",
                        message: "Your final answer is right, but one of your steps is not: " + dist.message
                    };
                }
            }

            if (!diagnosis && flawedStep.label) {
                diagnosis = buildStepDiagnosis(question, flawedStep, true);
            }

            if (diagnosis) {
                return {
                    ...diagnosis,
                    workValidation: validation,
                    mlPrediction: null
                };
            }
        }

        if (llmDiagnosis) {
            return {
                ...llmDiagnosis,
                workValidation: validation,
                mlPrediction: null
            };
        }

        return {

            detected: false,

            type: null,

            concept:
                question.concept,

            confidence: 1,

            message:
                "Correct answer.",

            hint: null,

            workValidation:
                validation,

            mlPrediction: null
        };
    }


    // ========================================================
    // MACHINE LEARNING STEP ANALYSIS
    // ========================================================

    let mlPrediction = null;


    if (
        validation &&
        validation.invalidStep
    ) {

        const invalid =
            validation.invalidStep;


        mlPrediction =
            // Call through module.exports so tests can mock this method.
            await module.exports.predictStepWithML(
                invalid.from,
                invalid.to
            );
    }


    // ========================================================
    // RULE-BASED STEP DIAGNOSIS (exact algebra on both sides)
    // ========================================================

    const stepError = findFirstStepError(work);

    if (
        question.concept === "distributive_property" &&
        (!stepError || !stepError.label ||
            stepError.label === "failed_to_distribute")
    ) {
        const distributiveError =
            detectDistributiveMisconception(question, work, validation);

        if (distributiveError) {
            return {
                detected: true,
                ...distributiveError,
                workValidation: validation,
                mlPrediction
            };
        }
    }

    if (stepError && stepError.label) {

        return {
            ...buildStepDiagnosis(question, stepError, false),
            workValidation: validation,
            mlPrediction
        };
    }

    if (llmDiagnosis) {
        return {
            ...llmDiagnosis,
            workValidation: validation,
            mlPrediction
        };
    }

    const arrowStepError = findArrowStepError(work);
    if (arrowStepError && arrowStepError.label) {
        return {
            ...buildStepDiagnosis(question, arrowStepError, false),
            workValidation: validation,
            mlPrediction
        };
    }

    // ========================================================
    // DISTRIBUTIVE PROPERTY
    // ========================================================
    //
    // IMPORTANT:
    //
    // Rule-based mathematical analysis gets priority
    // for distributive-property questions.
    //
    // ML prediction is still returned as supporting data.
    //
    // ========================================================

    // ========================================================
    // ML DETECTED A MISCONCEPTION
    // ========================================================

    if (
        mlPrediction &&
        mlPrediction.prediction &&
        mlPrediction.prediction !==
            "correct_transformation"
    ) {

        const type =
            mlPrediction.prediction;


        const messages = {

            failed_to_distribute:
                "You did not distribute the outside number to every term inside the parentheses.",

            sign_error:
                "There appears to be a sign error in this step.",

            incorrect_operation:
                "The operation in this step changes the equation incorrectly."
        };


        const hints = {

            failed_to_distribute:
                "Multiply the number outside the parentheses by every term inside.",

            sign_error:
                "Check the signs carefully when moving or changing terms.",

            incorrect_operation:
                "Check the arithmetic and make sure the same valid operation is applied correctly."
        };


        return {

            detected: true,

            type,

            concept:
                question.concept,

            confidence:
                mlPrediction.confidence ||
                0,

            message:
                messages[type] ||
                "This step contains a mathematical error.",

            hint:
                hints[type] ||
                "Check this transformation carefully.",

            workValidation:
                validation,

            mlPrediction
        };
    }


    // ========================================================
    // FALLBACK
    // ========================================================

    if (
        validation &&
        validation.invalidStep
    ) {

        return {

            detected: true,

            type:
                "invalid_transformation",

            concept:
                question.concept,

            confidence:
                0.85,

            message:
                correct
                    ? `Your final answer is right, but ${validation.invalidStep.message.charAt(0).toLowerCase()}${validation.invalidStep.message.slice(1)}`
                    : validation.invalidStep.message,

            hint:
                "Check what operation you performed on both sides of the equation.",

            workValidation:
                validation,

            mlPrediction
        };
    }


    // ========================================================
    // UNKNOWN ERROR
    // ========================================================

    return {

        detected: false,

        type:
            "unknown_error",

        concept:
            question.concept,

        confidence: 0,

        message:
            "The answer is incorrect, but the exact misconception could not be identified.",

        hint:
            "Review your equation transformations and try again.",

        workValidation:
            validation,

        mlPrediction
    };
}


// ============================================================
// 17. ANALYZE ANSWER
// ============================================================

async function analyzeAnswer({

    questionId,

    studentAnswer,

    work = ""

}) {

    const question =
        questionService.findQuestionById(
            questionId
        );


    if (!question) {

        throw new Error(
            `Question not found: ${questionId}`
        );
    }


    let llmReview = null;

    try {
        llmReview = await llmReviewService.reviewSubmission({
            question: question.question,
            studentAnswer,
            correctAnswer: question.answer,
            work
        });
    } catch (error) {
        console.error(
            "LLM work review failed; continuing with deterministic analysis:",
            error.message
        );
    }

    const correct = isAnswerCorrect(studentAnswer, question.answer);

    const misconception =
        await detectMisconception(
            question,
            studentAnswer,
            work,
            {
                llmReview
            }
        );


    return {

        questionId:
            question.id,

        concept:
            question.concept,

        difficulty:
            question.difficulty,

        studentAnswer,

        correctAnswer:
            question.answer,

        correct,

        misconception:
            misconception,

        correctnessSource:
            "rules",

        solutionSteps:
            question.solution_steps,

        explanation:
            question.explanation
    };
}


// ============================================================
// 18. CREATE ML INPUT
// ============================================================

function createMLInput({

    question,

    attemptCount = 0,

    correctRate = 0,

    recentAccuracy = 0,

    misconceptionCount = 0,

    previousCorrect = 0

}) {

    if (!question) {

        throw new Error(
            "Question is required to create ML input."
        );
    }


    return {

        difficulty:
            question.difficulty,

        attempt_count:
            attemptCount,

        correct_rate:
            correctRate,

        recent_accuracy:
            recentAccuracy,

        misconception_count:
            misconceptionCount,

        previous_correct:
            previousCorrect,

        concept:
            question.concept
    };
}


// ============================================================
// 19. CREATE FEEDBACK
// ============================================================

function createFeedback(analysis) {

    if (!analysis) {

        return {

            type: "error",

            message:
                "Unable to analyze the answer."
        };
    }


    // Correct
    if (
        analysis.correct
    ) {

        return {

            type: "success",

            message:
                "Correct! Great work.",

            hint: null
        };
    }


    // Targeted misconception
    if (
        analysis.misconception &&
        analysis.misconception.detected
    ) {

        return {

            type: "targeted",

            message:
                analysis.misconception.message,

            hint:
                analysis.misconception.hint,

            misconception:
                analysis.misconception.type,

            workValidation:
                analysis.misconception.workValidation,

            incorrectStep:
                analysis.misconception.incorrectStep ||
                null,

            correctStep:
                analysis.misconception.correctStep ||
                null,

            explanation:
                analysis.misconception.explanation ||
                null
        };
    }


    // General incorrect answer
    return {

        type: "general",

        message:
            "Your answer is not correct.",

        hint:
            analysis.misconception?.hint ||
            "Review your solution and try again.",

        workValidation:
            analysis.misconception?.workValidation
    };
}


// ============================================================
// 20. MISCONCEPTION CONTRIBUTION
// ============================================================

function getMisconceptionContribution(
    analysis
) {

    if (
        analysis &&
        analysis.misconception &&
        analysis.misconception.detected
    ) {

        return 1;
    }

    return 0;
}


// ============================================================
// 21. EXPORTS
// ============================================================

module.exports = {

    normalizeAnswer,

    isAnswerCorrect,

    detectDistributiveMisconception,

    detectMisconception,

    analyzeAnswer,

    createMLInput,

    createFeedback,

    getMisconceptionContribution,

    cleanWork,

    parseExpression,

    parseEquation,

    equationsEquivalent,

    detectOperation,

    predictStepWithML,

    validateWorkSteps
};
