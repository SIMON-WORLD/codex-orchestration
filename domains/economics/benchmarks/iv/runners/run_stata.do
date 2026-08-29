* IV card benchmark runner (Stata ivreg2, homoskedastic 2SLS) - parameterized csv + raw output.
* usage: do run_stata.do "csvpath" "rawpath"
args csvpath rawpath
clear all
set more off
capture log close
import delimited "`csvpath'", varnames(1) clear
ivreg2 lwage exper expersq black smsa south (educ = nearc4), first
local b_educ : display %20.17g _b[educ]
local se_educ : display %20.17g _se[educ]
local n = e(N)
local stataver = c(version)
file open f using "`rawpath'", write replace
foreach nm in idstat idp cdf widstat arf arfp sstat sstatp sargan sargandf j jdf N F Fdf1 Fdf2 r2 rmse df_m {
  capture local val = e(`nm')
  if "`val'"=="" local val = "NA"
  file write f "e_`nm'=`val'" _n
}
file write f "b_educ=`b_educ'" _n
file write f "se_educ=`se_educ'" _n
file write f "n=`n'" _n
file write f "stata_version=`stataver'" _n
file close f
