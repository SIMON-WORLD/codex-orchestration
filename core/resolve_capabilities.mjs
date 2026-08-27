#!/usr/bin/env node
// 通用 Capability Resolver / Preflight（领域无关）。
// Core 只理解通用概念：capability / implementation / runtime / environment / status / risk / policy /
// precondition / decision / resolved / needs_decision / blocked。不硬编码任何领域方法名或软件名。
// 输入: --study <study_design.json> （必填）
//       --registry <capabilities dir/文件> （可选，默认 domains/<domain>/capabilities）
//       --env <env.json> （可选：执行环境快照，来自 scripts/probe_env.mjs 或手工；缺省保守 unknown）
//       --domain <name>　（可选：用于定位默认 registry 路径）
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATUS_RANK = { verified: 4, tested: 3, experimental: 2, reference: 1, deprecated: 0 };

function readJson(rel) { return JSON.parse(readFileSync(join(root, rel), "utf8")); }
function arg(name) { const i = process.argv.indexOf("--" + name); return i >= 0 ? process.argv[i + 1] : undefined; }
function hasFlag(name) { return process.argv.includes("--" + name); }
function loadJson(path, rel) {
  try { return JSON.parse(readFileSync(isAbsolute(path) ? path : join(root, rel), "utf8")); }
  catch (e) { throw new Error(`无法解析 JSON ${path}：${e.message}`); }
}
function isDir(p) { try { return statSync(p).isDirectory(); } catch { return false; } }
function loadRegistry(path, defaultDir) {
  const p = path || defaultDir;
  if (!p) return {};
  if (isDir(p)) {
    const reg = {};
    for (const f of readdirSync(p)) {
      if (!f.endsWith(".json") || f === "index.json") continue;
      try { const cap = JSON.parse(readFileSync(join(p, f), "utf8")); if (cap && cap.id) reg[cap.id] = cap; }
      catch (e) { throw new Error(`无法解析 capability ${f}：${e.message}`); }
    }
    return reg;
  }
  const data = loadJson(p, p);
  if (Array.isArray(data)) { const reg = {}; for (const c of data) if (c && c.id) reg[c.id] = c; return reg; }
  return data || {};
}

// ---- 版本约束（最小实现：支持 >=X / ==X / 裸 X，数字小段逐段比较） ----
function compareVersion(a, b) {
  const pa = String(a).split(".").map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da !== db) return da > db ? 1 : -1;
  }
  return 0;
}
function versionKnown(v) { return v !== undefined && v !== null && v !== "unknown" && v !== ""; }
function satisfies(version, constraint) {
  if (constraint === undefined || constraint === null || constraint === "") return true;
  if (!versionKnown(version)) return false; // unknown version 不满足约束
  const c = String(constraint).trim();
  const m = c.match(/^(>=|==|>|<)?\s*(.+)$/);
  const op = (m && m[1]) || "==";
  const want = (m && m[2]) || c;
  const cmp = compareVersion(version, want);
  switch (op) {
    case ">=": return cmp >= 0;
    case ">": return cmp > 0;
    case "<": return cmp < 0;
    case "==": default: return cmp === 0;
  }
}

// ---- 环境判定（skill/workflow 需 resources 证据；tool 需 runtime+packages；unknown version 不满足约束） ----
function resolveInstances(env) {
  if (env?.runtime_instances && Object.keys(env.runtime_instances).length > 0) {
    return Object.entries(env.runtime_instances).map(([id, inst]) => ({ id, ...inst }));
  }
  // 兼容旧 snapshot：runtimes(版本) + packages（作为每个 runtime 的可用包，宽松映射）
  const insts = [];
  for (const [rt, info] of Object.entries(env?.runtimes || {})) {
    insts.push({ id: `${rt}.os`, runtime: rt, provider: "os", available: info.available, known: info.known, version: info.version, packages: env?.packages || {} });
  }
  return insts;
}
function findInstance(impl, env) {
  if (impl.kind === "skill" || impl.kind === "workflow") {
    const bucket = impl.kind === "skill" ? env?.resources?.skills : env?.resources?.workflows;
    const entry = bucket?.[impl.name] || bucket?.[impl.id];
    return (entry && entry.available === true) ? { resource: impl.kind, id: impl.name } : null;
  }
  if (impl.runtime === "any") return { any: true };
  const reqs = impl.environment_requirements || {};
  const candidates = resolveInstances(env).filter((i) => i.runtime === impl.runtime && i.available === true);
  for (const inst of candidates) {
    if (reqs.version_constraints && !satisfies(inst.version, reqs.version_constraints)) continue;
    if (reqs.packages) {
      let ok = true;
      for (const [pkg, ver] of Object.entries(reqs.packages)) {
        const p = inst.packages?.[pkg];
        if (!p || !p.available) { ok = false; break; }
        if (ver && !satisfies(p.version, ver)) { ok = false; break; }
      }
      if (!ok) continue;
    }
    return inst;
  }
  return null;
}
function envFulfilled(impl, env) {
  return findInstance(impl, env) !== null;
}
function bestInstance(impl, env) {
  return findInstance(impl, env);
}

