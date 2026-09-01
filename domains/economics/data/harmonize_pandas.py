#!/usr/bin/env python3
# Economics harmonize v1 - Python/pandas implementation (Domain-level, runtime adapter).
# Reads a frozen harmonize plan, verifies declared input SHA256 (fail closed on mutation), loads
# sources read-only, applies ONLY explicitly declared structural operations in order, writes a
# separate deterministic harmonized output, and emits a machine-readable execution log.
# NEVER mutates a frozen source in place; NEVER infers scientific cleaning rules; NEVER imputes /
# winsorizes / deletes outliers / defines treatment / applies eligibility to a final sample.
import sys, os, json, hashlib
try:
    import pandas as pd
    import numpy as np
except Exception as e:
    print(json.dumps({"error": "pandas/numpy unavailable: " + str(e)}))
    sys.exit(2)

def sha_bytes(path):
    # exact raw-byte SHA256: any byte change (including CRLF<->LF) alters the hash.
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()

def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def load_input(in_dir, inp):
    path = os.path.join(in_dir, inp["file"])
    if not os.path.exists(path):
        return None, {"status": "fail", "error": "input file missing: " + inp["file"]}
    actual = sha_bytes(path)
    if inp.get("sha256") and inp["sha256"] != actual:
        return None, {"status": "fail", "error": "input sha mismatch (source changed)", "actual_sha256": actual, "declared_sha256": inp["sha256"]}
    df = pd.read_csv(path)
    return df, {"status": "ok", "actual_sha256": actual, "rows": int(len(df)), "cols": int(len(df.columns))}

def op_result(s, *args, **kw):
    d = {"status": s}
    if args:
        if len(args) == 1: d["note"] = args[0]
        elif len(args) == 2: d[args[0]] = args[1]
        else: d["detail"] = args
    d.update(kw)
    return d

def apply_op(cur, frames, op, log):
    kind = op["kind"]; st = None
    if kind == "rename":
        missing = [c for c in op["mapping"].keys() if c not in cur.columns]
        if missing: st = op_result("fail", "error", "missing source columns: " + ",".join(missing))
        else:
            cur = cur.rename(columns=op["mapping"]); st = op_result("ok", renamed=len(op["mapping"]))
    elif kind == "coerce":
        col = op["column"]; to = op["to"]
        if col not in cur.columns: st = op_result("fail", "error", "column missing: " + col)
        else:
            s = cur[col]
            if to in ("integer", "numeric"):
                conv = pd.to_numeric(s, errors="coerce")
                fails = int(((s.notna()) & (conv.isna())).sum())
            elif to == "string":
                conv = s.astype(str); fails = 0
            elif to == "boolean":
                mapping = {"true": True, "false": False, "1": True, "0": False, "yes": True, "no": False}
                u = s.astype(str).str.lower().str.strip()
                bad = ~u.isin(list(mapping.keys()) + [""])
                fails = int(bad.sum()); conv = u.map(mapping)
            else:
                st = op_result("fail", "error", "unsupported coercion target: " + to)
            if st is None:
                if fails > 0:
                    st = op_result("fail", coercion_failures=int(fails), note="cannot satisfy declared type " + to)
                else:
                    cur[col] = conv; st = op_result("ok")
    elif kind == "normalize_key":
        col = op["column"]
        if col not in cur.columns: st = op_result("fail", "error", "column missing: " + col)
        else:
            s = cur[col].astype(str)
            for rl in op["rules"]:
                if rl == "trim": s = s.str.strip()
                elif rl == "lower_case": s = s.str.lower()
                elif rl == "upper_case": s = s.str.upper()
                elif rl == "zero_pad": s = s.str.zfill(int(op.get("width", 0)))
            cur[col] = s
            dup = int(s.duplicated(keep=False).sum())
            st = op_result("fail", duplicate_key_after_normalization=int(dup)) if dup > 0 else op_result("ok")
    elif kind == "map_code":
        col = op["column"]
        if col not in cur.columns: st = op_result("fail", "error", "column missing: " + col)
        else:
            mapping = op["mapping"]; s = cur[col]
            unk = [x for x in s.astype(str).tolist() if x not in mapping]
            if unk: st = op_result("fail", unknown_codes=unk)
            else:
                cur[col] = s.map(lambda x: mapping.get(x, np.nan)); st = op_result("ok", mapped=len(mapping))
    elif kind == "normalize_date":
        col = op["column"]
        if col not in cur.columns: st = op_result("fail", "error", "column missing: " + col)
        else:
            out = op.get("out", "iso_date")
            try:
                dt = pd.to_datetime(cur[col], format=op["in_format"], errors="raise")
            except Exception as e:
                st = op_result("fail", "error", "invalid date/year: " + str(e))
            else:
                if dt.isna().any(): st = op_result("fail", invalid_dates=int(dt.isna().sum()))
                else:
                    if out == "year": cur[col] = dt.dt.year
                    elif out == "year_month": cur[col] = dt.dt.strftime("%Y-%m")
                    else: cur[col] = dt.dt.strftime("%Y-%m-%d")
                    st = op_result("ok")
    elif kind == "convert_unit":
        src = op["source_column"]; tgt = op["target_column"]
        if src not in cur.columns: st = op_result("fail", "error", "source column missing: " + src)
        else:
            factor = op["factor"]; fm = op["factor_mode"]
            cur[tgt] = cur[src] * factor if fm == "multiply" else cur[src] / factor
            st = op_result("ok", unit=op["source_unit"] + "->" + op["target_unit"])
    elif kind == "merge":
        right_id = op["right"]; how = op["how"]
        if right_id not in frames: st = op_result("fail", "error", "unknown right input: " + right_id)
        else:
            left_keys = op.get("left_keys", op["right_keys"]); right_keys = op["right_keys"]
            lk = int(cur[left_keys].duplicated().sum()); rk = int(frames[right_id][right_keys].duplicated().sum())
            card = op["cardinality"]; perm = True
            if card == "1:1": perm = (lk == 0 and rk == 0)
            elif card == "1:m": perm = (lk == 0)
            elif card == "m:1": perm = (rk == 0)
            if not perm: st = op_result("fail", "cardinality_violation", "declared", card, "left_dup", int(lk), "right_dup", int(rk))
            else:
                before = len(cur)
                cur = cur.merge(frames[right_id], left_on=left_keys, right_on=right_keys, how=how, suffixes=("", "_r"))
                after = len(cur)
                if how == "left":
                    unmatched = int(cur[right_keys].isna().any(axis=1).sum()); matched = int(after - unmatched)
                else:
                    matched = after; unmatched = 0
                rec = op_result("ok", rows_before=int(before), rows_after=int(after), matched=int(matched), unmatched=int(unmatched))
                if op.get("unmatched") == "fail" and unmatched > 0: rec = op_result("fail", unmatched_records=int(unmatched))
                elif unmatched > 0: log["warnings"].append({"op": op["op_id"], "unmatched_records": int(unmatched)})
                if after != before: log["warnings"].append({"op": op["op_id"], "row_count_effect": {"before": int(before), "after": int(after)}})
                st = rec
    else:
        st = op_result("fail", "error", "unsupported op kind: " + kind)
    log["operations"].append({"op_id": op["op_id"], "kind": kind, "status": st["status"], "detail": st})
    if st["status"] == "fail":
        log["errors"].append({"op_id": op["op_id"], "kind": kind, "detail": st})
        log["overall"] = "failed"
    return cur, st

