#!/usr/bin/env node
// Economics Director 决策状态评估（领域级，位于 domains/economics）。
// 只根据选定 capability 的 metadata 判断：Director 是否仍有未决科学决策。
// 输入：一个已通过结构契约校验的 Economics study_design。
// 不做：实现选择、runtime 探测、verification_status 强制、高风产 admission 判定、重复 Core resolver 逻辑。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadRegistry, validateStudyDesign } from "./validate_study_design.mjs";

const FILE_DIR = dirnamePath();
function dirnamePath() { return join(fileURLToPath(new URL(".", import.meta.url))); }

// ---- 归一化：registry 可能以字符串或对象形式出现（稳健处理） ----
function asArray(x) { return Array.isArray(x) ? x : (x === undefined || x === null ? [] : [x]); }
function isEmpty(v) {
  return v === undefined || v === null || v === "" ||
    (Array.isArray(v) && v.length === 0) ||
    (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0);
}

// ---- 单条 capability 的未决决策 ----
function unresolvedForCapability(capId, cap, study) {
  const out = [];
  const decisions = study.decisions || {};
  const preconds = study.preconditions || {};
  const manual = study.manual_validations || {};

  // 1) decision_requirements -> study.decisions
  for (const req of asArray(cap.decision_requirements)) {
    if (typeof req === "string" && req.length > 0 && isEmpty(decisions[req])) {
      out.push({ capability: capId, kind: "decision_requirement", field: req });
    }
  }

  // 2) scientific_preconditions
  for (const pc of asArray(cap.scientific_preconditions)) {
    if (!pc || typeof pc !== "object") continue;
    if (pc.kind === "machine") {
      const field = pc.field;
      if (!field) continue;
      const provided = !isEmpty(preconds[field]);
      if (!provided && pc.on_missing === "needs_decision") {
        // 只有 on_missing=needs_decision 表示“这是未决科学选择”；on_missing=blocked 留给 resolver 判定。
        out.push({ capability: capId, kind: "precondition", field });
      }
      // 若已提供值，Director 层视为已决；是否 admissible 由 Core resolver 判定。
    } else if (pc.kind === "manual") {
      const label = pc.label;
      if (!label) continue;
      const v = manual[label];
      // 三态：true = resolved & satisfied；false = resolved but NOT satisfied（留给下游 resolver/precondition
      // 决定 blocked 等，Director 不判）；missing/undefined/null/其它 = 未决科学验证 -> needs_decision。
      if (v !== true && v !== false) {
        out.push({ capability: capId, kind: "manual_validation", field: label });
      }
    }
  }
  return out;
}

// ---- 主评估 ----
function evaluateStudyDesign(study, registry) {
  const reg = registry || loadRegistry();
  const unresolved = [];
  const selected = study?.selected_capabilities || {};
  const capSet = new Set();
  for (const roleId of Object.keys(selected)) {
    const capIds = Array.isArray(selected[roleId]) ? selected[roleId] : [];
    for (const capId of capIds) {
      if (capSet.has(capId)) continue;
      capSet.add(capId);
      const cap = reg[capId];
      if (!cap) continue; // 已由结构校验保证存在于 registry；这里防御性跳过。
      for (const u of unresolvedForCapability(capId, cap, study)) unresolved.push(u);
    }
  }
  const status = unresolved.length === 0 ? "ready" : "needs_decision";
  return {
    study_id: study?.study_id || null,
    status,
    unresolved_decisions: unresolved,
    selected_capabilities: selected,
  };
}

// ---- 集成：结构契约校验通过后才做决策状态评估 ----
function evaluateIfValid(study, registry) {
  const contractErrors = validateStudyDesign(study, registry);
  if (contractErrors.length > 0) {
    return { ok: false, errors: contractErrors };
  }
  return { ok: true, result: evaluateStudyDesign(study, registry) };
}
function validateThenEvaluate(studyPath, registry) {
  let study;
  try { study = JSON.parse(readFileSync(studyPath, "utf8")); }
  catch (e) { return { ok: false, errors: [{ code: "STUDY_PARSE_ERROR", path: "", message: e.message }] }; }
  return evaluateIfValid(study, registry);
}

// ---- CLI（仅在作为主模块运行时执行） ----
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const i = process.argv.indexOf("--study");
  const studyPath = i >= 0 ? process.argv[i + 1] : join(FILE_DIR, "study_design.example.json");
  const ri = process.argv.indexOf("--registry");
  const registry = loadRegistry(ri >= 0 ? process.argv[ri + 1] : undefined);
  const out = validateThenEvaluate(studyPath, registry);
  if (!out.ok) {
    console.error("study_design 结构契约校验失败，跳过决策状态评估：");
    for (const e of out.errors) console.error(`  [${e.code}] ${e.path || "(root)"} — ${e.message}`);
    process.exit(1);
  }
  console.log(JSON.stringify(out.result, null, 2));
}

export { evaluateStudyDesign, unresolvedForCapability, evaluateIfValid, validateThenEvaluate };


