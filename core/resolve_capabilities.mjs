#!/usr/bin/env node
// 通用 Capability Resolver / Preflight（领域无关）。
// Core 只理解通用概念：capability / implementation / runtime / environment / status / risk / policy /
// precondition / decision / resolved / needs_decision / blocked。不硬编码任何领域方法名或软件名。
// 输入: --study <study_design.json> （必填）
//       --registry <capabilities/index.json> （可选，默认 domains/<domain>/capabilities/index.json）
//       --env <env.json> （可选：执行环境快照，来自 scripts/probe_env.mjs 或手工；缺省保守 unknown）
//       --domain <name>　（可选：用于定位默认 registry 路径）
// 输出: 每个 selected capability 的 resolution + 每个 role 的 preflight 状态。
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const STATUS_RANK = { verified: 4, tested: 3, experimental: 2, reference: 1, deprecated: 0 };

function readJson(rel) { return JSON.parse(readFileSync(join(root, rel), "utf8")); }
function arg(name) { const i = process.argv.indexOf("--" + name); return i >= 0 ? process.argv[i + 1] : undefined; }
function hasFlag(name) { return process.argv.includes("--" + name); }
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
function loadJson(path, rel) {
  try { return JSON.parse(readFileSync(isAbsolute(path) ? path : join(root, rel), "utf8")); }
  catch (e) { throw new Error(`无法解析 JSON ${path}：${e.message}`); }
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
function satisfies(version, constraint) {
  if (constraint === undefined || constraint === null || constraint === "") return true;
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

// ---- 环境判定 ----
function envFulfilled(impl, env) {
  const reqs = impl.environment_requirements;
  if (!reqs) return true; // 无要求 → 视为可用（但 high-risk 仍要求 verified）
  if (reqs.runtime && reqs.runtime !== "any") {
    const rt = env?.runtimes?.[reqs.runtime];
    if (!rt || !rt.available) return false; // 未知/不可用都算不满足
    if (reqs.version_constraints && rt.version && !satisfies(rt.version, reqs.version_constraints)) return false;
  }
  if (reqs.packages) {
    for (const [pkg, ver] of Object.entries(reqs.packages)) {
      const p = env?.packages?.[pkg];
      if (!p || !p.available) return false;
      if (ver && p.version && !satisfies(p.version, ver)) return false;
    }
  }
  return true;
}

// ---- 科学前提：machine vs manual ----
function evalPrecondition(prec, study) {
  if (prec && prec.kind === "machine") {
    const val = study.preconditions?.[prec.field];
    if (val === undefined || val === null || val === "") return prec.on_missing || "needs_decision";
    const match = String(val) === String(prec.required_value);
    if (!match) return prec.on_mismatch || "blocked";
    return "ok";
  }
  // manual
  if (prec && prec.kind === "manual") {
    const confirmed = study.manual_validations?.[prec.label];
    return confirmed === true ? "ok" : "needs_decision";
  }
  return "ok"; // 无字段的字符串视为已声明（保守：需人工，但此处由调用方决定）；默认 ok
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
  return true; // low：任何状态（含 fallback），是否 fallback 另判
}

// ---- implementation 选择：非按“最高 status”简单取，按既定顺序 ----
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
      // tested/verified 必须有证据，否则不视为已达到
      if ((i.verification_status === "tested" || i.verification_status === "verified") && !i.verification?.evidence) continue;
      best = i.verification_status;
    }
  }
  return best;
}

