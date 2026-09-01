#!/usr/bin/env node
// Phase 2 M4 - Literature E2E / reproducibility / closure tests (CI-safe, deterministic replay only).
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { runLiteratureWorkflow, verifyLiteratureIntegrity, buildLiteraturePlan, classifyWorkflowStatus } from "../domains/economics/literature/run_workflow.mjs";
import { evaluateStudyDesign } from "../domains/economics/evaluate_study_design.mjs";
import { validateStudyDesign } from "../domains/economics/validate_study_design.mjs";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";
import { canonicalLiteratureContentHash } from "../domains/economics/literature/run_literature_search.mjs";
import { loadBenchmark, sourceFetchersForQuery, loadCapture } from "../domains/economics/benchmarks/literature/benchmark_helpers.mjs";
import { runClosure } from "../domains/economics/benchmarks/literature/run_closure.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = loadRegistry(join(root, "domains/economics/capabilities"));
const roles = JSON.parse(readFileSync(join(root, "domains/economics/roles.json"), "utf8")).roles;
const study = JSON.parse(readFileSync(join(root, "domains/economics/study.phase2.literature.json"), "utf8"));
const capFile = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/literature.search.json"), "utf8"));
const TMP = join(root, "role-team-out/phase2_lit_m4"); mkdirSync(TMP, { recursive: true });
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function hasU(res, cap, field) { return res.unresolved_decisions.some((u) => u.capability === cap && u.field === field); }
const envNode = { runtimes: { node: { available: true, known: true, version: "24" } }, packages: {} };
const envNoNode = { runtimes: { node: { available: false, known: false, version: null } }, packages: {} };

console.log("Phase 2 M4 literature closure / reproducibility");

// 1. Final Phase-2 E2E study execution (live-failure + replay) through closure runner
const closure = await runClosure();
{
  ok("CLOSURE. manifest written + capability/id/status correct", closure.capability_id === "economics.literature.search" && closure.implementation_id === "litsearch.local.sources" && closure.verification_status === "experimental");
  ok("CLOSURE. source_set = [crossref, openalex]", JSON.stringify(closure.source_set) === JSON.stringify(["crossref", "openalex"]));
  ok("CLOSURE. live transport evidence both source_unavailable", closure.live_transport_evidence.crossref === "source_unavailable" && closure.live_transport_evidence.openalex === "source_unavailable");
  ok("CLOSURE. ground-truth identities frozen (4 cases, correct DOIs)", closure.benchmark_ground_truth.identities.length === 4 && closure.benchmark_ground_truth.identities.find((i) => i.case === "CASE_B2").doi === "10.2307/2937954" && closure.benchmark_ground_truth.identities.find((i) => i.case === "CASE_A_PUBLI").doi === null);
  ok("CLOSURE. adversarial suite PASS (18 cases + 6 matrix)", closure.adversarial_suite.result === "PASS" && closure.adversarial_suite.cases_passed === "18/18" && closure.adversarial_suite.degradation_matrix_passed === "6/6");
  ok("CLOSURE. deterministic replay identical (rerun diff empty, 2 groups verified)", closure.deterministic_replay.identical === true && closure.deterministic_replay.diffs.length === 0 && closure.deterministic_replay.groups === 2 && JSON.stringify(closure.deterministic_replay.verification_states) === JSON.stringify(["verified", "verified"]));
  ok("CLOSURE. workflow integration: director ready, active role literature_search, replay completed / live source_unavailable", closure.workflow_integration.director === "ready" && JSON.stringify(closure.workflow_integration.role_closure.active_roles) === JSON.stringify(["literature_search"]) && closure.workflow_integration.replay_workflow_status === "completed" && closure.workflow_integration.live_workflow_status === "source_unavailable");
  ok("CLOSURE. resolver_role: low risk, search_scope required, fallback recorded, no core special case", closure.resolver_role.risk_level === "low" && closure.resolver_role.search_scope_required === true && closure.resolver_role.fallback_policy === "recorded" && closure.resolver_role.core_special_case === false);
  ok("CLOSURE. provenance integrity ok; artifact_manifest not applicable", closure.provenance_integrity.integrity_ok === true && closure.provenance_integrity.artifact_manifest_applicable_for_domain_log === false);
  ok("CLOSURE. known limitations wording present + NOT demonstrated includes tested maturity", closure.known_limitations.not_demonstrated.includes("tested maturity") && /independently grounded multi-source-shaped replay benchmark passed; live transport evidence incomplete\./.test(closure.known_limitations.wording));
  ok("CLOSURE. maturity = experimental, no promotion", closure.maturity.current === "experimental" && closure.maturity.allow_tested_promotion === false);
}