// ---- 科学前提：machine / manual；未知/malformed -> invalid（绝不默认 ok） ----
function evalPrecondition(prec, study) {
  if (!prec || typeof prec !== "object") return { status: "invalid", reason: "scientific_precondition_malformed" };
  if (prec.kind === "machine") {
    if (!prec.field || prec.required_value === undefined) return { status: "invalid", reason: "scientific_precondition_malformed" };
    const val = study.preconditions?.[prec.field];
    if (val === undefined || val === null || val === "") return { status: prec.on_missing || "needs_decision", reason: "scientific_precondition_missing" };
    if (String(val) !== String(prec.required_value)) return { status: prec.on_mismatch || "blocked", reason: "scientific_precondition_mismatch" };
    return { status: "ok" };
  }
  if (prec.kind === "manual") {
    const confirmed = study.manual_validations?.[prec.label];
    return confirmed === true ? { status: "ok" } : { status: "needs_decision", reason: "manual_scientific_validation_required" };
  }
  return { status: "invalid", reason: "scientific_precondition_malformed" };
}

// ---- 风险准入 ----
function isPermissible(cap, impl, ctx) {
  const s = impl.verification_status;
  const risk = cap.risk_level;
  if (risk === "high") {
    if (ctx.mode === "production") return s === "verified";
    return s === "verified" || (s === "tested" && ctx.allow_experimental === true);
  }
  if (risk === "medium") {
    if (ctx.mode === "production") return s === "verified" || s === "tested";
    return ["verified", "tested"].includes(s) || (["experimental", "reference"].includes(s) && ctx.allow_experimental === true);
  }
  return true;
}

// ---- run-level 显式批准（仅 capability+implementation，可解析；HIGH production 永远不绕过 verified_only；deprecated 不可批准） ----
function isApproved(cap, impl, ctx) {
  return (ctx.approved_overrides || []).some((o) => o && o.capability === cap.id && o.implementation === impl.id && o.approved === true);
}

// ---- implementation 选择：非按“最高 status”简单取 ----
function pickBest(impls, ctx) {
  return [...impls].sort((a, b) => {
    const dr = STATUS_RANK[b.verification_status] - STATUS_RANK[a.verification_status];
    if (dr !== 0) return dr;
    const pa = ctx.preferred_runtimes.indexOf(a.runtime);
    const pb = ctx.preferred_runtimes.indexOf(b.runtime);
    const ra = pa === -1 ? 99 : pa, rb = pb === -1 ? 99 : pb;
    if (ra !== rb) return ra - rb;
    return (a.rank ?? 0) - (b.rank ?? 0);
  })[0];
}

// ---- 派生 maturity（不独立人工维护） ----
function deriveMaturity(cap) {
  const nonDep = (cap.implementations || []).filter((i) => i.verification_status !== "deprecated");
  if (nonDep.length === 0) return "deprecated";
  let best = "reference";
  for (const i of nonDep) {
    const r = STATUS_RANK[i.verification_status];
    if (r > STATUS_RANK[best]) {
      if ((i.verification_status === "tested" || i.verification_status === "verified") && !i.verification?.evidence) continue;
      best = i.verification_status;
    }
  }
  return best;
}

// ---- 是否存在 verified 实现但版本不满足（用于区分 diagnostic） ----
function hasVerifiedVersionIssue(cap, env) {
  for (const i of (cap.implementations || [])) {
    if (i.verification_status !== "verified") continue;
    const reqs = i.environment_requirements || {};
    if (i.runtime === "any") continue;
    for (const inst of resolveInstances(env).filter((x) => x.runtime === i.runtime && x.available === true)) {
      if (reqs.version_constraints && !satisfies(inst.version, reqs.version_constraints)) return true;
      if (reqs.packages) for (const [pkg, ver] of Object.entries(reqs.packages)) {
        const p = inst.packages?.[pkg];
        if (p && p.available === true && ver && !satisfies(p.version, ver)) return true;
      }
    }
  }
  return false;
}

