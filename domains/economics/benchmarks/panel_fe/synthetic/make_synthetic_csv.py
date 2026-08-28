#!/usr/bin/env python3
import numpy as np, pandas as pd
rng = np.random.default_rng(20260828)
firms = np.arange(1,6); years = np.arange(1,6)
rows=[]
for i in firms:
    for t in years:
        firm_fe = 1.0*i
        year_fe = 0.5*t
        x1 = 0.8*i + 0.4*t + rng.normal(0, 1.5)   # strong within variation
        x2 = 0.3*i - 0.2*t + rng.normal(0, 1.2)
        resid = rng.normal(0, 0.3)                 # small residual
        y = 2.0*x1 - 1.0*x2 + firm_fe + year_fe + resid
        rows.append([int(i), int(t), float(y), float(x1), float(x2)])
df = pd.DataFrame(rows, columns=["firm","year","invest","value","capital"])
df.to_csv("domains/economics/benchmarks/panel_fe/synthetic/panel.csv", index=False)
print("rows", len(df))
