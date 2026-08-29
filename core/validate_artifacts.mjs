#!/usr/bin/env node
// Deterministic artifact validator（领域无关）。复用 buildReplicationStamp 的纯函数；
// 重建 expected stamp，与磁盘 stamp 做 canonical-semantic 比较（忽略 key order / formatting / CRLF）。
// 不替代科学 reviewer。
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildReplicationStamp } from "./build_replication_stamp.mjs";
import { canonicalJson, hashCanonicalJsonFile, hashRawFile, hashTextFile, CANONICAL_HASH_MODE, CANONICAL_TEXT_HASH_MODE } from "./artifact_hash.mjs";
import { validateMultipleTesting } from "./multiple_testing_contract.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) { const i = process.argv.indexOf("--" + name); return i >= 0 ? process.argv[i + 1] : undefined; }
function isFiniteNum(x) { return typeof x === "number" && Number.isFinite(x); }

const REQUIRED = {
  data_manifest: ["artifact_id", "artifact_type", "schema_version", "producer_role", "producer_task_id", "dataset_id", "observation_count", "variable_count"],
  variable_dictionary: ["artifact_id", "artifact_type", "schema_version", "producer_role", "producer_task_id", "variables"],
  sample_flow: ["artifact_id", "artifact_type", "schema_version", "producer_role", "producer_task_id", "steps"],
  descriptive_facts: ["artifact_id", "artifact_type", "schema_version", "producer_role", "producer_task_id", "facts"],
  model_registry: ["artifact_id", "artifact_type", "schema_version", "producer_role", "producer_task_id", "models"],
  estimates: ["artifact_id", "artifact_type", "schema_version", "producer_role", "producer_task_id", "estimates"],
  diagnostics: ["artifact_id", "artifact_type", "schema_version", "producer_role", "producer_task_id", "diagnostics"],
  replication_stamp: ["schema_version", "model_count", "estimate_count", "model_ids", "estimate_ids", "models", "source_hashes", "source_hash_mode"],
  multiple_testing: ["artifact_id", "artifact_type", "families"],
};
export const EXPECTED_TYPE = { data_manifest: "data_manifest", variable_dictionary: "variable_dictionary", sample_flow: "sample_flow", descriptive_facts: "descriptive_facts", model_registry: "model_registry", estimates: "estimates", diagnostics: "diagnostics", multiple_testing: "multiple_testing" };
const PRESENTATION_REQUIRED = ["artifact_id","artifact_type","schema_version","producer_role","producer_task_id","views"];
const PRESENTATION_ALLOWED_KEYS = new Set(["artifact_id","artifact_type","schema_version","producer_role","producer_task_id","created_at","inputs","code_ref","data_ref","views"]);
const PRESENTATION_VIEW_REQUIRED = ["view_id","view_type","output_ref","source_refs"];
const PRESENTATION_SOURCE_REQUIRED = ["artifact_id","source_hash","source_hash_mode"];
const VIEW_ALLOWED_KEYS = new Set(["view_id","view_type","output_ref","source_refs"]);
const SOURCE_ALLOWED_KEYS = new Set(["artifact_id","item_ids","source_hash","source_hash_mode"]);
const ITEM_ID_FIELDS = { model_registry: ["models","model_id"], estimates: ["estimates","estimate_id"], diagnostics: ["diagnostics","diagnostic_id"], descriptive_facts: ["facts","fact_id"] };
const MODEL_REQUIRED = ["model_id", "capability_id", "implementation_id", "runtime", "sample_id", "outcome", "n", "code_ref", "result_ref"];
const ESTIMATE_REQUIRED = ["estimate_id", "model_id", "term", "estimate", "std_error", "ci_lower", "ci_upper", "p_value", "n"];
const VARIABLE_REQUIRED = ["name", "definition"];
const STEP_REQUIRED = ["step_id", "n_before", "n_after", "n_removed", "reason"];

