#!/usr/bin/env node
// Literature v1 Phase-2 M3 - Domain-level workflow runner (Domain, NOT Core).
// Integrates economics.literature.search into the strict-v1.3 workflow:
//   study -> Director decision gate -> resolver/preflight -> literature_search role
//        -> actual litsearch.local.sources (M1 adapters) -> literature_search_log.json
//        -> deterministic provenance/integrity record -> execution record.
//
// It does NOT source execution records from M2 replay captures. M2 captures are benchmark/test
// evidence only. A deterministic replay execution is available ONLY through an explicit replays
// seam (opts.fetchers + replay_mode/evidence_kind) and is labeled as such.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveAll, loadRegistry } from "../../../core/resolve_capabilities.mjs";
import { evaluateStudyDesign } from "../evaluate_study_design.mjs";
import { validateStudyDesign } from "../validate_study_design.mjs";
import { runLiteratureSearch, canonicalLiteratureContentHash } from "./run_literature_search.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
function arg(name, def) { const i = process.argv.indexOf("--" + name); return i >= 0 ? process.argv[i + 1] : def; }
function resolvePath(p) { return isAbsolute(p) ? p : join(ROOT, p); }
const defaultRoles = () => join(ROOT, "domains/economics/roles.json");
const defaultRegistry = () => join(ROOT, "domains/economics/capabilities");
const defaultStudy = () => join(ROOT, "domains/economics/study.phase2.literature.json");

// ---- runtime probe: actual Node availability (runtime != live source-service availability) ----
export function probeNode() {
  const o = spawnSync("node", ["--version"], { encoding: "utf8" });
  if (o.status === 0) return { runtime: "node", available: true, known: true, version: (o.stdout || "").trim().replace(/^v/, "") };
  return { runtime: "node", available: false, known: true, version: null };
}
function envFrom(nodeInfo) { return { runtimes: { node: { available: nodeInfo.available, known: nodeInfo.known, version: nodeInfo.version } }, packages: {} }; }

// ---- validation of the Domain workflow search request (fail-closed if config missing) ----
export function validateDomainSearchRequest(study) {
  const req = study?.search_request;
  if (!req || typeof req !== "object") return ["search_request configuration required by the Literature workflow is missing"];
  const errs = [];
  if (!Array.isArray(req.query_strings) || req.query_strings.length === 0 || req.query_strings.some((q) => typeof q !== "string" || !q.trim())) errs.push("query_strings must be a non-empty array of non-empty strings");
  if (!Array.isArray(req.requested_sources) || req.requested_sources.length === 0) errs.push("requested_sources must be a non-empty array");
  if (req.max_results !== undefined && Number(req.max_results) <= 0) errs.push("max_results must be a positive integer");
  return errs;
}

// ---- topological stage ordering over an active role set (mirrors Phase-1 plan, no Core change) ----
function planStages(roleIds, byId) {
  const remaining = new Set(roleIds); const stages = []; let guard = 0;
  while (remaining.size > 0) {
    if (++guard > roleIds.length + 1) throw new Error("role dependency cycle");
    const ready = [...remaining].filter((id) => (byId.get(id).depends_on || []).every((d) => !remaining.has(d) || !roleIds.includes(d)));
    if (ready.length === 0) throw new Error("role dependency cycle (active)");
    stages.push(ready); for (const id of ready) remaining.delete(id);
  }
  return stages;
}

