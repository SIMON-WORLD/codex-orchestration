#!/usr/bin/env python3
# Economics construct v1 - Python/pandas implementation (Domain-level, runtime adapter).
# Reads a frozen construct plan, verifies declared input SHA256 (raw-byte, fail closed on mutation),
# loads the input read-only, applies ONLY declared structured operations in order, writes a separate
# deterministic constructed output, and emits a machine-readable execution log.
# NO arbitrary eval / arbitrary expression execution. It never decides the final estimation sample:
# it may only compute an explicitly defined indicator/eligibility FLAG (using that flag is Director's call).
import sys, os, json, hashlib
try:
    import pandas as pd
    import numpy as np
except Exception as e:
    print(json.dumps({"error": "pandas/numpy unavailable: " + str(e)})); sys.exit(2)

def sha_bytes(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()

def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def op_result(s, *args, **kw):
    d = {"status": s}
    if args:
        if len(args) == 1: d["note"] = args[0]
        elif len(args) == 2: d[args[0]] = args[1]
        else: d["detail"] = args
    d.update(kw)
    return d

def col_or_scalar(series_map, operand):
    if isinstance(operand, str): return series_map[operand]
    return pd.Series(operand, index=series_map[next(iter(series_map))].index)

def eval_predicate(series_map, pred):
    op = pred["op"]
    if op == "and":
        return eval_predicate(series_map, pred["args"][0]) & eval_predicate(series_map, pred["args"][1])
    if op == "or":
        return eval_predicate(series_map, pred["args"][0]) | eval_predicate(series_map, pred["args"][1])
    left = col_or_scalar(series_map, pred["left"]); right = col_or_scalar(series_map, pred["right"])
    if op == "gt": return left > right
    if op == "gte": return left >= right
    if op == "lt": return left < right
    if op == "lte": return left <= right
    if op == "eq": return left == right
    if op == "neq": return left != right
    raise ValueError("bad predicate op " + op)

def apply_op(cur, op, plan, log):
    kind = op["kind"]; st = None
    try:
        if "target" in op and op["target"] in cur.columns and kind in ("arithmetic","log","ratio","difference","growth_rate","interaction","lag","lead","indicator"):
            st = op_result("fail", "output_column_collision", op["target"])
        elif kind == "arithmetic":
            operator = op["operator"]; left = col_or_scalar(cur, op["left"]); right = col_or_scalar(cur, op["right"])
            if operator == "add": v = left + right
            elif operator == "subtract": v = left - right
            elif operator == "multiply": v = left * right
            elif operator == "divide":
                if (right == 0).any(): st = op_result("fail", "divide_by_zero", int((right == 0).sum()))
                else: v = left / right
            if st is None: cur[op["target"]] = v; st = op_result("ok")
        elif kind == "log":
            src = cur[op["source"]]
            if (src <= 0).any() or src.isna().any(): st = op_result("fail", "log_domain_violation", int(((src <= 0) | src.isna()).sum()))
            else:
                cur[op["target"]] = np.log(src) if op.get("base", "natural") == "natural" else np.log10(src); st = op_result("ok")
        elif kind == "ratio":
            num = cur[op["numerator"]]; den = cur[op["denominator"]]
            if (den == 0).any(): st = op_result("fail", "divide_by_zero", int((den == 0).sum()))
            else: cur[op["target"]] = num / den; st = op_result("ok")
        elif kind == "interaction":
            terms = [cur[t] for t in op["terms"]]; v = terms[0]
            for t in terms[1:]: v = v * t
            cur[op["target"]] = v; st = op_result("ok")
        elif kind in ("difference", "growth_rate"):
            pb = op.get("panel_by", plan.get("panel_by")); tb = op.get("time_by", plan.get("time_by"))
            if not pb or not tb: st = op_result("fail", "missing_panel_time")
            elif pb not in cur.columns or tb not in cur.columns: st = op_result("fail", "missing_key_column")
            elif cur.duplicated(subset=[pb, tb]).any(): st = op_result("fail", "duplicate_unit_time_key", int(cur.duplicated(subset=[pb, tb]).sum()))
            else:
                tmp = cur.sort_values([pb, tb]); g = tmp.groupby(pb, sort=True)[op["source"]]
                periods = int(op.get("periods", 1)); base = g.shift(periods)
                if kind == "difference": v = tmp[op["source"]] - base
                else:
                    if (base == 0).any() and not (base.isna().all()): st = op_result("fail", "growth_denominator_zero", int((base == 0).sum()))
                    else: v = (tmp[op["source"]] - base) / base
                if st is None: cur[op["target"]] = v; st = op_result("ok")
        elif kind in ("lag", "lead"):
            pb = op.get("panel_by", plan.get("panel_by")); tb = op.get("time_by", plan.get("time_by"))
            if not pb or not tb: st = op_result("fail", "missing_panel_time")
            elif pb not in cur.columns or tb not in cur.columns: st = op_result("fail", "missing_key_column")
            elif cur.duplicated(subset=[pb, tb]).any(): st = op_result("fail", "duplicate_unit_time_key", int(cur.duplicated(subset=[pb, tb]).sum()))
            else:
                tmp = cur.sort_values([pb, tb]); periods = int(op.get("periods", 1)); g = tmp.groupby(pb, sort=True)[op["source"]]
                shifted = g.shift(periods) if kind == "lag" else g.shift(-periods)
                cur[op["target"]] = shifted; st = op_result("ok")
        elif kind == "indicator":
            cur[op["target"]] = eval_predicate(cur, op["predicate"]).astype(int); st = op_result("ok", "flag", "explicitly defined indicator/eligibility flag; NOT applied to final sample")
        else:
            st = op_result("fail", "unsupported_op", kind)
    except Exception as e:
        st = op_result("fail", "exception", str(e))
    log["operations"].append({"op_id": op["op_id"], "kind": kind, "status": st["status"], "detail": st})
    if st["status"] == "fail":
        log["errors"].append({"op_id": op["op_id"], "kind": kind, "detail": st}); log["overall"] = "failed"
    return cur, st
def run(plan_path, in_dir, out_path, log_path):
    plan = read_json(plan_path)
    log = {"plan_id": plan.get("plan_id"), "implementation_id": "data.construct.python.pandas", "input_shas": {}, "output_sha256": None, "operations": [], "warnings": [], "errors": [], "overall": "completed"}
    inp = plan["input"]; path = os.path.join(in_dir, inp["file"])
    if not os.path.exists(path):
        log["errors"].append({"status": "fail", "error": "input file missing"}); log["overall"] = "failed"; _write_log(log, log_path); return log
    actual = sha_bytes(path)
    if inp.get("sha256") and inp["sha256"] != actual:
        log["errors"].append({"status": "fail", "error": "input sha mismatch (source changed)", "actual_sha256": actual, "declared_sha256": inp["sha256"]}); log["overall"] = "failed"; _write_log(log, log_path); return log
    log["input_shas"]["input"] = actual
    cur = pd.read_csv(path)
    cols_before = int(len(cur.columns))
    for op in plan["operations"]:
        if log["overall"] == "failed": break
        cur, st = apply_op(cur, op, plan, log)
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
    args = sys.argv[1:]
    plan_path = args[0] if len(args) > 0 else ""
    in_dir = args[1] if len(args) > 1 else os.path.dirname(plan_path)
    out_path = args[2] if len(args) > 2 else "constructed.csv"
    log_path = args[3] if len(args) > 3 else "construct_execution_log.json"
    log = run(plan_path, in_dir, out_path, log_path)
    print(json.dumps({"overall": log["overall"], "output_sha256": log["output_sha256"], "errors": len(log["errors"]), "warnings": len(log["warnings"])}, ensure_ascii=False))
    sys.exit(0 if log["overall"] == "completed" else 1)

if __name__ == "__main__":
    main()