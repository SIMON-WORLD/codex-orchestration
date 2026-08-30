#!/usr/bin/env node
// Domain-level Phase-1 E2E execution-plan generator.
// Consumes the real strict-v1.3 Core machinery: real study, real roles.json, real capability registry,
// real resolver/preflight, real Director decision-state. Produces a deterministic machine-readable plan
// whose ACTIVE role closure is exactly Data -> Empirical (Presentation consumed within Empirical scope).
// This lives under domains/economics (NOT Core) and does NOT modify Core role semantics.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveAll, loadRegistry } from "../../../core/resolve_capabilities.mjs";
import { evaluateStudyDesign } from "../evaluate_study_design.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function arg(name, def) { const i = process.argv.indexOf("--" + name); return i >= 0 ? process.argv[i + 1] : def; }
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

// topological stages on a role set using depends_on
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
function buildUpstream(role, byId) {
  return (role.depends_on || []).map((d) => { const up = byId.get(d); return { role: d, outputs: (up?.outputs || ["data_manifest"]).filter((o) => up?.outputs?.includes(o)) }; });
}

export function buildPhase1Plan(studyPath, rolesPath, envPath, registryDir) {
  const study = readJson(studyPath);
  const roles = readJson(rolesPath).roles;
  const registry = loadRegistry(registryDir);
  const env = readJson(envPath);
  const byId = new Map(roles.map((r) => [r.id, r]));

  const pctx = { mode: study.execution_context?.mode || "production", allow_experimental: !!study.execution_context?.allow_experimental, preferred_runtimes: study.execution_context?.preferred_runtimes || [], approved_overrides: study.execution_context?.approved_overrides || [] };
  const preflight = resolveAll(study, registry, env, pctx);
  const director = evaluateStudyDesign(study, registry);

  // active roles = roles with >=1 selected capability in the study
  const activeRoleIds = roles.filter((r) => (study.selected_capabilities?.[r.id] || []).length > 0).map((r) => r.id);
  const stages = planStages(activeRoleIds, byId);
  const stageOf = new Map(); stages.forEach((ids, i) => ids.forEach((id) => stageOf.set(id, i + 1)));

  const rolePlan = {};
  for (const id of activeRoleIds) {
    const role = byId.get(id);
    const sel = study.selected_capabilities[id] || [];
    const roleRes = preflight.roles?.[id];
    const depStatus = (role.depends_on || []).map((d) => ({ role: d, status: (preflight.roles?.[d]?.status || "ready"), dispatch_allowed: rolePlan[d]?.dispatch_allowed ?? true }));
    const allDepsReady = (role.depends_on || []).every((d) => rolePlan[d]?.dispatch_allowed !== false);
    const dispatch_allowed = roleRes?.status === "ready" && allDepsReady;
    const capEvidence = {};
    for (const capId of sel) {
      const c = preflight.capabilities?.[capId];
      capEvidence[capId] = c ? { resolution: c.resolution, implementation: c.selected_implementation?.id || null, verification_status: c.verification_status || null, reason: c.reason || null, runtime: c.runtime || null } : { resolution: "missing" };
    }
    rolePlan[id] = {
      role: id, name: role.name, stage: stageOf.get(id), target: role.target || "projectless",
      selected_capabilities: sel, dispatch_allowed, resolution: roleRes?.status || "ready",
      depends_on: role.depends_on || [], upstream: buildUpstream(role, byId),
      outputs: role.outputs || [], capability_evidence: capEvidence,
      director_decisions: Object.fromEntries(Object.entries(study.decisions || {}).filter(([k]) => /cluster|fix|famil|correction|sample|variable|control/.test(k))),
    };
  }

  const out = {
    plan_id: study.study_id, study: studyPath, domain: "economics", mode: pctx.mode,
    active_roles: activeRoleIds, dependency: activeRoleIds.includes("empirical") ? "data -> empirical" : "",
    stages: stages.map((ids, i) => ({ stage: i + 1, roles: ids })),
    roles: rolePlan,
    director: { status: director.status, unresolved_decisions: director.unresolved_decisions },
    preflight: { overall: preflight.overall, capabilities: Object.fromEntries(Object.entries(preflight.capabilities).map(([k, v]) => [k, { resolution: v.resolution, reason: v.reason || null, implementation: v.selected_implementation?.id || null, verification_status: v.verification_status || null }])) },
    deterministic: true,
  };
  return out;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const study = arg("study", "domains/economics/study.phase1.grunfeld.json");
  const roles = arg("roles", "domains/economics/roles.json");
  const env = arg("env", "domains/economics/phase1/env.json");
  const registry = arg("registry", "domains/economics/capabilities");
  const outPath = arg("out", "domains/economics/phase1/execution_plan.json");
  const plan = buildPhase1Plan(study, roles, env, registry);
  const abs = isAbsolute(outPath) ? outPath : join(root, outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(plan, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ plan_id: plan.plan_id, active_roles: plan.active_roles, stages: plan.stages, dependency: plan.dependency, director: plan.director.status, overall: plan.preflight.overall, written: outPath }, null, 2));
}
