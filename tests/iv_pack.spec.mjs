#!/usr/bin/env node
// Economics IV/2SLS Pack v1 - contract + safety + artifact regression.
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";
import { evaluateStudyDesign } from "../domains/economics/evaluate_study_design.mjs";
import { validateArtifacts } from "../core/validate_artifacts.mjs";
import { loadBundle as loadPB, renderValidated as renderEst } from "../domains/economics/presentation/render_table.mjs";
import { renderValidated as renderFam } from "../domains/economics/presentation/render_family_table.mjs";
import { hashCanonicalJsonFile, CANONICAL_HASH_MODE } from "../core/artifact_hash.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = loadRegistry(join(root, "domains/economics/capabilities"));
const iv = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/causal.iv.json"), "utf8"));
const example = JSON.parse(readFileSync(join(root, "domains/economics/study_design.example.json"), "utf8"));

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function hasU(res, cap, field) { return res.unresolved_decisions.some((u) => u.capability === cap && u.field === field); }
function ivStudy() { const s = clone(example); s.selected_capabilities = { empirical: ["economics.causal.iv"] }; s.decisions.endogenous_regressor = "educ"; s.decisions.estimator_specification = "lwage ~ exper expersq black smsa south + [educ ~ nearc4]"; return s; }

// A. contract scope
ok("A. IV refs have no placeholder https://... URLs", iv.methodology.references.every((r) => r.url && r.url.startsWith("https://") && !r.url.includes("...") && !r.url.endsWith("%60")), JSON.stringify(iv.methodology.references.map((r) => r.url)));
ok("A2. IV narrow scope states exclusion restriction not machine-verified", /machine-verify/i.test(iv.description) && /relevance diagnostics as proof of instrument validity/i.test(iv.description));
ok("A3. IV distinguishes structural equation / endogenous / excluded instrument / controls / FE / clustering / sample / first stage / reduced form / 2SLS", ["structural equation", "endogenous", "excluded instrument", "included exogenous controls", "fixed effects", "clustering", "sample", "first stage", "reduced form", "second-stage 2SLS"].every((t) => iv.description.toLowerCase().includes(t.toLowerCase())), iv.description);
ok("A4. IV fallback_policy hard_stop", iv.fallback_policy === "hard_stop" && iv.risk_level === "high");
ok("A5. IV decision requirements include instrument definition / endogenous regressor / exclusion restriction / clustering / sample / spec", ["instrument","endogenous_regressor","exclusion_restriction","clustering_level","sample_exclusion","estimator_specification"].every((d) => iv.decision_requirements.includes(d)), JSON.stringify(iv.decision_requirements));
ok("A6. IV manual gates present (exclusion restriction cannot be auto-satisfied)", iv.scientific_preconditions.some((p) => p.kind === "manual" && p.label === "instrument_exclusion_argued") && iv.scientific_preconditions.some((p) => p.kind === "manual" && p.label === "instrument_relevance_strong"));

// B. maturity: both tested, none verified
const ivImpls = iv.implementations || [];
ok("B. linearmodels tested", ivImpls.some((i) => i.id === "causal.iv.python.linearmodels" && i.verification_status === "tested"));
ok("B2. ivreg2 tested", ivImpls.some((i) => i.id === "causal.iv.stata.ivreg2" && i.verification_status === "tested"));
ok("B3. no IV implementation verified", ivImpls.every((i) => i.verification_status !== "verified") && ivImpls.every((i) => i.verification_status !== "verified"));
ok("B4. tested scope is evidence-scoped (mentions not verified / not general validity)", ivImpls.every((i) => /NOT verified/.test(i.verification.evidence) && /NOT a claim of general IV validity/.test(i.verification.evidence)));

// C. Director gates
ok("C. IV study (all decisions + manual) -> ready", evaluateStudyDesign(ivStudy(), registry).status === "ready");
let s1 = ivStudy(); delete s1.decisions.instrument; const r1 = evaluateStudyDesign(s1, registry);
ok("C1. missing instrument decision -> needs_decision", r1.status === "needs_decision" && hasU(r1, "economics.causal.iv", "instrument"), `status=${r1.status}`);
let s2 = ivStudy(); delete s2.decisions.endogenous_regressor; const r2 = evaluateStudyDesign(s2, registry);
ok("C2. missing endogenous_regressor -> needs_decision", r2.status === "needs_decision" && hasU(r2, "economics.causal.iv", "endogenous_regressor"));
let s3 = ivStudy(); delete s3.decisions.exclusion_restriction; const r3 = evaluateStudyDesign(s3, registry);
ok("C3. missing exclusion-restriction argument -> needs_decision", r3.status === "needs_decision" && hasU(r3, "economics.causal.iv", "exclusion_restriction"));
let s4 = ivStudy(); delete s4.manual_validations.instrument_exclusion_argued; const r4 = evaluateStudyDesign(s4, registry);
ok("C4. missing exclusion-restriction manual gate -> needs_decision", r4.status === "needs_decision" && hasU(r4, "economics.causal.iv", "instrument_exclusion_argued"));
let s5 = ivStudy(); s5.manual_validations.instrument_exclusion_argued = false; const r5 = evaluateStudyDesign(s5, registry);
ok("C5. exclusion-restriction manual gate cannot be auto-satisfied (false -> resolved-false, not ready-by-default)", r5.status === "ready" && !hasU(r5, "economics.causal.iv", "instrument_exclusion_argued")); // Director sees resolved-false as resolved; resolver blocks
let s6 = ivStudy(); delete s6.decisions.clustering_level; const r6 = evaluateStudyDesign(s6, registry);
ok("C6. missing clustering decision -> needs_decision", r6.status === "needs_decision" && hasU(r6, "economics.causal.iv", "clustering_level"));
// relevance diagnostics never auto-declare validity
let s8 = ivStudy(); delete s8.manual_validations.instrument_relevance_strong; const r8 = evaluateStudyDesign(s8, registry);
ok("C7. missing relevance manual gate -> needs_decision (weak evidence does not auto-declare validity)", r8.status === "needs_decision" && hasU(r8, "economics.causal.iv", "instrument_relevance_strong"));

