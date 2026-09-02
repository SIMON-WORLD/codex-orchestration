#!/usr/bin/env python3
# Phase-3 M3 independent deterministic oracle (stdlib ONLY: math/csv/json; NO pandas/numpy).
# Computes selected real-benchmark facts from the canonical Grunfeld and compares to the constructed
# output to verify the Python/pandas implementation independently. This is benchmark evidence only;
# it does NOT register/claim a Stata or other implementation.
import math, csv, json, sys
from collections import defaultdict

ROOT = "domains/economics/benchmarks/data_prep"
CANON = "domains/economics/benchmarks/panel_fe/grunfeld.csv"
CONSTRUCTED = ROOT + "/results/constructed.csv"

def read_csv_rows(path):
    with open(path, "r", newline="") as f:
        return list(csv.DictReader(f))

def num(v):
    if v is None or v.strip() == "":
        return None
    return float(v)

# canonical firm-year ground truth (firm, year -> invest, value, capital)
canon = {}
for r in read_csv_rows(CANON):
    key = (int(r["firm"]), int(r["year"]))
    canon[key] = {"invest": num(r["invest"]), "value": num(r["value"]), "capital": num(r["capital"])}

# compute lag/diff/growth by firm (deduced from canonical, sorted year)
years_by_firm = defaultdict(list)
for (firm, year) in sorted(canon.keys()):
    years_by_firm[firm].append(year)

def prior(yearlist, y, k=1):
    i = yearlist.index(y)
    return yearlist[i - k] if i - k >= 0 else None

# compare selected facts
facts = []
checks = []
for (firm, year), v in sorted(canon.items()):
    yl = years_by_firm[firm]
    lag_year = prior(yl, year, 1)
    pred = {
        "firm": firm, "year": year,
        "log_value": math.log(v["value"]),
        "invest_value": v["invest"] / v["value"],
        "value_x_cap": v["value"] * v["capital"],
        "high_value": 1 if v["value"] > 3000 else 0,
    }
    if lag_year is not None:
        pv = canon[(firm, lag_year)]
        pred["lag_value"] = pv["value"]
        pred["d_value"] = v["value"] - pv["value"]
        pred["g_value"] = (v["value"] - pv["value"]) / pv["value"]
    facts.append(pred)

# read constructed output
cr = read_csv_rows(CONSTRUCTED)
# map constructed firm/year -> facts
def key(row):
    return (int(float(row["firm"])), int(row["year"]))
constructed_map = {}
for row in cr:
    k = key(row)
    constructed_map[k] = row

TOL = 1e-6
parity = []
for pred in facts:
    row = constructed_map.get((pred["firm"], pred["year"]))
    if row is None:
        parity.append({"firm": pred["firm"], "year": pred["year"], "ok": False, "reason": "missing row"})
        continue
    field = "lag_value" if "lag_value" in pred else "log_value"
    ok_all = True; details = []
    for fname, expect in pred.items():
        if fname in ("firm", "year"): continue
        got = num(row[fname])
        if fname in ("lag_value", "d_value", "g_value") and "lag_value" not in pred:
            # boundary: constructed should be NaN -> skip (structural)
            if got is not None:
                ok_all = False; details.append(f"{fname}:expected-NaN-got-{got}")
            continue
        if expect is None:
            if got is not None: ok_all = False; details.append(f"{fname}:expected-NaN-got-{got}")
        else:
            if got is None or abs(got - expect) > TOL:
                ok_all = False; details.append(f"{fname}:expected-{expect}-got-{got}")
    parity.append({"firm": pred["firm"], "year": pred["year"], "ok": ok_all, "details": details})

all_ok = all(p["ok"] for p in parity)
result = {
    "oracle_kind": "independent_stdlib_math_csv_calculator",
    "canonical_source": CANON,
    "constructed_source": CONSTRUCTED,
    "facts_checked": len(parity),
    "all_ok": all_ok,
    "border_cases": sorted([(p["firm"], p["year"]) for p in parity if p["ok"] is False])[:10],
    "sample_facts": facts[:3],
}
print(json.dumps(result, indent=2, default=str))
sys.exit(0 if all_ok else 1)