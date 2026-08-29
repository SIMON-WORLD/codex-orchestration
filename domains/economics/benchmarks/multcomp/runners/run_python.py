#!/usr/bin/env python3
# Real-data Grunfeld multiple-testing runner (Python).
# Reads the accepted frozen panel-FE reghdfe result and computes raw p-values programmatically,
# then applies Holm (FWER) and Benjamini-Hochberg (FDR) via statsmodels.stats.multitest.multipletests.
# No scientific values are hard-coded; the benchmark family is an ENGINEERING VERIFICATION family.
import sys, os, json, hashlib

ROOT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", ".."))
PANEL_FE = os.path.join(ROOT, "domains", "economics", "benchmarks", "panel_fe")
STATA = os.path.join(PANEL_FE, "results", "stata.json")
CSV = os.path.join(PANEL_FE, "grunfeld.csv")
OUT = os.path.join(ROOT, "domains", "economics", "benchmarks", "multcomp", "results", "python.json")

from scipy import stats
from statsmodels.stats.multitest import multipletests

def hash_text_file(path):
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def main():
    result = json.load(open(STATA, "r", encoding="utf-8"))
    coefs = result["coefficients"]; ses = result["std_errors"]
    df_r = float(result["inference_configuration"]["stata_dof_evidence"]["df_r"])
    n = result["n"]
    terms = ["value", "capital"]
    estimate_ids = ["EST_GRUNFELD_" + t.upper() for t in terms]
    raw_p = {}
    tstat = {}
    estimate = {}
    std_error = {}
    ci_lower = {}
    ci_upper = {}
    df = float(df_r)
    tcrit = stats.t.ppf(0.975, df)
    for t in terms:
        eid = "EST_GRUNFELD_" + t.upper()
        est = coefs[t]; se = ses[t]
        tv = est / se
        p = 2.0 * stats.t.sf(abs(tv), df)
        raw_p[eid] = float(p)
        tstat[eid] = tv
        estimate[eid] = float(est)
        std_error[eid] = float(se)
        ci_lower[eid] = float(est - tcrit * se)
        ci_upper[eid] = float(est + tcrit * se)
    pv = [raw_p[eid] for eid in estimate_ids]
    holm = list(multipletests(pv, method="holm")[1])
    bh = list(multipletests(pv, method="fdr_bh")[1])
    adjusted = {
        "holm": {eid: float(v) for eid, v in zip(estimate_ids, holm)},
        "benjamini_hochberg": {eid: float(v) for eid, v in zip(estimate_ids, bh)},
    }
    import statsmodels as sm
    out = {
        "implementation_id": "multcomp.python.statsmodels",
        "runtime_version": sys.version.split()[0],
        "package_version": sm.__version__,
        "benchmark_id": "grunfeld_multcomp_v1",
        "capability_id": "economics.stat.testing.multcomp",
        "dataset_checksum": hash_text_file(CSV),
        "source": {
            "dataset": "grunfeld.csv",
            "panel_fe_benchmark_id": "grunfeld_twfe_cluster",
            "accepted_result": "domains/economics/benchmarks/panel_fe/results/stata.json",
            "upstream_artifact_ids": ["MODEL_GRUNFELD", "ESTIMATES_GRUNFELD", "DIAGNOSTICS_GRUNFELD"],
            "estimate_ids": estimate_ids,
            "residual_df": df_r,
        },
        "raw_p_value_provenance": "two-sided finite-df Student-t p from t = coef/se with df = reghdfe e(df_r); computed programmatically from accepted frozen reghdfe result; NOT hard-coded",
        "n": n,
        "family_definition": {
            "family_ids": ["FAM_GRUNFELD_MHT_HOLM", "FAM_GRUNFELD_MHT_BH"],
            "note": "ENGINEERING VERIFICATION family: significance tests of the two Grunfeld panel-FE coefficients (value, capital). NOT a substantive research-family recommendation.",
        },
        "estimates": {"order": estimate_ids, "raw_p": raw_p, "t_stat": tstat, "estimate": estimate, "std_error": std_error, "ci_lower": ci_lower, "ci_upper": ci_upper},
        "adjusted": adjusted,
        "methods": {
            "holm": {"tool": "statsmodels.stats.multitest.multipletests", "method": "holm", "definition": "Holm (1979) family-wise error rate step-down"},
            "benjamini_hochberg": {"tool": "statsmodels.stats.multitest.multipletests", "method": "fdr_bh", "definition": "Benjamini & Hochberg (1995) false discovery rate"},
        },
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
        f.write("\n")
    print(json.dumps(out, indent=2))

if __name__ == "__main__":
    main()
