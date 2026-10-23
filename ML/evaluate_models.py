"""Honest evaluation of both StudyTwin ML models.
Run from the ML folder:  python evaluate_models.py
"""
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold, GroupShuffleSplit, cross_val_score, train_test_split
from sklearn.metrics import classification_report, roc_auc_score

print("=" * 60, "\nMODEL 1: step classifier (misconception label per step)\n" + "=" * 60)
s = pd.read_csv("generated_data/synthetic_step_training_data.csv")
y = s["label"]
num = [c for c in s.columns if c not in ("previous_step", "current_step", "concept", "operation", "label")]
X = pd.get_dummies(s[num + ["operation"]])

def acc(X, tag):
    a, b, c, d = train_test_split(X, y, test_size=.2, random_state=42, stratify=y)
    m = RandomForestClassifier(200, random_state=42).fit(a, c)
    print(f"  {tag:<38}{m.score(b, d):.3f}")
    return m, b, d

print("Random split (what the training script reports):")
m, b, d = acc(X, "all features")
if "is_valid" in X: acc(X.drop(columns=["is_valid"]), "without is_valid (from rule engine)")

print("\nTrain on some operation types, test on UNSEEN ones (real generalization):")
tr, te = next(GroupShuffleSplit(1, test_size=.3, random_state=1).split(X, y, s["operation"]))
m2 = RandomForestClassifier(200, random_state=42).fit(X.iloc[tr], y.iloc[tr])
print(f"  unseen operation accuracy               {m2.score(X.iloc[te], y.iloc[te]):.3f}")
print("  unseen operations:", sorted(s['operation'].iloc[te].unique()))
print("\nPer-class report (random split):")
print(classification_report(d, m.predict(b), zero_division=0))

print("=" * 60, "\nMODEL 2: next-answer predictor\n" + "=" * 60)
n = pd.read_csv("../data/studytwin_ml_training_data.csv")
target = n.columns[-1]
feats = [c for c in n.columns if c not in ("student_id", target) and pd.api.types.is_numeric_dtype(n[c])]
Xn, yn, g = n[feats], n[target], n["student_id"]
print("features:", feats, "| target:", target, "| rows:", len(n), "| students:", g.nunique())
base = max(yn.mean(), 1 - yn.mean())
print(f"Majority-class baseline accuracy: {base:.3f}")
cv = GroupKFold(5)  # split BY STUDENT so one student never appears in train and test
for name, mdl in [("LogisticRegression", LogisticRegression(max_iter=1000)),
                  ("RandomForest", RandomForestClassifier(200, random_state=42))]:
    a = cross_val_score(mdl, Xn, yn, cv=cv, groups=g, scoring="accuracy").mean()
    r = cross_val_score(mdl, Xn, yn, cv=cv, groups=g, scoring="roc_auc").mean()
    print(f"  {name:<20} accuracy {a:.3f}   ROC-AUC {r:.3f}")
print("\nIf accuracy is near the baseline, the model adds little over guessing 'always correct/incorrect'.")
print("Remember: this data is simulated, so even a high score only shows it learned the simulator.")
