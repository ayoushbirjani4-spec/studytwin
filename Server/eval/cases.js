// Hand-written evaluation set for StudyTwin's misconception detector.
// gold = what a human teacher would say is going on in the student's work.
// answerCorrect = whether the FINAL answer matches the question's answer.
// NOTE: written by one person who knows the rule engine. Replace/extend with
// real student work and a second labeler before quoting these numbers.
const C = (q, a, w, gold, answerCorrect = false, note = "") =>
  ({ q, a, w, gold, answerCorrect, note });

module.exports = [
  // ---------- correct, clean and messy formatting ----------
  C("dp_001","4","2(x+3)=14\n2x+6=14\n2x=8\nx=4","correct",true),
  C("dp_001","x=4","2(x+3)=14\n2x+6=14\n2x=8\nx=4","correct",true,"answer prefixed with x="),
  C("dp_003","7","4(x-2)=20\n4x-8=20\n4x=28\nx=7","correct",true),
  C("dp_004","3","5(x+4)=35\n5x+20=35\n5x=15\nx=3","correct",true),
  C("dp_005","6","3(2x-4)=24\n6x-12=24\n6x=36\nx=6","correct",true),
  C("dp_002","3","3(x + 2) = 15\n3x + 6 = 15\n3x = 9\nx = 3","correct",true,"spaces"),
  C("clt_003","6x+8","4x+3+2x+5\n6x+8","correct",true),
  C("clt_004","11x-3","8x-5+3x+2\n11x-3","correct",true),
  C("io_005","6","4x+7=31\n4x=24\nx=6","correct",true),
  C("io_004","20","x/5=4\nx=20","correct",true),
  C("eb_004","5","3x+4=19\n3x=15\nx=5","correct",true),
  C("eb_005","7","5x-7=28\n5x=35\nx=7","correct",true),
  C("io_002","14","x-4=10\nx=14","correct",true),
  C("clt_001","5x","3x+2x=5x","correct",true),
  C("dp_001","4.0","2(x+3)=14\n2x+6=14\n2x=8\nx=4","correct",true,"4.0"),
  C("dp_002","3","","correct",true,"correct, no work"),
  C("dp_001","x = 4 ","2(x+3)=14 => 2x+6=14 => 2x=8 => x=4","correct",true,"arrow chain"),
  C("dp_002","3","3(X+2)=15\n3X+6=15\n3X=9\nX=3","correct",true,"uppercase X"),
  C("io_004","20","x/5=4\nx=4*5\nx=20","correct",true),
  C("dp_004","3","5(x+4)=35\n5x+20=35\n5x=35-20\n5x=15\nx=3","correct",true,"extra step"),
  C("dp_003","7","4(x-2)=20\n4x-8=20\n4x=20+8\n4x=28\nx=7","correct",true,"extra step"),
  C("eb_005","7","5x-7=28\n5x=35\nx=35/5\nx=7","correct",true,"extra step"),

  // ---------- failed to distribute ----------
  C("dp_001","5.5","2(x+3)=14\n2x+3=14\n2x=11\nx=5.5","failed_to_distribute"),
  C("dp_002","13/3","3(x+2)=15\n3x+2=15\n3x=13\nx=13/3","failed_to_distribute"),
  C("dp_003","5.5","4(x-2)=20\n4x-2=20\n4x=22\nx=5.5","failed_to_distribute"),
  C("dp_004","31/5","5(x+4)=35\n5x+4=35\n5x=31\nx=31/5","failed_to_distribute"),
  C("dp_005","14/3","3(2x-4)=24\n6x-4=24\n6x=28\nx=14/3","failed_to_distribute"),
  C("dp_001","5.5","2(x + 3) = 14\n2x + 3 = 14\n2x = 11\nx = 5.5","failed_to_distribute",false,"spaces"),
  C("dp_002","13/3","3*(x+2)=15\n3x+2=15\n3x=13\nx=13/3","failed_to_distribute",false,"explicit *"),
  C("dp_004","31/5","5(x+4)=35\n5x+4=35\nx=31/5","failed_to_distribute",false,"skipped step"),
  C("dp_003","x=5.5","4(x-2)=20\n4x-2=20\n4x=22\nx=5.5","failed_to_distribute",false,"x= prefix"),
  C("dp_005","18","3(2x-4)=24\n2x-12=24\n2x=36\nx=18","failed_to_distribute",false,"first term not multiplied"),

  // ---------- sign errors ----------
  C("dp_003","3","4(x-2)=20\n4x+8=20\n4x=12\nx=3","sign_error"),
  C("dp_005","2","3(2x-4)=24\n6x+12=24\n6x=12\nx=2","sign_error"),
  C("clt_004","11x+3","8x-5+3x+2\n11x+3","sign_error"),
  C("clt_002","10x","7x-3x\n10x","sign_error",false,"treats minus as plus"),

  // ---------- wrong inverse operation ----------
  C("io_001","17","x+5=12\nx=12+5\nx=17","wrong_inverse_op"),
  C("io_002","6","x-4=10\nx=10-4\nx=6","wrong_inverse_op"),
  C("io_003","54","3x=18\nx=18*3\nx=54","wrong_inverse_op"),
  C("io_004","4/5","x/5=4\nx=4/5","wrong_inverse_op"),
  C("io_005","9.5","4x+7=31\n4x=31+7\n4x=38\nx=9.5","wrong_inverse_op"),
  C("eb_002","-4","x-6=2\nx=2-6\nx=-4","wrong_inverse_op"),
  C("eb_003","32","2x=16\nx=16*2\nx=32","wrong_inverse_op"),

  // ---------- one-sided operation (equation balance) ----------
  C("eb_004","19/3","3x+4=19\n3x=19\nx=19/3","one_sided_op"),
  C("eb_005","28/5","5x-7=28\n5x=28\nx=28/5","one_sided_op"),
  C("eb_001","8","x+3=8\nx=8","one_sided_op"),
  C("io_005","31/4","4x+7=31\n4x=31\nx=31/4","one_sided_op"),
  C("eb_003","16","2x=16\nx=16","one_sided_op"),

  // ---------- arithmetic slips ----------
  C("dp_001","4.5","2(x+3)=14\n2x+6=14\n2x=9\nx=4.5","arithmetic_slip"),
  C("dp_004","5","5(x+4)=35\n5x+20=35\n5x=15\nx=5","arithmetic_slip"),
  C("io_005","8","4x+7=31\n4x=24\nx=8","arithmetic_slip"),
  C("eb_004","4","3x+4=19\n3x=15\nx=4","arithmetic_slip"),
  C("clt_003","6x+7","4x+3+2x+5\n6x+7","arithmetic_slip"),
  C("clt_005","7x+10","6x+4-2x+7+3x\n7x+10","arithmetic_slip"),

  // ---------- combining unlike terms ----------
  C("clt_003","14x","4x+3+2x+5\n14x","combining_unlike_terms"),
  C("clt_004","11x","8x-5+3x+2\n11x","combining_unlike_terms"),

  // ---------- wrong answer, no work: system should NOT guess ----------
  C("dp_002","5","","no_evidence"),
  C("io_003","9","","no_evidence"),
  C("eb_001","4","","no_evidence"),
  C("clt_002","10x","","no_evidence"),
  C("dp_005","8","   ","no_evidence",false,"whitespace only"),

  // ---------- right answer, flawed work: should read the work ----------
  C("dp_001","4","2(x+3)=14\n2x+3=14\n2x=11\nx=4","failed_to_distribute",true,"answer right, work wrong"),
  C("dp_002","3","3(x+2)=15\n3x+2=15\n3x=13\nx=3","failed_to_distribute",true,"answer right, work wrong"),
];
