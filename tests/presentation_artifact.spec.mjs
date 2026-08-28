#!/usr/bin/env node
// generic presentation_manifest provenance binding（派生视图）回归。
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateArtifacts } from "../core/validate_artifacts.mjs";
import { hashCanonicalJsonFile, CANONICAL_HASH_MODE } from "../core/artifact_hash.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VALID = join(root, "tests/fixtures/artifacts/valid");
const TMP = join(root, "role-team-out/presentation_artifact_tests");
const FILES = ["data_manifest.json","variable_dictionary.json","sample_flow.json","descriptive_facts.json","model_registry.json","estimates.json","diagnostics.json","replication_stamp.json","artifact_manifest.json","presentation_manifest.json"];

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
function writePres(dir, pm) { writeFileSync(join(dir, "presentation_manifest.json"), JSON.stringify(pm, null, 2) + "\n", "utf8"); }

let pass = 0, fail = 0;
function expect(name, dir, shouldFail, labelContains) {
  const b = bundleFrom(dir);
  const errs = validateArtifacts(b, b.paths);
  const ok = shouldFail ? errs.length > 0 : errs.length === 0;
  const matched = labelContains ? errs.some((e) => e.includes(labelContains)) : true;
  if (ok && matched) { console.log(`  ✅ ${name}${errs.length ? " — " + errs[0] : ""}`); pass++; }
  else { console.log(`  ❌ ${name}（期望${shouldFail ? "FAIL" : "PASS"}${labelContains ? ` 含「${labelContains}」` : ""}，errs=${JSON.stringify(errs)}）`); fail++; }
}
const h = (f) => hashCanonicalJsonFile(join(VALID, f));
const EST_HASH = h("estimates.json"), DIAG_HASH = h("diagnostics.json"), FACT_HASH = h("descriptive_facts.json");
const COMMON = { schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_pres_001", created_at: "2026-08-28T00:00:00Z" };

console.log("Presentation artifact spec");

// baseline：无 presentation_manifest 的 bundle 仍通过
expect("0 existing bundle without presentation passes", VALID, false);

// 1 合法 table view 引用真实 estimate ids
let d1 = caseDir("p1");
writePres(d1, { artifact_id: "PRESENT_001", artifact_type: "presentation_manifest", ...COMMON, views: [ { view_id: "V_TABLE_1", view_type: "table", output_ref: "output/tables/table1.tex", source_refs: [ { artifact_id: "ESTIMATES_001", item_ids: ["EST_001"], source_hash: EST_HASH, source_hash_mode: CANONICAL_HASH_MODE } ] } ] });
expect("1 valid table view referencing real estimate ids passes", d1, false);

// 2 合法 figure view 引用 diagnostic + descriptive fact ids
let d2 = caseDir("p2");
writePres(d2, { artifact_id: "PRESENT_002", artifact_type: "presentation_manifest", ...COMMON, views: [ { view_id: "V_FIG_1", view_type: "figure", output_ref: "output/figures/fig1.png", source_refs: [ { artifact_id: "DIAGNOSTICS_001", item_ids: ["DIAG_001"], source_hash: DIAG_HASH, source_hash_mode: CANONICAL_HASH_MODE }, { artifact_id: "DESC_FACTS_001", item_ids: ["FACT_PANEL_ATTRITION_RATE"], source_hash: FACT_HASH, source_hash_mode: CANONICAL_HASH_MODE } ] } ] });
expect("2 valid figure view referencing diagnostic/descriptive-fact ids passes", d2, false);

// 3 不存在的源 artifact 失败
let d3 = caseDir("p3");
writePres(d3, { artifact_id: "PRESENT_003", artifact_type: "presentation_manifest", ...COMMON, views: [ { view_id: "V_TABLE_2", view_type: "table", output_ref: "output/tables/t2.tex", source_refs: [ { artifact_id: "NOPE_ARTIFACT", source_hash: "deadbeef", source_hash_mode: CANONICAL_HASH_MODE } ] } ] });
expect("3 nonexistent source artifact fails", d3, true, "引用不存在的 artifact");

// 4 不存在的源 item id 失败
let d4 = caseDir("p4");
writePres(d4, { artifact_id: "PRESENT_004", artifact_type: "presentation_manifest", ...COMMON, views: [ { view_id: "V_TABLE_3", view_type: "table", output_ref: "output/tables/t3.tex", source_refs: [ { artifact_id: "ESTIMATES_001", item_ids: ["EST_999"], source_hash: EST_HASH, source_hash_mode: CANONICAL_HASH_MODE } ] } ] });
expect("4 nonexistent source item id fails", d4, true, "item_id EST_999 不存在");

// 5 空 source_refs 失败
let d5 = caseDir("p5");
writePres(d5, { artifact_id: "PRESENT_005", artifact_type: "presentation_manifest", ...COMMON, views: [ { view_id: "V_TABLE_4", view_type: "table", output_ref: "output/tables/t4.tex", source_refs: [] } ] });
expect("5 empty source_refs fails", d5, true, "source_refs 不能为空");

// 6 stale source hash 失败（上游 artifact 变更后未同步）
let d6 = caseDir("p6");
writePres(d6, { artifact_id: "PRESENT_006", artifact_type: "presentation_manifest", ...COMMON, views: [ { view_id: "V_TABLE_5", view_type: "table", output_ref: "output/tables/t5.tex", source_refs: [ { artifact_id: "ESTIMATES_001", item_ids: ["EST_001"], source_hash: EST_HASH, source_hash_mode: CANONICAL_HASH_MODE } ] } ] });
{ const p = join(d6, "estimates.json"); const o = JSON.parse(readFileSync(p, "utf8")); o.estimates[0].estimate = 9.99; writeFileSync(p, JSON.stringify(o, null, 2) + "\n", "utf8"); }
// 保留 stamp/artifact_manifest：contract 校验通过后，presentation 的源 hash 校验独立触发
expect("6 stale source hash fails after upstream changes", d6, true, "hash 不匹配");

// 7 presentation-to-presentation scientific sourcing fails（自引用）
let d7 = caseDir("p7");
writePres(d7, { artifact_id: "PRESENT_007", artifact_type: "presentation_manifest", ...COMMON, views: [ { view_id: "V_TABLE_6", view_type: "table", output_ref: "output/tables/t6.tex", source_refs: [ { artifact_id: "PRESENT_007", source_hash: "x", source_hash_mode: CANONICAL_HASH_MODE } ] } ] });
expect("7 presentation-to-presentation scientific sourcing fails", d7, true, "不能以另一 presentation view 作为科学来源");

// 8 presentation_manifest 不得成为新的数值 truth（view 内嵌科学数值被拒）
let d8 = caseDir("p8");
writePres(d8, { artifact_id: "PRESENT_008", artifact_type: "presentation_manifest", ...COMMON, views: [ { view_id: "V_TABLE_7", view_type: "table", output_ref: "output/tables/t7.tex", estimate: 9.99, coefficients: [1.25, 2.0], source_refs: [ { artifact_id: "ESTIMATES_001", item_ids: ["EST_001"], source_hash: EST_HASH, source_hash_mode: CANONICAL_HASH_MODE } ] } ] });
expect("8 presentation_manifest does not become a new numerical source of truth", d8, true, "不得内嵌科学数值");

// 8b source_ref 内嵌科学数值同样被拒
let d8b = caseDir("p8b");
writePres(d8b, { artifact_id: "PRESENT_008B", artifact_type: "presentation_manifest", ...COMMON, views: [ { view_id: "V_TABLE_7B", view_type: "table", output_ref: "output/tables/t7b.tex", source_refs: [ { artifact_id: "ESTIMATES_001", item_ids: ["EST_001"], source_hash: EST_HASH, source_hash_mode: CANONICAL_HASH_MODE, p_value: 0.5 } ] } ] });
expect("8b source_ref embedded numeric payload rejected", d8b, true, "source_ref 含非法字段");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

