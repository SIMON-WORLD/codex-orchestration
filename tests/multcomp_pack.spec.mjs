#!/usr/bin/env node
// Economics Multiple Testing Pack v1 - contract + Director + resolver + artifact + cross-engine regression.
import { readFileSync, mkdirSync, writeFileSync, rmSync, cpSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";
import { evaluateStudyDesign } from "../domains/economics/evaluate_study_design.mjs";
import { validateArtifacts } from "../core/validate_artifacts.mjs";
import { validateMultipleTesting } from "../core/multiple_testing_contract.mjs";
import { hashCanonicalJsonFile, hashTextFile, CANONICAL_HASH_MODE, CANONICAL_TEXT_HASH_MODE } from "../core/artifact_hash.mjs";
import { buildMultcompBundle } from "../domains/economics/benchmarks/multcomp/build_bundle.mjs";
import { approx, compareMultcomp } from "../domains/economics/benchmarks/multcomp/comparator.mjs";
import { buildReplicationStamp } from "../core/build_replication_stamp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = loadRegistry(join(root, "domains/economics/capabilities"));
const mt = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/stat.testing.multcomp.json"), "utf8"));
const example = JSON.parse(readFileSync(join(root, "domains/economics/study_design.example.json"), "utf8"));
const MULTCOMP = "economics.stat.testing.multcomp";
const MBASE = join(root, "domains/economics/benchmarks/multcomp");
const BUNDLE = join(root, "role-team-out/multcomp_pack_bundle");

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function readJson(p) { return JSON.parse(readFileSync(p, "utf8")); }
function hasU(res, cap, field) { return res.unresolved_decisions.some((u) => u.capability === cap && u.field === field); }
function mtStudy() { const s = clone(example); s.selected_capabilities = { review: [MULTCOMP] }; return s; }
function loadBundle(dir) {
  const bundle = {}, paths = {};
  for (const n of ["data_manifest","variable_dictionary","sample_flow","descriptive_facts","model_registry","estimates","diagnostics","multiple_testing","replication_stamp","artifact_manifest"]) {
    const f = join(dir, n + ".json"); bundle[n] = JSON.parse(readFileSync(f, "utf8")); paths[n] = f;
  }
  return { bundle, paths };
}

console.log("Multiple Testing Pack v1 regression");

// ---- A. Contract scope ----
ok("A. multcomp refs have no placeholder https://... URLs", (mt.methodology.references || []).every((r) => r.url && r.url.startsWith("https://") && !r.url.includes("...") && !r.url.endsWith("%60") && !/https:\/\/\.\.\./.test(r.url)), JSON.stringify((mt.methodology.references || []).map((r) => r.url)));
ok("A2. multcomp narrow scope: only Holm/BH, no generic coverage, no validity claim", /Holm/.test(mt.description) && /Benjamini-Hochberg/.test(mt.description) && /does NOT choose the family automatically/.test(mt.description) && /does NOT treat adjusted p-values as a substitute/.test(mt.description) && /does NOT silently mix/.test(mt.description) && /does NOT claim that multiplicity correction establishes scientific validity/.test(mt.description));
ok("A3. decision_requirements = family_definition + correction_method", ["family_definition","correction_method"].every((d) => mt.decision_requirements.includes(d)) && mt.decision_requirements.length === 2, JSON.stringify(mt.decision_requirements));
ok("A4. risk medium + fallback needs_decision", mt.risk_level === "medium" && mt.fallback_policy === "needs_decision");
ok("A5. both implementations tested, none verified; evidence scoped (NOT verified / NOT generic / NOT validity)", (() => {
  const impls = mt.implementations || [];
  return impls.some((i) => i.id === "multcomp.python.statsmodels" && i.verification_status === "tested") && impls.some((i) => i.id === "multcomp.r.base" && i.verification_status === "tested") && impls.every((i) => i.verification_status !== "verified") && impls.every((i) => /NOT verified/.test(i.verification.evidence) && /NOT a claim of generic multiple-testing coverage/.test(i.verification.evidence) && /NOT a claim that correction establishes validity/.test(i.verification.evidence));
})());

// ---- B. Director decision-state gates ----
ok("B. multcomp study (family_definition + correction_method) -> ready", evaluateStudyDesign(mtStudy(), registry).status === "ready");
let s1 = mtStudy(); delete s1.decisions.family_definition; let r1 = evaluateStudyDesign(s1, registry);
ok("B1. missing family_definition -> needs_decision", r1.status === "needs_decision" && hasU(r1, MULTCOMP, "family_definition"), `status=${r1.status}`);
let s2 = mtStudy(); delete s2.decisions.correction_method; let r2 = evaluateStudyDesign(s2, registry);
ok("B2. missing correction_method -> needs_decision", r2.status === "needs_decision" && hasU(r2, MULTCOMP, "correction_method"), `status=${r2.status}`);
let s3 = clone(example); s3.selected_capabilities = {}; const r3 = evaluateStudyDesign(s3, registry);
ok("B3. decisions for an unselected capability are NOT required", r3.status === "ready", `status=${r3.status}`);

// ---- C. Production resolver admission (medium-risk verification policy, no special-case) ----
const envOK = { runtimes: { python: { available: true, known: true, version: "3.14.3" }, r: { available: true, known: true, version: "4.5.2" } }, packages: { statsmodels: { available: true, known: true, version: "0.15.0" } } };
function runMt(opts = {}) {
  const study = {
    study_id: "mt_test", domain: "economics",
    execution_context: { mode: opts.mode || "production", allow_experimental: !!opts.allow_experimental, preferred_runtimes: opts.preferred_runtimes || [], approved_overrides: opts.approved_overrides || [] },
    selected_capabilities: { review: [MULTCOMP] },
    decisions: opts.decisions || { family_definition: "m1-m6a", correction_method: "holm" },
    preconditions: opts.preconditions || {}, manual_validations: opts.manual_validations || {},
  };
  const res = resolveAll(study, registry, opts.env || {}, { mode: study.execution_context.mode, allow_experimental: study.execution_context.allow_experimental, preferred_runtimes: study.execution_context.preferred_runtimes, approved_overrides: study.execution_context.approved_overrides });
  return res.capabilities[MULTCOMP];
}
let rc = runMt({ env: envOK });
ok("C1. medium/production + tested impl env-available -> resolved (tested is admissible under medium-risk policy; NOT blocked, NOT verified-only)", rc.resolution === "resolved" && rc.verification_status === "tested", `got=${rc.resolution}/${rc.verification_status}`);
let rc2 = runMt({ env: {} });
ok("C2. medium/production + no available impl + fallback needs_decision -> needs_decision/no_implementation_approval_required", rc2.resolution === "needs_decision" && rc2.reason === "no_implementation_approval_required", `got=${rc2.resolution}/${rc2.reason}`);
const coreSrc = readFileSync(join(root, "core/resolve_capabilities.mjs"), "utf8");
ok("C3. no special-case Multiple Testing logic in Core resolver", !/multcomp/i.test(coreSrc) && !/family_definition/.test(coreSrc) && !/holm/i.test(coreSrc), "core/resolve_capabilities.mjs should stay generic");

// ---- D. No cross-capability bleed ----
const implIds = (mt.implementations || []).map((i) => i.id);
ok("D. multcomp implementations are exactly the two declared", implIds.length === 2 && implIds.includes("multcomp.python.statsmodels") && implIds.includes("multcomp.r.base"), JSON.stringify(implIds));
let bleed = false;
for (const f of readdirSync(join(root, "domains/economics/capabilities"))) {
  if (!f.endsWith(".json") || f === "index.json") continue;
  const cap = readJson(join(root, "domains/economics/capabilities", f));
  if (cap.id === MULTCOMP) continue;
  for (const i of cap.implementations || []) if (implIds.includes(i.id)) bleed = true;
}
ok("D2. multcomp implementations do not leak into any other capability", !bleed);

// ---- E. Raw p-values never invented + family membership explicit ----
const info = buildMultcompBundle(BUNDLE);
let { bundle, paths } = loadBundle(BUNDLE);
const estArt = bundle.estimates.estimates;
const result = readJson(join(root, "domains/economics/benchmarks/panel_fe/results/stata.json"));
ok("E. artifact estimates derive raw p programmatically from frozen reghdfe (self-check)", estArt.every((e) => approx(e.p_value, info.estimates.find((x) => x.estimate_id === e.estimate_id).p_value, 1e-12, 1e-14)) && estArt.every((e) => e.p_value > 0 && e.p_value < 1));
const estMap = Object.fromEntries(estArt.map((e) => [e.estimate_id, e]));
ok("E2. multiple_testing raw_p_value equals estimate p_value (not a separate source)", bundle.multiple_testing.families.every((f) => f.adjusted_results.every((a) => approx(a.raw_p_value, estMap[a.estimate_id].p_value, 1e-9, 1e-12))));
ok("E3. family membership is explicit (declared on both sides)", bundle.multiple_testing.families.length === 2 && bundle.multiple_testing.families.every((f) => f.member_estimate_ids.length === 2 && estArt.every((e) => (e.multiple_testing_family_ids || []).includes(f.family_id))));

// family membership not machine-inferred: an estimate not declared as a family member must NOT be auto-included
const fam = bundle.multiple_testing.families[0];
let bad = clone(bundle.multiple_testing); bad.families[0].member_estimate_ids = ["EST_GRUNFELD_VALUE"]; // drop capital -> estimate declares family but not member
ok("E4. family missing a declared member -> contract error (not machine-inferred)", validateMultipleTesting(estArt, bad).length > 0, JSON.stringify(validateMultipleTesting(estArt, bad)));
let bad2 = clone(bundle.multiple_testing); bad2.families[0].member_estimate_ids = ["EST_NOT_A_REAL_ESTIMATE"];
ok("E5. family referencing an unknown estimate -> contract error", validateMultipleTesting(estArt, bad2).length > 0);
let bad3 = clone(bundle.multiple_testing); bad3.families[0].adjusted_results = bad3.families[0].adjusted_results.filter((a) => a.estimate_id !== "EST_GRUNFELD_CAPITAL");
ok("E6. adjusted_results not covering a member -> contract error", validateMultipleTesting(estArt, bad3).length > 0);

// ---- F. Artifact/provenance fail-closed ----
ok("F. multcomp artifact bundle passes full validateArtifacts", validateArtifacts(bundle, paths).length === 0, JSON.stringify(validateArtifacts(bundle, paths)));
const MUT = join(root, "role-team-out/multcomp_pack_mut");
rmSync(MUT, { recursive: true, force: true }); mkdirSync(MUT, { recursive: true }); cpSync(BUNDLE, MUT, { recursive: true });
const esP = join(MUT, "estimates.json"); const eo = readJson(esP); eo.estimates.find((e) => e.term === "value").estimate = 0.12; writeFileSync(esP, JSON.stringify(eo, null, 2) + "\n", "utf8");
let { bundle: mb, paths: mp } = loadBundle(MUT);
ok("F1. source estimate p-value mutation without rebuild -> validation fails", validateArtifacts(mb, mp).length > 0, JSON.stringify(validateArtifacts(mb, mp)));
// rebuild dependent provenance -> validator restores
function rebuildStamp(dir) { const mr = readJson(join(dir, "model_registry.json")); const es = readJson(join(dir, "estimates.json")); const sourceHashes = { model_registry: hashCanonicalJsonFile(join(dir, "model_registry.json")), estimates: hashCanonicalJsonFile(join(dir, "estimates.json")), diagnostics: hashCanonicalJsonFile(join(dir, "diagnostics.json")) }; writeFileSync(join(dir, "replication_stamp.json"), JSON.stringify(buildReplicationStamp(mr.models, es.estimates, sourceHashes), null, 2) + "\n", "utf8"); }
function rebuildManifest(dir) { const am = readJson(join(dir, "artifact_manifest.json")); for (const a of am.artifacts) a.sha256 = hashCanonicalJsonFile(join(dir, a.path)); writeFileSync(join(dir, "artifact_manifest.json"), JSON.stringify(am, null, 2) + "\n", "utf8"); }
rebuildStamp(MUT); rebuildManifest(MUT);
({ bundle: mb, paths: mp } = loadBundle(MUT));
ok("F2. rebuilt dependent provenance restores validation", validateArtifacts(mb, mp).length === 0, JSON.stringify(validateArtifacts(mb, mp)));
// multiple_testing adjusted p-value tamper (without rebuild) -> artifact_manifest checksum mismatch -> fail
const MT = join(root, "role-team-out/multcomp_pack_mt");
rmSync(MT, { recursive: true, force: true }); mkdirSync(MT, { recursive: true }); cpSync(BUNDLE, MT, { recursive: true });
const mtP = join(MT, "multiple_testing.json"); const mtO = readJson(mtP); mtO.families[0].adjusted_results[0].adjusted_p_value = 0.9999; writeFileSync(mtP, JSON.stringify(mtO, null, 2) + "\n", "utf8");
let { bundle: mtb, paths: mtp } = loadBundle(MT);
ok("F3. multiple_testing adjusted-p tamper without rebuild -> validation fails", validateArtifacts(mtb, mtp).length > 0, JSON.stringify(validateArtifacts(mtb, mtp)));
// unsupported method is not silently resolved as holm: manifest methods only holm/bh; a 'bonferroni' method is not declared
const manifest = readJson(join(MBASE, "benchmark.multcomp.json"));
ok("F4. benchmark manifest declares only these methods (no silent fallback)", JSON.stringify(manifest.methods) === JSON.stringify(["holm","benjamini_hochberg"]), JSON.stringify(manifest.methods));

// ---- G. Cross-engine exact match (committed results) ----
const py = readJson(join(MBASE, "results/python.json"));
const rr = readJson(join(MBASE, "results/r.json"));
const cmp = compareMultcomp(py, rr, manifest);
ok("G. comparator verdict PASS (checksum/benchmark_id/n/raw_p/adjusted/method_identity)", cmp.verdict === "PASS", JSON.stringify(cmp.checks));
const estOrder = ["EST_GRUNFELD_VALUE", "EST_GRUNFELD_CAPITAL"];
ok("G2. Python holm/bh match frozen manifest expected_adjusted", estOrder.every((eid) => approx(py.adjusted.holm[eid], manifest.expected_adjusted.holm[eid], 1e-9, 1e-12)) && estOrder.every((eid) => approx(py.adjusted.benjamini_hochberg[eid], manifest.expected_adjusted.benjamini_hochberg[eid], 1e-9, 1e-12)));
ok("G3. R holm/bh match frozen manifest expected_adjusted", estOrder.every((eid) => approx(rr.adjusted.holm[eid], manifest.expected_adjusted.holm[eid], 1e-9, 1e-12)) && estOrder.every((eid) => approx(rr.adjusted.benjamini_hochberg[eid], manifest.expected_adjusted.benjamini_hochberg[eid], 1e-9, 1e-12)));
ok("G4. Python holm == R holm; Python bh == R bh (cross-engine)", estOrder.every((eid) => approx(py.adjusted.holm[eid], rr.adjusted.holm[eid], 1e-9, 1e-12)) && estOrder.every((eid) => approx(py.adjusted.benjamini_hochberg[eid], rr.adjusted.benjamini_hochberg[eid], 1e-9, 1e-12)));
ok("G5. raw p cross-engine matches manifest expected_raw_p", estOrder.every((eid) => approx(py.estimates.raw_p[eid], manifest.expected_raw_p[eid], 1e-9, 1e-12)) && estOrder.every((eid) => approx(rr.estimates.raw_p[eid], manifest.expected_raw_p[eid], 1e-9, 1e-12)));

// ---- H. Determinism / order / monotonic / bounds ----
const J1 = JSON.stringify(info.holm), J2 = JSON.stringify(info.bh);
const info2 = buildMultcompBundle(join(root, "role-team-out/multcomp_pack_bundle2"));
ok("H. JS reference is deterministic across two runs", JSON.stringify(info2.holm) === J1 && JSON.stringify(info2.bh) === J2);
ok("H2. hypothesis IDs preserved (order not scrambled)", bundle.multiple_testing.families[0].member_estimate_ids.join(",") === ["EST_GRUNFELD_VALUE","EST_GRUNFELD_CAPITAL"].join(","));
const holmSorted = estOrder.map((eid) => bundle.multiple_testing.families[0].adjusted_results.find((a) => a.estimate_id === eid).adjusted_p_value);
ok("H3. Holm adjusted p monotonic (non-decreasing in raw-p order) and bounded [0,1]", holmSorted[0] <= holmSorted[1] + 1e-15 && holmSorted.every((v) => v >= 0 && v <= 1));
ok("H4. adjusted p >= raw p (Holm/BH do not shrink below unadjusted)", bundle.multiple_testing.families.every((f) => f.adjusted_results.every((a) => a.adjusted_p_value >= a.raw_p_value - 1e-14)));

// ---- I. Downstream compatibility (PHASE 8) ----
ok("I. multcomp bundle coexists with replication_stamp + artifact_manifest chain", validateArtifacts(bundle, paths).length === 0);
ok("I2. dataset checksum matches frozen Grunfeld", bundle.data_manifest.dataset_sha256 === manifest.source.dataset_checksum && hashTextFile(join(root, "domains/economics/benchmarks/panel_fe/grunfeld.csv")) === manifest.source.dataset_checksum);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);


