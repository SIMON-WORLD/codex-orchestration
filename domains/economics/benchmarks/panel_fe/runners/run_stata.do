* P7 panel_fe benchmark runner (Stata reghdfe).
* Writes a key=value text file; run_stata.mjs assembles machine-readable JSON.
clear all
set more off
capture log close
import delimited "domains/economics/benchmarks/panel_fe/grunfeld.csv", varnames(1) clear
* canonical: two-way absorbed FE + one-way cluster at firm
reghdfe invest value capital, absorb(firm year) vce(cluster firm)
local n = e(N)
local ng = e(N_clust)
local bv : display %20.17g _b[value]
local bp : display %20.17g _b[capital]
local sev : display %20.17g _se[value]
local sep : display %20.17g _se[capital]
* native default: reghdfe default inference (no vce specified)
reghdfe invest value capital, absorb(firm year)
local dsev : display %20.17g _se[value]
local dsep : display %20.17g _se[capital]
file open f using "domains/economics/benchmarks/panel_fe/results/stata_raw.txt", write replace
file write f "n=`n'" _n
file write f "cluster_count=`ng'" _n
file write f "b_value=`bv'" _n
file write f "b_capital=`bp'" _n
file write f "se_value=`sev'" _n
file write f "se_capital=`sep'" _n
file write f "default_se_value=`dsev'" _n
file write f "default_se_capital=`dsep'" _n
file close f
