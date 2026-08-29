#!/usr/bin/env node
// IV card benchmark runner wrapper (Stata ivreg2, homoskedastic 2SLS) - parameterized.
// Deletes stale raw; requires this run to BOTH succeed AND produce a fresh raw.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
const here = import.meta.dirname;
const root = join(here, "..", "..", "..", "..", "..");
const DO = join(here, "run_stata.do");
function arg(name, def){ const i=process.argv.indexOf("--"+name); return i>=0?process.argv[i+1]:def; }
export function requireFreshStataOutput(procStatusOk, rawExistsAfter) {
  if (procStatusOk !== true || rawExistsAfter !== true) throw new Error(`Stata fresh-run gate failed (procStatusOk=${procStatusOk}, rawExistsAfter=${rawExistsAfter})`);
}
export function buildIvResultFromRaw(rawText, man, benchmarkId = "iv_card_2sls_v1") {
  const kv = {};
  for (const line of rawText.split(/\r?\n/)) { const m = line.match(/^([^=]+)=(.+)$/); if (m) kv[m[1].trim()] = m[2].trim(); }
  const num = (v) => { const x = Number(kv[v]); return Number.isFinite(x) ? x : null; };
  const coeff = (k) => kv[k];
  const se = (k) => kv[k];
  if (num("n") === null) throw new Error(`Stata raw output incomplete (missing/non-numeric 'n')`);
  const infCfg = {
    estimator: "ivreg2 (2SLS)",
    covariance: "homoskedastic / non-robust",
    covariance_definition: "ivreg2 default VCE (homoskedastic 2SLS)",
    note: "diagnostics are ivreg2-native; where a statistic is not produced/definition-compatible it is documented, never fabricated",
    diagnostics: {
      underid: { name: "Anderson canonical corr. LM (underidentification)", statistic: num("e_idstat"), method: "ivreg2 underid", definition: "chi-sq(k1) rank test", p_value: num("e_idp") },
      weak_id: { name: "Cragg-Donald / KP Wald F (weak identification)", statistic: num("e_cdf"), method: "ivreg2 weakid", definition: "Cragg-Donald Wald F (homoskedastic)" },
      ar_wald: { name: "Anderson-Rubin weak-IV-robust Wald", statistic: num("e_arf"), method: "ivreg2 weak-iv-robust", definition: "F, test of endogenous regressor = 0 + orthogonality valid" },
      s_lm: { name: "Stock-Wright LM S statistic", statistic: num("e_sstat"), method: "ivreg2 weak-iv-robust", definition: "chi-sq LM S" },
      overid: { name: "Sargan overidentification", statistic: num("e_sargan"), method: "ivreg2 sargan", definition: "invalid here (equation exactly identified: 1 endogenous, 1 excluded instrument)" },
    },
    notes: "ivreg2 also displays a first-stage 'F test of excluded instruments' (16.72) and Sanderson-Windmeijer conditional F (16.72) in its output; these are NOT captured as a compared quantity because linearmodels IV2SLS does not expose a comparable first-stage F in this version (result.first_stage.fstat = null). Weak-instrument / underidentification / weak-IV-robust statistics are ivreg2-native; linearmodels default summary does not produce Kleibergen-Paap / Sanderson-Windmeijer / Anderson-Rubin, so no forced equality across engines.",
  };
  return {
    implementation_id: "causal.iv.stata.ivreg2",
    runtime_version: kv.stata_version || "unknown",
    package_version: "unknown",
    package_version_evidence: "ivreg2 does not expose a reliable version via e(); ado file present at D:\\Software\\Stata\\StataNow19\\ado\\plus\\i\\ivreg2.ado",
    benchmark_id: benchmarkId,
    dataset_checksum: (man.source && man.source.dataset_checksum) || man.dataset_checksum,
    n: num("n"),
    coefficients: { educ: Number(coeff("b_educ")) },
    std_errors: { educ: Number(se("se_educ")) },
    inference_configuration: infCfg,
    native_default: { cov_type: "ivreg2_default_homoskedastic", coefficients: { educ: Number(coeff("b_educ")) }, std_errors: { educ: Number(se("se_educ")) }, n: num("n") },
  };
}
const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const csv = arg("csv", join(root, "domains/economics/benchmarks/iv/card.csv"));
  const raw = arg("raw", join(root, "domains/economics/benchmarks/iv/results/stata_raw.txt"));
  const out = arg("out", join(root, "domains/economics/benchmarks/iv/results/stata.json"));
  const manPath = arg("manifest", join(root, "domains/economics/benchmarks/iv/benchmark.iv.card.json"));
  const benchId = arg("benchmark-id", "iv_card_2sls_v1");
  const exe = process.env.STATA_EXE || "D:\\Software\\Stata\\StataNow19\\StataMP-64.exe";
  try { unlinkSync(raw); } catch {}
  const r = spawnSync(exe, ["/e", "do", DO, csv, raw], { encoding: "utf8", timeout: 120000, windowsHide: true });
  requireFreshStataOutput(r.status === 0, existsSync(raw));
  const man = JSON.parse(readFileSync(manPath, "utf8"));
  const result = buildIvResultFromRaw(readFileSync(raw, "utf8"), man, benchId);
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));
}
