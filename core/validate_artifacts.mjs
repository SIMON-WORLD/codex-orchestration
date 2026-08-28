#!/usr/bin/env node
// Deterministic artifact validator（领域无关）。复用 buildReplicationStamp 的纯函数；
// 重建 expected stamp，与磁盘 stamp 做 deterministic 比较。不做科学 reviewer 的主观判断。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildReplicationStamp } from "./build_replication_stamp.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function sha256(p) { return createHash("sha256").update(readFileSync(p)).digest("hex"); }
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
  replication_stamp: ["schema_version", "model_count", "estimate_count", "model_ids", "estimate_ids", "models", "source_hashes"],
};

function contractErrs(type, obj) {
  const errs = [];
  if (!obj || typeof obj !== "object") return [`${type}: 非对象`];
  for (const k of REQUIRED[type] || []) if (obj[k] === undefined) errs.push(`${type}: 缺 ${k}`);
  if (type === "replication_stamp") { if (!Array.isArray(obj.models)) errs.push("stamp: models 非数组"); else for (const m of obj.models) if (!m || !m.model_id || !Array.isArray(m.estimate_ids)) errs.push("stamp: models[].model_id/estimate_ids 缺失"); }
  return errs;
}
function uniqueErrs(list, key, label) {
  const seen = new Map(); const errs = [];
  for (const it of list) { const v = it[key]; if (v === undefined) { errs.push(`${label} 缺 ${key}`); continue; } if (seen.has(v)) errs.push(`${label} 重复 ${key}: ${v}`); seen.set(v, it); }
  return errs;
}

