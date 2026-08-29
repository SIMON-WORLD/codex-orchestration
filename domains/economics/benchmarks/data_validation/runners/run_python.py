#!/usr/bin/env python3
# Data Validation Pack v1 runner (pandas) - read-only structural validation.
# Consumes a frozen data file + explicit declared metadata/rules (rules.json) and emits a deterministic
# machine-readable validation result. It NEVER mutates, imputes, recodes, deletes rows, or repairs data.
import sys, os, json, hashlib, csv

ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", ".."))
DV = os.path.join(ROOT, "domains", "economics", "benchmarks", "data_validation")
DEFAULT_CSV = os.path.join(ROOT, "domains", "economics", "benchmarks", "panel_fe", "grunfeld.csv")
DEFAULT_RULES = os.path.join(DV, "rules.json")
DEFAULT_OUT = os.path.join(DV, "results", "python.json")

import pandas as pd
import numpy as np

def hash_text_file(path):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def bool_ok(v): return bool(v)

def run(csv_path, rules_path, out_path):
    df = pd.read_csv(csv_path)
    rules = json.load(open(rules_path, "r", encoding="utf-8"))
    n = int(len(df))
    checks = []
    facts = {}

    # E. row-count / observation-count consistency
    expected_n = int(rules["expected_n"])
    rc = {"check_id": "DV_ROWCOUNT", "name": "observation count matches expected", "status": "pass" if n == expected_n else "fail",
          "value": {"observed": n, "expected": expected_n}}
    checks.append(rc)
    facts["observation_count"] = n

    # F. variable presence / type consistency
    key = rules["unit_key"]
    declared_vars = [v["name"] for v in rules["variables"]]
    col_set = set(df.columns)
    missing_vars = [v for v in declared_vars if v not in col_set]
    vp = {"check_id": "DV_VAR_PRESENT", "name": "required variables present", "status": "pass" if not missing_vars else "fail",
          "value": {"required": declared_vars, "missing": missing_vars}}
    checks.append(vp)

    type_mismatches = []
    for v in rules["variables"]:
        name = v["name"]; want = v["type"].lower()
        if name not in col_set: continue
        col = df[name]
        nonnull = col.dropna()
        if len(nonnull) == 0: continue
        if want == "integer":
            is_num = pd.api.types.is_numeric_dtype(col) and np.all(np.equal(np.mod(nonnull.astype(float), 1), 0))
            if not is_num: type_mismatches.append(name)
        elif want == "float":
            if not pd.api.types.is_numeric_dtype(col): type_mismatches.append(name)
        elif want == "string":
            if not pd.api.types.is_string_dtype(col): type_mismatches.append(name)
    vt = {"check_id": "DV_VAR_TYPE", "name": "declared variable types match", "status": "pass" if not type_mismatches else "fail",
          "value": {"mismatches": type_mismatches}}
    checks.append(vt)

    # A. duplicate-key detection
    dup_count = 0
    if all(k in col_set for k in key):
        dup_count = int(df.duplicated(subset=key, keep=False).sum() // 2) if len(df) > 0 else 0
        n_unique = int(df.drop_duplicates(subset=key).shape[0])
    else:
        n_unique = None
    dk = {"check_id": "DV_KEY_UNIQUE", "name": "declared key unique", "status": "pass" if (n_unique is not None and n_unique == n and dup_count == 0) else "fail",
          "value": {"key": key, "n": n, "n_unique": n_unique, "duplicate_count": dup_count}}
    checks.append(dk)

    # B. missingness counts/rates for selected variables
    missing = {}
    for v in rules["variables"]:
        name = v["name"]
        if name in col_set:
            miss = int(df[name].isna().sum())
            missing[name] = {"n_missing": miss, "missing_rate": round(miss / n, 6) if n else 0}
    any_missing = any(m["n_missing"] > 0 for m in missing.values())
    ms = {"check_id": "DV_MISSINGNESS", "name": "selected-variable missingness within expectation", "status": "pass" if not any_missing else "fail",
          "value": {"missing": missing}}
    checks.append(ms)
    facts["missingness"] = missing

    # C. sample-flow arithmetic consistency
    steps = rules.get("sample_flow_steps") or []
    sf_ok = True; sf_detail = {}
    if steps:
        prev_after = None
        for st in steps:
            nb = int(st["n_before"]); na = int(st["n_after"]); nr = int(st["n_removed"])
            if nb - nr != na: sf_ok = False; sf_detail[st["step_id"]] = f"{nb}-{nr}!={na}"
            if prev_after is not None and prev_after != nb: sf_ok = False; sf_detail[st["step_id"]] = "chain mismatch"
            prev_after = na
        if prev_after is not None and prev_after != expected_n: sf_ok = False; sf_detail["final"] = f"{prev_after}!={expected_n}"
    sf = {"check_id": "DV_SAMPLE_FLOW", "name": "sample-flow arithmetic consistent", "status": "pass" if sf_ok else "fail", "value": {"steps": steps, "detail": sf_detail, "final_n": prev_after if steps else None}}
    checks.append(sf)

    # D. merge cardinality (only if a merge is declared)
    merge_spec = rules.get("merge_spec")
    if merge_spec:
        # Validate cardinality against the declared expected relationship (left keys unique on one side).
        exp_rel = merge_spec.get("expected_relationship")
        left = pd.read_csv(merge_spec["left_path"]); right = pd.read_csv(merge_spec["right_path"])
        lk = merge_spec["left_key"]; rk = merge_spec["right_key"]
        l_dup = int(left.duplicated(subset=lk).sum()); r_dup = int(right.duplicated(subset=rk).sum())
        mrel = "1:1" if l_dup == 0 and r_dup == 0 else ("1:m" if l_dup == 0 else ("m:1" if r_dup == 0 else "m:m"))
        card_ok = (exp_rel == mrel)
        mc = {"check_id": "DV_MERGE_CARDINALITY", "name": "merge cardinality matches expected relationship", "status": "pass" if card_ok else "fail",
              "value": {"expected_relationship": exp_rel, "observed_relationship": mrel, "left_duplicates": l_dup, "right_duplicates": r_dup}}
        checks.append(mc)
    else:
        checks.append({"check_id": "DV_MERGE_CARDINALITY", "name": "merge cardinality", "status": "not_applicable", "value": {"reason": "single frozen dataset; no merge declared"}})

    pass_count = sum(1 for c in checks if c["status"] == "pass")
    fail_count = sum(1 for c in checks if c["status"] == "fail")
    na_count = sum(1 for c in checks if c["status"] == "not_applicable")
    out = {
        "implementation_id": "data.val.python.pandas",
        "runtime_version": sys.version.split()[0],
        "package_version": "pandas " + pd.__version__,
        "benchmark_id": "grunfeld_data_validation_v1",
        "capability_id": "economics.data.validation",
        "dataset_checksum": hash_text_file(csv_path),
        "dataset_path": os.path.basename(csv_path),
        "rules": {"rules_id": rules.get("rules_id"), "unit_key": rules["unit_key"], "expected_n": expected_n, "unit": rules.get("unit")},
        "n": n,
        "checks": checks,
        "summary": {"pass": pass_count, "fail": fail_count, "not_applicable": na_count},
        "facts": facts,
        "no_auto_repair": True,
        "note": "Read-only structural validation. Does NOT delete rows, impute, recode, or repair data.",
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2); f.write("\n")
    return out

if __name__ == "__main__":
    args = sys.argv[1:]
    def get(key, default):
        if key in args:
            i = args.index(key); return args[i + 1] if i + 1 < len(args) else default
        return default
    csv_path = get("--csv", DEFAULT_CSV)
    rules_path = get("--rules", DEFAULT_RULES)
    out_path = get("--out", DEFAULT_OUT)
    run(csv_path, rules_path, out_path)
