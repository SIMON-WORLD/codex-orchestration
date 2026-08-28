#!/usr/bin/env node
// P7 panel_fe cross-engine benchmark regression.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { comparePanelFe } from "../domains/economics/benchmarks/panel_fe/comparator.mjs";
import { requireFreshStataOutput, buildStataResultFromRaw } from "../domains/economics/benchmarks/panel_fe/runners/run_stata.mjs";
import { hashTextFile } from "../core/artifact_hash.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = join(root, "domains/economics/benchmarks/panel_fe");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const manifest = readJson(join(BASE, "benchmark.grunfeld.json"));
const results = [ readJson(join(BASE, "results/python.json")), readJson(join(BASE, "results/r.json")), readJson(join(BASE, "results/stata.json")) ];
const checksum = hashTextFile(join(BASE, "grunfeld.csv"));
const clone = (x) => JSON.parse(JSON.stringify(x));
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }

console.log("P7 panel_fe benchmark regression");

// 1. valid run
{
  const v = comparePanelFe(manifest, clone(results), checksum);
  check("valid: verdict != FAIL", v.verdict !== "FAIL", `verdict=${v.verdict}`);
  check("valid: coefficients PAS", v.checks.coefficients === "PASS");
  check("valid: n & cluster_count PAS", v.checks.n === "PASS" && v.checks.cluster_count === "PASS");
  check("valid: canonical_covariance (reghdfe<->fixest) PAS", v.checks.canonical_covariance === "PASS");
  check("valid: linearmodels covariance UNRESOLVED", v.checks.covariance_alignment["panel.fe.python.linearmodels"] === "UNRESOLVED");
}
// 2. coefficient tamper -> FAIL
{ const r = clone(results); r[0].coefficients.value += 0.5; const v = comparePanelFe(manifest, r, checksum); check("tampered coefficient -> FAIL", v.verdict === "FAIL" && v.checks.coefficients === "FAIL"); }
// 3. N mismatch -> FAIL
{ const r = clone(results); r[2].n = 201; const v = comparePanelFe(manifest, r, checksum); check("N mismatch -> FAIL", v.verdict === "FAIL" && v.checks.n === "FAIL"); }
// 4. checksum mismatch -> FAIL
{ const r = clone(results); r[0].dataset_checksum = "d49d8a9eDEADBEEF"; const v = comparePanelFe(manifest, r, checksum); check("checksum mismatch -> FAIL", v.verdict === "FAIL" && v.checks.dataset_checksum === "FAIL"); }
// 5. canonical definition mismatch (fixest no longer canonical) -> canonical UNRESOLVED
{ const r = clone(results); r[1].inference_configuration.is_canonical_definition = false; const v = comparePanelFe(manifest, r, checksum); check("covariance definition mismatch -> canonical UNRESOLVED", v.checks.canonical_covariance === "UNRESOLVED" && v.checks.covariance_alignment["panel.fe.r.fixest"] === "UNRESOLVED"); }
// 6. stale-output regression (E): fresh-raw enforcement
{
  let threw = false; try { requireFreshStataOutput(false, false); } catch { threw = true; }
  check("stale: Stata failed + no raw -> thrown", threw);
  threw = false; try { requireFreshStataOutput(true, false); } catch { threw = true; }
  check("stale: raw not regenerated (missing) -> thrown", threw);
  let ok = false; try { requireFreshStataOutput(true, true); ok = true; } catch {}
  check("stale: fresh raw present -> not thrown", ok);
}
// 7. Stata result builder real evidence
{
  const SAMPLE = `n=200\ncluster_count=10\nb_value=.11771585508260658\nb_capital=.35791627307342766\nse_value=.01082442947686367\nse_capital=.0478483965925891\ndefault_se_value=.013751283003648225\ndefault_se_capital=.022719010882572516\nstata_version=19.5\ne_df_m=2\ne_df_r=9\ne_df_a=19\ne_df_a_nested=10\ne_dofmethod=pairwise clusters continuous\ne_vce=cluster\ne_clustvar=firm\ne_cmd=reghdfe\ne_version=.\n`;
  const r = buildStataResultFromRaw(SAMPLE, manifest);
  check("stata builder: runtime from real e()/c(version)", r.runtime_version === "19.5");
  check("stata builder: package_version unknown + evidence", r.package_version === "unknown" && typeof r.package_version_evidence === "string" && r.package_version_evidence.length > 0);
  check("stata builder: e_df_a_nested captured", r.inference_configuration.stata_dof_evidence.df_a_nested === "10");
  check("stata builder: nested firm FE redundant noted", /nested/.test(r.inference_configuration.note));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
