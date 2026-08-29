#!/usr/bin/env node
// Economics Data Validation Pack v1 - contract + Director + resolver + benchmark + adversarial + artifact regression.
import { readFileSync, mkdirSync, writeFileSync, rmSync, cpSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";
import { evaluateStudyDesign } from "../domains/economics/evaluate_study_design.mjs";
import { validateArtifacts } from "../core/validate_artifacts.mjs";
import { hashTextFile, hashCanonicalJsonFile, CANONICAL_HASH_MODE } from "../core/artifact_hash.mjs";
import { buildReplicationStamp } from "../core/build_replication_stamp.mjs";
import { buildDataValidationBundle } from "../domains/economics/benchmarks/data_validation/build_bundle.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = loadRegistry(join(root, "domains/economics/capabilities"));
const dv = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/data.validation.json"), "utf8"));
const example = JSON.parse(readFileSync(join(root, "domains/economics/study_design.example.json"), "utf8"));
const DV = "economics.data.validation";
const DBASE = join(root, "domains/economics/benchmarks/data_validation");
const BUNDLE = join(root, "role-team-out/data_validation_pack_bundle");

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function readJson(p) { return JSON.parse(readFileSync(p, "utf8")); }
function hasU(res, cap, field) { return res.unresolved_decisions.some((u) => u.capability === cap && u.field === field); }
function loadBundle(dir) {
  const bundle = {}, paths = {};
  for (const n of ["data_manifest","variable_dictionary","sample_flow","descriptive_facts","model_registry","estimates","diagnostics","replication_stamp","artifact_manifest"]) {
    const f = join(dir, n + ".json"); bundle[n] = JSON.parse(readFileSync(f, "utf8")); paths[n] = f;
  }
  return { bundle, paths };
}

console.log("Data Validation Pack v1 regression");

// ---- A. Contract scope ----
ok("A. data.validation refs have no placeholder https://... URLs", (dv.methodology.references || []).every((r) => r.url && r.url.startsWith("https://") && !r.url.includes("...") && !/EconAgentSkills/.test(r.url) && !/https:\/\/\.\.\./.test(r.url)), JSON.stringify((dv.methodology.references || []).map((r) => r.url)));
ok("A2. data.validation scope is machine-checkable structural (no auto cleaning/exclusion/unit/range inference)", /[Mm]achine-checkable/.test(dv.description) && /does NOT.*repair/.test(dv.description) && /does NOT infer/.test(dv.description) && /does NOT decide.*sample exclusion/.test(dv.description));
ok("A3. decision_requirements kept to sample_exclusion + variable_definition", ["sample_exclusion","variable_definition"].every((d) => dv.decision_requirements.includes(d)));
ok("A4. risk medium + fallback needs_decision", dv.risk_level === "medium" && dv.fallback_policy === "needs_decision");
ok("A5. both implementations tested, none verified; evidence scoped (real-data + adversarial, NOT generic/verified)", (() => {
  const impls = dv.implementations || [];
  return impls.some((i) => i.id === "data.val.python.pandas" && i.verification_status === "tested") && impls.some((i) => i.id === "data.val.stata" && i.verification_status === "tested") && impls.every((i) => i.verification_status !== "verified") && impls.every((i) => /NOT verified/.test(i.verification.evidence));
})());

// ---- B. Director decision-state gates ----
ok("B. canonical example remains ready (no new required data-validation decisions)", evaluateStudyDesign(example, registry).status === "ready");
let s1 = clone(example); delete s1.decisions.sample_exclusion; let r1 = evaluateStudyDesign(s1, registry);
ok("B1. missing sample_exclusion -> needs_decision", r1.status === "needs_decision" && hasU(r1, DV, "sample_exclusion"));
let s2 = clone(example); delete s2.decisions.variable_definition; let r2 = evaluateStudyDesign(s2, registry);
ok("B2. missing variable_definition -> needs_decision", r2.status === "needs_decision" && hasU(r2, DV, "variable_definition"));
let s3 = clone(example); delete s3.manual_validations.sample_flow_defined; let r3 = evaluateStudyDesign(s3, registry);
ok("B3. missing sample_flow_defined manual validation -> needs_decision", r3.status === "needs_decision" && hasU(r3, DV, "sample_flow_defined"));
let s4 = clone(example); s4.selected_capabilities = {}; let r4 = evaluateStudyDesign(s4, registry);
ok("B4. unselected data.validation does not impose decisions on other workflows", r4.status === "ready");

// ---- C. Production resolver admission ----
const envOK = { runtimes: { python: { available: true, known: true, version: "3.14.3" }, stata: { available: true, known: true, version: "19.5" } }, packages: { pandas: { available: true, known: true, version: "3.0.5" } } };
function runDv(opts = {}) {
  const study = {
    study_id: "dv_test", domain: "economics",
    execution_context: { mode: opts.mode || "production", allow_experimental: !!opts.allow_experimental, preferred_runtimes: opts.preferred_runtimes || [], approved_overrides: opts.approved_overrides || [] },
    selected_capabilities: { data: [DV] },
    decisions: opts.decisions || { sample_exclusion: "none", variable_definition: "standard" },
    preconditions: opts.preconditions || {}, manual_validations: opts.manual_validations || { sample_flow_defined: true },
  };
  const res = resolveAll(study, registry, opts.env || {}, { mode: study.execution_context.mode, allow_experimental: study.execution_context.allow_experimental, preferred_runtimes: study.execution_context.preferred_runtimes, approved_overrides: study.execution_context.approved_overrides });
  return res.capabilities[DV];
}
let rc = runDv({ env: envOK });
ok("C1. medium/production + tested impl env-available -> resolved (tested admissible under medium-risk policy)", rc.resolution === "resolved" && rc.verification_status === "tested", `got=${rc.resolution}/${rc.verification_status}`);
let rc2 = runDv({ env: {} });
ok("C2. medium/production + no available impl + fallback needs_decision -> needs_decision/no_implementation_approval_required", rc2.resolution === "needs_decision" && rc2.reason === "no_implementation_approval_required", `got=${rc2.resolution}/${rc2.reason}`);
const coreSrc = readFileSync(join(root, "core/resolve_capabilities.mjs"), "utf8");
ok("C3. no special-case data-validation logic in Core resolver", !/data\.val/i.test(coreSrc) && !/unit_key/.test(coreSrc) && !/DV_ROWCOUNT/.test(coreSrc) && !/DV_KEY_UNIQUE/.test(coreSrc), "core/resolve_capabilities.mjs must stay generic");

// ---- D. No cross-capability bleed ----
const implIds = (dv.implementations || []).map((i) => i.id);
ok("D. data.validation implementations are exactly the two declared", implIds.length === 2 && implIds.includes("data.val.python.pandas") && implIds.includes("data.val.stata"), JSON.stringify(implIds));
let bleed = false;
for (const f of readdirSync(join(root, "domains/economics/capabilities"))) {
  if (!f.endsWith(".json") || f === "index.json") continue;
  const cap = readJson(join(root, "domains/economics/capabilities", f));
  if (cap.id === DV) continue;
  for (const i of cap.implementations || []) if (implIds.includes(i.id)) bleed = true;
}
ok("D2. data.validation implementations do not leak into any other capability", !bleed);

// ---- E. Real-data benchmark ----
const info = buildDataValidationBundle(BUNDLE);
let { bundle, paths } = loadBundle(BUNDLE);
const manifest = readJson(join(DBASE, "benchmark.data_validation.json"));
ok("E. data-validation artifact bundle passes full validateArtifacts", validateArtifacts(bundle, paths).length === 0, JSON.stringify(validateArtifacts(bundle, paths)));
ok("E2. dataset checksum identity (data_manifest vs frozen grunfeld.csv)", bundle.data_manifest.dataset_sha256 === manifest.source.dataset_checksum && hashTextFile(join(root, "domains/economics/benchmarks/panel_fe/grunfeld.csv")) === manifest.source.dataset_checksum);
const py = readJson(join(DBASE, "results/python.json"));
const sta = readJson(join(DBASE, "results/stata.json"));
ok("E3. Python & Stata real-data result both PASS on clean Grunfeld (6 pass / 0 fail / 1 not_applicable)", py.summary.pass === 6 && py.summary.fail === 0 && py.summary.not_applicable === 1 && sta.summary.pass === 6 && sta.summary.fail === 0 && sta.summary.not_applicable === 1, `py=${JSON.stringify(py.summary)} sta=${JSON.stringify(sta.summary)}`);
ok("E4. both implementation results carry the frozen dataset checksum", py.dataset_checksum === manifest.source.dataset_checksum && sta.dataset_checksum === manifest.source.dataset_checksum);
ok("E5. artifact diagnostics reflect the real-data validation checks", (() => { const d = bundle.diagnostics.diagnostics; const ids = d.map((x) => x.diagnostic_id); return ids.includes("DIAG_DV_DV_ROWCOUNT") && ids.includes("DIAG_DV_DV_KEY_UNIQUE") && ids.includes("DIAG_DV_DV_MISSINGNESS") && d.every((x) => x.status === "pass" || x.status === "not_applicable"); })());
const reghdfe = readJson(join(root, "domains/economics/benchmarks/panel_fe/results/stata.json"));
ok("E6. artifact does NOT mutate/recompute: model_registry/estimates are accepted frozen scientific context", bundle.model_registry.models[0].implementation_id === "panel.fe.stata.reghdfe" && bundle.estimates.estimates[0].estimate === reghdfe.coefficients.value && bundle.estimates.estimates[1].estimate === reghdfe.coefficients.capital);

// ---- F. Adversarial defect detection (committed evidence) ----
const adv = readJson(join(DBASE, "results/adversarial.json"));
const expectedTarget = { "dup_key":"DV_KEY_UNIQUE", "missing_var":"DV_VAR_PRESENT", "extra_missing":"DV_MISSINGNESS", "wrong_n":"DV_ROWCOUNT", "wrong_type":"DV_VAR_TYPE", "bad_rule_key":"DV_KEY_UNIQUE", "merge_cardinality":"DV_MERGE_CARDINALITY" };
ok("F. each adversarial fixture surfaces the targeted defect (fail, not pass)", Object.entries(expectedTarget).every(([caseName, checkId]) => adv.cases[caseName] && adv.cases[caseName].checks[checkId] === "fail"), JSON.stringify(Object.fromEntries(Object.entries(expectedTarget).map(([c, ch]) => [c, adv.cases[c] && adv.cases[c].checks[ch]]))));
ok("F2. no adversarial fixture silently passes all checks", Object.values(adv.cases).every((c) => c.summary.fail >= 1));

// ---- G. Artifact / provenance fail-closed + no-auto-repair ----
const MUT = join(root, "role-team-out/data_validation_mut");
rmSync(MUT, { recursive: true, force: true }); mkdirSync(MUT, { recursive: true }); cpSync(BUNDLE, MUT, { recursive: true });
// change source csv -> data_manifest.dataset_sha256 stale -> validation fails
const csvPath = join(MUT, "grunfeld.csv"); let csvLines = readFileSync(csvPath, "utf8").split(/\r?\n/); csvLines[1] = "1,1935,999.9,3078.5,2.8"; writeFileSync(csvPath, csvLines.join("\n"), "utf8");
let { bundle: mb, paths: mp } = loadBundle(MUT);
ok("G. stale source data without rebuild -> validation fails", validateArtifacts(mb, mp).length > 0, JSON.stringify(validateArtifacts(mb, mp)));
ok("G2. validators + adapter declare no_auto_repair", py.no_auto_repair === true && sta.no_auto_repair === true && manifest.no_auto_repair === true);

// ---- H. Cross-engine agreement + downstream compatibility ----
ok("H. Python and Stata agree on the clean-dataset summary + checksum", py.n === 200 && sta.n === 200 && py.dataset_checksum === sta.dataset_checksum);
ok("H2. data-validation bundle coexists with the accepted scientific pipeline (validateArtifacts green)", validateArtifacts(bundle, paths).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);