function contractErrs(type, obj) {
  const errs = [];
  if (!obj || typeof obj !== "object") return [`${type}: 非对象`];
  for (const k of REQUIRED[type] || []) if (obj[k] === undefined) errs.push(`${type}: 缺 ${k}`);
  if (EXPECTED_TYPE[type] && obj.artifact_type !== EXPECTED_TYPE[type]) errs.push(`${type}: artifact_type 应为 ${EXPECTED_TYPE[type]}，实际 ${obj.artifact_type}`);
  if (type === "model_registry") for (const m of obj.models || []) for (const k of MODEL_REQUIRED) if (m[k] === undefined) errs.push(`model_registry: ${m.model_id || "?"} 缺 ${k}`);
  if (type === "estimates") for (const e of obj.estimates || []) for (const k of ESTIMATE_REQUIRED) if (e[k] === undefined) errs.push(`estimates: ${e.estimate_id || "?"} 缺 ${k}`);
  if (type === "variable_dictionary") for (const v of obj.variables || []) for (const k of VARIABLE_REQUIRED) if (v[k] === undefined) errs.push(`variable_dictionary: 缺 ${k}`);
  if (type === "sample_flow") for (const s of obj.steps || []) for (const k of STEP_REQUIRED) if (s[k] === undefined) errs.push(`sample_flow: ${s.step_id || "?"} 缺 ${k}`);
  if (type === "replication_stamp") {
    if (!Array.isArray(obj.models)) errs.push("stamp: models 非数组");
    else for (const m of obj.models) if (!m || !m.model_id || !Array.isArray(m.estimate_ids) || !Array.isArray(m.critical_estimates)) errs.push("stamp: models[].model_id/estimate_ids/critical_estimates 缺失");
    if (obj.source_hash_mode !== CANONICAL_HASH_MODE) errs.push(`stamp: source_hash_mode 应为 ${CANONICAL_HASH_MODE}，实际 ${obj.source_hash_mode}`);
  }
  return errs;
}
function uniqueErrs(list, key, label) {
  const seen = new Map(); const errs = [];
  for (const it of list) { const v = it[key]; if (v === undefined) { errs.push(`${label} 缺 ${key}`); continue; } if (seen.has(v)) errs.push(`${label} 重复 ${key}: ${v}`); seen.set(v, it); }
  return errs;
}