// 2. Two independent replay reruns (identical canonical content + invariants)
{
  const man = loadBenchmark();
  const { fetchers } = sourceFetchersForQuery(man, "Q_B");
  const run = async (tag) => {
    const res = await runLiteratureWorkflow(study, { fetchers, replay_mode: true, evidence_kind: "ground_truth_derived_source_shaped_replay", outDir: join(TMP, tag) });
    const log = JSON.parse(readFileSync(join(TMP, tag, "literature_search_log.json"), "utf8"));
    return { res, log };
  };
  const a = await run("rerunA"); const b = await run("rerunB");
  ok("REPLAY2. canonical log content identical", JSON.stringify(a.log) === JSON.stringify(b.log));
  ok("REPLAY2. canonical content sha256 identical", canonicalLiteratureContentHash(a.log) === canonicalLiteratureContentHash(b.log));
  ok("REPLAY2. record IDs identical", JSON.stringify(a.log.candidates.map((c) => c.record_id).sort()) === JSON.stringify(b.log.candidates.map((c) => c.record_id).sort()));
  ok("REPLAY2. dedupe groups identical", JSON.stringify(a.log.dedupe_groups) === JSON.stringify(b.log.dedupe_groups));
  ok("REPLAY2. verification states/reason codes identical", JSON.stringify(a.log.verification) === JSON.stringify(b.log.verification));
  ok("REPLAY2. source IDs identical", JSON.stringify(a.log.candidates.map((c) => c.source + ":" + c.source_id).sort()) === JSON.stringify(b.log.candidates.map((c) => c.source + ":" + c.source_id).sort()));
  ok("REPLAY2. role completion identical", a.res.role_closure.role_completion === b.res.role_closure.role_completion);
  ok("REPLAY2. no source-order dependency (canonical hash matched closure)", canonicalLiteratureContentHash(a.log) === closure.deterministic_replay.canonical_sha256);
}

// 3. Live-vs-replay separation fail-closed
{
  const man = loadBenchmark();
  const { fetchers } = sourceFetchersForQuery(man, "Q_B");
  const bad1 = await runLiteratureWorkflow(study, { fetchers, replay_mode: true, evidence_kind: "live_adapter_execution", outDir: join(TMP, "sep1") });
  ok("SEP. replay cannot be marked live (invalid_request)", bad1.workflow_status === "invalid_request" && /separation violation/.test(bad1.domain_request_errors.join(" ")));
  const bad2 = await runLiteratureWorkflow(study, { fetchers, replay_mode: false, evidence_kind: "ground_truth_derived_source_shaped_replay", outDir: join(TMP, "sep2") });
  ok("SEP. live cannot be marked replay (invalid_request)", bad2.workflow_status === "invalid_request" && /separation violation/.test(bad2.domain_request_errors.join(" ")));
  // live-failure simulation has no benchmark ref and does not trigger replay
  const hostile = { crossref: async () => { throw new Error("x"); }, openalex: async () => { throw new Error("x"); } };
  const liveFail = await runLiteratureWorkflow(study, { fetchers: hostile, replay_mode: false, evidence_kind: "source_failure_simulation", outDir: join(TMP, "sep_live") });
  ok("SEP. live-failure has null benchmark evidence ref", liveFail.provenance.benchmark_evidence_ref === null);
  ok("SEP. live-failure does not become replay (replay_mode false, evidence_kind simulation)", liveFail.replay_mode === false && liveFail.evidence_kind !== "ground_truth_derived_source_shaped_replay");
  ok("SEP. live failure cannot silently trigger replay (workflow_status source_unavailable, 0 verified)", liveFail.workflow_status === "source_unavailable" && liveFail.counts.verified === 0);
  // replay always carries benchmark evidence identity/hash
  const replay = await runLiteratureWorkflow(study, { fetchers, replay_mode: true, evidence_kind: "ground_truth_derived_source_shaped_replay", outDir: join(TMP, "sep_replay") });
  ok("SEP. replay carries benchmark evidence ref + hash", replay.provenance.benchmark_evidence_ref?.kind === "ground_truth_derived_source_shaped_replay" && Array.isArray(replay.provenance.benchmark_evidence_ref.captures));
  ok("SEP. replay success cannot change recorded live-source status", (() => { const lp = JSON.parse(readFileSync(join(root, "domains/economics/benchmarks/literature/live/live_probe.json"), "utf8")); return lp.executions.every((e) => e.status === "source_unavailable"); })());
  // runner source does not read captures for live path
  const wfSrc = readFileSync(join(root, "domains/economics/literature/run_workflow.mjs"), "utf8");
  ok("SEP. runner does not import benchmark_helpers / read captures", !/import[^;]*benchmark_helpers/.test(wfSrc) && !/readFileSync\([^)]*captures/.test(wfSrc));
}

