"""
StudyTwin Step Misconception Training Data

Synthetic training examples for recognizing common
algebra transformation errors.
"""


def get_training_data():

    return [

        # ====================================================
        # CORRECT DISTRIBUTION
        # ====================================================

        {
            "previous": "4(x - 2) = 20",
            "current": "4x - 8 = 20",
            "label": "correct_transformation"
        },

        {
            "previous": "2(x + 3) = 14",
            "current": "2x + 6 = 14",
            "label": "correct_transformation"
        },

        {
            "previous": "3(x + 2) = 15",
            "current": "3x + 6 = 15",
            "label": "correct_transformation"
        },

        {
            "previous": "5(x + 4) = 35",
            "current": "5x + 20 = 35",
            "label": "correct_transformation"
        },

        {
            "previous": "3(2x - 4) = 24",
            "current": "6x - 12 = 24",
            "label": "correct_transformation"
        },


        # ====================================================
        # CORRECT ADDITION / SUBTRACTION
        # ====================================================

        {
            "previous": "4x - 8 = 20",
            "current": "4x = 28",
            "label": "correct_transformation"
        },

        {
            "previous": "2x + 6 = 14",
            "current": "2x = 8",
            "label": "correct_transformation"
        },

        {
            "previous": "3x - 6 = 15",
            "current": "3x = 21",
            "label": "correct_transformation"
        },

        {
            "previous": "5x + 10 = 35",
            "current": "5x = 25",
            "label": "correct_transformation"
        },


        # ====================================================
        # CORRECT DIVISION
        # ====================================================

        {
            "previous": "4x = 28",
            "current": "x = 7",
            "label": "correct_transformation"
        },

        {
            "previous": "2x = 8",
            "current": "x = 4",
            "label": "correct_transformation"
        },

        {
            "previous": "3x = 21",
            "current": "x = 7",
            "label": "correct_transformation"
        },


        # ====================================================
        # FAILED DISTRIBUTION
        # ====================================================

        {
            "previous": "4(x - 2) = 20",
            "current": "4x - 2 = 20",
            "label": "failed_to_distribute"
        },

        {
            "previous": "5(x + 4) = 35",
            "current": "5x + 4 = 35",
            "label": "failed_to_distribute"
        },

        {
            "previous": "3(x + 2) = 15",
            "current": "3x + 2 = 15",
            "label": "failed_to_distribute"
        },

        {
            "previous": "2(x + 3) = 14",
            "current": "2x + 3 = 14",
            "label": "failed_to_distribute"
        },

        {
            "previous": "3(2x - 4) = 24",
            "current": "6x - 4 = 24",
            "label": "failed_to_distribute"
        },


        # ====================================================
        # DISTRIBUTION SIGN ERRORS
        # ====================================================

        {
            "previous": "4(x - 2) = 20",
            "current": "4x + 8 = 20",
            "label": "sign_error"
        },

        {
            "previous": "3(x - 5) = 12",
            "current": "3x + 15 = 12",
            "label": "sign_error"
        },

        {
            "previous": "2(x - 4) = 10",
            "current": "2x + 8 = 10",
            "label": "sign_error"
        },


        # ====================================================
        # SIGN ERRORS DURING EQUATION SOLVING
        # ====================================================

        {
            "previous": "4x - 8 = 20",
            "current": "4x = 12",
            "label": "sign_error"
        },

        {
            "previous": "2x - 6 = 14",
            "current": "2x = 8",
            "label": "sign_error"
        },

        {
            "previous": "3x + 6 = 15",
            "current": "3x = 21",
            "label": "sign_error"
        },

        {
            "previous": "5x - 10 = 30",
            "current": "5x = 20",
            "label": "sign_error"
        },


        # ====================================================
        # INCORRECT OPERATIONS
        # ====================================================

        {
            "previous": "4x - 8 = 20",
            "current": "4x = 20",
            "label": "incorrect_operation"
        },

        {
            "previous": "2x + 6 = 14",
            "current": "2x = 14",
            "label": "incorrect_operation"
        },

        {
            "previous": "3x - 6 = 15",
            "current": "3x = 15",
            "label": "incorrect_operation"
        },

        {
            "previous": "4x = 28",
            "current": "x = 28",
            "label": "incorrect_operation"
        },

        {
            "previous": "5x = 25",
            "current": "x = 25",
            "label": "incorrect_operation"
        },

        {
            "previous": "3x = 21",
            "current": "x = 21",
            "label": "incorrect_operation"
        },


        # ====================================================
        # MORE CORRECT TRANSFORMATIONS
        # ====================================================

        {
            "previous": "6x + 12 = 30",
            "current": "6x = 18",
            "label": "correct_transformation"
        },

        {
            "previous": "7x - 14 = 28",
            "current": "7x = 42",
            "label": "correct_transformation"
        },

        {
            "previous": "8x = 40",
            "current": "x = 5",
            "label": "correct_transformation"
        },

        {
            "previous": "9x = 45",
            "current": "x = 5",
            "label": "correct_transformation"
        },

    ]