#!/usr/bin/env node
// P7 panel_fe benchmark runner wrapper (Stata reghdfe).
// Deletes stale stata_raw.txt; requires this run to both succeed AND produce a
// fresh raw output. Records real e() DoF evidence + runtime provenance.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..", "..");
const MAN = join(root, "domains/economics/benchmarks/panel_fe/benchmark.grunfeld.json");
const RAW = join(root, "domains/economics/benchmarks/panel_fe/results/stata_raw.txt");
const OUT = join(root, "domains/economics/benchmarks/panel_fe/results/stata.json");
const DO = join(here, "run_stata.do");

export function requireFreshStataOutput(procStatusOk, rawExistsAfter) {
  if (procStatusOk !== true || rawExistsAfter !== true) {
    throw new Error(`Stata fresh-run gate failed (procStatusOk=${procStatusOk}, rawExistsAfter=${rawExistsAfter})`);
  }
}
export function buildStataResultFromRaw(rawText, man) {
  const kv = {};
  for (const line of rawText.split(/\r?\n/)) { const m = line.match(/^([^=]+)=(.+)$/); if (m) kv[m[1].trim()] = m[2].trim(); }
  const num = (v) => { const x = Number(kv[v]); return Number.isFinite(x) ? x : null; };
  const required = ["n", "cluster_count", "b_value", "b_capital", "se_value", "se_capital", "default_se_value", "default_se_capital", "e_df_a_nested"];
  for (const k of required) if (num(k) === null) throw new Error(`Stata raw output incomplete (missing/non-numeric '${k}')`);
  const infCfg = {
    clustering: "one-way cluster=firm",
    estimator: "reghdfe (absorbed firm+year FE)",
    finite_sample_correction: "AER/Stata vce(cluster) cluster-robust",
    absorbed_fe_dof: "firm + year absorbed; firm FE nested within cluster(firm) treated as redundant",
    covariance_definition: "reghdfe vce(cluster firm)",
    covariance_family: "aes_cluster",
    is_canonical_definition: true,
    stata_dof_evidence: {
      df_m: kv.e_df_m, df_r: kv.e_df_r, df_a: kv.e_df_a,
      df_a_nested: kv.e_df_a_nested, dofmethod: kv.e_dofmethod,
      vce: kv.e_vce, clustvar: kv.e_clustvar,
    },
    note: "firm FE nested in cluster(firm) is redundant for DoF (e_df_a_nested); cluster small-sample correction applied",
  };
  return {
    implementation_id: "panel.fe.stata.reghdfe",
    runtime_version: kv.stata_version || "unknown",
    package_version: "unknown",
    package_version_evidence: "Stata e(version)='.' ; reghdfe does not expose a reliable version via e() (ado file present)",
    benchmark_id: "grunfeld_twfe_cluster",
    dataset_checksum: man.dataset.checksum,
    n: num("n"),
    cluster_count: num("cluster_count"),
    coefficients: { value: num("b_value"), capital: num("b_capital") },
    std_errors: { value: num("se_value"), capital: num("se_capital") },
    inference_configuration: infCfg,
    native_default: {
      cov_type: "reghdfe_default",
      coefficients: { value: num("b_value"), capital: num("b_capital") },
      std_errors: { value: num("default_se_value"), capital: num("default_se_capital") },
      n: num("n"),
    },
  };
}

const isMain = process.argv[1] && new URL(import.meta.url).href === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const exe = process.env.STATA_EXE || "D:\\Software\\Stata\\StataNow19\\StataMP-64.exe";
  try { unlinkSync(RAW); } catch {}
  const r = spawnSync(exe, ["/e", "do", DO], { encoding: "utf8", timeout: 120000, windowsHide: true });
  requireFreshStataOutput(r.status === 0, existsSync(RAW));
  const man = JSON.parse(readFileSync(MAN, "utf8"));
  const result = buildStataResultFromRaw(readFileSync(RAW, "utf8"), man);
  writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));
}
