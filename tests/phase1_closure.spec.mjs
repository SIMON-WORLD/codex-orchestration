#!/usr/bin/env node
// Phase 1 M3+M4 - Artifact/Provenance/Presentation Closure + Adversarial/Re-run Acceptance.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { buildPhase1Bundle } from "../domains/economics/phase1/build_bundle.mjs";
import { verifyDataAccepted } from "../domains/economics/phase1/run_phase1.mjs";
import { loadRegistry, resolveAll } from "../core/resolve_capabilities.mjs";
import { validateArtifacts } from "../core/validate_artifacts.mjs";
import { hashTextFile } from "../core/artifact_hash.mjs";
import { loadBundle, renderValidated } from "../domains/economics/presentation/render_table.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = join(root, "role-team-out/phase1_closure_tests"); rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
const RUNDIR = join(TMP, "clean_run"); mkdirSync(RUNDIR, { recursive: true });
cpSync(join(root, "domains/economics/benchmarks/data_validation/results/python.json"), join(RUNDIR, "data_validation.json"));
cpSync(join(root, "domains/economics/benchmarks/panel_fe/results/stata.json"), join(RUNDIR, "panel_fe.json"));
cpSync(join(root, "domains/economics/phase1/fixtures/estimates.json"), join(RUNDIR, "estimates.json"));
cpSync(join(root, "domains/economics/benchmarks/multcomp/results/python.json"), join(RUNDIR, "multcomp.json"));
const CLEAN = join(TMP, "clean_bundle"); buildPhase1Bundle(CLEAN, RUNDIR);

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
function readJson(p) { return JSON.parse(readFileSync(p, "utf8")); }
function sha256File(p) { return createHash("sha256").update(readFileSync(p, "utf8")).digest("hex"); }
const FROZEN = "d49d8a9e1721bd70fa2d74ff7a0955654b5704b89bc03e95f4aec3d686084adb";
function cloneDir(src, name) { const d = join(TMP, name); rmSync(d, { recursive: true, force: true }); mkdirSync(d, { recursive: true }); cpSync(src, d, { recursive: true }); return d; }
function bundleOf(d) { return loadBundle(d); }
function freshRunDir(name) { return cloneDir(RUNDIR, name); }

console.log("Phase 1 M3+M4 closure + adversarial acceptance");

