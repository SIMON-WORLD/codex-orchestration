#!/usr/bin/env node
// Issue #5 最小可验证 bundle 的确定性生成器（Economics benchmark）。
// 从 source panel.csv 计算 panel_attrition facts、dataset 文本 hash，并组装 validator 所需的全部最小 artifacts。
// 同一输入必须得到同一输出；Core 不读取此文件。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashCanonicalJsonObject, hashTextFile, CANONICAL_HASH_MODE, CANONICAL_TEXT_HASH_MODE } from "../../../../core/artifact_hash.mjs";
import { buildReplicationStamp } from "../../../../core/build_replication_stamp.mjs";
import { parseCsv, computeDescriptiveFacts } from "./compute_panel_attrition_facts.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const REF = "domains/economics/benchmarks/issue5/build_bundle.mjs";
const BUNDLE = join(root, "tests/fixtures/issues/issue5/bundle");

function json(o) { return JSON.stringify(o, null, 2) + "\n"; }

export function buildIssue5Bundle(csvText) {
  const rows = parseCsv(csvText);
  const facts = computeDescriptiveFacts(rows);
  const n = rows.length;
  const datasetId = "DATASET_ISSUE5";
  // data_manifest: 声明真实 source data 文件 + 稳定文本 hash（CRLF/LF 无关）
  const dataManifest = {
    artifact_id: "DATA_MANIFEST_ISSUE5", artifact_type: "data_manifest", schema_version: "1.0",
    producer_role: "data", producer_task_id: "task_issue5", created_at: "fixed",
    inputs: [], code_ref: REF, data_ref: "panel.csv",
    dataset_id: datasetId, data_path: "panel.csv",
    observation_count: n, variable_count: 3,
    dataset_hash_mode: CANONICAL_TEXT_HASH_MODE, dataset_sha256: null,
    source_refs: [], parent_dataset_refs: [],
  };
  const variableDictionary = {
    artifact_id: "VAR_DICT_ISSUE5", artifact_type: "variable_dictionary", schema_version: "1.0",
    producer_role: "data", producer_task_id: "task_issue5", created_at: "fixed",
    inputs: ["DATA_MANIFEST_ISSUE5"], code_ref: REF,
    variables: [
      { name: "id", definition: "panel unit id", type: "integer" },
      { name: "period", definition: "time period", type: "integer" },
      { name: "panel_attrition", definition: "1 if attrited, 0 otherwise", type: "binary" },
    ],
  };
  const sampleFlow = {
    artifact_id: "SAMPLE_FLOW_ISSUE5", artifact_type: "sample_flow", schema_version: "1.0",
    producer_role: "data", producer_task_id: "task_issue5", created_at: "fixed",
    inputs: ["DATA_MANIFEST_ISSUE5"], code_ref: REF,
    steps: [{ step_id: "STEP_FULL", n_before: n, n_removed: 0, n_after: n, reason: "full sample (" + n + " rows)" }],
  };
  const modelRegistry = {
    artifact_id: "MODEL_REG_ISSUE5", artifact_type: "model_registry", schema_version: "1.0",
    producer_role: "empirical", producer_task_id: "task_issue5", created_at: "fixed",
    inputs: ["DATA_MANIFEST_ISSUE5"], code_ref: REF, data_ref: "panel.csv",
    models: [{
      model_id: "MODEL_ISSUE5", capability_id: "economics.regression.panel_fe", implementation_id: "stata.reghdfe",
      runtime: "stata", runtime_instance: "stata.system", sample_id: datasetId,
      outcome: "panel_attrition", treatment: "panel_attrition", specification: "y ~ x",
      fixed_effects: "id", vcov_spec: "cluster", clustering: "id", n: n,
      code_ref: REF, data_ref: "panel.csv", result_ref: "EST_ISSUE5",
    }],
  };
  const estimates = {
    artifact_id: "ESTIMATES_ISSUE5", artifact_type: "estimates", schema_version: "1.0",
    producer_role: "empirical", producer_task_id: "task_issue5", created_at: "fixed",
    inputs: ["MODEL_REG_ISSUE5"], code_ref: REF,
    estimates: [{ estimate_id: "EST_ISSUE5", model_id: "MODEL_ISSUE5", term: "panel_attrition", estimate: 0.04, std_error: 0.08, ci_lower: -0.04, ci_upper: 0.12, p_value: 0.62, n: n }],
  };
  const diagnostics = {
    artifact_id: "DIAG_ISSUE5", artifact_type: "diagnostics", schema_version: "1.0",
    producer_role: "empirical", producer_task_id: "task_issue5", created_at: "fixed",
    inputs: ["MODEL_REG_ISSUE5"], code_ref: REF, diagnostics: [],
  };
  const sourceHashes = {
    model_registry: hashCanonicalJsonObject(modelRegistry),
    estimates: hashCanonicalJsonObject(estimates),
    diagnostics: hashCanonicalJsonObject(diagnostics),
  };
  const stamp = buildReplicationStamp(modelRegistry.models, estimates.estimates, sourceHashes);
  return { rows, facts, n, datasetId, dataManifest, variableDictionary, sampleFlow, modelRegistry, estimates, diagnostics, stamp };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const csvPath = (() => { const i = process.argv.indexOf("--csv"); return i >= 0 ? process.argv[i + 1] : join(BUNDLE, "panel.csv"); })();
  const outDir = (() => { const i = process.argv.indexOf("--out-dir"); return i >= 0 ? process.argv[i + 1] : BUNDLE; })();
  const csvText = readFileSync(csvPath, "utf8");
  const b = buildIssue5Bundle(csvText);
  b.dataManifest.dataset_sha256 = hashTextFile(csvPath);
  const artifacts = [
    { key: "data_manifest", obj: b.dataManifest },
    { key: "variable_dictionary", obj: b.variableDictionary },
    { key: "sample_flow", obj: b.sampleFlow },
    { key: "descriptive_facts", obj: b.facts },
    { key: "model_registry", obj: b.modelRegistry },
    { key: "estimates", obj: b.estimates },
    { key: "diagnostics", obj: b.diagnostics },
    { key: "replication_stamp", obj: b.stamp },
  ];
  // 先写所有 JSON，再生成 artifact_manifest（其 hash 依赖文件实际内容）
  const am = { schema_version: "1.0", artifacts: [] };
  for (const a of artifacts) {
    writeFileSync(join(outDir, a.key + ".json"), json(a.obj), "utf8");
    am.artifacts.push({ path: a.key + ".json", hash_mode: CANONICAL_HASH_MODE, sha256: hashCanonicalJsonObject(a.obj) });
  }
  writeFileSync(join(outDir, "artifact_manifest.json"), json(am), "utf8");
  console.log(`bundle written to ${outDir}: n=${b.n} rate=${b.facts.facts[0].value} count=${b.facts.facts[1].value} dataset_sha256=${b.dataManifest.dataset_sha256.slice(0, 12)}...`);
}