// ---- 单个能力解析 ----
function resolveOne(capId, cap, study, env, ctx) {
  // 1) 科学前提
  for (const prec of cap.scientific_preconditions || []) {
    const r = evalPrecondition(prec, study);
    if (r === "blocked") return { resolution: "blocked", reason: `scientific_precondition_mismatch: ${prec.field || prec.label}`, capability: capId, maturity: deriveMaturity(cap) };
    if (r === "needs_decision") return { resolution: "needs_decision", reason: `manual_scientific_validation_required: ${prec.label || prec.field}`, capability: capId, maturity: deriveMaturity(cap) };
  }
  // 2) 决策要求
  const missingDecisions = (cap.decision_requirements || []).filter((d) => {
    const v = study.decisions?.[d];
    return v === undefined || v === null || v === "";
  });
  if (missingDecisions.length > 0) {
    return { resolution: "needs_decision", reason: "decision_requirements_missing", items: missingDecisions, capability: capId, maturity: deriveMaturity(cap) };
  }
  const nonDep = (cap.implementations || []).filter((i) => i.verification_status !== "deprecated");
  const envOK = nonDep.filter((i) => envFulfilled(i, env));
  const risk = cap.risk_level;

  // low risk：无实现可 fallback（按 fallback_policy）
  if (risk === "low") {
    if (envOK.length === 0) {
      if (cap.fallback_policy === "allow" || cap.fallback_policy === "recorded") {
        return { resolution: "resolved", fallback_recorded: true, selected_implementation: null, runtime: null, verification_status: "fallback", risk_level: risk, capability: capId, maturity: deriveMaturity(cap), reason: "no implementation; self-contained fallback" };
      }
      return { resolution: "blocked", reason: "no implementation and fallback not allowed", capability: capId, maturity: deriveMaturity(cap) };
    }
    const chosen = pickBest(envOK, ctx);
    return { resolution: "resolved", selected_implementation: chosen, runtime: chosen.runtime, verification_status: chosen.verification_status, risk_level: risk, capability: capId, maturity: deriveMaturity(cap), reason: "low-risk; best available" };
  }

  const permissible = envOK.filter((i) => isPermissible(cap, i, ctx));
  if (permissible.length === 0) {
    // 判定原因
    if (risk === "high" && ctx.mode === "production") {
      const anyVerifiedEnvOK = envOK.some((i) => i.verification_status === "verified");
      if (anyVerifiedEnvOK) {
        return { resolution: "blocked", reason: "verified implementation exists but environment/requirements unmet", capability: capId, maturity: deriveMaturity(cap) };
      }
      return { resolution: "blocked", reason: "no verified implementation for high-risk production", capability: capId, maturity: deriveMaturity(cap) };
    }
    if (risk === "medium" && ctx.mode === "production") {
      return { resolution: "needs_decision", reason: envOK.length === 0 ? "no available implementation; needs approval" : "only experimental/reference available; needs approval", capability: capId, maturity: deriveMaturity(cap) };
    }
    if (risk === "high" && ctx.mode === "test") {
      if (!ctx.allow_experimental) return { resolution: "blocked", reason: "high-risk test requires verified, or tested with allow_experimental", capability: capId, maturity: deriveMaturity(cap) };
      return { resolution: "needs_decision", reason: "high-risk test with allow_experimental but no admissable impl", capability: capId, maturity: deriveMaturity(cap) };
    }
    return { resolution: "needs_decision", reason: "no admissable implementation", capability: capId, maturity: deriveMaturity(cap) };
  }
  const chosen = pickBest(permissible, ctx);
  const override = ctx.mode === "test" && (chosen.verification_status === "tested" || (risk === "medium" && ["experimental", "reference"].includes(chosen.verification_status))) && ctx.allow_experimental === true;
  return { resolution: "resolved", selected_implementation: chosen, runtime: chosen.runtime, verification_status: chosen.verification_status, risk_level: risk, capability: capId, maturity: deriveMaturity(cap), override_recorded: override, reason: "resolved" };
}

// ---- 汇总 ----
function resolveAll(study, registry, env, ctx) {
  const dom = study.domain || null;
  const capResult = {};
  const roles = {};
  let overall = "ready";
  for (const [roleId, capIds] of Object.entries(study.selected_capabilities || {})) {
    const perRole = [];
    let roleStatus = "ready";
    for (const capId of capIds) {
      const cap = registry[capId];
      if (!cap) { capResult[capId] = { resolution: "blocked", reason: `unknown capability ${capId}` }; perRole.push(capId); roleStatus = "blocked"; continue; }
      const r = resolveOne(capId, cap, study, env, ctx);
      capResult[capId] = r;
      perRole.push(capId);
      if (r.resolution === "blocked") { roleStatus = "blocked"; }
      else if (r.resolution === "needs_decision" && roleStatus === "ready") { roleStatus = "needs_decision"; }
    }
    const blockedCaps = capIds.filter((c) => capResult[c]?.resolution === "blocked");
    roles[roleId] = {
      status: roleStatus,
      capabilities: perRole,
      blocked_capabilities: blockedCaps,
      needed_decisions: capIds.filter((c) => capResult[c]?.resolution === "needs_decision"),
    };
    if (roleStatus === "blocked") overall = "blocked";
    else if (roleStatus === "needs_decision" && overall !== "blocked") overall = "needs_decision";
  }
  return { study_id: study.study_id || null, domain: dom, overall, capabilities: capResult, roles };
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
  const ctx = {
    mode: study.execution_context?.mode || "production",
    allow_experimental: study.execution_context?.allow_experimental || false,
    preferred_runtimes: study.execution_context?.preferred_runtimes || [],
  };
  const result = resolveAll(study, registry, env, ctx);
  console.log(JSON.stringify(result, null, 2));
}

// ---- 导出（供单元测试 / scaffold 集成使用） ----
export { resolveAll, resolveOne, deriveMaturity, envFulfilled, satisfies, STATUS_RANK, loadRegistry };



