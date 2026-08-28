#!/usr/bin/env node
// P7 panel_fe cross-engine benchmark regression.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { comparePanelFe } from "../domains/economics/benchmarks/panel_fe/comparator.mjs";
import { hashTextFile } from "../core/artifact_hash.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = join(root, "domains/economics/benchmarks/panel_fe");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const manifest = readJson(join(BASE, "benchmark.grunfeld.json"));
const results = [
  readJson(join(BASE, "results/python.json")),
  readJson(join(BASE, "results/r.json")),
  readJson(join(BASE, "results/stata.json")),
];
const checksum = hashTextFile(join(BASE, "grunfeld.csv"));
const clone = (x) => JSON.parse(JSON.stringify(x));
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }

console.log("P7 panel_fe benchmark regression");

// 1. valid run -> expected structured verdict (not FAIL)
{
  const v = comparePanelFe(manifest, clone(results), checksum);
  check("valid: verdict != FAIL", v.verdict !== "FAIL", `verdict=${v.verdict}`);
  check("valid: coefficients PASS", v.checks.coefficients === "PASS");
  check("valid: n & cluster_count PASS", v.checks.n === "PASS" && v.checks.cluster_count === "PASS");
  check("valid: canonical_covariance (fixest/reghdfe) PASS", v.checks.canonical_covariance === "PASS");
  check("valid: linearmodels covariance UNRESOLVED", v.checks.covariance_alignment["panel.fe.python.linearmodels"] === "UNRESOLVED");
}
// 2. coefficient tamper -> FAIL
{
  const r = clone(results); r[0].coefficients.value = r[0].coefficients.value + 0.5;
  const v = comparePanelFe(manifest, r, checksum);
  check("tampered coefficient -> FAIL", v.verdict === "FAIL" && v.checks.coefficients === "FAIL");
}
// 3. N mismatch -> FAIL
{
  const r = clone(results); r[2].n = 201;
  const v = comparePanelFe(manifest, r, checksum);
  check("N mismatch -> FAIL", v.verdict === "FAIL" && v.checks.n === "FAIL");
}
// 4. checksum mismatch -> FAIL
{
  const r = clone(results); r[0].dataset_checksum = "d49d8a9eDEADBEEF";
  const v = comparePanelFe(manifest, r, checksum);
  check("checksum mismatch -> FAIL", v.verdict === "FAIL" && v.checks.dataset_checksum === "FAIL");
}
// 5. covariance definition mismatch (fixest moved off canonical) -> canonical UNRESOLVED
{
  const r = clone(results); r[1].inference_configuration.covariance_family = "linearmodels_clustered";
  const v = comparePanelFe(manifest, r, checksum);
  check("covariance definition mismatch -> canonical UNRESOLVED", v.checks.canonical_covariance === "UNRESOLVED" && v.checks.covariance_alignment["panel.fe.r.fixest"] === "UNRESOLVED");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
