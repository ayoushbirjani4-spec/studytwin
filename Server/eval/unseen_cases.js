// UNSEEN SET: independent evaluation set of 31 submissions
// Not used during initial rule construction or tuning.
// Tests whether StudyTwin generalizes to unseen submissions.
const C = (q, a, w, gold, answerCorrect = false, note = "") =>
  ({ q, a, w, gold, answerCorrect, note });

module.exports = [
  // ---- 1. Correct solutions & valid alternative methods (8 cases) ----
  C("dp_004", "3", "5(x+4)=35\n(x+4)=7\nx+4=7\nx=3", "correct", true, "divide first alternative"),
  C("dp_005", "6", "3(2x-4)=24\n2x-4=8\n2x=12\nx=6", "correct", true, "divide by 3 first"),
  C("clt_005", "7x+11", "6x-2x+3x+4+7\n4x+3x+11\n7x+11", "correct", true, "rearranged terms first"),
  C("io_005", "6", "4x+7=31\n4x=24\nx=6", "correct", true, "standard clean multi-step"),
  C("eb_005", "7", "5x-7=28\n5x-7+7=28+7\n5x=35\nx=7", "correct", true, "both sides written out"),
  C("eb_004", "5", "3x+4=19\n3x=15\nx=5", "correct", true, "clean standard steps"),
  C("clt_004", "11x-3", "8x+3x-5+2\n11x-3", "correct", true, "regrouped then simplified"),
  C("dp_001", "4", "2(x+3)=14\nx+3=7\nx=4", "correct", true, "divide first alternative"),

  // ---- 2. Distribution errors: failed_to_distribute (4 cases) ----
  C("dp_004", "6.2", "5(x+4)=35\n5x+4=35\n5x=31\nx=6.2", "failed_to_distribute", false, "multiplied x, forgot 4"),
  C("dp_005", "28/6", "3(2x-4)=24\n6x-4=24\n6x=28\nx=28/6", "failed_to_distribute", false, "multiplied 2x, forgot -4"),
  C("dp_002", "13/3", "3(x+2)=15\n3x+2=15\n3x=13\nx=13/3", "failed_to_distribute", false, "multiplied x, forgot 2"),
  C("dp_001", "8", "2(x+3)=14\nx+6=14\nx=8", "failed_to_distribute", false, "multiplied 3, forgot x"),

  // ---- 3. Sign errors (4 cases) ----
  C("clt_004", "11x+3", "8x-5+3x+2\n11x+3", "sign_error", false, "constant sign error"),
  C("clt_002", "10x", "7x-3x\n10x", "sign_error", false, "added instead of subtracted"),
  C("dp_003", "3", "4(x-2)=20\n4x+8=20\n4x=12\nx=3", "sign_error", false, "flipped sign in expansion"),
  C("dp_005", "2", "3(2x-4)=24\n6x+12=24\n6x=12\nx=2", "sign_error", false, "flipped sign in expansion"),

  // ---- 4. Wrong inverse operations (5 cases) ----
  C("io_001", "17", "x+5=12\nx=12+5\nx=17", "wrong_inverse_op", false, "added instead of subtracted"),
  C("io_003", "54", "3x=18\nx=18*3\nx=54", "wrong_inverse_op", false, "multiplied instead of divided"),
  C("io_004", "4/5", "x/5=4\nx=4/5", "wrong_inverse_op", false, "divided instead of multiplied"),
  C("eb_004", "23/3", "3x+4=19\n3x=23\nx=23/3", "wrong_inverse_op", false, "added 4 instead of subtracting"),
  C("eb_003", "32", "2x=16\nx=16*2\nx=32", "wrong_inverse_op", false, "multiplied instead of divided"),

  // ---- 5. One-sided operations (2 cases) ----
  C("eb_001", "8", "x+3=8\nx=8", "one_sided_op", false, "subtracted from left only"),
  C("eb_004", "19/3", "3x+4=19\n3x=19\nx=19/3", "one_sided_op", false, "subtracted 4 from left only"),

  // ---- 6. Combining unlike terms (2 cases) ----
  C("clt_003", "14x", "4x+3+2x+5\n14x", "combining_unlike_terms", false, "merged constants into x"),
  C("clt_004", "8x", "8x-5+3x+2\n8x", "combining_unlike_terms", false, "merged all terms"),

  // ---- 7. Arithmetic slips (2 cases) ----
  C("dp_001", "4.5", "2(x+3)=14\n2x+6=14\n2x=9\nx=4.5", "arithmetic_slip", false, "14-6 computed as 9"),
  C("io_005", "8", "4x+7=31\n4x=24\nx=8", "arithmetic_slip", false, "24/4 computed as 8"),

  // ---- 8. Correct answers with flawed work (2 cases) ----
  C("dp_004", "3", "5(x+4)=35\n5x+4=35\n5x=15\nx=3", "failed_to_distribute", true, "correct final answer but missed distribution"),
  C("dp_002", "3", "3(x+2)=15\n3x+2=15\n3x=9\nx=3", "failed_to_distribute", true, "correct final answer but missed distribution"),

  // ---- 9. Submissions without working (2 cases) ----
  C("dp_001", "9", "", "no_evidence", false, "blank work"),
  C("io_003", "12", "I have no idea how to do this", "no_evidence", false, "unstructured text without steps")
];