// presentation_manifest：可选「派生视图」provenance binding。只存绑定元数据，不内嵌科学数值。
function validatePresentation(bundle, paths) {
  const errs = [];
  const pm = bundle.presentation_manifest;
  if (!pm) return errs;
  if (typeof pm !== "object" || Array.isArray(pm)) return ["presentation_manifest: 非对象"];
  for (const k of PRESENTATION_REQUIRED) if (pm[k] === undefined) errs.push(`presentation_manifest: 缺 ${k}`);
  if (pm.artifact_type !== "presentation_manifest") errs.push(`presentation_manifest: artifact_type 应为 presentation_manifest`);
  for (const k of Object.keys(pm)) if (!PRESENTATION_ALLOWED_KEYS.has(k)) errs.push(`presentation_manifest: 含非法顶层字段 ${k}（不得内嵌科学数值）`);
  // artifact_id -> { type, path, obj }
  const artifactById = new Map();
  for (const type of ["data_manifest","variable_dictionary","sample_flow","descriptive_facts","model_registry","estimates","diagnostics","presentation_manifest"]) {
    const obj = bundle[type];
    if (obj && obj.artifact_id) artifactById.set(obj.artifact_id, { type, path: paths?.[type], obj });
  }
  for (const v of pm.views || []) {
    if (!v || typeof v !== "object") { errs.push("presentation_manifest: view 非对象"); continue; }
    for (const k of Object.keys(v)) if (!VIEW_ALLOWED_KEYS.has(k)) errs.push(`presentation_manifest: view ${v.view_id || "?"} 含非法字段 ${k}（不得内嵌科学数值）`);
    for (const k of PRESENTATION_VIEW_REQUIRED) if (v[k] === undefined) errs.push(`presentation_manifest: view ${v.view_id || "?"} 缺 ${k}`);
    if (v.view_type !== undefined && v.view_type !== "table" && v.view_type !== "figure") errs.push(`presentation_manifest: view ${v.view_id} view_type 非法`);
    if (!Array.isArray(v.source_refs) || v.source_refs.length === 0) errs.push(`presentation_manifest: view ${v.view_id} source_refs 不能为空`);
    for (const s of v.source_refs || []) {
      if (!s || typeof s !== "object") { errs.push(`presentation_manifest: view ${v.view_id} source_ref 非对象`); continue; }
      for (const k of Object.keys(s)) if (!SOURCE_ALLOWED_KEYS.has(k)) errs.push(`presentation_manifest: view ${v.view_id} source_ref 含非法字段 ${k}`);
      for (const k of PRESENTATION_SOURCE_REQUIRED) if (s[k] === undefined) errs.push(`presentation_manifest: view ${v.view_id} source_ref 缺 ${k}`);
      const src = artifactById.get(s.artifact_id);
      if (!src) { errs.push(`presentation_manifest: view ${v.view_id} 引用不存在的 artifact ${s.artifact_id}`); continue; }
      if (src.type === "presentation_manifest") errs.push(`presentation_manifest: view ${v.view_id} 不能以另一 presentation view 作为科学来源`);
      if (s.source_hash_mode !== undefined && s.source_hash_mode !== CANONICAL_HASH_MODE) errs.push(`presentation_manifest: view ${v.view_id} source_hash_mode 应为 ${CANONICAL_HASH_MODE}`);
      if (src.path && s.source_hash_mode === CANONICAL_HASH_MODE) {
        let actual; try { actual = hashCanonicalJsonFile(src.path); } catch { errs.push(`presentation_manifest: 无法读取源 artifact ${s.artifact_id}`); actual = null; }
        if (actual && actual !== s.source_hash) errs.push(`presentation_manifest: view ${v.view_id} 源 artifact hash 不匹配（${s.artifact_id} 已改变或未同步）`);
      }
      if (s.item_ids !== undefined) {
        if (!Array.isArray(s.item_ids)) { errs.push(`presentation_manifest: view ${v.view_id} item_ids 非数组`); continue; }
        const idSpec = ITEM_ID_FIELDS[src.type];
        if (!idSpec) { errs.push(`presentation_manifest: view ${v.view_id} artifact ${s.artifact_id} (${src.type}) 不支持 item_ids`); continue; }
        const [listKey, idKey] = idSpec;
        const items = src.obj?.[listKey] || [];
        const idSet = new Set(items.map((it) => it[idKey]));
        for (const itemId of s.item_ids) if (!idSet.has(itemId)) errs.push(`presentation_manifest: view ${v.view_id} item_id ${itemId} 不存在于 ${s.artifact_id}`);
      }
    }
  }
  return errs;
}
export function validateArtifacts(bundle, paths) {
  const errs = [];
  const dm = bundle.data_manifest, vd = bundle.variable_dictionary, sf = bundle.sample_flow, desc = bundle.descriptive_facts;
  const mr = bundle.model_registry, es = bundle.estimates, dg = bundle.diagnostics, stamp = bundle.replication_stamp, am = bundle.artifact_manifest;
  for (const [type, obj] of Object.entries({ data_manifest: dm, variable_dictionary: vd, sample_flow: sf, descriptive_facts: desc, model_registry: mr, estimates: es, diagnostics: dg, replication_stamp: stamp })) errs.push(...contractErrs(type, obj));
  if (errs.length) return errs;

  errs.push(...uniqueErrs(mr.models, "model_id", "model_registry"));
  errs.push(...uniqueErrs(es.estimates, "estimate_id", "estimates"));
  errs.push(...uniqueErrs(dg.diagnostics, "diagnostic_id", "diagnostics"));
  errs.push(...uniqueErrs(desc.facts, "fact_id", "descriptive_facts"));
  errs.push(...uniqueErrs(vd.variables, "name", "variable_dictionary"));
  errs.push(...uniqueErrs(sf.steps, "step_id", "sample_flow"));

  const modelMap = new Map(mr.models.map((m) => [m.model_id, m]));
  for (const e of es.estimates) {
    const m = modelMap.get(e.model_id);
    if (!m) { errs.push(`estimates: ${e.estimate_id} 指向不存在 model ${e.model_id}`); continue; }
    if (m.n !== undefined && e.n !== m.n) errs.push(`estimates: ${e.estimate_id} n(${e.n}) != model ${m.model_id} n(${m.n})`);
    for (const k of ["estimate", "std_error", "ci_lower", "ci_upper"]) if (!isFiniteNum(e[k])) errs.push(`estimates: ${e.estimate_id}.${k} 非 finite`);
    if (!(e.p_value >= 0 && e.p_value <= 1)) errs.push(`estimates: ${e.estimate_id}.p_value 越界 (${e.p_value})`);
    if (!(e.ci_lower <= e.ci_upper)) errs.push(`estimates: ${e.estimate_id} CI 非法 (${e.ci_lower} > ${e.ci_upper})`);
    if (!(e.ci_lower <= e.estimate && e.estimate <= e.ci_upper)) errs.push(`estimates: ${e.estimate_id} estimate 不在 CI 内`);
  }
  if (sf.steps.length > 0) {
    for (let i = 0; i < sf.steps.length; i++) {
      const s = sf.steps[i];
      if (!(Number.isInteger(s.n_before) && Number.isInteger(s.n_after) && Number.isInteger(s.n_removed))) { errs.push(`sample_flow: ${s.step_id} n 非整数`); continue; }
      if (s.n_before - s.n_removed !== s.n_after) errs.push(`sample_flow: ${s.step_id} 算术错误 (${s.n_before} - ${s.n_removed} != ${s.n_after})`);
      if (i > 0 && sf.steps[i - 1].n_after !== s.n_before) errs.push(`sample_flow: ${s.step_id} 与前一步未衔接`);
    }
    if (sf.steps[sf.steps.length - 1].n_after !== dm.observation_count) errs.push(`sample_flow: final n(${sf.steps[sf.steps.length - 1].n_after}) != data_manifest(${dm.observation_count})`);
  }
  const ids = new Set([dm.artifact_id, vd.artifact_id, sf.artifact_id, desc.artifact_id, mr.artifact_id, es.artifact_id, dg.artifact_id]);
  for (const obj of [dm, vd, sf, desc, mr, es, dg]) for (const r of obj.inputs || []) if (!ids.has(r)) errs.push(`refs: ${obj.artifact_id} 引用不存在的 ${r}`);
    // source-data freshness（仅当 data_manifest 声明了真实 source data + hash）
  if (dm && paths?.data_manifest) {
    if (typeof dm.dataset_sha256 === "string" && dm.dataset_sha256.length > 0) {
      if (!dm.dataset_hash_mode) errs.push("data_manifest: 声明 dataset_sha256 但缺 dataset_hash_mode");
      if (!dm.data_path) errs.push("data_manifest: 声明 dataset_sha256 但缺 data_path");
      if (dm.dataset_hash_mode && dm.data_path) {
        const bundleDir = dirname(paths.data_manifest);
        const dataAbs = isAbsolute(dm.data_path) ? dm.data_path : join(bundleDir, dm.data_path);
        let actual;
        try {
          if (dm.dataset_hash_mode === CANONICAL_HASH_MODE) actual = hashCanonicalJsonFile(dataAbs);
          else if (dm.dataset_hash_mode === "raw_file_sha256") actual = hashRawFile(dataAbs);
          else if (dm.dataset_hash_mode === CANONICAL_TEXT_HASH_MODE) actual = hashTextFile(dataAbs);
          else errs.push(`data_manifest: 未知 dataset_hash_mode ${dm.dataset_hash_mode}`);
        } catch {
          errs.push(`data_manifest: source data 文件不存在 (${dataAbs})`);
        }
        if (actual && actual !== dm.dataset_sha256) errs.push("data_manifest: source data 与 dataset_sha256 不一致（source 改变或未重建）");
      }
    }
  }
if (am && Array.isArray(am.artifacts)) {
    for (const a of am.artifacts) {
      const stub = String(a.path || "").replace(".json", "");
      const p = paths?.[stub];
      if (!p) { errs.push(`artifact_manifest: ${a.path || a.artifact_id} 无对应文件`); continue; }
      if (!a.hash_mode) { errs.push(`artifact_manifest: ${a.path} 缺 hash_mode`); continue; }
      let actual;
      if (a.hash_mode === CANONICAL_HASH_MODE) actual = hashCanonicalJsonFile(p);
      else if (a.hash_mode === "raw_file_sha256") actual = hashRawFile(p);
      else { errs.push(`artifact_manifest: ${a.path} 未知 hash_mode ${a.hash_mode}`); continue; }
      if (a.sha256 && actual !== a.sha256) errs.push(`artifact_manifest: ${a.path} checksum 不匹配`);
    }
  }
  for (const d of dg.diagnostics) if (d.model_id && !modelMap.has(d.model_id)) errs.push(`diagnostics: ${d.diagnostic_id} 指向不存在 model ${d.model_id}`);
  // multiple-testing family completeness（estimate 声明的 family 必须全员覆盖）
  if (bundle.multiple_testing) errs.push(...validateMultipleTesting(es.estimates, bundle.multiple_testing));
  if (paths?.model_registry && paths?.estimates) {
    const sourceHashes = { model_registry: hashCanonicalJsonFile(paths.model_registry), estimates: hashCanonicalJsonFile(paths.estimates) };
    if (paths.diagnostics) sourceHashes.diagnostics = hashCanonicalJsonFile(paths.diagnostics);
    const expected = buildReplicationStamp(mr.models, es.estimates, sourceHashes);
    if (canonicalJson(expected) !== canonicalJson(stamp)) errs.push("replication_stamp: 与 estimates/model_registry 不一致（可能手改或未重建）");
  }
  errs.push(...validatePresentation(bundle, paths));
  return errs;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const bundleDir = arg("bundle");
  if (!bundleDir) { console.error("用法：node core/validate_artifacts.mjs --bundle <dir>"); process.exit(2); }
  const dir = isAbsolute(bundleDir) ? bundleDir : join(root, bundleDir);
  const files = ["data_manifest.json", "variable_dictionary.json", "sample_flow.json", "descriptive_facts.json", "model_registry.json", "estimates.json", "diagnostics.json", "replication_stamp.json", "artifact_manifest.json", "multiple_testing.json", "presentation_manifest.json"];
  const bundle = { paths: {} };
  for (const name of files) {
    const full = `${dir}/${name}`;
    let obj = null; try { obj = JSON.parse(readFileSync(full, "utf8")); } catch {}
    const key = name.replace(".json", "");
    bundle[key] = obj;
    if (obj) bundle.paths[key] = full;
  }
  const errs = validateArtifacts(bundle, bundle.paths);
  if (errs.length) { console.error("validate_artifacts FAIL："); for (const e of errs) console.error("  - " + e); process.exit(1); }
  console.log("OK: artifacts 一致（valid）");
}