// ---- build deterministic execution plan (active role closure, preflight, director) ----
export function buildLiteraturePlan(study, roles, env, registry) {
  const byId = new Map((roles || []).map((r) => [r.id, r]));
  const pctx = { mode: study.execution_context?.mode || "production", allow_experimental: !!study.execution_context?.allow_experimental, preferred_runtimes: study.execution_context?.preferred_runtimes || [], approved_overrides: study.execution_context?.approved_overrides || [] };
  const preflight = resolveAll(study, registry, env, pctx);
  const director = evaluateStudyDesign(study, registry);
  const activeRoleIds = (roles || []).filter((r) => (study.selected_capabilities?.[r.id] || []).length > 0).map((r) => r.id);
  const stages = planStages(activeRoleIds, byId);
  const stageOf = new Map(); stages.forEach((ids, i) => ids.forEach((id) => stageOf.set(id, i + 1)));
  const rolePlan = {};
  for (const id of activeRoleIds) {
    const role = byId.get(id); const sel = study.selected_capabilities[id] || []; const roleRes = preflight.roles?.[id];
    const allDepsReady = (role.depends_on || []).every((d) => rolePlan[d]?.dispatch_allowed !== false);
    const capEvidence = {};
    for (const capId of sel) {
      const c = preflight.capabilities?.[capId];
      capEvidence[capId] = c ? { resolution: c.resolution, implementation: c.selected_implementation?.id || null, verification_status: c.verification_status || null, reason: c.reason || null, runtime: c.runtime || null } : { resolution: "missing" };
    }
    rolePlan[id] = { role: id, name: role.name, stage: stageOf.get(id), target: role.target || "projectless", selected_capabilities: sel, dispatch_allowed: roleRes?.status === "ready" && allDepsReady, resolution: roleRes?.status || "ready", depends_on: role.depends_on || [], outputs: role.outputs || [], capability_evidence: capEvidence };
  }
  return { plan_id: study.study_id, domain: "economics", mode: pctx.mode, active_roles: activeRoleIds, stages: stages.map((ids, i) => ({ stage: i + 1, roles: ids })), roles: rolePlan, director: { status: director.status, unresolved_decisions: director.unresolved_decisions }, preflight: { overall: preflight.overall, capabilities: Object.fromEntries(Object.entries(preflight.capabilities).map(([k, v]) => [k, { resolution: v.resolution, reason: v.reason || null, implementation: v.selected_implementation?.id || null, verification_status: v.verification_status || null }])) }, deterministic: true };
}

// ---- source-degradation semantics (completed / completed_degraded / source_unavailable / completed_zero_results) ----
export function classifyWorkflowStatus(statuses) {
  const hasSuccess = statuses.includes("success");
  const hasZero = statuses.includes("success_zero_records");
  const failed = ["source_unavailable", "malformed_response", "unsupported_source"];
  const anyFailed = statuses.some((s) => failed.includes(s));
  const allFailed = statuses.length > 0 && statuses.every((s) => failed.includes(s));
  if (allFailed) return "source_unavailable";
  if (hasSuccess && anyFailed) return "completed_degraded";
  if (hasSuccess && !anyFailed) return "completed";
  if (hasZero && !anyFailed && !hasSuccess) return "completed_zero_results";
  if (hasZero && anyFailed) return "completed_degraded";
  return "source_unavailable";
}

// ---- provenance / integrity integrity verification against a written execution record ----
export function verifyLiteratureIntegrity(record, logPath, study) {
  const errs = [];
  let logCanonical = null;
  try { logCanonical = JSON.parse(readFileSync(logPath, "utf8")); } catch (e) { return { ok: false, errors: ["cannot read canonical log: " + e.message] }; }
  // A. canonical log mutation -> hash mismatch
  const logHash = sha256(JSON.stringify(logCanonical));
  if (record?.provenance?.literature_search_log_sha256 !== logHash) errs.push("canonical_log_hash_mismatch");
  // B. request/search_scope binding
  const logReq = logCanonical?.request;
  const reqScope = study?.decisions?.search_scope;
  if (!logReq || logReq.search_scope !== reqScope) errs.push("search_scope_binding_mismatch");
  if (JSON.stringify([...(logReq?.query_strings || [])]) !== JSON.stringify([...(study?.search_request?.query_strings || [])])) errs.push("query_binding_mismatch");
  if (JSON.stringify([...(logReq?.requested_sources || [])].sort()) !== JSON.stringify([...(study?.search_request?.requested_sources || [])].sort())) errs.push("requested_sources_binding_mismatch");
  // C. implementation binding (recorded selection must match provenance binding)
  if (!record?.resolved?.implementation_id) errs.push("implementation_binding_missing");
  else if (record.provenance?.implementation_id !== record.resolved.implementation_id) errs.push("implementation_binding_mismatch");
  // D. source execution status binding (provenance must match the canonical log source statuses)
  const logSrcs = (logCanonical.source_executions || []).map((x) => x.source + ":" + x.status).sort().join("|");
  const provSrcs = (record.provenance?.source_statuses || []).map((x) => x.source + ":" + x.status).sort().join("|");
  if (logSrcs !== provSrcs) errs.push("source_statuses_binding_mismatch");
  return { ok: errs.length === 0, errors: errs, logHash };
}

