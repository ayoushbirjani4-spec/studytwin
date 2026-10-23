
// ============================================================
// StudyTwin ML Service
// ============================================================
//
// This service connects the Node.js backend to the
// Python FastAPI ML service.
//
// Flow:
//
// Node.js
//    ↓
// mlService.js
//    ↓
// FastAPI /predict
//    ↓
// predict.py
//    ↓
// model.pkl
//    ↓
// ML prediction
//
// ============================================================

const axios = require("axios");


// ============================================================
// FASTAPI URL
// ============================================================

const ML_API_URL =
    process.env.ML_API_URL || "http://127.0.0.1:8000";


// ============================================================
// CHECK ML SERVICE
// ============================================================

async function checkMLHealth() {

    try {

        const response = await axios.get(
            `${ML_API_URL}/health`
        );

        return {
            success: true,
            data: response.data
        };

    } catch (error) {

        return {
            success: false,
            error: "ML service is unavailable."
        };
    }
}


// ============================================================
// SEND STUDENT DATA TO ML MODEL
// ============================================================

async function predictStudent(studentData) {

    try {

        // ----------------------------------------------------
        // Send POST request to FastAPI
        // ----------------------------------------------------

        const response = await axios.post(
            `${ML_API_URL}/predict`,
            {
                difficulty: studentData.difficulty,
                attempt_count: studentData.attempt_count,
                correct_rate: studentData.correct_rate,
                recent_accuracy: studentData.recent_accuracy,
                misconception_count:
                    studentData.misconception_count,
                previous_correct:
                    studentData.previous_correct,
                concept: studentData.concept
            }
        );


        // ----------------------------------------------------
        // Return ML result
        // ----------------------------------------------------

        return {
            success: true,
            data: response.data
        };

    } catch (error) {

        console.error(
            "ML prediction error:",
            error.message
        );

        return {
            success: false,
            error: "Unable to get prediction from ML service."
        };
    }
}


// ============================================================
// GET PREDICTION + RECOMMENDATION
// ============================================================
//
// This helper makes the response easier for the rest
// of the application to use.
//
// ============================================================

async function getLearningRecommendation(studentData) {

    const result =
        await predictStudent(studentData);


    if (!result.success) {

        return {
            success: false,
            error: result.error
        };
    }


    const mlData =
        result.data.data;


    return {

        success: true,

        source: "ml",

        prediction:
            mlData.prediction,

        probabilityCorrect:
            mlData.probability_correct,

        probabilityPercent:
            mlData.probability_percent,

        recommendedDifficulty:
            mlData.recommended_difficulty,

        recommendation:
            mlData.recommendation
    };
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    checkMLHealth,

    predictStudent,

    getLearningRecommendation
};
