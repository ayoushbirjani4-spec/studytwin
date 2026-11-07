// STRESS SET: written after the rules, trying to break them.
// Valid-but-unusual work (should not be flagged) and trickier wrong work.
const C = (q, a, w, gold, answerCorrect = false, note = "") =>
  ({ q, a, w, gold, answerCorrect, note });

module.exports = [
  // ---- valid but unusual work: must NOT be flagged ----
  C("dp_001","4","2(x+3)=14\n2x+6=14\n2x=14-6\n2x=8\nx=8/2\nx=4","correct",true,"many small steps"),
  C("dp_003","7","4(x-2)=20\n(x-2)=5\nx-2=5\nx=7","correct",true,"divide first"),
  C("io_005","6","4x+7=31\n4x+7-7=31-7\n4x=24\nx=6","correct",true,"both sides written out"),
  C("dp_002","3","3x + 6 = 15\n3x = 9\nx = 3","correct",true,"starts after expanding"),
  C("eb_003","8","2x=16\nx=16/2\nx=8","correct",true),
  C("io_001","7","x+5=12\nx=12-5\nx=7","correct",true),
  C("clt_003","6x+8","4x+2x+3+5\n6x+8","correct",true,"regrouped first"),
  C("dp_005","6","3(2x-4)=24\n2x-4=8\n2x=12\nx=6","correct",true,"divide first"),
  C("dp_002","3","3(x+2)=15\n3x+6=15\n3x=9\nx=3\nCheck: 3(3+2)=15","correct",true,"trailing check line"),
  C("io_004","20","x/5=4\n5*x/5=4*5\nx=20","correct",true,"multiply both sides written out"),

  // ---- wrong work, trickier ----
  C("dp_004","11","5(x+4)=35\n5x+20=35\n5x=35+20\n5x=55\nx=11","wrong_inverse_op",false,"expansion right, later step wrong"),
  C("dp_003","112","4(x-2)=20\n4x-8=20\n4x=28\nx=28*4","wrong_inverse_op",false,"multiplied instead of divided"),
  C("dp_005","2","3(2x-4)=24\n6x-12=24\n6x=12\nx=2","wrong_inverse_op",false,"subtracted 12 instead of adding"),
  C("io_005","20","4x+7=31\n4x=24\nx=24-4\nx=20","wrong_inverse_op",false,"subtracted instead of dividing"),
  C("eb_004","19/3","3x+4=19\n3x+4-4=19\n3x=19\nx=19/3","one_sided_op",false,"one-sided, written out"),
  C("clt_001","6x","3x+2x\n6x","arithmetic_slip",false,"multiplied coefficients"),
  C("eb_005","4.2","5x-7=28\n5x=21\nx=4.2","wrong_inverse_op"),
  C("dp_001","16","2(x+3)=14\n2x+6=14\n2x=8\nx=16","wrong_inverse_op",false,"multiplied instead of divided"),
  C("dp_003","4.5","4(x-2)=20\n4x-2=20\n4x=18\nx=4.5","failed_to_distribute",false,"two errors: first one counts"),
  C("dp_002","7","3x+6=15\n3x=21\nx=7","wrong_inverse_op",false,"starts after expanding"),
  C("io_002","6","x - 4 = 10 -> x = 10 - 4 -> x = 6","wrong_inverse_op",false,"arrow chain on one line"),
  C("eb_002","-4","x-6=2\nx=-4","wrong_inverse_op",false,"skipped step: subtracted 6 instead of adding"),

  // ---- no evidence ----
  C("dp_002","5","I dont know","no_evidence"),
  C("io_003","9","x=9","no_evidence",false,"only restates the answer"),
];
