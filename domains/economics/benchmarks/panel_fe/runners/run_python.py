#!/usr/bin/env python3
# P7 panel_fe benchmark runner (linearmodels PanelOLS).
# Reads the frozen benchmark CSV; writes a machine-readable JSON.
import json, hashlib, sys, os
import pandas as pd
from linearmodels.panel import PanelOLS

HERE = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(HERE, "..", "grunfeld.csv")
BENCH_ID = "grunfeld_twfe_cluster"

def text_hash(p):
    with open(p, "rb") as f:
        data = f.read()
    txt = data.decode("utf-8").replace("\r\n", "\n").replace("\r", "\n")
    return hashlib.sha256(txt.encode("utf-8")).hexdigest()

df = pd.read_csv(CSV)
checksum = text_hash(CSV)
df = df.set_index(["firm", "year"]).sort_index()
y = df["invest"]
X = df[["value", "capital"]]
mod = PanelOLS(y, X, entity_effects=True, time_effects=True)
res = mod.fit(cov_type="clustered", cluster_entity=True)

coefs = {k: float(v) for k, v in res.params.items()}
ses = {k: float(v) for k, v in res.std_errors.items()}
n = int(res.nobs)
ids = df.index.get_level_values("firm")
clusters = int(pd.Series(range(len(ids))).groupby(ids).ngroups)

def native_default():
    r = mod.fit()
    return {
        "cov_type": getattr(r, "cov_type", "unadjusted"),
        "coefficients": {k: float(v) for k, v in r.params.items()},
        "std_errors": {k: float(v) for k, v in r.std_errors.items()},
        "n": int(r.nobs),
    }

result = {
    "implementation_id": "panel.fe.python.linearmodels",
    "runtime_version": sys.version.split()[0],
    "package_version": __import__("linearmodels").__version__,
    "benchmark_id": BENCH_ID,
    "dataset_checksum": checksum,
    "n": n,
    "cluster_count": clusters,
    "coefficients": coefs,
    "std_errors": ses,
    "inference_configuration": {
        "clustering": "one-way cluster=firm",
        "estimator": "PanelOLS within (entity+time effects absorbed)",
        "finite_sample_correction": "linearmodels clustered default",
        "absorbed_fe_dof": "entity_effects + time_effects absorbed",
        "covariance_definition": "cluster-robust (cov_type=clustered, cluster_entity=True)",        "covariance_family": "linearmodels_clustered",
        "is_canonical_definition": False,
        "df_adjustment": {
          "num_effects": 2,
          "_determine_df_adjustment": "returns True (debias) for two-way FE; does NOT treat entity FE nested in cluster as redundant",
          "tested_configs_value_se": {
            "default": 0.010565288935,
            "auto_df=False": 0.010565288935,
            "count_effects=False": 0.009760951068,
            "debiased=False": 0.010503321897,
            "debiased=False,group_debias=True": 0.011043760029
          },
          "note": "no documented linearmodels config reproduces the reghdfe/fixest nested-in-cluster DoF convention; default value_se 0.0105653 vs AER 0.0108244 (~2.4%)"
        },
        "note": "canonical run uses cov_type=clustered, cluster_entity=True",
    },
    "native_default": native_default(),
}
out = os.path.join(HERE, "..", "results", "python.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump(result, f, indent=2)
print(json.dumps(result, indent=2))





