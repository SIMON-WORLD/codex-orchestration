* Data Validation Pack v1 Stata runner (base Stata) - read-only structural validation.
* Consumes the frozen Grunfeld CSV + known declared rules and writes a deterministic key=value raw file.
* Does NOT mutate/impute/delete rows or repair data.
args csvraw rawfile
import delimited "`csvraw'", clear
local expected_n = 200
local keyvars "firm year"
local checked_vars "invest value capital"

capture count
local n = r(N)
local rowcount = "pass"
if `n' != `expected_n' local rowcount = "fail"

* variable presence
local vp = "pass"
local vp_missing ""
foreach v in firm year invest value capital {
  capture confirm variable `v'
  if _rc != 0 {
    local vp = "fail"
    local vp_missing "`vp_missing' `v'"
  }
}

* key uniqueness
local dup_count = 0
local n_unique = `n'
capture duplicates tag firm year, gen(_dup)
if _rc == 0 {
  quietly count if _dup > 0
  local dup_count = r(N)
  quietly count if _dup == 0
  local n_unique = r(N)
  local keyunique = "pass"
  if `dup_count' > 0 local keyunique = "fail"
}
else {
  local keyunique = "fail"
}

* missingness
local miss_v = ""
local miss_c = ""
local miss_f = ""
local miss_k = ""
foreach v in `keyvars' `checked_vars' {
  capture quietly count if missing(`v')
  local nm = r(N)
  if `nm' > 0 {
    local miss_v "`miss_v' `v'"
    local miss_c "`miss_c' `nm'"
    local miss_f "`miss_f' `v'"
    local miss_k "`miss_k' `v'"
  }
}
local ms = "pass"
if "`miss_v'" != "" local ms = "fail"

* variable type: firm/year integer-valued; invest/value/capital numeric
local vt = "pass"
local vt_mismatch ""
foreach v in firm year {
  capture confirm numeric variable `v'
  if _rc != 0 {
    local vt = "fail"
    local vt_mismatch "`vt_mismatch' `v'"
  }
  else {
    capture quietly count if `v' != int(`v')
    if _rc == 0 & r(N) > 0 {
      local vt = "fail"
      local vt_mismatch "`vt_mismatch' `v'"
    }
  }
}
foreach v in `checked_vars' {
  capture confirm numeric variable `v'
  if _rc != 0 {
    local vt = "fail"
    local vt_mismatch "`vt_mismatch' `v'"
  }
}

* sample-flow arithmetic (single load step: before 200 after 200 removed 0)
local sf = "pass"
if `n' != `expected_n' local sf = "fail"

* merge cardinality not applicable
local mc = "not_applicable"

* counts
local pass_count = 0
local fail_count = 0
if "`rowcount'" == "pass" local pass_count = `pass_count' + 1
else local fail_count = `fail_count' + 1
if "`vp'" == "pass" local pass_count = `pass_count' + 1
else local fail_count = `fail_count' + 1
if "`vt'" == "pass" local pass_count = `pass_count' + 1
else local fail_count = `fail_count' + 1
if "`keyunique'" == "pass" local pass_count = `pass_count' + 1
else local fail_count = `fail_count' + 1
if "`ms'" == "pass" local pass_count = `pass_count' + 1
else local fail_count = `fail_count' + 1
if "`sf'" == "pass" local pass_count = `pass_count' + 1
else local fail_count = `fail_count' + 1

file open fout using "`rawfile'", write replace
file write fout "n=`n'" _n
file write fout "expected_n=`expected_n'" _n
file write fout "DV_ROWCOUNT=`rowcount'" _n
file write fout "DV_VAR_PRESENT=`vp'" _n
file write fout "DV_VAR_TYPE=`vt'" _n
file write fout "DV_KEY_UNIQUE=`keyunique'" _n
file write fout "DV_MISSINGNESS=`ms'" _n
file write fout "DV_SAMPLE_FLOW=`sf'" _n
file write fout "DV_MERGE_CARDINALITY=`mc'" _n
file write fout "dup_count=`dup_count'" _n
file write fout "n_unique=`n_unique'" _n
file write fout "missing_vars=`miss_v'" _n
file write fout "type_mismatches=`vt_mismatch'" _n
file write fout "summary_pass=`pass_count'" _n
file write fout "summary_fail=`fail_count'" _n
file close fout
di "DV_STATA_DONE"