// 校验整包。bundle 为各字段的 parsed 对象；paths 为 {type: filePath}（用于 source_hashes / artifact_manifest checksum）。
export function validateArtifacts(bundle, paths) {
  const errs = [];
  const dm = bundle.data_manifest, vd = bundle.variable_dictionary, sf = bundle.sample_flow, desc = bundle.descriptive_facts;
  const mr = bundle.model_registry, es = bundle.estimates, dg = bundle.diagnostics, stamp = bundle.replication_stamp, am = bundle.artifact_manifest;
  for (const [type, obj] of Object.entries({ data_manifest: dm, variable_dictionary: vd, sample_flow: sf, descriptive_facts: desc, model_registry: mr, estimates: es, diagnostics: dg, replication_stamp: stamp })) errs.push(...contractErrs(type, obj));
  if (errs.length) return errs;

  // B. IDs 唯一
  errs.push(...uniqueErrs(mr.models, "model_id", "model_registry"));
  errs.push(...uniqueErrs(es.estimates, "estimate_id", "estimates"));
  errs.push(...uniqueErrs(dg.diagnostics, "diagnostic_id", "diagnostics"));
  errs.push(...uniqueErrs(desc.facts, "fact_id", "descriptive_facts"));
  errs.push(...uniqueErrs(vd.variables, "name", "variable_dictionary"));
  errs.push(...uniqueErrs(sf.steps, "step_id", "sample_flow"));

  const modelMap = new Map(mr.models.map((m) => [m.model_id, m]));
  // C/D/E. estimate↔model + n + numeric
  for (const e of es.estimates) {
    const m = modelMap.get(e.model_id);
    if (!m) { errs.push(`estimates: ${e.estimate_id} 指向不存在 model ${e.model_id}`); continue; }
    if (m.n !== undefined && e.n !== m.n) errs.push(`estimates: ${e.estimate_id} n(${e.n}) != model ${m.model_id} n(${m.n})`);
    for (const k of ["estimate", "std_error", "ci_lower", "ci_upper"]) if (!isFiniteNum(e[k])) errs.push(`estimates: ${e.estimate_id}.${k} 非 finite`);
    if (!(e.p_value >= 0 && e.p_value <= 1)) errs.push(`estimates: ${e.estimate_id}.p_value 越界 (${e.p_value})`);
    if (!(e.ci_lower <= e.ci_upper)) errs.push(`estimates: ${e.estimate_id} CI 非法 (${e.ci_lower} > ${e.ci_upper})`);
    if (!(e.ci_lower <= e.estimate && e.estimate <= e.ci_upper)) errs.push(`estimates: ${e.estimate_id} estimate 不在 CI 内`);
  }
  // F. sample_flow arithmetic + final N vs manifest
  if (sf.steps.length > 0) {
    for (let i = 0; i < sf.steps.length; i++) {
      const s = sf.steps[i];
      if (!(Number.isInteger(s.n_before) && Number.isInteger(s.n_after) && Number.isInteger(s.n_removed))) { errs.push(`sample_flow: ${s.step_id} n 非整数`); continue; }
      if (s.n_before - s.n_removed !== s.n_after) errs.push(`sample_flow: ${s.step_id} 算术错误 (${s.n_before} - ${s.n_removed} != ${s.n_after})`);
      if (i > 0 && sf.steps[i - 1].n_after !== s.n_before) errs.push(`sample_flow: ${s.step_id} 与前一步未衔接`);
    }
    if (sf.steps[sf.steps.length - 1].n_after !== dm.observation_count) errs.push(`sample_flow: final n(${sf.steps[sf.steps.length - 1].n_after}) != data_manifest(${dm.observation_count})`);
  }
  // G. refs 存在（inputs 引用的 artifact_id 需存在）
  const ids = new Set([dm.artifact_id, vd.artifact_id, sf.artifact_id, desc.artifact_id, mr.artifact_id, es.artifact_id, dg.artifact_id]);
  for (const obj of [dm, vd, sf, desc, mr, es, dg]) for (const r of obj.inputs || []) if (!ids.has(r)) errs.push(`refs: ${obj.artifact_id} 引用不存在的 ${r}`);
  if (am && am.artifacts) {
    for (const a of am.artifacts) {
      const stub = String(a.path || "").replace(".json", "");
      const p = paths?.[stub];
      if (!p) { errs.push(`artifact_manifest: ${a.path || a.artifact_id} 无对应文件`); continue; }
      if (a.sha256 && sha256(p) !== a.sha256) errs.push(`artifact_manifest: ${a.path || a.artifact_id} checksum 不匹配`);
    }
  }
  // D. diagnostic model ref
  for (const d of dg.diagnostics) if (d.model_id && !modelMap.has(d.model_id)) errs.push(`diagnostics: ${d.diagnostic_id} 指向不存在 model ${d.model_id}`);
  // H. replication_stamp rebuild（复用同一 builder 纯函数）
  if (paths?.model_registry && paths?.estimates) {
    const sourceHashes = { model_registry: sha256(paths.model_registry), estimates: sha256(paths.estimates) };
    if (paths.diagnostics) sourceHashes.diagnostics = sha256(paths.diagnostics);
    const expected = buildReplicationStamp(mr.models, es.estimates, sourceHashes);
    if (JSON.stringify(expected) !== JSON.stringify(stamp)) errs.push("replication_stamp: 与 estimates/model_registry 不一致（可能手改或未重建）");
  }
  return errs;
}
function sorted(o) { return JSON.stringify(o, Object.keys(o).sort()); }

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const bundleDir = arg("bundle");
  if (!bundleDir) { console.error("用法：node core/validate_artifacts.mjs --bundle <dir>"); process.exit(2); }
  const dir = isAbsolute(bundleDir) ? bundleDir : join(root, bundleDir);
  const f = (name) => (`${dir}/${name}`);
  const files = ["data_manifest.json", "variable_dictionary.json", "sample_flow.json", "descriptive_facts.json", "model_registry.json", "estimates.json", "diagnostics.json", "replication_stamp.json", "artifact_manifest.json"];
  const bundle = { paths: {} };
  for (const name of files) {
    const full = f(name);
    let obj = null; try { obj = JSON.parse(readFileSync(full, "utf8")); } catch {}
    const key = name.replace(".json", "");
    bundle[key] = obj;
    if (obj) bundle.paths[key] = full;
  }
  const errs = validateArtifacts(bundle, bundle.paths);
  if (errs.length) { console.error("validate_artifacts FAIL："); for (const e of errs) console.error("  - " + e); process.exit(1); }
  console.log("OK: artifacts 一致（valid）");
}


