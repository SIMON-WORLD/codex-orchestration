#!/usr/bin/env node
// P7 panel_fe cross-engine benchmark regression (Grunfeld + synthetic known-result).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { comparePanelFe } from "../domains/economics/benchmarks/panel_fe/comparator.mjs";
import { requireFreshStataOutput, buildStataResultFromRaw } from "../domains/economics/benchmarks/panel_fe/runners/run_stata.mjs";
import { referencePanelFe } from "../domains/economics/benchmarks/panel_fe/reference.mjs";
import { hashTextFile } from "../core/artifact_hash.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = join(root, "domains/economics/benchmarks/panel_fe");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
const approx = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;
function readCsv(p) { const lines = readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.trim() !== ""); const h = lines[0].split(",").map((x) => x.trim()); return lines.slice(1).map((l) => { const c = l.split(",").map((x) => x.trim()); const o = {}; h.forEach((k, i) => (o[k] = Number(c[i]))); return o; }); }

const gManifest = readJson(join(BASE, "benchmark.grunfeld.json"));
const gResults = [ readJson(join(BASE, "results/python.json")), readJson(join(BASE, "results/r.json")), readJson(join(BASE, "results/stata.json")) ];
const gChecksum = hashTextFile(join(BASE, "grunfeld.csv"));

const SYN = join(BASE, "synthetic");
const sManifest = readJson(join(SYN, "benchmark.synthetic.json"));
const sResults = [ readJson(join(SYN, "results/python.json")), readJson(join(SYN, "results/r.json")), readJson(join(SYN, "results/stata.json")) ];
const sReference = readJson(join(SYN, "results/reference.json"));
const sChecksum = hashTextFile(join(SYN, "panel.csv"));

console.log("P7 panel_fe benchmark regression");

// --- Grunfeld ---
{
  const v = comparePanelFe(gManifest, clone(gResults), gChecksum);
  check("grunfeld: verdict != FAIL", v.verdict !== "FAIL");
  check("grunfeld: coefficients PASS", v.checks.coefficients === "PASS");
  check("grunfeld: n & cluster_count PASS", v.checks.n === "PASS" && v.checks.cluster_count === "PASS");
  check("grunfeld: canonical_covariance (reghdfe<->fixest) PASS", v.checks.canonical_covariance === "PASS");
  check("grunfeld: linearmodels covariance UNRESOLVED", v.checks.covariance_alignment["panel.fe.python.linearmodels"] === "UNRESOLVED");
}
// Grunfeld reference self-check
{
  const rows = readCsv(join(BASE, "grunfeld.csv"));
  const ref = referencePanelFe({ firm: rows.map((r) => r.firm), year: rows.map((r) => r.year), y: rows.map((r) => r.invest), x1: rows.map((r) => r.value), x2: rows.map((r) => r.capital) });
  check("grunfeld: reference beta matches reghdfe", approx(ref.beta.x1, gResults[2].coefficients.value) && approx(ref.beta.x2, gResults[2].coefficients.capital));
  check("grunfeld: reference SE matches reghdfe", approx(ref.se.x1, gResults[2].std_errors.value) && approx(ref.se.x2, gResults[2].std_errors.capital));
}
// --- Synthetic ---
{
  const dm = sResults[0].inference_configuration.df_adjustment.diag_matrix;
  const keys = ["A_default","B_auto_df_false_count_effects_true","C_auto_df_false_count_effects_false","D_debiased_false","E_default_group_debias_true","F_auto_df_false_count_effects_false_group_debias_true"];
  check("synthetic: python diag matrix A-F present", keys.every((k) => dm[k] && typeof dm[k].value_se === "number" && typeof dm[k].capital_se === "number"));
  // reference self-check vs committed reference.json
  const rows = readCsv(join(SYN, "panel.csv"));
  const ref = referencePanelFe({ firm: rows.map((r) => r.firm), year: rows.map((r) => r.year), y: rows.map((r) => r.invest), x1: rows.map((r) => r.value), x2: rows.map((r) => r.capital) });
  check("synthetic: reference self-check (beta)", approx(ref.beta.x1, sReference.beta.x1) && approx(ref.beta.x2, sReference.beta.x2));
  check("synthetic: reference self-check (SE)", approx(ref.se.x1, sReference.se.x1) && approx(ref.se.x2, sReference.se.x2));
  // fixest / reghdfe match reference SE strictly
  check("synthetic: fixest SE matches reference", approx(sResults[1].std_errors.value, sReference.se.x1) && approx(sResults[1].std_errors.capital, sReference.se.x2));
  check("synthetic: reghdfe SE matches reference", approx(sResults[2].std_errors.value, sReference.se.x1) && approx(sResults[2].std_errors.capital, sReference.se.x2));
  // comparator verdict
  const v = comparePanelFe(sManifest, clone(sResults), sChecksum);
  check("synthetic: verdict != FAIL", v.verdict !== "FAIL");
  check("synthetic: canonical_covariance (fixest/reghdfe) PASS", v.checks.canonical_covariance === "PASS");
  check("synthetic: linearmodels UNRESOLVED", v.checks.covariance_alignment["panel.fe.python.linearmodels"] === "UNRESOLVED");
  // tamper cases
  let r = clone(sResults); r[0].coefficients.value += 1; check("synthetic: coefficient tamper -> FAIL", comparePanelFe(sManifest, r, sChecksum).verdict === "FAIL");
  r = clone(sResults); r[2].std_errors.capital = 99.0; check("synthetic: SE tamper -> FAIL", comparePanelFe(sManifest, r, sChecksum).verdict === "FAIL");
  r = clone(sResults); r[0].dataset_checksum = "DEADBEEF"; check("synthetic: checksum mismatch -> FAIL", comparePanelFe(sManifest, r, sChecksum).verdict === "FAIL");
}
// --- Stata fresh-run gate + builder ---
{
  const cases = [["false,false", false, false, true], ["true,false", true, false, true], ["false,true", false, true, true], ["true,true", true, true, false]];
  for (const [label, ok, raw, shouldThrow] of cases) { let threw = false; try { requireFreshStataOutput(ok, raw); } catch { threw = true; } check(`stale gate: ${label} -> ${shouldThrow ? "throw" : "pass"}`, threw === shouldThrow); }
}
{
  const SAMPLE = `n=25\ncluster_count=5\nb_value=2.05880587985704\nb_capital=-0.920465536908786\nse_value=.0730215434227993\nse_capital=.0403578390171644\ndefault_se_value=.0755844783091441\ndefault_se_capital=.0417743321328419\nstata_version=19.5\ne_df_m=2\ne_df_r=4\ne_df_a=4\ne_df_a_nested=5\ne_dofmethod=pairwise clusters continuous\ne_vce=cluster\ne_clustvar=firm\ne_cmd=reghdfe\ne_version=.\n`;
  const r = buildStataResultFromRaw(SAMPLE, sManifest, "panel_fe_synthetic");
  check("stata builder: synthetic benchmark_id & checksum", r.benchmark_id === "panel_fe_synthetic" && r.dataset_checksum === sManifest.dataset.checksum);
  check("stata builder: package_version unknown + evidence", r.package_version === "unknown");
  check("stata builder: df_a_nested captured", r.inference_configuration.stata_dof_evidence.df_a_nested === "5");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
