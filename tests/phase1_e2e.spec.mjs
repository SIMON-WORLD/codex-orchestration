#!/usr/bin/env node
// Phase 1 M1 - Executable Study / Preflight / Dispatch integration tests (strict v1.3 E2E dogfood).
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";
import { evaluateStudyDesign } from "../domains/economics/evaluate_study_design.mjs";
import { buildPhase1Plan } from "../domains/economics/phase1/build_execution_plan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = loadRegistry(join(root, "domains/economics/capabilities"));
const study = JSON.parse(readFileSync(join(root, "domains/economics/study.phase1.grunfeld.json"), "utf8"));
const studyPath = join(root, "domains/economics/study.phase1.grunfeld.json");
const rolesPath = join(root, "domains/economics/roles.json");
const envPath = join(root, "domains/economics/phase1/env.json");
const regDir = join(root, "domains/economics/capabilities");
const TMP = join(root, "role-team-out/phase1_tests"); mkdirSync(TMP, { recursive: true });

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function hasU(res, cap, field) { return res.unresolved_decisions.some((u) => u.capability === cap && u.field === field); }
function writeStudy(st, name) { const p = join(TMP, name); writeFileSync(p, JSON.stringify(st, null, 2) + "\n", "utf8"); return p; }
function runResolver(st) {
  const p = writeStudy(st, st.study_id + ".json");
  const ctx = { mode: st.execution_context.mode, allow_experimental: !!st.execution_context.allow_experimental, preferred_runtimes: st.execution_context.preferred_runtimes || [], approved_overrides: st.execution_context.approved_overrides || [] };
  const env = JSON.parse(readFileSync(envPath, "utf8"));
  return resolveAll(st, registry, env, ctx);
}

console.log("Phase 1 M1 E2E integration regression");

// A. dedicated study -> Director ready
ok("A. dedicated Phase-1 Grunfeld study -> Director ready", evaluateStudyDesign(study, registry).status === "ready");

// B. missing required Data decision -> needs_decision (sample_exclusion is required by data.validation + panel_fe)
let sB = clone(study); delete sB.decisions.sample_exclusion; let rB = evaluateStudyDesign(sB, registry);
ok("B. missing sample_exclusion -> needs_decision (data.validation)", rB.status === "needs_decision" && hasU(rB, "economics.data.validation", "sample_exclusion"), `status=${rB.status}`);

// C. missing required Panel-FE decision -> needs_decision
let sC = clone(study); delete sC.decisions.clustering_level; let rC = evaluateStudyDesign(sC, registry);
ok("C. missing clustering_level -> needs_decision (panel_fe)", rC.status === "needs_decision" && hasU(rC, "economics.regression.panel_fe", "clustering_level"), `status=${rC.status}`);
let sC2 = clone(study); delete sC2.decisions.fixed_effects; let rC2 = evaluateStudyDesign(sC2, registry);
ok("C2. missing fixed_effects -> needs_decision (panel_fe)", rC2.status === "needs_decision" && hasU(rC2, "economics.regression.panel_fe", "fixed_effects"));

// D. missing family_definition / correction method -> needs_decision (multcomp)
let sD = clone(study); delete sD.decisions.family_definition; let rD = evaluateStudyDesign(sD, registry);
ok("D. missing family_definition -> needs_decision (multcomp)", rD.status === "needs_decision" && hasU(rD, "economics.stat.testing.multcomp", "family_definition"));
let sD2 = clone(study); delete sD2.decisions.correction_method; let rD2 = evaluateStudyDesign(sD2, registry);
ok("D2. missing correction_method -> needs_decision (multcomp)", rD2.status === "needs_decision" && hasU(rD2, "economics.stat.testing.multcomp", "correction_method"));

// E. production guard blocks Panel FE
let sE = clone(study); sE.execution_context.mode = "production"; sE.execution_context.allow_experimental = false; sE.study_id = "phase1_prod";
const resE = runResolver(sE);
ok("E. production guard blocks panel_fe (no_verified_implementation), overall blocked", resE.overall === "blocked" && resE.capabilities["economics.regression.panel_fe"].resolution === "blocked" && resE.capabilities["economics.regression.panel_fe"].reason === "no_verified_implementation", `overall=${resE.overall} pf=${resE.capabilities["economics.regression.panel_fe"].resolution}/${resE.capabilities["economics.regression.panel_fe"].reason}`);

