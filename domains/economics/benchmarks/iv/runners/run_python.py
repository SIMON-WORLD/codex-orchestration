#!/usr/bin/env python
# frozen card.csv -> linearmodels IV2SLS (homoskedastic/unadjusted 2SLS) -> JSON result.
import io, json, sys, hashlib
import pandas as pd
from linearmodels.iv import IV2SLS

def main():
    csv = sys.argv[1] if len(sys.argv) > 1 else "domains/economics/benchmarks/iv/card.csv"
    out = sys.argv[2] if len(sys.argv) > 2 else "domains/economics/benchmarks/iv/results/python.json"
    data = pd.read_csv(csv)
    raw = io.open(csv, "rb").read().decode("utf-8").replace("\r\n", "\n").encode("utf-8")
    checksum = hashlib.sha256(raw).hexdigest()
    mod = IV2SLS.from_formula("lwage ~ 1 + exper + expersq + black + smsa + south + [educ ~ nearc4]", data)
    r = mod.fit(cov_type="unadjusted")
    coeff_names = list(r.params.index)
    coefficients = {k: float(r.params[k]) for k in coeff_names}
    std_errors = {k: float(r.std_errors[k]) for k in coeff_names}
    tstats = {k: float(r.tstats[k]) for k in coeff_names}
    pvalues = {k: float(r.pvalues[k]) for k in coeff_names}
    ci = r.conf_int()
    ci_lower = {k: float(ci.loc[k, "lower"]) for k in coeff_names}
    ci_upper = {k: float(ci.loc[k, "upper"]) for k in coeff_names}
    # first-stage diagnostics (individual) - capture only if present, never fabricate
    first_stage = {"partial_r2": None, "fstat": None, "fstat_df": None, "note": "linearmodels IV2SLS first-stage (individual)"}
    try:
        ind = r.first_stage.individual
        fs = ind.get("educ") or (list(ind.values())[0] if ind else None)
        if fs is not None:
            pr = getattr(fs, "partial_r2", None)
            fs_f = getattr(fs, "fstat", None)
            partial_r2 = float(pr) if pr is not None and pd.notna(pr) else None
            fstat = float(fs_f) if fs_f is not None and pd.notna(fs_f) else None
            first_stage = {"partial_r2": partial_r2, "fstat": fstat, "note": "linearmodels IV2SLS first-stage (individual) partial R2 / F; if unavailable, left null (not fabricated)"}
    except Exception as e:
        first_stage = {"partial_r2": None, "fstat": None, "note": "linearmodels first-stage diagnostic unavailable: " + str(e)}
    overid = "not_applicable_exactly_identified"  # sargan invalid: 1 endog, 1 excluded instrument
    result = {
        "implementation_id": "causal.iv.python.linearmodels",
        "runtime": "python",
        "runtime_version": sys.version.split()[0],
        "package_version": "linearmodels " + __import__("linearmodels").__version__,
        "benchmark_id": "iv_card_2sls_v1",
        "dataset_checksum": checksum,
        "n": int(r.nobs),
        "coefficients": coefficients,
        "std_errors": std_errors,
        "inference_configuration": {
            "covariance": "homoskedastic / unadjusted",
            "cov_type": "unadjusted",
            "estimator": "IV2SLS (2SLS)",
            "first_stage": first_stage,
            "overid": overid,
            "weak_id_diagnostics": "linearmodels default summary does not expose Kleibergen-Paap / Sanderson-Windmeijer / Anderson-Rubin; NOT fabricated",
        },
        "diag": {"tstats": tstats, "pvalues": pvalues, "ci_lower": ci_lower, "ci_upper": ci_upper, "first_stage": first_stage},
    }
    with io.open(out, "w", encoding="utf-8", newline="") as f:
        f.write(json.dumps(result, indent=2, default=str) + "\n")
    print(json.dumps({"n": result["n"], "educ_coef": coefficients.get("educ"), "educ_se": std_errors.get("educ"), "checksum": checksum}, indent=2))

if __name__ == "__main__":
    main()