// ---- 单个能力解析 ----
function resolveOne(capId, cap, study, env, ctx) {
  for (const prec of cap.scientific_preconditions || []) {
    const r = evalPrecondition(prec, study);
    if (r.status === "invalid") return { resolution: "blocked", reason: "scientific_precondition_malformed", capability: capId, maturity: deriveMaturity(cap) };
    if (r.status === "blocked") return { resolution: "blocked", reason: "scientific_precondition_mismatch", field: prec.field, capability: capId, maturity: deriveMaturity(cap) };
    if (r.status === "needs_decision") return { resolution: "needs_decision", reason: "manual_scientific_validation_required", field: prec.label, capability: capId, maturity: deriveMaturity(cap) };
  }
  const missingDecisions = (cap.decision_requirements || []).filter((d) => { const v = study.decisions?.[d]; return v === undefined || v === null || v === ""; });
  if (missingDecisions.length > 0) return { resolution: "needs_decision", reason: "decision_missing", items: missingDecisions, capability: capId, maturity: deriveMaturity(cap) };

  const allNonDep = (cap.implementations || []).filter((i) => i.verification_status !== "deprecated");
  const hasVerifiedRegistry = allNonDep.some((i) => i.verification_status === "verified");
  const envOK = allNonDep.filter((i) => envFulfilled(i, env));
  const verifiedEnvOK = envOK.filter((i) => i.verification_status === "verified");
  const verifiedUnavailable = hasVerifiedRegistry && verifiedEnvOK.length === 0;
  const risk = cap.risk_level;

  if (risk === "low") {
    if (envOK.length === 0) {
      if (cap.fallback_policy === "allow" || cap.fallback_policy === "recorded") {
        return { resolution: "resolved", fallback_recorded: true, selected_implementation: null, runtime: null, verification_status: "fallback", risk_level: risk, capability: capId, maturity: deriveMaturity(cap), reason: "low_risk_fallback_recorded" };
      }
      return { resolution: "blocked", reason: "low_risk_no_implementation_fallback_not_allowed", capability: capId, maturity: deriveMaturity(cap) };
    }
    const chosen = pickBest(envOK, ctx);
    const li = bestInstance(chosen, env); return { resolution: "resolved", selected_implementation: chosen, runtime: chosen.runtime, runtime_instance: li?.id || null, provider: li?.provider || null, verification_status: chosen.verification_status, risk_level: risk, capability: capId, maturity: deriveMaturity(cap), reason: "low_risk_available" };
  }

  // 可选实现 = envOK 中（风险准入通过 或 对非 high 已显式批准）
  const selectable = envOK.filter((i) => isPermissible(cap, i, ctx) || (isApproved(cap, i, ctx) && risk !== "high"));
  if (selectable.length > 0) {
    const chosen = pickBest(selectable, ctx);
    const approved = !isPermissible(cap, chosen, ctx) && isApproved(cap, chosen, ctx);
    const explicitOverride = ctx.mode === "test" && ctx.allow_experimental === true && (chosen.verification_status === "tested" || (risk === "medium" && ["experimental", "reference"].includes(chosen.verification_status)));
    const li = bestInstance(chosen, env); return { resolution: "resolved", selected_implementation: chosen, runtime: chosen.runtime, runtime_instance: li?.id || null, provider: li?.provider || null, verification_status: chosen.verification_status, risk_level: risk, capability: capId, maturity: deriveMaturity(cap), override_recorded: explicitOverride || approved, approval_recorded: approved, reason: approved ? "medium_approval_recorded" : (explicitOverride ? "test_override_recorded" : "resolved") };
  }

  if (risk === "high" && ctx.mode === "production") {
    if (!hasVerifiedRegistry) return { resolution: "blocked", reason: "no_verified_implementation", capability: capId, maturity: deriveMaturity(cap) };
    if (hasVerifiedVersionIssue(cap, env)) return { resolution: "blocked", reason: "version_requirement_unsatisfied", capability: capId, maturity: deriveMaturity(cap) };
    return { resolution: "blocked", reason: "verified_implementation_unavailable", capability: capId, maturity: deriveMaturity(cap) };
  }
  if (risk === "medium" && ctx.mode === "production") {
    if (envOK.length > 0) return { resolution: "needs_decision", reason: "medium_approval_required", items: envOK.map((i) => i.id), capability: capId, maturity: deriveMaturity(cap) };
    return { resolution: "needs_decision", reason: "no_implementation_approval_required", capability: capId, maturity: deriveMaturity(cap) };
  }
  if (risk === "high" && ctx.mode === "test") {
    if (!ctx.allow_experimental) return { resolution: "blocked", reason: "high_risk_test_verified_required", capability: capId, maturity: deriveMaturity(cap) };
    return { resolution: "needs_decision", reason: "high_risk_test_no_admissible", capability: capId, maturity: deriveMaturity(cap) };
  }
  return { resolution: "needs_decision", reason: "no_admissible_implementation", capability: capId, maturity: deriveMaturity(cap) };
}