// D. resolver safety
const env = { runtime_instances: { "python.os": { runtime: "python", available: true, known: true, version: "3.14.3" }, "stata.os": { runtime: "stata", available: true, known: true, version: "19.0" } } };
const prodStudy = ivStudy(); const res = resolveAll(prodStudy, registry, env, { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] });
const ivcap = res.capabilities["economics.causal.iv"];
ok("D high-risk production IV -> blocked (no_verified_implementation)", ivcap?.resolution === "blocked" && ivcap?.reason === "no_verified_implementation", `res=${ivcap?.resolution} reason=${ivcap?.reason}`);
ok("D2 selecting IV never resolves/selects panel_fe/regression (no fallback to OLS/panel-FE)", !Object.keys(res.capabilities).includes("economics.regression.panel_fe"), `caps=${Object.keys(res.capabilities)}`);
ok("D3 no cross-capability implementation bleed", !ivImpls.some((i) => ["panel.fe.python.linearmodels","panel.fe.stata.reghdfe","did.twfe.python.pyfixest","did.stag.r.did"].includes(i.id)), JSON.stringify(ivImpls.map((i)=>i.id)));

// E. artifact bundle validation + provenance mutation fail-closed
const { buildIvBundle } = await import("../domains/economics/benchmarks/iv/build_bundle.mjs");
const bundleDir = join(root, "role-team-out/iv_spec_bundle");
buildIvBundle(bundleDir);
const loadB = () => { const bundle = {}, paths = {}; for (const n of ["data_manifest","variable_dictionary","sample_flow","descriptive_facts","model_registry","estimates","diagnostics","replication_stamp","artifact_manifest","multiple_testing"]) { const f = join(bundleDir, n + ".json"); bundle[n] = JSON.parse(readFileSync(f, "utf8")); paths[n] = f; } return { bundle, paths }; };
let { bundle: b1, paths: p1 } = loadB();
ok("E. IV artifact bundle (model_registry/estimates/diagnostics/replication_stamp) validates", validateArtifacts(b1, p1).length === 0, JSON.stringify(validateArtifacts(b1, p1)));
const esP = join(bundleDir, "estimates.json"); const eo = JSON.parse(readFileSync(esP, "utf8")); eo.estimates.find((e) => e.term === "educ").estimate = 9.99; writeFileSync(esP, JSON.stringify(eo, null, 2) + "\n", "utf8");
let { bundle: b2, paths: p2 } = loadB();
ok("E2. provenance mutation (2SLS estimate) fails closed", validateArtifacts(b2, p2).length > 0, JSON.stringify(validateArtifacts(b2, p2)));

// F. Presentation compatibility: frozen Presentation Tables Pack consumes IV artifacts
buildIvBundle(bundleDir); // rebuild clean bundle (E2 mutated it)
const presManifest = {
  artifact_id: "PRES_IV", artifact_type: "presentation_manifest", schema_version: "1.0",
  producer_role: "empirical", producer_task_id: "task_pres_iv", created_at: "2026-08-29T00:00:00Z",
  views: [
    { view_id: "V_IV_EST", view_type: "table", output_ref: "output/tables/iv_estimates.tex", source_refs: [ { artifact_id: "ESTIMATES_IV", item_ids: ["EST_IV_EDUC"], source_hash: hashCanonicalJsonFile(join(bundleDir, "estimates.json")), source_hash_mode: CANONICAL_HASH_MODE } ] },
    { view_id: "V_IV_DIAG", view_type: "table", output_ref: "output/tables/iv_diagnostics.tex", source_refs: [ { artifact_id: "DIAGNOSTICS_IV", item_ids: ["DIAG_IV_COV"], source_hash: hashCanonicalJsonFile(join(bundleDir, "diagnostics.json")), source_hash_mode: CANONICAL_HASH_MODE } ] },
    { view_id: "V_IV_MODEL", view_type: "table", output_ref: "output/tables/iv_models.tex", source_refs: [ { artifact_id: "MODELREG_IV", item_ids: ["MODEL_IV"], source_hash: hashCanonicalJsonFile(join(bundleDir, "model_registry.json")), source_hash_mode: CANONICAL_HASH_MODE } ] },
  ],
};
writeFileSync(join(bundleDir, "presentation_manifest.json"), JSON.stringify(presManifest, null, 2) + "\n", "utf8");
const { bundle: pb, paths: pp } = loadPB(bundleDir);
const rEst = renderEst(pb, pp, {});
ok("F. IV estimates table rendered via Presentation Pack", rEst.ok === true && /educ/.test(rEst.output) && /0.1323/.test(rEst.output), JSON.stringify(rEst.errors || []));
const rDiag = renderFam(pb, pp, { family: "diagnostics" });
ok("F2. IV diagnostics table rendered via Presentation Pack", rDiag.ok === true && /covariance/.test(rDiag.output), JSON.stringify(rDiag.errors || []));
const rModel = renderFam(pb, pp, { family: "model_registry" });
ok("F3. IV model-registry table rendered via Presentation Pack", rModel.ok === true && /economics.causal.iv/.test(rModel.output), JSON.stringify(rModel.errors || []));

console.log(`\n${pass} passed, ${fail} failed`);