// ---- main workflow runner ----
export async function runLiteratureWorkflow(study, opts = {}) {
  const outDir = opts.outDir || join(ROOT, "role-team-out/phase2_literature_run");
  mkdirSync(outDir, { recursive: true });

  const contractErrors = validateStudyDesign(study);
  const domainReqErrors = validateDomainSearchRequest(study);
  const roles = readJson(opts.rolesPath || defaultRoles()).roles;
  const registry = loadRegistry(opts.registryDir || defaultRegistry());
  const nodeInfo = opts.nodeInfo || probeNode();
  const env = envFrom(nodeInfo);

  // Director decision gate
  const directive = evaluateStudyDesign(study, registry);
  // Resolver / preflight
  const plan = buildLiteraturePlan(study, roles, env, registry);

  const selected = study.selected_capabilities?.literature_search || [];
  const implId = plan.preflight.capabilities["economics.literature.search"]?.implementation || null;
  const role = plan.roles.literature_search;

  const base = {
    study_id: study.study_id, run_mode: study.execution_context?.mode || "production",
    replay_mode: opts.replay_mode ?? !!opts.fetchers, evidence_kind: opts.evidence_kind || ((opts.replay_mode ?? !!opts.fetchers) ? "ground_truth_derived_source_shaped_replay" : "live_adapter_execution"),
    director: directive.status, contract_errors: contractErrors, domain_request_errors: domainReqErrors,
    selected_capabilities: { literature_search: selected },
    resolved: { capability_id: "economics.literature.search", implementation_id: implId, verification_status: plan.preflight.capabilities["economics.literature.search"]?.verification_status || null, reason: plan.preflight.capabilities["economics.literature.search"]?.reason || null },
    runtime_probe: { node_available: nodeInfo.available, node_version: nodeInfo.version },
    resolver: { overall: plan.preflight.overall },
    role_closure: { active_roles: plan.active_roles, literature_search_dispatch_allowed: role?.dispatch_allowed === true, literature_review_active: plan.active_roles.includes("literature_review") },
  };

  // fail-closed live/replay separation: replay cannot be marked live; live cannot be marked replay
  const effReplay = base.replay_mode;
  const kind = base.evidence_kind;
  if ((effReplay && kind === "live_adapter_execution") || (!effReplay && kind === "ground_truth_derived_source_shaped_replay")) {
    base.workflow_status = "invalid_request"; base.can_execute = false; base.domain_request_errors.push("live/replay evidence_kind mismatch (separation violation)");
    writeFileSync(join(outDir, "execution_record.json"), JSON.stringify(base, null, 2) + "\n", "utf8");
    return base;
  }

  // fail closed: contract OR domain request invalid -> no execution
  if (contractErrors.length > 0 || domainReqErrors.length > 0) {
    base.workflow_status = "invalid_request"; base.can_execute = false; base.canonical_log = null;
    base.provenance = { study_id: study.study_id, search_scope: study.decisions?.search_scope || null, query_ids: [study.search_request?.query_id || null], requested_sources: study.search_request?.requested_sources || [], implementation_id: implId, literature_search_log_sha256: null, normalize_dedupe_verify_implementation: "literature.v1", benchmark_evidence_ref: null, artifact_manifest_applicable_for_domain_log: false, note: "artifact_manifest_not_applicable_for_domain_log: literature_search_log is a Domain bibliographic log, not a Core scientific artifact type", integrity: contractErrors.length ? "contract_invalid" : "request_invalid" };
    writeFileSync(join(outDir, "execution_record.json"), JSON.stringify(base, null, 2) + "\n", "utf8");
    return base;
  }

  if (directive.status !== "ready") {
    base.workflow_status = "needs_decision"; base.can_execute = false; base.director_unresolved = directive.unresolved_decisions;
    writeFileSync(join(outDir, "execution_record.json"), JSON.stringify(base, null, 2) + "\n", "utf8");
    return base;
  }
  if (role?.dispatch_allowed !== true) {
    base.workflow_status = "blocked"; base.can_execute = false; base.block_reason = "role_dispatch_not_allowed";
    writeFileSync(join(outDir, "execution_record.json"), JSON.stringify(base, null, 2) + "\n", "utf8");
    return base;
  }

  const sr = study.search_request;
  const request = { search_scope: study.decisions.search_scope, query_strings: sr.query_strings, requested_sources: [...sr.requested_sources], max_results: Number(sr.max_results) || 20, request_id: "lit_" + sha256(study.study_id + "|" + (sr.query_id || "")).slice(0, 12) };

  const log = await runLiteratureSearch(request, opts.fetchers ? { fetchers: opts.fetchers } : {});
  const canonicalPath = join(outDir, "literature_search_log.json");
  writeFileSync(canonicalPath, JSON.stringify(log.canonical, null, 2) + "\n", "utf8");

  const logHash = canonicalLiteratureContentHash(log);
  const statuses = log.canonical.source_executions.map((s) => ({ source: s.source, status: s.status, error_category: s.error_category, request_identity: s.request_identity, result_count: s.result_count }));
  const verCounts = { candidates: log.canonical.candidates.length, groups: log.canonical.dedupe_groups.length, verified: log.canonical.verification.filter((v) => v.state === "verified").length, partially_verified: log.canonical.verification.filter((v) => v.state === "partially_verified").length, conflicting: log.canonical.verification.filter((v) => v.state === "conflicting").length, unresolved: log.canonical.verification.filter((v) => v.state === "unresolved").length };
  const workflow_status = classifyWorkflowStatus(statuses.map((s) => s.status));

  base.can_execute = true;
  base.workflow_status = workflow_status;
  base.search_request = { search_scope: study.decisions.search_scope, query_ids: [sr.query_id || null], query_strings: sr.query_strings, requested_sources: [...sr.requested_sources], max_results: Number(sr.max_results) || 20 };
  base.source_statuses = statuses;
  base.counts = verCounts;
  base.canonical_log = { path: "literature_search_log.json", sha256: logHash };
  base.role_closure.role_completion = role?.dispatch_allowed === true ? "literature_search completed" : "not dispatched";
  base.execution_metadata = { request_id: log.execution_metadata?.request_id || null, generated_at: log.execution_metadata?.generated_at || null };
  base.timestamps = { completed_at: new Date().toISOString() };
  base.provenance = {
    study_id: study.study_id, search_scope: study.decisions.search_scope, query_ids: [sr.query_id || null], requested_sources: [...sr.requested_sources],
    implementation_id: implId, source_statuses: statuses.map((s) => ({ source: s.source, status: s.status, error_category: s.error_category })),
    literature_search_log_sha256: logHash, normalize_dedupe_verify_implementation: "literature.v1",
    benchmark_evidence_ref: base.replay_mode ? { kind: base.evidence_kind, captures: ["domains/economics/benchmarks/literature/captures/derived_crossref.json", "domains/economics/benchmarks/literature/captures/derived_openalex.json"] } : null,
    artifact_manifest_applicable_for_domain_log: false,
    note: "artifact_manifest_not_applicable_for_domain_log: literature_search_log is a Domain bibliographic log, not a Core scientific artifact type",
    integrity: "verified",
  };
  const record = verifyLiteratureIntegrity(base, canonicalPath, study);
  base.integrity = { ok: record.ok, errors: record.errors };
  writeFileSync(join(outDir, "execution_record.json"), JSON.stringify(base, null, 2) + "\n", "utf8");
  return base;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const studyPath = arg("study", defaultStudy());
  const outDir = arg("out-dir", join(ROOT, "role-team-out/phase2_literature_run"));
  const study = readJson(resolvePath(studyPath));
  const result = await runLiteratureWorkflow(study, { outDir });
  console.log(JSON.stringify({ study_id: result.study_id, director: result.director, workflow_status: result.workflow_status, resolved_implementation: result.resolved.implementation_id, canonical_log: result.canonical_log, counts: result.counts, integrity: result.integrity, out_dir: outDir }, null, 2));
  if (result.workflow_status === "invalid_request") process.exit(1);
}