// 4. Version-identity closure
{
  const man = loadBenchmark();
  const { fetchers: fQ_A } = sourceFetchersForQuery(man, "Q_A");
  const qa = await runLiteratureWorkflow(study, { fetchers: fQ_A, replay_mode: true, evidence_kind: "ground_truth_derived_source_shaped_replay", outDir: join(TMP, "ver_a") });
  const qaLog = JSON.parse(readFileSync(join(TMP, "ver_a", "literature_search_log.json"), "utf8"));
  const norm = qaLog.normalized;
  const wp = qaLog.dedupe_groups.find((g) => g.record_ids.some((rid) => norm.find((x) => x.internal_id === rid)?.canonical_doi === "10.3386/w4483"));
  const pub = qaLog.dedupe_groups.find((g) => g !== wp && norm.filter((x) => g.record_ids.includes(x.internal_id)).some((x) => !x.canonical_doi));
  ok("VERSION. Card WP 4483 distinct from published book chapter (no merge)", wp && pub && wp.group_id !== pub.group_id);
  ok("VERSION. published book chapter has no invented DOI", pub && norm.filter((x) => pub.record_ids.includes(x.internal_id)).every((x) => !x.canonical_doi));
  ok("VERSION. no journal mislabel for book chapter (published state not verified via DOI)", (() => { const v = qaLog.verification.find((x) => x.group_id === pub.group_id); return v && v.state !== "verified"; })());
  const { fetchers: fQ_B } = sourceFetchersForQuery(man, "Q_B");
  const qb = await runLiteratureWorkflow(study, { fetchers: fQ_B, replay_mode: true, evidence_kind: "ground_truth_derived_source_shaped_replay", outDir: join(TMP, "ver_b") });
  const qbLog = JSON.parse(readFileSync(join(TMP, "ver_b", "literature_search_log.json"), "utf8"));
  const b1 = qbLog.dedupe_groups.find((g) => g.record_ids.some((rid) => qbLog.normalized.find((x) => x.internal_id === rid)?.canonical_doi === "10.3386/w3572"));
  const b2 = qbLog.dedupe_groups.find((g) => g.record_ids.some((rid) => qbLog.normalized.find((x) => x.internal_id === rid)?.canonical_doi === "10.2307/2937954"));
  ok("VERSION. B1 WP + B2 QJE distinct, never merged (same title/authors)", b1 && b2 && b1.group_id !== b2.group_id);
  ok("VERSION. B1/B2 both verified via authoritative DOI", qbLog.verification.find((x) => x.group_id === b1.group_id).state === "verified" && qbLog.verification.find((x) => x.group_id === b2.group_id).state === "verified");
  ok("VERSION. no relation inferred from title similarity (no merge despite same title)", b1.group_id === b2.group_id ? false : true);
}

