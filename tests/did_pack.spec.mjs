#!/usr/bin/env node
// Economics Causal DiD Pack v1 — contract + safety regression.
// Proves: canonical (non-placeholder) references; honest maturity (no tested/verified DiD impl);
// no cross-capability implementation bleed; no silent fallback from staggered DiD to TWFE;
// high-risk production fail-closed; Director-level missing decision/precondition -> needs_decision;
// flat estimates artifact can encode ATT(g,t) rows and provenance mutation fails closed.
import { readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";
import { evaluateStudyDesign } from "../domains/economics/evaluate_study_design.mjs";
import { validateArtifacts } from "../core/validate_artifacts.mjs";
import { hashCanonicalJsonFile, CANONICAL_HASH_MODE } from "../core/artifact_hash.mjs";
import { buildReplicationStamp } from "../core/build_replication_stamp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = loadRegistry(join(root, "domains/economics/capabilities"));
const twfe = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/causal.did.twfe.json"), "utf8"));
const stag = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/causal.did.staggered.json"), "utf8"));
const example = JSON.parse(readFileSync(join(root, "domains/economics/study_design.example.json"), "utf8"));

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function hasUnresolved(res, cap, field) { return res.unresolved_decisions.some((u) => u.capability === cap && u.field === field); }

// A. canonical references: no placeholder "https://..."
const allRefs = [...twfe.methodology.references, ...stag.methodology.references];
ok("A. DiD references contain no placeholder https://... URLs", allRefs.every((r) => typeof r.url === "string" && r.url.includes("https://") && !/https:\/\/\.\.\./.test(r.url) && !/doi\.org\/null/.test(r.url)), JSON.stringify(allRefs.map((r) => r.url)));
ok("A2. TWFE narrow scope explicitly notes NOT robust for heterogeneous staggered", /heterogeneous/i.test(twfe.description) && /NOT a generally robust/i.test(twfe.description) && /silently to TWFE/i.test(twfe.description));
ok("A3. THFE scope manual guard present", twfe.scientific_preconditions.some((p) => p.kind === "manual" && p.label === "twfe_scope_homogeneous_or_reference"));
ok("A4. staggered v1 frozen to CS group-time ATT framework", /Callaway.*Sant.*Anna/i.test(stag.description) && /att_gt/i.test(stag.description) && /NOT a blanket claim/i.test(stag.description));

// B. maturity: none tested/verified
const allImpls = [...(twfe.implementations || []), ...(stag.implementations || [])];
ok("B. no DiD implementation is tested or verified", allImpls.every((i) => i.verification_status === "experimental" || i.verification_status === "reference"), JSON.stringify(allImpls.map((i) => [i.id, i.verification_status])));
ok("B2. staggered has no runnable-claim (csdid experimental, did reference)", stag.implementations.some((i) => i.id === "did.stag.python.csdid" && i.verification_status === "experimental") && stag.implementations.some((i) => i.id === "did.stag.r.did" && i.verification_status === "reference"));

// C. no cross-capability bleed
const twfeImplIds = (twfe.implementations || []).map((i) => i.id);
const stagImplIds = (stag.implementations || []).map((i) => i.id);
ok("C. no cross-capability implementation bleed", !twfeImplIds.some((id) => stagImplIds.includes(id)) && !stagImplIds.some((id) => twfeImplIds.includes(id)), `twfe=${twfeImplIds} stag=${stagImplIds}`);

// D. resolver: high-risk production fail-closed + no silent staggered->TWFE fallback
const prodStudy = clone(example);
const res = resolveAll(prodStudy, registry, { runtime_instances: { "r.os": { runtime: "r", available: true, known: true, version: "4.5.2" }, "python.os": { runtime: "python", available: true, known: true, version: "3.14.3" }, "stata.os": { runtime: "stata", available: true, known: true, version: "19.0" } } }, { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] });
const stg = res.capabilities["economics.causal.did.staggered"];
ok("D high-risk production staggered -> blocked (no_verified_implementation)", stg?.resolution === "blocked" && stg?.reason === "no_verified_implementation", `res=${stg?.resolution} reason=${stg?.reason}`);
ok("D2 selecting staggered never resolves/selects TWFE (no silent fallback)", !Object.keys(res.capabilities).includes("economics.causal.did.twfe") && stg?.selected_implementation == null, `caps=${Object.keys(res.capabilities)}`);
const stg2 = clone(example); stg2.selected_capabilities = { empirical: ["economics.causal.did.twfe"] }; stg2.manual_validations.twfe_scope_homogeneous_or_reference = true;
const res2 = resolveAll(stg2, registry, { runtime_instances: { "python.os": { runtime: "python", available: true, known: true, version: "3.14.3" }, "stata.os": { runtime: "stata", available: true, known: true, version: "19.0" } } }, { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] });
const tw = res2.capabilities["economics.causal.did.twfe"];
ok("D3 high-risk production twfe -> blocked (no_verified_implementation)", tw?.resolution === "blocked" && tw?.reason === "no_verified_implementation", `res=${tw?.resolution} reason=${tw?.reason}`);

