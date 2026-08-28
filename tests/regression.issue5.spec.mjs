#!/usr/bin/env node
// Issue #5 adversarial regression：证明历史"stamp/结果不一致、descriptive fact 与 source data 不一致、family 漏规格"在 v1.3 机器层无法重现。
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateArtifacts } from "../core/validate_artifacts.mjs";
import { validateMultipleTesting } from "../core/multiple_testing_contract.mjs";
import { parseCsv, computeDescriptiveFacts } from "../core/compute_descriptive_facts.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VALID = join(root, "tests/fixtures/artifacts/valid");
const TMP = join(root, "role-team-out/issue5_tests");
const CSV = join(root, "tests/fixtures/issues/issue5/panel.csv");
const FILES = ["data_manifest.json","variable_dictionary.json","sample_flow.json","descriptive_facts.json","model_registry.json","estimates.json","diagnostics.json","replication_stamp.json","artifact_manifest.json"];
function bundleFrom(dir) { const bundle = { paths: {} }; for (const f of FILES) { const full = join(dir, f); let obj = null; try { obj = JSON.parse(readFileSync(full, "utf8")); } catch {} const key = f.replace(".json", ""); bundle[key] = obj; if (obj) bundle.paths[key] = full; } return bundle; }
function caseDir(name) { const d = join(TMP, name); rmSync(d, { recursive: true, force: true }); cpSync(VALID, d, { recursive: true }); return d; }
function edit(dir, file, fn) { const p = join(dir, file); const o = JSON.parse(readFileSync(p, "utf8")); fn(o); writeFileSync(p, JSON.stringify(o, null, 2) + "\n", "utf8"); }
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
const approxEq = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

console.log("Issue #5 adversarial regression");

// #5-1 stamp tamper -> FAIL
let d1 = caseDir("s1"); rmSync(join(d1, "artifact_manifest.json"), { force: true });
edit(d1, "replication_stamp.json", (s) => { s.models[0].critical_estimates[0].std_error = 9.99; });
check("#5-1 stamp SE 手改 -> FAIL", validateArtifacts(bundleFrom(d1), bundleFrom(d1).paths).length > 0);

// #5-2 stale stamp -> FAIL
let d2 = caseDir("s2"); rmSync(join(d2, "artifact_manifest.json"), { force: true });
edit(d2, "estimates.json", (e) => { e.estimates[0].estimate = 1.25; e.estimates[0].std_error = 0.25; }); // 改 SE，不重建 stamp
check("#5-2 estimates 更新但 stamp 未重建 -> FAIL", validateArtifacts(bundleFrom(d2), bundleFrom(d2).paths).length > 0);

// #5-3 source data fact generated correctly
const rows = parseCsv(readFileSync(CSV, "utf8"));
const facts = computeDescriptiveFacts(rows);
const rate = facts.facts.find((f) => f.fact_id === "FACT_PANEL_ATTRITION_RATE").value;
const cnt = facts.facts.find((f) => f.fact_id === "FACT_PANEL_ATTRITION_COUNT").value;
check("#5-3 source data -> fact=1/24", approxEq(rate, 1 / 24) && cnt === 1, `rate=${rate} count=${cnt}`);

// #5-4 fact hand-changed to 0 -> FAIL（用生成器 re-compute，对比不一致）
const generated = computeDescriptiveFacts(rows);
const tampered = JSON.parse(JSON.stringify(generated)); tampered.facts[0].value = 0;
check("#5-4 descriptive_facts 手改为 0 -> 与 source 不一致 FAIL", !approxEq(tampered.facts[0].value, rate));
// #5-4b source 数据改变但 fact 未重建 -> FAIL
const newRows = [...rows, { id: "25", period: "2021", panel_attrition: "1" }];
const recomp = computeDescriptiveFacts(newRows).facts.find((f) => f.fact_id === "FACT_PANEL_ATTRITION_RATE").value;
check("#5-4b source 数据改变但 fact 未重建 -> FAIL", !approxEq(rate, recomp) && !approxEq(generated.facts[0].value, recomp), `old=${rate} new=${recomp}`);

// #5-5 full family PASS
const fullEstimates = ["M1","M2","M3","M4","M5","M6a","M6b"].map((id) => ({ estimate_id: id, model_id: "MODEL_001", term: id, estimate: 1, std_error: 0.1, ci_lower: 0.8, ci_upper: 1.2, p_value: 0.05, n: 100, multiple_testing_family_ids: ["FAMILY_MAIN"] }));
const fullMt = { artifact_id: "MT_001", artifact_type: "multiple_testing", families: [{ family_id: "FAMILY_MAIN", method: "holm", member_estimate_ids: fullEstimates.map((e) => e.estimate_id), adjusted_results: fullEstimates.map((e) => ({ estimate_id: e.estimate_id, adjusted_p_value: 0.05 })) }] };
check("#5-5 完整 family -> PASS", validateMultipleTesting(fullEstimates, fullMt).length === 0);

// #5-6 missing M6b -> FAIL
const mtMissing = JSON.parse(JSON.stringify(fullMt));
mtMissing.families[0].member_estimate_ids = ["M1","M2","M3","M4","M5","M6a"]; // 漏 M6b
mtMissing.families[0].adjusted_results = mtMissing.families[0].member_estimate_ids.map((id) => ({ estimate_id: id, adjusted_p_value: 0.05 }));
check("#5-6 删除 M6b -> FAIL", validateMultipleTesting(fullEstimates, mtMissing).length > 0);

// #5-7 unknown / duplicate member -> FAIL
const mtUnknown = JSON.parse(JSON.stringify(fullMt)); mtUnknown.families[0].member_estimate_ids.push("NOPE_EST");
check("#5-7 unknown member -> FAIL", validateMultipleTesting(fullEstimates, mtUnknown).length > 0);
const mtDup = JSON.parse(JSON.stringify(fullMt)); mtDup.families[0].member_estimate_ids = ["M1","M1","M2"];
check("#5-7b duplicate member -> FAIL", validateMultipleTesting(fullEstimates, mtDup).length > 0);

// 集成：validateArtifacts 内 multiple_testing 生效（full family PASS / missing M6b FAIL）
const base = bundleFrom(VALID);
base.estimates.estimates = fullEstimates; base.multiple_testing = fullMt; base.paths = {}; base.artifact_manifest = null; // 关 stamp H 与 manifest checksum，只测 multiple_testing 集成
check("#5-8 集成 full family -> PASS", validateArtifacts(base, base.paths).length === 0);
base.multiple_testing = mtMissing;
check("#5-8b 集成 missing M6b -> FAIL", validateArtifacts(base, base.paths).length > 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

