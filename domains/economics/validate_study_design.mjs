#!/usr/bin/env node
// 确定性 study_design 契约校验（领域级，位于 domains/economics）。
// 只做：结构契约（加载 study_design.schema.json）+ capability registry 成员校验。
// 不做：capability resolution、admission、科学推断。不把 Director 变成 worker Role。
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const FILE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(FILE_DIR, "..", "..");
const SCHEMA_PATH = join(FILE_DIR, "study_design.schema.json");
const DEFAULT_REGISTRY_DIR = join(ROOT, "domains", "economics", "capabilities");

function loadJson(rel) {
  try { return JSON.parse(readFileSync(rel, "utf8")); }
  catch (e) { throw new Error(`无法解析 JSON ${rel}：${e.message}`); }
}
const schemaCache = new Map();
function loadSchema(p = SCHEMA_PATH) {
  if (schemaCache.has(p)) return schemaCache.get(p);
  const s = loadJson(p);
  schemaCache.set(p, s);
  return s;
}
function loadRegistry(dir = DEFAULT_REGISTRY_DIR) {
  const reg = {};
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    try { const cap = loadJson(join(dir, f)); if (cap && cap.id) reg[cap.id] = cap; }
    catch { /* skip unreadable capability */ }
  }
  return reg;
}

// ---- 最小 JSON Schema 子集求值（draft-07/2020-12 的常用关键字） ----
function typeMatch(value, t) {
  switch (t) {
    case "object": return typeof value === "object" && value !== null && !Array.isArray(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return true;
  }
}
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function joinPath(base, key) {
  if (base === "") return String(key);
  return typeof key === "number" ? `${base}[${key}]` : `${base}.${key}`;
}

function schemaViolations(schema, value, path = "") {
  const out = [];
  if (!schema || schema === true) return out;
  if (schema === false) { out.push({ path, keyword: "falseSchema" }); return out; }
  if (typeof schema !== "object") return out;

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeMatch(value, t))) { out.push({ path, keyword: "type" }); return out; }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((v) => deepEqual(v, value))) { out.push({ path, keyword: "enum" }); return out; }
  if (schema.const !== undefined && !deepEqual(schema.const, value)) { out.push({ path, keyword: "const" }); return out; }

  if (typeMatch(value, "object")) {
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) out.push({ path, keyword: "minProperties" });
    if (Array.isArray(schema.required)) for (const k of schema.required) if (!(k in value)) out.push({ path: joinPath(path, k), keyword: "required" });
    const props = schema.properties || {};
    if (schema.additionalProperties === false) {
      for (const k of Object.keys(value)) if (!(k in props)) out.push({ path: joinPath(path, k), keyword: "additionalProperties" });
    } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      for (const k of Object.keys(value)) if (!(k in props)) for (const v of schemaViolations(schema.additionalProperties, value[k], joinPath(path, k))) out.push(v);
    }
    for (const [k, sub] of Object.entries(props)) if (k in value) for (const v of schemaViolations(sub, value[k], joinPath(path, k))) out.push(v);
  } else if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) out.push({ path, keyword: "minItems" });
    if (schema.items) {
      if (Array.isArray(schema.items)) schema.items.forEach((sub, i) => { if (i < value.length) for (const v of schemaViolations(sub, value[i], joinPath(path, i))) out.push(v); });
      else value.forEach((el, i) => { for (const v of schemaViolations(schema.items, el, joinPath(path, i))) out.push(v); });
    }
  } else if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) out.push({ path, keyword: "minLength" });
    if (schema.pattern) { try { if (!new RegExp(schema.pattern).test(value)) out.push({ path, keyword: "pattern" }); } catch { /* ignore bad regex */ } }
  }
  return out;
}