// E. Director: missing anticipation / aggregation / comparison_group precondition -> needs_decision
const e1 = clone(example); delete e1.decisions.anticipation;
const e1r = evaluateStudyDesign(e1, registry);
ok("E missing anticipation -> needs_decision (staggered)", e1r.status === "needs_decision" && hasUnresolved(e1r, "economics.causal.did.staggered", "anticipation"), `status=${e1r.status}`);
const e2 = clone(example); delete e2.decisions.aggregation;
const e2r = evaluateStudyDesign(e2, registry);
ok("E2 missing aggregation -> needs_decision (staggered)", e2r.status === "needs_decision" && hasUnresolved(e2r, "economics.causal.did.staggered", "aggregation"), `status=${e2r.status}`);
const e3 = clone(example); delete e3.preconditions["design.comparison_group"];
const e3r = evaluateStudyDesign(e3, registry);
ok("E3 missing design.comparison_group precondition -> needs_decision (staggered)", e3r.status === "needs_decision" && hasUnresolved(e3r, "economics.causal.did.staggered", "design.comparison_group"), `status=${e3r.status}`);

// F. flat estimates artifact can encode ATT(g,t) rows; provenance mutation fails closed
const bundleDir = join(root, "role-team-out/did_bundle");
rmSync(bundleDir, { recursive: true, force: true }); mkdirSync(bundleDir, { recursive: true });
const write = (name, obj) => writeFileSync(join(bundleDir, name), JSON.stringify(obj, null, 2) + "\n", "utf8");
const createdAt = "2026-08-29T00:00:00Z";
write("data_manifest.json", { artifact_id: "DM_DID", artifact_type: "data_manifest", schema_version: "1.0", producer_role: "data", producer_task_id: "task_did", created_at: createdAt, dataset_id: "SYN_DID", data_path: "syn.csv", observation_count: 500, variable_count: 6, dataset_sha256: null });
write("variable_dictionary.json", { artifact_id: "VD_DID", artifact_type: "variable_dictionary", schema_version: "1.0", producer_role: "data", producer_task_id: "task_did", created_at: createdAt, variables: [ { name: "unit", definition: "cluster unit", type: "integer" }, { name: "time", definition: "calendar period", type: "integer" }, { name: "y", definition: "outcome", type: "float" }, { name: "g", definition: "first treatment time", type: "integer" } ] });
write("sample_flow.json", { artifact_id: "SF_DID", artifact_type: "sample_flow", schema_version: "1.0", producer_role: "data", producer_task_id: "task_did", created_at: createdAt, steps: [ { step_id: "S1", n_before: 500, n_after: 500, n_removed: 0, reason: "no drops" } ] });
write("descriptive_facts.json", { artifact_id: "DF_DID", artifact_type: "descriptive_facts", schema_version: "1.0", producer_role: "data", producer_task_id: "task_did", created_at: createdAt, facts: [ { fact_id: "F_NEVER_SHARE", name: "never_treated_share", value: 0.2, unit: "share", sample_id: "SYN_DID" } ] });
write("model_registry.json", { artifact_id: "MR_DID", artifact_type: "model_registry", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_did", created_at: createdAt, models: [ { model_id: "MODEL_DID", capability_id: "economics.causal.did.staggered", implementation_id: "did.stag.r.did", runtime: "r", sample_id: "SYN_DID", outcome: "y", treatment: ["g"], specification: "ATT(g,t) group-time (CS)", fixed_effects: [], vcov_spec: "cluster", clustering: "unit", n: 500, code_ref: "work/att_gt.R", data_ref: "syn.csv", result_ref: "EST_DID" } ] });
write("estimates.json", { artifact_id: "EST_DID", artifact_type: "estimates", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_did", created_at: createdAt, estimates: [ { estimate_id: "EST_ATT_2006_2007", model_id: "MODEL_DID", term: "ATT(2006,2007)", estimate: 2.5, std_error: 0.8, ci_lower: 0.9, ci_upper: 4.1, p_value: 0.01, n: 500 } ] });
write("diagnostics.json", { artifact_id: "DIAG_DID", artifact_type: "diagnostics", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_did", created_at: createdAt, diagnostics: [ { diagnostic_id: "DIAG_CG", model_id: "MODEL_DID", name: "comparison_group", value: "never_or_not_yet_treated", method: "design" }, { diagnostic_id: "DIAG_AGG", model_id: "MODEL_DID", name: "aggregation", value: "simple", method: "aggte" } ] });
const sourceHashes = { model_registry: hashCanonicalJsonFile(join(bundleDir, "model_registry.json")), estimates: hashCanonicalJsonFile(join(bundleDir, "estimates.json")), diagnostics: hashCanonicalJsonFile(join(bundleDir, "diagnostics.json")) };
const models = JSON.parse(readFileSync(join(bundleDir, "model_registry.json"), "utf8")).models;
const estimates = JSON.parse(readFileSync(join(bundleDir, "estimates.json"), "utf8")).estimates;
write("replication_stamp.json", buildReplicationStamp(models, estimates, sourceHashes));
write("artifact_manifest.json", { schema_version: "1.0", artifacts: ["data_manifest.json","variable_dictionary.json","sample_flow.json","descriptive_facts.json","model_registry.json","estimates.json","diagnostics.json","replication_stamp.json"].map((p) => ({ path: p, hash_mode: CANONICAL_HASH_MODE, sha256: hashCanonicalJsonFile(join(bundleDir, p)) })) });
const loadBundle = () => { const bundle = {}, paths = {}; for (const n of ["data_manifest","variable_dictionary","sample_flow","descriptive_facts","model_registry","estimates","diagnostics","replication_stamp","artifact_manifest"]) { const f = join(bundleDir, n + ".json"); bundle[n] = JSON.parse(readFileSync(f, "utf8")); paths[n] = f; } return { bundle, paths }; };
let { bundle: bOK, paths: pOK } = loadBundle();
ok("F DiD ATT artifact bundle validates (flat estimates encodes ATT(g,t), diagnostics encode comparison/aggregation)", validateArtifacts(bOK, pOK).length === 0, JSON.stringify(validateArtifacts(bOK, pOK)));
{ const e = JSON.parse(readFileSync(join(bundleDir, "estimates.json"), "utf8")); e.estimates[0].estimate = 9.99; writeFileSync(join(bundleDir, "estimates.json"), JSON.stringify(e, null, 2) + "\n", "utf8"); }
let { bundle: bMut, paths: pMut } = loadBundle();
ok("F2 provenance mutation (ATT value) fails closed", validateArtifacts(bMut, pMut).length > 0, `errs=${JSON.stringify(validateArtifacts(bMut, pMut))}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
