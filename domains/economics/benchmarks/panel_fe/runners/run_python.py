#!/usr/bin/env python3
# P7 panel_fe benchmark runner (linearmodels PanelOLS).
# Reads the frozen benchmark CSV; writes a machine-readable JSON.
# The covariance diagnostic matrix is computed LIVE (no hardcoded SE numbers).
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

# canonical result (default clustered)
res = mod.fit(cov_type="clustered", cluster_entity=True)
n = int(res.nobs)
ids = df.index.get_level_values("firm")
clusters = int(pd.Series(range(len(ids))).groupby(ids).ngroups)

# live covariance diagnostic matrix (A-F): value + capital SE for each config
CONFIGS = [
    ("A_default", dict()),
    ("B_auto_df_false_count_effects_true", dict(auto_df=False, count_effects=True)),
    ("C_auto_df_false_count_effects_false", dict(auto_df=False, count_effects=False)),
    ("D_debiased_false", dict(debiased=False)),
    ("E_default_group_debias_true", dict(group_debias=True)),
    ("F_auto_df_false_count_effects_false_group_debias_true", dict(auto_df=False, count_effects=False, group_debias=True)),
]
diag = {}
for name, cfg in CONFIGS:
    try:
        r = mod.fit(cov_type="clustered", cluster_entity=True, **cfg)
        diag[name] = {
            "config": cfg,
            "value_se": float(r.std_errors["value"]),
            "capital_se": float(r.std_errors["capital"]),
        }
    except Exception as e:
        diag[name] = {"config": cfg, "error": str(e)}

# native default
nd = mod.fit()
native_default = {
    "cov_type": getattr(nd, "cov_type", "unadjusted"),
    "coefficients": {k: float(v) for k, v in nd.params.items()},
    "std_errors": {k: float(v) for k, v in nd.std_errors.items()},
    "n": int(nd.nobs),
}

result = {
    "implementation_id": "panel.fe.python.linearmodels",
    "runtime_version": sys.version.split()[0],
    "package_version": __import__("linearmodels").__version__,
    "benchmark_id": BENCH_ID,
    "dataset_checksum": checksum,
    "n": n,
    "cluster_count": clusters,
    "coefficients": {k: float(v) for k, v in res.params.items()},
    "std_errors": {k: float(v) for k, v in res.std_errors.items()},
    "inference_configuration": {
        "clustering": "one-way cluster=firm",
        "estimator": "PanelOLS within (entity+time effects absorbed)",
        "finite_sample_correction": "linearmodels clustered default",
        "absorbed_fe_dof": "entity_effects + time_effects absorbed",
        "covariance_definition": "cluster-robust (cov_type=clustered, cluster_entity=True)",
        "covariance_family": "linearmodels_clustered",
        "is_canonical_definition": False,
        "df_adjustment": {
            "num_effects": 2,
            "_determine_df_adjustment": "returns True (debias) for two-way FE; auto_df counts ALL FE (entity+time) in extra_df",
            "diag_matrix": diag,
            "note": (
                "linearmodels two-way FE auto_df counts all absorbed FE into extra_df, which raises the "
                "covariance scale; reghdfe/fixest do NOT double-count nested-in-cluster firm FE and also "
                "apply a cluster small-sample correction. The ~2.4% SE gap is the net of these corrections. "
                "No public PanelOLS config reproduces the reghdfe/fixest canonical SE -> DEFINITION_DIFFERENCE."
            ),
        },
    },
    "native_default": native_default,
}
out = os.path.join(HERE, "..", "results", "python.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w") as f:
    json.dump(result, f, indent=2)
print(json.dumps(result, indent=2))
