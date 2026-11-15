# Running a two-week study with real students

The goal is one honest sentence backed by real data, for example:

> Across 14 students, the sign mistake appeared in 31% of answers before they taught it to their twin and 17% after (8 improved, 4 unchanged, 2 worse).

That is worth more than any new feature. This guide covers how to get it without overclaiming.

## 1. Before you start

**Permission.** If your students are under 18, run the study through a teacher, with the school's agreement and a note home to parents. Students must be free to say no, and to leave at any point without it affecting their grades. Keep a copy of what you sent.

A short note you can adapt:

> Our class is trying StudyTwin, a free maths practice tool that checks each line of working and points out the first mistake. For two weeks students will use it for about 15 minutes, three times a week. StudyTwin stores the answers and working they type, the mistakes it finds, and the first name or nickname they choose. It does not store photos, email addresses or surnames. The results will be shared only as class totals, with no names. Your child can stop using it at any time. Questions: [contact].

**Data.** StudyTwin stores only what the note says. Photos of working are read and immediately discarded. A student can delete everything with *Reset my progress*. The teacher's CSV export numbers students S01, S02… instead of naming them.

**Size.** Aim for 10–20 students. With fewer than about 8 who taught their twin the same mistake, report each student's result rather than a percentage.

## 2. Setting up

1. Open `/teacher.html` on the live site and create the class. **Save the teacher link straight away.** It's the only way back in.
2. Put the class code on the board, or share the join link (`/?class=CODE`).
3. Each student opens StudyTwin, joins with the code and their first name or a nickname, and practises.

## 3. The two weeks

| When | What students do | Why |
|---|---|---|
| Days 1–5 | Normal practice only, about 15 minutes a session, 3 sessions | Builds the "before" baseline: at least 10 answers each, so their usual mistakes show |
| Days 6–10 | Practice plus *Teach your twin* (5 lessons a session), and a trap round when one is suggested | The "after" period |
| End | Nothing new | Download the CSVs and analyse them |

Keep the amount of practice in both weeks about the same. If students simply practise more in week 2, any improvement can't be credited to the twin.

## 4. What to look at

On the teacher page, **Is it working?** pools the Twin Effect across the class. For each mistake it shows:

- the rate before and after teaching, with the raw counts (e.g. 8 of 25 → 4 of 31)
- how many students improved, stayed the same or got worse
- trap-round cures, and whether each cured mistake came back in later answers

Write down the counts, not just the percentages.

## 5. Checking the checker

The numbers are only as good as StudyTwin's mistake detection, so check it against human judgement:

1. On the teacher page, choose **Download for labelling**. You get a CSV with an empty `gold` column and none of StudyTwin's own labels, so the labeller isn't influenced.
2. Label 100–200 rows by hand. Valid labels are `failed_to_distribute`, `sign_error`, `wrong_inverse_op`, `one_sided_op`, `arithmetic_slip`, `combining_unlike_terms`, `correct` and `no_evidence`. Ideally a second person labels the same rows, and you settle any disagreements.
3. Score it:

   ```bash
   cd Server
   node eval/run_eval.js --real-data path/to/labelled.csv
   ```

Report the agreement alongside the Twin Effect, for example "the checker agreed with a teacher on 87% of 150 answers".

## 6. Reporting honestly

- **Give the numbers behind every percentage**: "8 of 25 answers", not just "32%".
- **Say what this design can't rule out.** There is no comparison group, so some improvement would happen with practice alone, and students whose mistakes were unusually frequent tend to make them less often next time anyway.
- **Report the students who didn't improve**, as well as those who did.
- **A stronger version.** Split the class at random: half teach their twin in week 2, half keep practising normally. Then compare the two halves' change. If you do this, decide the split before looking at any results.

## 7. After the study

Thank the class and show them the class totals. Delete the class data when it is no longer needed: each student can use *Reset my progress*, or remove it from the database directly.