def run(plan_path, in_dir, out_path, log_path):
    plan = read_json(plan_path)
    log = {"plan_id": plan.get("plan_id"), "implementation_id": "data.harmonize.python.pandas",
           "input_shas": {}, "output_sha256": None, "operations": [], "warnings": [], "errors": [], "overall": "completed"}
    frames = {}; cur = None; cols_before = None
    for inp in plan["inputs"]:
        df, meta = load_input(in_dir, inp)
        if df is None:
            log["errors"].append(meta); log["overall"] = "failed"; _write_log(log, log_path); return log
        frames[inp["input_id"]] = df
        log["input_shas"][inp["input_id"]] = meta["actual_sha256"]
        if cur is None:
            cur = df; cols_before = meta["cols"]
    for op in plan["operations"]:
        if log["overall"] == "failed": break
        cur, st = apply_op(cur, frames, op, log)
    if log["overall"] == "failed":
        _write_log(log, log_path); return log
    if plan.get("output", {}).get("sort_by"):
        keys = [k for k in plan["output"]["sort_by"] if k in cur.columns]
        if keys: cur = cur.sort_values(keys).reset_index(drop=True)
    out_cols = sorted(cur.columns.tolist()); cur = cur[out_cols]
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    cur.to_csv(out_path, index=False, lineterminator="\n")
    log["output_sha256"] = sha_bytes(out_path)
    log["rows_after"] = int(len(cur)); log["cols_after"] = int(len(out_cols)); log["cols_before"] = cols_before
    log["overall"] = "completed" if not log["errors"] else "failed"
    _write_log(log, log_path)
    return log

def _write_log(log, log_path):
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    with open(log_path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(log, f, indent=2, ensure_ascii=False); f.write("\n")

def main():
    plan_path = sys.argv[1] if len(sys.argv) > 1 else ""
    in_dir = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(plan_path)
    out_path = sys.argv[3] if len(sys.argv) > 3 else "harmonized.csv"
    log_path = sys.argv[4] if len(sys.argv) > 4 else "harmonize_execution_log.json"
    log = run(plan_path, in_dir, out_path, log_path)
    print(json.dumps({"overall": log["overall"], "output_sha256": log["output_sha256"], "errors": len(log["errors"]), "warnings": len(log["warnings"])}, ensure_ascii=False))
    sys.exit(0 if log["overall"] == "completed" else 1)

if __name__ == "__main__":
    main()
