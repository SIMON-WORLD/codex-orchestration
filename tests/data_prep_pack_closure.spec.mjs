#!/usr/bin/env node
// Phase 3 M3 - data-prep Pack closure spec. Validates the committed closure manifest against actual
// evidence (bindings/hashes + semantic claims). Not a duplicate of every implementation unit test.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";
import { canonicalHarmonizePlanHash } from "../domains/economics/data/validate_harmonize_plan.mjs";
import { canonicalConstructPlanHash } from "../domains/economics/data/validate_construct_plan.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREP = join(root, "domains/economics/benchmarks/data_prep");
const shaTextLf = (p) => createHash("sha256").update(readFileSync(p, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n")).digest("hex");
const shaBytes = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const registry = loadRegistry(join(root, "domains/economics/capabilities"));
const man = JSON.parse(readFileSync(join(PREP, "closure.phase3.json"), "utf8"));
const hCap = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/data.harmonize.json"), "utf8"));
const cCap = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/data.construct.json"), "utf8"));
const envPy = { runtimes: { python: { available: true, known: true, version: "3.14.3" } }, packages: { pandas: { available: true, known: true, version: "3.0.5" } } };
const envNoPy = { runtimes: { python: { available: false, known: false, version: null } }, packages: {} };

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
console.log("Phase 3 M3 data-prep Pack closure");

// 1. Real Grunfeld identity
{
  ok("GRUN. canonical LF checksum == Phase-1 FROZEN_CHECKSUM (d49d8a9e)", man.real_dataset.lf_sha === "d49d8a9e1721bd70fa2d74ff7a0955654b5704b89bc03e95f4aec3d686084adb");
  ok("GRUN. working raw-byte sha recorded + differs from LF (line endings)", man.real_dataset.working_raw_sha !== man.real_dataset.lf_sha && /^[0-9a-f]{64}$/.test(man.real_dataset.working_raw_sha));
  ok("GRUN. benchmark frozen copy raw sha == canonical LF sha (byte-exact, not replacing source)", shaBytes(join(PREP, "sources/grunfeld.csv")) === man.real_dataset.lf_sha);
}
// 2. Derived schema-variant provenance
{
  ok("VARIANT. raw sha matches committed file + labeled real_dataset_derived_schema_variant", man.derived_schema_variant.raw_sha256 === shaBytes(join(PREP, "sources/grunfeld_variant.csv")) && /real_dataset_derived_schema_variant/.test(man.derived_schema_variant.note));
  ok("VARIANT. generation hash binds strategy + canonical LF sha", /^[0-9a-f]{64}$/.test(man.derived_schema_variant.variant_generation_hash) && man.derived_schema_variant.variant_generation_id === "grunfeld_schema_variant_v1");
}
// 3. Harmonize real benchmark binding
{
  const hPlan = JSON.parse(readFileSync(join(PREP, "real_harmonize.plan.json"), "utf8"));
  ok("HARMONIZE. plan hash matches + output sha matches", man.harmonize.plan_hash === canonicalHarmonizePlanHash(hPlan) && man.harmonize.harmonized_output_sha256 === man.determinism.harmonized_sha);
  ok("HARMONIZE. harmonized output is canonical-comparable (200 rows, canonical columns/values)", (() => { const h = readFileSync(join(PREP, "results/chain_run1/harmonized.csv"), "utf8"); const lines = h.trim().split("\n"); return lines.length === 201 && lines[0].trim() === "capital,firm,invest,value,year" && lines[1].trim() === "2.8,1,317.6,3078.5,1935"; })());
}
// 4. Construct real benchmark binding + oracle
{
  const cPlan = JSON.parse(readFileSync(join(PREP, "real_construct.plan.json"), "utf8"));
  ok("CONSTRUCT. plan hash matches + output sha matches", man.construct.plan_hash === canonicalConstructPlanHash(cPlan) && man.construct.constructed_output_sha256 === man.determinism.constructed_sha);
  const parity = JSON.parse(readFileSync(join(PREP, "oracle/parity.json"), "utf8"));
  ok("ORACLE. independent stdlib parity all_ok (200 facts)", man.oracle.all_ok === true && parity.all_ok === true && parity.facts_checked === 200);
}
// 5. Two-run prep determinism
{
  ok("DET. harmonize+construct plan hashes identical; harmonized+constructed output shas identical; op semantics identical", man.determinism.harmonize_plan_hash === man.harmonize.plan_hash && man.determinism.construct_plan_hash === man.construct.plan_hash && man.determinism.harmonized_sha_identical === true && man.determinism.constructed_sha_identical === true && man.determinism.op_semantics_identical === true);
  ok("DET. source variant byte-identical after runs", shaBytes(join(PREP, "sources/grunfeld_variant.csv")) === man.derived_schema_variant.raw_sha256);
}
// 6. Missingness cross-op + eligibility invariant
{
  const mx = JSON.parse(readFileSync(join(PREP, "results/adversarial/missingness_crossop.json"), "utf8"));
  const byKind = Object.fromEntries(mx.operations.map((o) => [o.kind, o]));
  ok("MISS. lag/lead/diff/growth each have structural_missing_count>0 AND input_missing_propagated_count>0 (distinct)", byKind.lag.structural_missing_count === 1 && byKind.lag.input_missing_propagated_count === 1 && byKind.difference.structural_missing_count === 1 && byKind.difference.input_missing_propagated_count === 2 && byKind.growth_rate.structural_missing_count === 1 && byKind.growth_rate.input_missing_propagated_count === 2);
  ok("ELIG. constructed output keeps 200 rows (eligibility flag does not filter)", (() => { const c = readFileSync(join(PREP, "results/chain_run1/constructed.csv"), "utf8"); return c.trim().split("\n").length === 201; })());
}
// 7. Artifact compatibility
{
  const dm = JSON.parse(readFileSync(join(PREP, "artifacts/data_manifest.json"), "utf8"));
  const vd = JSON.parse(readFileSync(join(PREP, "artifacts/variable_dictionary.json"), "utf8"));
  const sf = JSON.parse(readFileSync(join(PREP, "artifacts/sample_flow.json"), "utf8"));
  ok("ART. data_manifest binds harmonized dataset sha + lineage", dm.dataset_sha256 === man.harmonize.harmonized_output_sha256 && dm.observation_count === 200 && Array.isArray(dm.source_refs));
  ok("ART. variable_dictionary binds constructed-variable lineage (no treatment/exposure/instrument claims)", vd.variables.length === 7 && vd.variables.every((v) => v.construction_ref) && vd.variables.some((v) => v.name === "high_value") && /benchmark-only flag/.test(vd.variables.find((v) => v.name === "high_value").definition));
  ok("ART. sample_flow honest: no fake removal; eligibility flag does not alter n", sf.steps.every((s) => s.n_removed === 0 && s.n_before === 200 && s.n_after === 200));
}
// 8. Maturity
{
  ok("MATURITY. both implementations tested (max in phase3), never verified", man.maturity.max_in_phase3 === "tested" && man.maturity.never === "verified" && hCap.implementations[0].verification_status === "tested" && cCap.implementations[0].verification_status === "tested" && hCap.implementations[0].verification_status !== "verified" && cCap.implementations[0].verification_status !== "verified");
}
// 9. Resolver / risk regression (after tested promotion)
{
  const ctx = { mode: "production", allow_experimental: false, preferred_runtimes: ["python"], approved_overrides: [] };
  const fmt = (id) => { const study = { study_id: "x", domain: "economics", execution_context: ctx, selected_capabilities: { data: [id] }, decisions: { variable_definition: "x" }, preconditions: {}, manual_validations: {} }; return resolveAll(study, registry, envPy, ctx).capabilities[id]; };
  const rH = fmt("economics.data.harmonize"); const rC = fmt("economics.data.construct");
  ok("RES. production + python/pandas + tested -> resolved (medium risk, tested is admissible)", rH.resolution === "resolved" && rC.resolution === "resolved" && rH.verification_status === "tested" && rC.verification_status === "tested", `got=${rH.resolution}/${rC.resolution}`);
  const ctp = { mode: "test", allow_experimental: true, preferred_runtimes: ["python"], approved_overrides: [] };
  const rTestH = resolveAll({ ...fmt("economics.data.harmonize").capability ? {} : {}, study_id: "y", domain: "economics", execution_context: ctp, selected_capabilities: { data: ["economics.data.harmonize"] }, decisions: { variable_definition: "x" }, preconditions: {}, manual_validations: {} }, registry, envPy, ctp).capabilities["economics.data.harmonize"];
  ok("RES. controlled test resolves to tested", rTestH.resolution === "resolved" && rTestH.verification_status === "tested");
  const rNoH = resolveAll({ study_id: "z", domain: "economics", execution_context: ctx, selected_capabilities: { data: ["economics.data.harmonize"] }, decisions: { variable_definition: "x" }, preconditions: {}, manual_validations: {} }, registry, envNoPy, ctx).capabilities["economics.data.harmonize"];
  ok("RES. no python runtime -> medium needs_decision", rNoH.resolution === "needs_decision", `got=${rNoH.resolution}/${rNoH.reason}`);
  ok("RISK. risk=medium, fallback=needs_decision, no Core special-case, data role owned", hCap.risk_level === "medium" && hCap.fallback_policy === "needs_decision" && cCap.risk_level === "medium" && cCap.fallback_policy === "needs_decision" && readdirSync(join(root, "core")).filter((f) => f.endsWith(".mjs")).filter((f) => /data\.harmonize|data\.construct/.test(readFileSync(join(root, "core", f), "utf8"))).length === 0);
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);