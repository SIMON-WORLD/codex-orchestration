#!/usr/bin/env node
// P4 artifact 回归：valid bundle + 10 种失败场景 + builder 确定性。
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateArtifacts } from "../core/validate_artifacts.mjs";
import { buildReplicationStamp } from "../core/build_replication_stamp.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VALID = join(root, "tests/fixtures/artifacts/valid");
const TMP = join(root, "role-team-out/artifact_tests");
const FILES = ["data_manifest.json","variable_dictionary.json","sample_flow.json","descriptive_facts.json","model_registry.json","estimates.json","diagnostics.json","replication_stamp.json","artifact_manifest.json"];
function bundleFrom(dir) {
  const bundle = { paths: {} };
  for (const f of FILES) {
    const full = join(dir, f);
    let obj = null; try { obj = JSON.parse(readFileSync(full, "utf8")); } catch {}
    const key = f.replace(".json", "");
    bundle[key] = obj;
    if (obj) bundle.paths[key] = full;
  }
  return bundle;
}
function caseDir(name) { const d = join(TMP, name); rmSync(d, { recursive: true, force: true }); cpSync(VALID, d, { recursive: true }); return d; }
function edit(dir, file, fn) { const p = join(dir, file); const obj = JSON.parse(readFileSync(p, "utf8")); fn(obj); writeFileSync(p, JSON.stringify(obj, null, 2) + "\n", "utf8"); }

let pass = 0, fail = 0;
function expect(name, dir, shouldFail) {
  const errs = validateArtifacts(bundleFrom(dir), bundleFrom(dir).paths);
  const ok = shouldFail ? errs.length > 0 : errs.length === 0;
  if (ok) { console.log(`  ✅ ${name}${errs.length ? " — " + errs[0] : ""}`); pass++; }
  else { console.log(`  ❌ ${name}（期望${shouldFail ? "FAIL" : "PASS"}，errs=${JSON.stringify(errs)}）`); fail++; }
}

console.log("Artifact spec");
// 1 valid
expect("1 valid bundle -> PASS", VALID, false);

// 2 stamp 手改 estimate
let d2 = caseDir("case2");
rmSync(join(d2, "artifact_manifest.json"), { force: true }); // 让 stamp 内容不一致(H)而非 checksum 先触发
edit(d2, "replication_stamp.json", (s) => { s.models[0].critical_estimates[0].estimate = 9.99; });
expect("2 stamp 手改 estimate -> FAIL", d2, true);

// 3 estimates 改了但 stamp 没重建
let d3 = caseDir("case3");
edit(d3, "estimates.json", (e) => { e.estimates[0].estimate = 9.99; });
expect("3 estimates 改但 stamp 未重建 -> FAIL", d3, true);

// 4 estimate 指向不存在 model
let d4 = caseDir("case4");
edit(d4, "estimates.json", (e) => { e.estimates[0].model_id = "MODEL_NOPE"; });
expect("4 estimate 指向不存在 model -> FAIL", d4, true);

// 5 duplicate estimate_id
let d5 = caseDir("case5");
edit(d5, "estimates.json", (e) => { e.estimates.push({ ...e.estimates[0] }); });
expect("5 duplicate estimate_id -> FAIL", d5, true);

// 6 model n != estimate n
let d6 = caseDir("case6");
edit(d6, "estimates.json", (e) => { e.estimates[0].n = 99; });
expect("6 model n != estimate n -> FAIL", d6, true);

// 7 malformed p / CI
let d7 = caseDir("case7");
edit(d7, "estimates.json", (e) => { e.estimates[0].p_value = 1.5; });
expect("7 p 越界 -> FAIL", d7, true);
let d7b = caseDir("case7b");
edit(d7b, "estimates.json", (e) => { e.estimates[0].ci_lower = 1.7; e.estimates[0].ci_upper = 0.8; });
expect("7b CI 非法 -> FAIL", d7b, true);

// 8 sample_flow arithmetic 错误
let d8 = caseDir("case8");
edit(d8, "sample_flow.json", (s) => { s.steps[1].n_removed = 25; });
expect("8 sample_flow 算术错误 -> FAIL", d8, true);

// 9 sample_flow final N 与 data_manifest 不一致
let d9 = caseDir("case9");
edit(d9, "sample_flow.json", (s) => { s.steps[1].n_after = 99; s.steps[1].n_removed = 21; });
expect("9 final N 不一致 -> FAIL", d9, true);

// 10 checksum/ref mismatch
let d10 = caseDir("case10");
edit(d10, "artifact_manifest.json", (m) => { m.artifacts[0].sha256 = "0000"; });
expect("10 checksum 不匹配 -> FAIL", d10, true);

// 11 builder 确定性
const md = JSON.parse(readFileSync(join(VALID, "model_registry.json"), "utf8")).models;
const esD = JSON.parse(readFileSync(join(VALID, "estimates.json"), "utf8")).estimates;
const h1 = { model_registry: "a", estimates: "b", diagnostics: "c" };
const s1 = JSON.stringify(buildReplicationStamp(md, esD, h1));
const s2 = JSON.stringify(buildReplicationStamp(md, esD, h1));
check("11 builder 同输入两次 -> deterministic", s1 === s2);

function check(name, cond) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}`); fail++; } }

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

