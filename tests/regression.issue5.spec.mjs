#!/usr/bin/env node
// Issue #5 adversarial regression（P5.1 版）：
// - Core validator 负责“source/output 是否 stale/tampered”（artifact_manifest checksum + data_manifest dataset hash freshness）。
// - Economics benchmark generator 负责“算法从 source 算对”（panel_attrition = 1/24）。
// - 两层不混在 Core。
import { readFileSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateArtifacts } from "../core/validate_artifacts.mjs";
import { validateMultipleTesting } from "../core/multiple_testing_contract.mjs";
import { parseCsv, computeDescriptiveFacts } from "../domains/economics/benchmarks/issue5/compute_panel_attrition_facts.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ISSUE = join(root, "tests/fixtures/issues/issue5/bundle");
const TMP = join(root, "role-team-out/issue5_tests");
const FILES = ["data_manifest.json","variable_dictionary.json","sample_flow.json","descriptive_facts.json","model_registry.json","estimates.json","diagnostics.json","replication_stamp.json","artifact_manifest.json"];
function bundleFrom(dir) { const bundle = { paths: {} }; for (const f of FILES) { const full = join(dir, f); let obj = null; try { obj = JSON.parse(readFileSync(full, "utf8")); } catch {} const key = f.replace(".json", ""); bundle[key] = obj; if (obj) bundle.paths[key] = full; } return bundle; }
function issueCaseDir(name) { const d = join(TMP, name); rmSync(d, { recursive: true, force: true }); cpSync(ISSUE, d, { recursive: true }); return d; }
function edit(dir, file, fn) { const p = join(dir, file); const o = JSON.parse(readFileSync(p, "utf8")); fn(o); writeFileSync(p, JSON.stringify(o, null, 2) + "\n", "utf8"); }
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
const approxEq = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const csvPath = join(ISSUE, "panel.csv");

console.log("Issue #5 adversarial regression");

let d1 = issueCaseDir("s1"); rmSync(join(d1, "artifact_manifest.json"), { force: true });
edit(d1, "replication_stamp.json", (s) => { s.models[0].critical_estimates[0].std_error = 9.99; });
check("#5-1 stamp SE 手改 -> real VALIDATOR FAIL", validateArtifacts(bundleFrom(d1), bundleFrom(d1).paths).length > 0);

let d2 = issueCaseDir("s2"); rmSync(join(d2, "artifact_manifest.json"), { force: true });
edit(d2, "estimates.json", (e) => { e.estimates[0].estimate = 1.25; e.estimates[0].std_error = 0.25; });
check("#5-2 estimates 更新但 stamp 未重建 -> real VALIDATOR FAIL", validateArtifacts(bundleFrom(d2), bundleFrom(d2).paths).length > 0);

const rows = parseCsv(readFileSync(csvPath, "utf8"));
const facts = computeDescriptiveFacts(rows);
const rate = facts.facts.find((f) => f.fact_id === "FACT_PANEL_ATTRITION_RATE").value;
const cnt = facts.facts.find((f) => f.fact_id === "FACT_PANEL_ATTRITION_COUNT").value;
check("#5-3 A. generator: 23x0+1x1 -> fact=1/24", approxEq(rate, 1 / 24) && cnt === 1, `rate=${rate} count=${cnt}`);

check("#5-4 B. valid source+grafted bundle -> validate PASS", validateArtifacts(bundleFrom(ISSUE), bundleFrom(ISSUE).paths).length === 0);

let d3 = issueCaseDir("s3");
edit(d3, "descriptive_facts.json", (f) => { f.facts[0].value = 0; });
const errsC = validateArtifacts(bundleFrom(d3), bundleFrom(d3).paths);
check("#5-5 C. fact 手改为 0 -> real VALIDATOR FAIL", errsC.length > 0, errsC[0] || "");

let d4 = issueCaseDir("s4");
{ const p = join(d4, "panel.csv"); let s = readFileSync(p, "utf8").replace("24,2020,1\n", "24,2020,1\n25,2021,1\n"); writeFileSync(p, s, "utf8"); }
const errsD = validateArtifacts(bundleFrom(d4), bundleFrom(d4).paths);
check("#5-6 D. source 改变(25行) -> real VALIDATOR FAIL", errsD.length > 0, errsD[0] || "");

const fullEstimates = ["M1","M2","M3","M4","M5","M6a","M6b"].map((id) => ({ estimate_id: id, model_id: "MODEL_ISSUE5", term: id, estimate: 1, std_error: 0.1, ci_lower: 0.8, ci_upper: 1.2, p_value: 0.05, n: 24, multiple_testing_family_ids: ["FAMILY_MAIN"] }));
const fullMt = { artifact_id: "MT_001", artifact_type: "multiple_testing", families: [{ family_id: "FAMILY_MAIN", method: "holm", member_estimate_ids: fullEstimates.map((e) => e.estimate_id), adjusted_results: fullEstimates.map((e) => ({ estimate_id: e.estimate_id, adjusted_p_value: 0.05 })) }] };
check("#5-7 完整 family -> PASS", validateMultipleTesting(fullEstimates, fullMt).length === 0);
const mtMissing = JSON.parse(JSON.stringify(fullMt)); mtMissing.families[0].member_estimate_ids = ["M1","M2","M3","M4","M5","M6a"]; mtMissing.families[0].adjusted_results = mtMissing.families[0].member_estimate_ids.map((id) => ({ estimate_id: id, adjusted_p_value: 0.05 }));
check("#5-8 删除 M6b -> FAIL", validateMultipleTesting(fullEstimates, mtMissing).length > 0);
const mtUnknown = JSON.parse(JSON.stringify(fullMt)); mtUnknown.families[0].member_estimate_ids.push("NOPE_EST");
check("#5-9 unknown member -> FAIL", validateMultipleTesting(fullEstimates, mtUnknown).length > 0);
const mtDup = JSON.parse(JSON.stringify(fullMt)); mtDup.families[0].member_estimate_ids = ["M1","M1","M2"];
check("#5-10 duplicate member -> FAIL", validateMultipleTesting(fullEstimates, mtDup).length > 0);
const base = bundleFrom(ISSUE); base.estimates.estimates = fullEstimates; base.multiple_testing = fullMt; base.paths = {}; base.artifact_manifest = null;
check("#5-11 集成 full family -> PASS", validateArtifacts(base, base.paths).length === 0);
base.multiple_testing = mtMissing;
check("#5-12 集成 missing M6b -> FAIL", validateArtifacts(base, base.paths).length > 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
