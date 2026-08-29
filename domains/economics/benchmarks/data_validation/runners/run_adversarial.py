#!/usr/bin/env python3
# Data Validation Pack v1 adversarial driver - runs the pandas validator on each structural-defect fixture
# and records the resulting check statuses into results/adversarial.json (committed evidence for CI).
import json, os, sys, tempfile
import pandas as pd
ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", ".."))
DV = os.path.join(ROOT, "domains", "economics", "benchmarks", "data_validation")
sys.path.insert(0, os.path.join(DV, "runners"))
from run_python import run  # noqa: E402

BASE_RULES = json.load(open(os.path.join(DV, "rules.json"), "r", encoding="utf-8"))
def rowcount(csvfile): return len(pd.read_csv(os.path.join(DV, "fixtures", csvfile)))

cases = {}
def case(name, csvfile, rules):
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8")
    json.dump(rules, f); f.close()
    tf = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False, encoding="utf-8"); tf.close()
    try:
        res = run(os.path.join(DV, "fixtures", csvfile), f.name, tf.name)
        cases[name] = {"n": res["n"], "checks": {c["check_id"]: c["status"] for c in res["checks"]}, "summary": res["summary"]}
    finally:
        os.unlink(f.name); os.unlink(tf.name)

def with_n(rules, n):
    r = json.loads(json.dumps(rules))
    r["expected_n"] = n
    r["sample_flow_steps"] = [{"step_id": "STEP_LOAD_FIXTURE", "n_before": n, "n_after": n, "n_removed": 0, "reason": "load fixture csv"}]
    return r

# 1. duplicate declared key
case("dup_key", "dup_key.csv", with_n(BASE_RULES, rowcount("dup_key.csv")))
# 2. missing required variable (capital)
case("missing_var", "missing_var.csv", with_n(BASE_RULES, rowcount("missing_var.csv")))
# 3. unexpected missing value in invest
case("extra_missing", "extra_missing.csv", with_n(BASE_RULES, rowcount("extra_missing.csv")))
# 4. observation-count mismatch (3 rows, expected 5)
case("wrong_n", "wrong_n.csv", with_n(BASE_RULES, 5))
# 5. wrong declared type (firm non-integer text)
case("wrong_type", "wrong_type.csv", with_n(BASE_RULES, rowcount("wrong_type.csv")))
# 6. validation rule referencing a nonexistent key/column
r = with_n(BASE_RULES, rowcount("wrong_n.csv"))
r["unit_key"] = ["firm", "nonexistent_col"]
case("bad_rule_key", "wrong_n.csv", r)
# 7. invalid merge cardinality (expect 1:1, actual m:m)
r = with_n(BASE_RULES, rowcount("wrong_n.csv"))
r["merge_spec"] = {"expected_relationship": "1:1", "left_path": os.path.join(DV, "fixtures", "merge_left.csv"), "right_path": os.path.join(DV, "fixtures", "merge_right.csv"), "left_key": "id", "right_key": "id"}
case("merge_cardinality", "wrong_n.csv", r)

out = {"benchmark_id": "grunfeld_data_validation_v1", "cases": cases, "adversarial_driver": "domains/economics/benchmarks/data_validation/runners/run_adversarial.py"}
os.makedirs(os.path.join(DV, "results"), exist_ok=True)
with open(os.path.join(DV, "results", "adversarial.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, indent=2); f.write("\n")
print(json.dumps(out, indent=2))