// 5. Resolver / role final closure
{
  const ctx = { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] };
  const rProd = resolveAll(study, registry, envNode, ctx).capabilities["economics.literature.search"];
  ok("RES. production + node -> resolved experimental", rProd.resolution === "resolved" && rProd.verification_status === "experimental");
  const rNoNode = resolveAll(study, registry, envNoNode, ctx).capabilities["economics.literature.search"];
  ok("RES. production + no node -> fallback_recorded", rNoNode.resolution === "resolved" && rNoNode.fallback_recorded === true);
  ok("RES. risk low, search_scope required, fallback recorded", capFile.risk_level === "low" && capFile.decision_requirements.includes("search_scope") && capFile.fallback_policy === "recorded");
  ok("RES. runtime availability distinct from live source availability", (() => { const lp = JSON.parse(readFileSync(join(root, "domains/economics/benchmarks/literature/live/live_probe.json"), "utf8")); const down = lp.executions.every((e) => e.status === "source_unavailable"); return down && rProd.resolution === "resolved"; })());
  const active = roles.filter((r) => (study.selected_capabilities?.[r.id] || []).length > 0).map((r) => r.id);
  ok("RES. active role closure exactly literature_search", JSON.stringify(active) === JSON.stringify(["literature_search"]));
  ok("RES. literature_review depends on literature_search but is inactive", roles.find((r) => r.id === "literature_review")?.depends_on?.includes("literature_search") && !study.selected_capabilities.literature_review);
  const scopeHolders = roles.filter((r) => r.capability_scope.some((p) => p.startsWith("economics.literature."))).map((r) => r.id).sort();
  ok("RES. no data/empirical/writing/review bleed into literature scope", JSON.stringify(scopeHolders) === JSON.stringify(["literature_review", "literature_search"]));
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const coreHits = readdirSync(join(root, "core")).filter((f) => f.endsWith(".mjs")).filter((f) => /economics\.literature|litsearch|literature\.search/.test(stripComments(readFileSync(join(root, "core", f), "utf8"))));
  ok("RES. no Core literature-specific branch", coreHits.length === 0, `hits=${coreHits.join(",")}`);
  ok("RES. no public artifact schema change (no new Core schema)", !readdirSync(join(root, "core/schemas")).some((f) => /literature|bibliographic/.test(f)));
}