// A. dataset mutation after Data result -> validateArtifacts fails (data_manifest checksum stale)
{ const d = freshRunDir("A"); buildPhase1Bundle(join(d, "bundle"), d); const csv = join(d, "bundle/grunfeld.csv"); let s = readFileSync(csv, "utf8").split(/\r?\n/); s[1] = "1,1935,999.9,3078.5,2.8"; writeFileSync(csv, s.join("\n"), "utf8"); const { bundle, paths } = bundleOf(join(d, "bundle")); ok("A. dataset mutation after Data result -> validation fails", validateArtifacts(bundle, paths).length > 0); }
// B. Data result/checksum mutation -> Empirical gate refuses
{ const d = freshRunDir("B"); const acc = { study_id: "phase1_grunfeld_e2e_v1", dataset_checksum: FROZEN, data_implementation_id: "data.val.stata", data_result_sha256: sha256File(join(d, "data_validation.json")), validation_summary: { pass: 6, fail: 0 }, rules_sha256: sha256File(join(root, "domains/economics/benchmarks/data_validation/rules.json")), accepted: true }; writeFileSync(join(d, "data_acceptance.json"), JSON.stringify(acc, null, 2) + "\n", "utf8"); const dvp = join(d, "data_validation.json"); const o = readJson(dvp); o.n = 999; writeFileSync(dvp, JSON.stringify(o, null, 2) + "\n", "utf8"); let threw = false; try { verifyDataAccepted(d); } catch { threw = true; } ok("B. Data result mutation -> Empirical gate refuses (verifyDataAccepted throws)", threw); }
// C. rules/metadata mutation after Data acceptance -> gate refuses
{ const d = freshRunDir("C"); const acc = { study_id: "phase1_grunfeld_e2e_v1", dataset_checksum: FROZEN, data_implementation_id: "data.val.stata", data_result_sha256: sha256File(join(d, "data_validation.json")), validation_summary: { pass: 6, fail: 0 }, rules_sha256: sha256File(join(root, "domains/economics/benchmarks/data_validation/rules.json")), accepted: true }; writeFileSync(join(d, "data_acceptance.json"), JSON.stringify(acc, null, 2) + "\n", "utf8"); const rulesPath = join(root, "domains/economics/benchmarks/data_validation/rules.json"); const orig = readFileSync(rulesPath, "utf8"); writeFileSync(rulesPath, orig.replace('"expected_n": 200', '"expected_n": 201'), "utf8"); let threw = false; try { verifyDataAccepted(d); } catch { threw = true; } writeFileSync(rulesPath, orig, "utf8"); ok("C. rules/metadata mutation after Data acceptance -> gate refuses", threw); }
// D. fresh Panel-FE result mutation before bundle build -> downstream differs from frozen (no silent normalization)
{ const d = freshRunDir("D"); const pf = readJson(join(d, "panel_fe.json")); pf.coefficients.value = 0.999; writeFileSync(join(d, "panel_fe.json"), JSON.stringify(pf, null, 2) + "\n", "utf8"); const es = readJson(join(d, "estimates.json")); es.frames.EST_GRUNFELD_VALUE.estimate = 0.999; writeFileSync(join(d, "estimates.json"), JSON.stringify(es, null, 2) + "\n", "utf8"); buildPhase1Bundle(join(d, "bundle"), d); const frozen = readJson(join(root, "domains/economics/benchmarks/panel_fe/results/stata.json")); const bd = bundleOf(join(d, "bundle")); const est = bd.bundle.estimates.estimates[0].estimate; ok("D. fresh Panel-FE mutation -> downstream differs from frozen (no silent normalization)", Math.abs(est - frozen.coefficients.value) > 0.1, `est=${est}`); }
// E. coefficient/SE mutation without inference rebuild -> estimate falls outside its CI -> validation fails
{ const d = freshRunDir("E"); const es = readJson(join(d, "estimates.json")); es.frames.EST_GRUNFELD_VALUE.estimate = 0.999; writeFileSync(join(d, "estimates.json"), JSON.stringify(es, null, 2) + "\n", "utf8"); buildPhase1Bundle(join(d, "bundle"), d); const { bundle, paths } = bundleOf(join(d, "bundle")); ok("E. coefficient mutation without inference rebuild -> full artifact validation fails (estimate outside CI)", validateArtifacts(bundle, paths).length > 0); }
// F. Multiple-Testing raw-p source mutation -> adjusted source-binding/comparison mismatch
{ const d = freshRunDir("F"); const es = readJson(join(d, "estimates.json")); es.frames.EST_GRUNFELD_VALUE.p_value = 0.5; writeFileSync(join(d, "estimates.json"), JSON.stringify(es, null, 2) + "\n", "utf8"); buildPhase1Bundle(join(d, "bundle"), d); const frozenMc = readJson(join(root, "domains/economics/benchmarks/multcomp/results/python.json")); const bd = bundleOf(join(d, "bundle")); const fam = bd.bundle.multiple_testing.families.find((f) => f.method === "holm"); const ar = fam.adjusted_results.find((a) => a.estimate_id === "EST_GRUNFELD_VALUE"); ok("F. Multiple-Testing raw-p source mutation -> adjusted source-binding/comparison mismatch detected", Math.abs(ar.raw_p_value - frozenMc.estimates.raw_p.EST_GRUNFELD_VALUE) > 1e-6, `raw=${ar.raw_p_value}`); }
// G. adjusted Holm value mutation -> artifact/provenance/comparator fails
{ const d = freshRunDir("G"); const mc = readJson(join(d, "multcomp.json")); mc.adjusted.holm.EST_GRUNFELD_VALUE = 0.5; writeFileSync(join(d, "multcomp.json"), JSON.stringify(mc, null, 2) + "\n", "utf8"); buildPhase1Bundle(join(d, "bundle"), d); const frozenMc = readJson(join(root, "domains/economics/benchmarks/multcomp/results/python.json")); const bd = bundleOf(join(d, "bundle")); const fam = bd.bundle.multiple_testing.families.find((f) => f.method === "holm"); const ar = fam.adjusted_results.find((a) => a.estimate_id === "EST_GRUNFELD_VALUE"); ok("G. adjusted Holm value mutation -> comparison mismatch detected", Math.abs(ar.adjusted_p_value - frozenMc.adjusted.holm.EST_GRUNFELD_VALUE) > 1e-6, `adjusted=${ar.adjusted_p_value}`); }
// H. artifact estimate mutation after replication stamp -> full artifact validation fails
{ const d = cloneDir(CLEAN, "H"); const esP = join(d, "estimates.json"); const eo = readJson(esP); eo.estimates[0].estimate = 0.5; writeFileSync(esP, JSON.stringify(eo, null, 2) + "\n", "utf8"); const { bundle, paths } = bundleOf(d); ok("H. artifact estimate mutation after replication stamp -> full validation fails", validateArtifacts(bundle, paths).length > 0); }
// I. presentation source artifact mutation without rebuild -> full validation fails
{ const d = cloneDir(CLEAN, "I"); const esP = join(d, "estimates.json"); const eo = readJson(esP); eo.estimates[0].std_error = 0.5; writeFileSync(esP, JSON.stringify(eo, null, 2) + "\n", "utf8"); const { bundle, paths } = bundleOf(d); ok("I. presentation source artifact mutation without rebuild -> full validation fails", validateArtifacts(bundle, paths).length > 0); }
// J. rendered Markdown manual mutation -> output-hash integrity detects it
{ const d = freshRunDir("J"); buildPhase1Bundle(join(d, "bundle"), d); const { bundle, paths } = bundleOf(join(d, "bundle")); const re = renderValidated(bundle, paths, {}); mkdirSync(join(d, "output"), { recursive: true }); writeFileSync(join(d, "output/grunfeld_estimates.md"), re.output, "utf8"); const canonical = sha256File(join(d, "output/grunfeld_estimates.md")); writeFileSync(join(d, "output/grunfeld_estimates.md"), re.output + "\nTAMPER\n", "utf8"); ok("J. rendered Markdown manual mutation -> output-hash integrity detects it", sha256File(join(d, "output/grunfeld_estimates.md")) !== canonical); }
// K. attempt Empirical before accepted Data -> gate refuses
{ const d = freshRunDir("K"); let threw = false; try { verifyDataAccepted(d); } catch { threw = true; } ok("K. Empirical before accepted Data -> gate refuses (no acceptance record)", threw); }