// ---- 把 schema violation 映射为机器可读错误对象 ----
function friendly(v) {
  const p = v.path;
  let code = "STUDY_SCHEMA_INVALID";
  if (p === "study_id") code = "STUDY_ID_INVALID";
  else if (p === "domain") code = "STUDY_DOMAIN_INVALID";
  else if (p === "execution_context") code = "EXECUTION_CONTEXT_INVALID";
  else if (p === "execution_context.mode") code = "EXECUTION_MODE_INVALID";
  else if (p === "selected_capabilities") code = "SELECTED_CAPABILITIES_INVALID";
  else if (p.startsWith("selected_capabilities.") && v.keyword === "minItems") code = "SELECTED_CAPABILITIES_EMPTY";
  else if (p.startsWith("selected_capabilities.")) code = "SELECTED_CAPABILITIES_INVALID";
  else if (p === "decisions") code = "DECISIONS_INVALID";
  else if (p === "preconditions") code = "PRECONDITIONS_INVALID";
  else if (p === "manual_validations") code = "MANUAL_VALIDATIONS_INVALID";
  else if (v.keyword === "required") code = "STUDY_REQUIRED_FIELD_MISSING";
  return { code, path: p, message: message(v), keyword: v.keyword };
}
function message(v) {
  switch (v.keyword) {
    case "type": return `期望 ${v.path} 是对象/数组/字符串等，但实际类型不符`;
    case "required": return `缺少必需的字段: ${v.path}`;
    case "enum": return `${v.path} 取值非法（不在允许枚举内）`;
    case "const": return `${v.path} 必须是固定值: economics`;
    case "minItems": return `${v.path} 不允许为空数组（每个 selected_capabilities 至少要有一个 capability ID）`;
    case "minLength": return `${v.path} 不允许为空字符串`;
    case "pattern": return `${v.path} 不满足 pattern`;
    case "additionalProperties": return `${v.path} 不是本契约允许的字段`;
    case "falseSchema": return `${v.path} 为 false schema`;
    default: return `${v.path} 不满足 schema 约束 (${v.keyword})`;
  }
}

// ---- 主校验：契约 + registry 成员 ----
function validateStudyDesign(study, registry) {
  if (!study || typeof study !== "object" || Array.isArray(study)) {
    return [{ code: "STUDY_SCHEMA_INVALID", path: "", message: "study 必须是对象", keyword: "type" }];
  }
  const errors = [];
  const schema = loadSchema();
  for (const v of schemaViolations(schema, study)) errors.push(friendly(v));
  const reg = registry || loadRegistry();
  for (const [roleId, capIds] of Object.entries(study.selected_capabilities || {})) {
    if (!Array.isArray(capIds)) continue;
    capIds.forEach((id, i) => {
      if (typeof id === "string" && id.length > 0 && !reg[id]) {
        errors.push({ code: "CAPABILITY_ID_UNKNOWN", path: `selected_capabilities.${roleId}.${i}`, message: `未知 capability ID '${id}'（不在 economics registry）`, keyword: "registry" });
      }
    });
  }
  return errors;
}

// ---- CLI —— 仅在作为主模块运行时执行 ----
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const i = process.argv.indexOf("--study");
  const studyPath = i >= 0 ? process.argv[i + 1] : join(FILE_DIR, "study_design.example.json");
  const ri = process.argv.indexOf("--registry");
  const registryDir = ri >= 0 ? process.argv[ri + 1] : DEFAULT_REGISTRY_DIR;
  let study;
  try { study = loadJson(studyPath); }
  catch (e) { console.error(`STUDY_PARSE_ERROR: ${e.message}`); process.exit(1); }
  const errors = validateStudyDesign(study, loadRegistry(registryDir));
  if (errors.length) {
    console.error("study_design 契约校验失败：");
    for (const e of errors) console.error(`  [${e.code}] ${e.path || "(root)"} — ${e.message}`);
    process.exit(1);
  }
  console.log("OK: study_design 契约合法");
}

export { loadSchema, loadRegistry, schemaViolations, validateStudyDesign };
