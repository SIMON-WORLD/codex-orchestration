* P7 panel_fe benchmark runner (Stata reghdfe) - parameterized csv + raw output.
* usage: do run_stata.do "csvpath" "rawpath"
args csvpath rawpath
clear all
set more off
capture log close
import delimited "`csvpath'", varnames(1) clear
* canonical: two-way absorbed FE + one-way cluster at firm
reghdfe invest value capital, absorb(firm year) vce(cluster firm)
local bv : display %20.17g _b[value]
local bp : display %20.17g _b[capital]
local sev : display %20.17g _se[value]
local sep : display %20.17g _se[capital]
foreach v in N N_clust df_m df_r df_a df_a_nested dofmethod vce clustvar cmd version {
  capture local val`v' = e(`v')
  if "`val`v''"=="" local val`v' = "NA"
}
reghdfe invest value capital, absorb(firm year)
local dsev : display %20.17g _se[value]
local dsep : display %20.17g _se[capital]
local stataver = c(version)
file open f using "`rawpath'", write replace
file write f "n=`valN'" _n
file write f "cluster_count=`valN_clust'" _n
file write f "b_value=`bv'" _n
file write f "b_capital=`bp'" _n
file write f "se_value=`sev'" _n
file write f "se_capital=`sep'" _n
file write f "default_se_value=`dsev'" _n
file write f "default_se_capital=`dsep'" _n
file write f "stata_version=`stataver'" _n
file write f "e_df_m=`valdf_m'" _n
file write f "e_df_r=`valdf_r'" _n
file write f "e_df_a=`valdf_a'" _n
file write f "e_df_a_nested=`valdf_a_nested'" _n
file write f "e_dofmethod=`valdofmethod'" _n
file write f "e_vce=`valvce'" _n
file write f "e_clustvar=`valclustvar'" _n
file write f "e_cmd=`valcmd'" _n
file write f "e_version=`valversion'" _n
file close f