// F. controlled non-production (test) admission resolves the exact tested capabilities
const resF = runResolver(study);
const expImpl = {
  "economics.data.validation": "data.val.stata",
  "economics.regression.panel_fe": "panel.fe.stata.reghdfe",
  "economics.stat.testing.multcomp": "multcomp.r.base",
  "economics.presentation.tables.estimates": "presentation.local.table_renderer",
  "economics.presentation.tables.descriptive": "presentation.local.descriptive_table_renderer",
  "economics.presentation.tables.diagnostics": "presentation.local.diagnostics_table_renderer",
  "economics.presentation.tables.models": "presentation.local.model_table_renderer",
};
ok("F. controlled admission overall=ready and all 7 caps resolve to exact tested impls", resF.overall === "ready" && Object.entries(expImpl).every(([cap, impl]) => resF.capabilities[cap]?.resolution === "resolved" && resF.capabilities[cap]?.selected_implementation?.id === impl && resF.capabilities[cap]?.verification_status === "tested"), JSON.stringify(Object.fromEntries(Object.entries(expImpl).map(([c, i]) => [c, `${resF.capabilities[c]?.resolution}/${resF.capabilities[c]?.selected_implementation?.id}`]))));

// G. generic tables/figures remain isolated (no narrow renderer bleed, no resolved figure)
const genTabs = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/presentation.tables.json"), "utf8"));
const genFigs = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/presentation.figures.json"), "utf8"));
const concreteRenderers = ["presentation.local.table_renderer","presentation.local.descriptive_table_renderer","presentation.local.diagnostics_table_renderer","presentation.local.model_table_renderer"];
ok("G. generic tables/figures do not expose the concrete renderers (no bleed)", ![genTabs, genFigs].some((c) => (c.implementations || []).some((i) => concreteRenderers.includes(i.id))) && genFigs.implementations.every((i) => i.verification_status !== "tested") && (genTabs.implementations || []).every((i) => i.verification_status !== "verified"));

// H. active role closure is exactly Data -> Empirical
const plan = buildPhase1Plan(studyPath, rolesPath, envPath, regDir);
ok("H. active role closure exactly data -> empirical", JSON.stringify(plan.active_roles) === JSON.stringify(["data","empirical"]) && JSON.stringify(plan.stages) === JSON.stringify([{stage:1,roles:["data"]},{stage:2,roles:["empirical"]}]) && plan.dependency === "data -> empirical");

// I. Empirical dispatch before Data completion is rejected (dispatch_allowed=false when data not ready)
let sI = clone(study); delete sI.manual_validations.sample_flow_defined; sI.study_id = "phase1_broken_data";
const pI = writeStudy(sI, "sI.json");
const planI = buildPhase1Plan(pI, rolesPath, envPath, regDir);
ok("I. Empirical dispatch blocked until Data ready (data+empirical dispatch_allowed=false, data stage < empirical stage)", planI.roles.data.dispatch_allowed === false && planI.roles.empirical.dispatch_allowed === false && planI.roles.data.stage < planI.roles.empirical.stage, `data=${planI.roles.data.dispatch_allowed} empirical=${planI.roles.empirical.dispatch_allowed}`);

// J. plan generation is deterministic
const planJ = buildPhase1Plan(studyPath, rolesPath, envPath, regDir);
ok("J. plan generation deterministic (byte-identical across runs)", JSON.stringify(planJ) === JSON.stringify(plan));

// K. no Core resolver special-case for Phase 1
const coreSrc = readFileSync(join(root, "core/resolve_capabilities.mjs"), "utf8");
ok("K. no Phase-1 special-case in Core resolver", !/phase1|phase_1|phase1_grunfeld/i.test(coreSrc), "core/resolve_capabilities.mjs must stay generic");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