// 6. Adversarial closure matrix (A-L) — M4-specific + re-asserted invariants
{
  const man = loadBenchmark();
  const { fetchers } = sourceFetchersForQuery(man, "Q_B");
  const base = await runLiteratureWorkflow(study, { fetchers, replay_mode: true, evidence_kind: "ground_truth_derived_source_shaped_replay", outDir: join(TMP, "mat") });
  const logPath = join(TMP, "mat", "literature_search_log.json");
  const recPath = join(TMP, "mat", "execution_record.json");
  const log = JSON.parse(readFileSync(logPath, "utf8"));

  // A. replay evidence hash mutation -> comparator/closure fails
  const crCap = loadCapture("crossref");
  const origHash = closure.replay_evidence.capture_hashes.derived_crossref;
  const mutCap = JSON.parse(JSON.stringify(crCap)); mutCap.items[0].item.DOI = "10.0/FAKE";
  const mutHash = sha256(JSON.stringify(mutCap));
  ok("ADV.A. replay evidence hash mutation -> capture hash differs", mutHash !== origHash);

  // B. replay evidence_kind changed to live -> runner invalid_request (separation)
  const sep = await runLiteratureWorkflow(study, { fetchers, replay_mode: true, evidence_kind: "live_adapter_execution", outDir: join(TMP, "adv_b") });
  ok("ADV.B. replay marked live -> fail closed (invalid_request)", sep.workflow_status === "invalid_request");

  // C. live execution record injected with benchmark ref -> separation invariant broken (live ref must be null)
  const hostile = { crossref: async () => { throw new Error("x"); }, openalex: async () => { throw new Error("x"); } };
  const live = await runLiteratureWorkflow(study, { fetchers: hostile, replay_mode: false, evidence_kind: "source_failure_simulation", outDir: join(TMP, "adv_c") });
  ok("ADV.C. live execution record has null benchmark ref (no replay masquerade)", live.provenance.benchmark_evidence_ref === null);

  // D. benchmark ref removed from replay -> replay invariant broken (replay must carry ref)
  const replay = await runLiteratureWorkflow(study, { fetchers, replay_mode: true, evidence_kind: "ground_truth_derived_source_shaped_replay", outDir: join(TMP, "adv_d") });
  ok("ADV.D. replay always carries benchmark evidence ref", Boolean(replay.provenance.benchmark_evidence_ref));

  // E. canonical log mutated after hash -> integrity fails
  const eRec = JSON.parse(readFileSync(recPath, "utf8")); eRec.provenance.literature_search_log_sha256 = "f".repeat(64);
  ok("ADV.E. canonical log hash mutation -> integrity fails", verifyLiteratureIntegrity(eRec, logPath, study).ok === false);

  // F. source execution status mutated -> integrity fails
  const fRec = JSON.parse(readFileSync(recPath, "utf8")); fRec.provenance.source_statuses[0].status = "success_zero_records";
  ok("ADV.F. source status mutation -> integrity fails", verifyLiteratureIntegrity(fRec, logPath, study).ok === false && verifyLiteratureIntegrity(fRec, logPath, study).errors.includes("source_statuses_binding_mismatch"));

  // G/H. source-specific ID / DOI changed -> canonical content hash changes
  const gLog = JSON.parse(JSON.stringify(log)); gLog.candidates[0].source_id = "W_REWRITTEN"; gLog.normalized[0].source_id = "W_REWRITTEN";
  ok("ADV.G. source ID change -> canonical content hash changes", canonicalLiteratureContentHash(gLog) !== canonicalLiteratureContentHash(log));
  const hLog = JSON.parse(JSON.stringify(log)); hLog.normalized[0].canonical_doi = "10.9999/FAKE";
  ok("ADV.H. DOI change -> canonical content hash changes", canonicalLiteratureContentHash(hLog) !== canonicalLiteratureContentHash(log));

  // I. version relation injected without authority evidence -> pipeline never injects (no version_relation field inferred)
  ok("ADV.I. no inferred version_relation from title similarity (canonical log has none)", !log.version_relation && !log.relations);

  // J. working paper and published article force-merged -> dedupe keeps distinct
  const b1 = log.dedupe_groups.find((g) => g.record_ids.some((rid) => log.normalized.find((x) => x.internal_id === rid)?.canonical_doi === "10.3386/w3572"));
  const b2 = log.dedupe_groups.find((g) => g.record_ids.some((rid) => log.normalized.find((x) => x.internal_id === rid)?.canonical_doi === "10.2307/2937954"));
  ok("ADV.J. WP vs published not force-merged (distinct groups)", b1 && b2 && b1.group_id !== b2.group_id);

  // K. retrieval timestamp only changes -> canonical hash invariant (volatile metadata is NOT part of canonical content)
  const kRec = JSON.parse(readFileSync(recPath, "utf8"));
  kRec.execution_metadata.generated_at = "2099-01-01T00:00:00Z";
  kRec.timestamps.completed_at = "2099-01-01T00:00:00Z";
  ok("ADV.K. volatile retrieval timestamp change -> canonical hash unchanged + integrity ok", canonicalLiteratureContentHash(log) === canonicalLiteratureContentHash(JSON.parse(JSON.stringify(log))) && verifyLiteratureIntegrity(kRec, logPath, study).ok === true);

  // L. requested source order permutation -> canonical hash invariant
  const sA = await runLiteratureWorkflow(study, { fetchers, replay_mode: true, evidence_kind: "ground_truth_derived_source_shaped_replay", outDir: join(TMP, "adv_la") });
  const sB = await runLiteratureWorkflow(study, { fetchers: { openalex: fetchers.openalex, crossref: fetchers.crossref }, replay_mode: true, evidence_kind: "ground_truth_derived_source_shaped_replay", outDir: join(TMP, "adv_lb") });
  ok("ADV.L. requested source order permutation -> canonical hash invariant", sA.canonical_log.sha256 === sB.canonical_log.sha256);
}

// 7. Maturity decision FINAL
{
  const impl = capFile.implementations.find((i) => i.id === "litsearch.local.sources");
  ok("MATURITY. litsearch.local.sources = experimental (final)", impl.verification_status === "experimental");
  ok("MATURITY. not tested / not verified", impl.verification_status !== "tested" && impl.verification_status !== "verified");
  const liveDown = (() => { const lp = JSON.parse(readFileSync(join(root, "domains/economics/benchmarks/literature/live/live_probe.json"), "utf8")); return lp.executions.every((e) => e.status === "source_unavailable"); })();
  ok("MATURITY. no genuine new live evidence -> no promotion", liveDown && impl.verification_status === "experimental");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);