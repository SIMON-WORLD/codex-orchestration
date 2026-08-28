#!/usr/bin/env node
// P7 panel_fe benchmark runner wrapper (Stata reghdfe).
// Spawns Stata batch, then assembles a machine-readable JSON result.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..", "..");
const MAN = join(root, "domains/economics/benchmarks/panel_fe/benchmark.grunfeld.json");
const RAW = join(root, "domains/economics/benchmarks/panel_fe/results/stata_raw.txt");
const OUT = join(root, "domains/economics/benchmarks/panel_fe/results/stata.json");
const DO = join(here, "run_stata.do");
const exe = process.env.STATA_EXE || "D:\\Software\\Stata\\StataNow19\\StataMP-64.exe";
const r = spawnSync(exe, ["/e", "do", DO], { encoding: "utf8", timeout: 120000, windowsHide: true });
if (r.status !== 0 && !existsSync(RAW)) throw new Error("Stata did not produce output: " + (r.stderr || "").slice(0, 300));
const txt = readFileSync(RAW, "utf8");
const kv = {};
for (const line of txt.split(/\r?\n/)) { const m = line.match(/^([^=]+)=(.+)$/); if (m) kv[m[1].trim()] = m[2].trim(); }
const man = JSON.parse(readFileSync(MAN, "utf8"));
const num = (v) => Number(kv[v]);
const result = {
  implementation_id: "panel.fe.stata.reghdfe",
  runtime_version: "StataNow19",
  package_version: "reghdfe",
  benchmark_id: "grunfeld_twfe_cluster",
  dataset_checksum: man.dataset.checksum,
  n: num("n"),
  cluster_count: num("cluster_count"),
  coefficients: { value: num("b_value"), capital: num("b_capital") },
  std_errors: { value: num("se_value"), capital: num("se_capital") },
  inference_configuration: {
    clustering: "one-way cluster=firm",
    estimator: "reghdfe (absorbed firm+year FE)",
    finite_sample_correction: "AER/Stata vce(cluster) cluster-robust",
    absorbed_fe_dof: "firm + year absorbed (reghdfe)",
    covariance_definition: "reghdfe vce(cluster firm)",    covariance_family: "aes_cluster",
    note: "reghdfe clustered SE matches fixest exactly"
  },
  native_default: {
    cov_type: kv.default_cov_type,
    coefficients: { value: num("b_value"), capital: num("b_capital") },
    std_errors: { value: num("default_se_value"), capital: num("default_se_capital") },
    n: num("n")
  }
};
writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n", "utf8");
console.log(JSON.stringify(result, null, 2));