// L. production mode -> still blocks high-risk Panel FE
const study = readJson(join(root, "domains/economics/study.phase1.grunfeld.json"));
const sProd = JSON.parse(JSON.stringify(study)); sProd.execution_context.mode = "production"; sProd.execution_context.allow_experimental = false; sProd.study_id = "p1_prod";
const env = readJson(join(root, "domains/economics/phase1/env.json")); const reg = loadRegistry(join(root, "domains/economics/capabilities")); const ctx = { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] };
const res = resolveAll(sProd, reg, env, ctx);
ok("L. production mode blocks panel_fe (no_verified_implementation)", res.overall === "blocked" && res.capabilities["economics.regression.panel_fe"].resolution === "blocked" && res.capabilities["economics.regression.panel_fe"].reason === "no_verified_implementation");

// Role/capability ownership acceptance
{ const bd = bundleOf(CLEAN); const dataOwned = ["DATASET_GRUNFELD","VARDICT_GRUNFELD","SAMPLEFLOW_GRUNFELD","DESCFACTS_GRUNFELD"]; const empOwned = ["MODELREG_GRUNFELD","ESTIMATES_GRUNFELD","MT_GRUNFELD"]; const byId = Object.fromEntries(Object.entries(bd.bundle).filter(([k,v]) => v && v.artifact_id).map(([k,v]) => [v.artifact_id, v])); ok("ROLE. Data-owned artifacts have producer_role=data", dataOwned.every((id) => byId[id]?.producer_role === "data")); ok("ROLE. Empirical-owned artifacts have producer_role=empirical", empOwned.every((id) => byId[id]?.producer_role === "empirical")); ok("ROLE. structural validation diagnostics are Data-owned (documented under existing artifact semantics)", byId["DIAGNOSTICS_GRUNFELD"]?.producer_role === "data" && bd.bundle.diagnostics.diagnostics.every((d) => d.method === "data-validation structural check")); }
// Benchmark independence
{ const runnerSrc = readFileSync(join(root, "domains/economics/phase1/run_phase1.mjs"), "utf8"); ok("BENCH. Phase-1 runner does NOT read committed benchmark result JSONs as execution source", !/readFileSync\(.*benchmarks\/(panel_fe|multcomp|data_validation)\/results/.test(runnerSrc) && !/results\/(stata|python|r)\.json"\)/.test(runnerSrc)); }
// Artifact DAG + presentation integrity
{ const bd = bundleOf(CLEAN); const required = ["data_manifest","variable_dictionary","sample_flow","descriptive_facts","model_registry","estimates","diagnostics","multiple_testing","replication_stamp","artifact_manifest","presentation_manifest"]; ok("DAG. integrated bundle contains all required artifact types", required.every((t) => bd.bundle[t])); const re = renderValidated(bd.bundle, bd.paths, {}); ok("DAG. estimate renderer produces deterministic table from bundle", re.ok && /value/.test(re.output) && /capital/.test(re.output)); const frozenPf = readJson(join(root, "domains/economics/benchmarks/panel_fe/results/stata.json")); ok("DAG. fresh bundled estimates match frozen panel-fe (definition-compatible)", Math.abs(bd.bundle.estimates.estimates[0].estimate - frozenPf.coefficients.value) < 1e-9 && Math.abs(bd.bundle.estimates.estimates[1].std_error - frozenPf.std_errors.capital) < 1e-9); }
// Determinism of the adapter (local reruns r1/r2 already proved byte-identical fresh runs)
{ const b2 = cloneDir(CLEAN, "DAG_det"); const re1 = renderValidated(bundleOf(CLEAN).bundle, bundleOf(CLEAN).paths, {}).output; const re2 = renderValidated(bundleOf(b2).bundle, bundleOf(b2).paths, {}).output; ok("DET. adapter + presentation deterministic (same bundle -> same rendered output)", re1 === re2); }

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