// ---- 汇总 ----
function resolveAll(study, registry, env, ctx) {
  const capResult = {};
  const roles = {};
  let overall = "ready";
  for (const [roleId, capIds] of Object.entries(study.selected_capabilities || {})) {
    let roleStatus = "ready";
    for (const capId of capIds) {
      const cap = registry[capId];
      if (!cap) { capResult[capId] = { resolution: "blocked", reason: "unknown_capability" }; if (roleStatus === "ready") roleStatus = "blocked"; continue; }
      const r = resolveOne(capId, cap, study, env, ctx);
      capResult[capId] = r;
      if (r.resolution === "blocked") roleStatus = "blocked";
      else if (r.resolution === "needs_decision" && roleStatus === "ready") roleStatus = "needs_decision";
    }
    roles[roleId] = { status: roleStatus, capabilities: capIds, blocked_capabilities: capIds.filter((c) => capResult[c]?.resolution === "blocked"), needed_decisions: capIds.filter((c) => capResult[c]?.resolution === "needs_decision") };
    if (roleStatus === "blocked") overall = "blocked";
    else if (roleStatus === "needs_decision" && overall !== "blocked") overall = "needs_decision";
  }
  return { study_id: study.study_id || null, domain: study.domain || null, overall, capabilities: capResult, roles };
}

// ---- CLI（仅在作为主模块运行时执行，避免被 import 误触发） ----
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const studyPath = arg("study");
  const registryPath = arg("registry");
  const envPath = arg("env");
  const domain = arg("domain") || null;
  const study = loadJson(studyPath, studyPath);
  const registry = loadRegistry(registryPath, domain ? `domains/${domain}/capabilities` : null);
  const env = envPath ? loadJson(envPath, envPath) : {};
  const ovPath = arg("env-overlay");
  if (ovPath) mergeOverlay(env, loadJson(ovPath, ovPath));
  const ctx = {
    mode: study.execution_context?.mode || "production",
    allow_experimental: !!study.execution_context?.allow_experimental,
    preferred_runtimes: study.execution_context?.preferred_runtimes || [],
    approved_overrides: study.execution_context?.approved_overrides || [],
  };
  const result = resolveAll(study, registry, env, ctx);
  console.log(JSON.stringify(result, null, 2));
}

// ---- 环境 overlay 合并（harness runtime / resources 由协调者提供，合并进 snapshot） ----
function mergeOverlay(env, overlay) {
  if (!overlay) return env;
  const out = { ...env };
  if (overlay.runtime_instances) out.runtime_instances = { ...(env.runtime_instances || {}), ...overlay.runtime_instances };
  if (overlay.runtimes) out.runtimes = { ...(env.runtimes || {}), ...overlay.runtimes };
  if (overlay.packages) out.packages = { ...(env.packages || {}), ...overlay.packages };
  if (overlay.resources) {
    const res = out.resources || {};
    if (overlay.resources.skills) res.skills = { ...(res.skills || {}), ...overlay.resources.skills };
    if (overlay.resources.workflows) res.workflows = { ...(res.workflows || {}), ...overlay.resources.workflows };
    out.resources = res;
  }
  return out;
}
export { resolveAll, resolveOne, deriveMaturity, envFulfilled, satisfies, STATUS_RANK, loadRegistry, evalPrecondition, isPermissible, isApproved, resolveInstances, findInstance, bestInstance, mergeOverlay };




