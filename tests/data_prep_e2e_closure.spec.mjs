#!/usr/bin/env node
// Phase-3 M4 - data-prep E2E closure test. Validates the committed E2E evidence + acceptance
// bindings, tamper matrix, gate semantics, reproducibility, and maturity. CI-safe (reads frozen evidence).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";
import { evaluateStudyDesign } from "../domains/economics/evaluate_study_design.mjs";
import { validateStudyDesign } from "../domains/economics/validate_study_design.mjs";
import { verifyAcceptance } from "../domains/economics/phase3/run_phase3.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PREP = join(root, "domains/economics/benchmarks/data_prep");
const R1 = join(PREP, "results/e2e_run1");
const R2 = join(PREP, "results/e2e_run2");
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const shaText = (p) => createHash("sha256").update(readFileSync(p, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n")).digest("hex");
const study = JSON.parse(readFileSync(join(root, "domains/economics/study.phase3.grunfeld.json"), "utf8"));
const registry = loadRegistry(join(root, "domains/economics/capabilities"));
const acc1 = JSON.parse(readFileSync(join(R1, "data_acceptance.json"), "utf8"));
const acc2 = JSON.parse(readFileSync(join(R2, "data_acceptance.json"), "utf8"));
const rec1 = JSON.parse(readFileSync(join(R1, "execution_record.json"), "utf8"));
const rec2 = JSON.parse(readFileSync(join(R2, "execution_record.json"), "utf8"));
const man = JSON.parse(readFileSync(join(PREP, "closure.phase3.e2e.json"), "utf8"));
const files = {
  source_variant: join(PREP, "sources/grunfeld_variant.csv"),
  harmonized_csv: join(R1, "harmonized.csv"),
  harmonize_plan: join(PREP, "real_harmonize.plan.json"),
  harmonize_log: join(R1, "harmonize_execution_log.json"),
  constructed_csv: join(R1, "constructed.csv"),
  construct_plan: join(PREP, "real_construct.plan.json"),
  construct_log: join(R1, "construct_execution_log.json"),
  validation: join(R1, "data_validation.json"),
  rules: join(root, "domains/economics/benchmarks/data_validation/rules.json"),
};
const TMP = join(root, "role-team-out/e2e_tamper"); mkdirSync(TMP, { recursive: true });
let pass = 0, fail = 0;
function ok(n, c, d) { if (c) { console.log(`  ✅ ${n}`); pass++; } else { console.log(`  ❌ ${n}${d ? " — " + d : ""}`); fail++; } }
function tamperFile(src, mut) { const d = join(TMP, "tampered_" + sha(src).slice(0, 8)); writeFileSync(d, mut(readFileSync(src, "utf8")), "utf8"); return d; }
console.log("Phase-3 M4 data-prep E2E closure");

// 1. Study contract + Director + resolver active chain
{
  ok("STUDY. contract valid + Director ready", validateStudyDesign(study).length === 0 && evaluateStudyDesign(study, registry).status === "ready");
  const env = { runtimes: { python: { available: true, known: true, version: "3.14.3" }, stata: { available: true, known: true, version: "19" } }, packages: { pandas: { available: true, known: true, version: "3.0.5" }, linearmodels: { available: true, known: true, version: "7.0" } } };
  const pre = resolveAll(study, registry, env, { mode: "test", allow_experimental: true, preferred_runtimes: ["python", "stata"], approved_overrides: [] });
  ok("STUDY. data capabilities resolved (harmonize/construct/validation)", ["economics.data.harmonize", "economics.data.construct", "economics.data.validation"].every((c) => pre.capabilities[c]?.resolution === "resolved"));
  ok("STUDY. empirical panel_fe resolved (tested)", pre.capabilities["economics.regression.panel_fe"]?.resolution === "resolved" && pre.capabilities["economics.regression.panel_fe"]?.verification_status === "tested");
}
// 2. Data Acceptance binds match recomputed hashes
{
  ok("ACCEPT. acceptance accepted + validation passed", acc1.accepted === true && acc1.validation.summary.fail === 0);
  ok("ACCEPT. source variant sha matches file", acc1.source_variant_sha256 === sha(files.source_variant));
  ok("ACCEPT. harmonized/constructed output shas match bound values", acc1.harmonize.harmonized_sha256 === man.data_acceptance.harmonized_sha256 && acc1.construct.constructed_sha256 === man.data_acceptance.constructed_sha256);
  const errs = verifyAcceptance(acc1, files);
  ok("ACCEPT. verifyAcceptance (all bindings) -> no errors", errs.length === 0, `errs=${errs.join(",")}`);
}
// 3. Empirical gate + coefficient match
{
  ok("GATE. empirical_gate true + empirical completed", rec1.empirical_gate === true && rec1.empirical.matches_frozen_within_tol === true);
  ok("GATE. coefficients match frozen canonical (value 0.1177, capital 0.3579)", Math.abs(rec1.empirical.coefficients.value - 0.11771585508) < 1e-4 && Math.abs(rec1.empirical.coefficients.capital - 0.35791627307) < 1e-4);
  ok("GATE. role chain data owns harmonize->construct->validation; empirical after acceptance", JSON.stringify(man.active_role_capability_chain.data) === JSON.stringify(["economics.data.harmonize", "economics.data.construct", "economics.data.validation"]) && man.active_role_capability_chain.empirical[0] === "economics.regression.panel_fe");
}
// 4. Tamper matrix (each upstream material change -> verifyAcceptance mismatch / gate blocked)
{
  const cases = [
    ["source data", "source_variant", () => tamperFile(files.source_variant, (t) => t.replace(/317\.6/, "555.5"))],
    ["harmonize plan", "harmonize_plan", () => tamperFile(files.harmonize_plan, (t) => t.replace('harm_grunfeld_variant_v1', 'harm_tampered_v1'))],
    ["harmonize output", "harmonized_csv", () => tamperFile(files.harmonized_csv, (t) => t.replace(/\b1935\b/, "1940"))],
    ["harmonize evidence", "harmonize_log", () => tamperFile(files.harmonize_log, (t) => t.replace('"overall": "completed"', '"overall": "tampered"'))],
    ["construct plan", "construct_plan", () => tamperFile(files.construct_plan, (t) => t.replace('"log_value"', '"log_value_tampered"'))],
    ["construct output", "constructed_csv", () => tamperFile(files.constructed_csv, (t) => t.replace(/\b1935\b/, "1940"))],
    ["construct evidence", "construct_log", () => tamperFile(files.construct_log, (t) => t.replace('"overall": "completed"', '"overall": "tampered"'))],
    ["validation result", "validation", () => tamperFile(files.validation, (t) => t.replace('"fail": 0', '"fail": 99'))],
    ["rules", "rules", () => tamperFile(files.rules, (t) => t.replace('gcdv_grunfeld_rules_v1', 'gcdv_TAMPERED'))],
  ];
  for (const [label, key, mk] of cases) {
    const f = mk(); const errs = verifyAcceptance(acc1, { ...files, [key]: f });
    ok(`TAMPER. ${label} change -> dataset/evidence binding mismatch (gate blocked)`, errs.length > 0, `errs=${errs.join(",")}`);
  }
  // acceptance record tamper (run_id/identity) -> bindings no longer match
  const accT = JSON.parse(JSON.stringify(acc1)); accT.harmonize.harmonized_sha256 = "0".repeat(64);
  ok("TAMPER. acceptance-record binding mutation -> mismatch", verifyAcceptance(accT, files).length > 0);
  // missing required scientific decision stops chain before empirical
  const sMissing = JSON.parse(JSON.stringify(study)); delete sMissing.decisions.clustering_level;
  const preMissing = resolveAll(sMissing, registry, { runtimes: { python: { available: true, known: true, version: "3.14.3" } }, packages: { pandas: { available: true, known: true, version: "3.0.5" }, linearmodels: { available: true, known: true, version: "7.0" } } }, { mode: "test", allow_experimental: true, preferred_runtimes: ["python"], approved_overrides: [] });
  ok("GATE. missing required scientific decision (clustering_level) -> empirical needs_decision (chain stops before empirical)", preMissing.capabilities["economics.regression.panel_fe"].resolution === "needs_decision" || preMissing.capabilities["economics.regression.panel_fe"].resolution === "blocked", `got=${preMissing.capabilities["economics.regression.panel_fe"].resolution}`);
}
// 5. Reproducibility
{
  ok("REPRO. two runs: acceptance identical + coefficients identical + prep shas identical", JSON.stringify(acc1) === JSON.stringify(acc2) && JSON.stringify(rec1.empirical.coefficients) === JSON.stringify(rec2.empirical.coefficients) && rec1.hashes.harmonized === rec2.hashes.harmonized && rec1.hashes.constructed === rec2.hashes.constructed && rec1.hashes.validation === rec2.hashes.validation);
  ok("REPRO. manifest records reproducibility true", man.reproducibility.acceptance_identical === true && man.reproducibility.empirical_coefficients_identical === true);
}
// 6. Maturity
{
  ok("MATURITY. implementations tested (max), never verified", ["data.harmonize.python.pandas", "data.construct.python.pandas"].every((id) => JSON.parse(readFileSync(join(root, "domains/economics/capabilities/data." + (id.includes("harmonize") ? "harmonize" : "construct") + ".json"), "utf8")).implementations.find((i) => i.id === id).verification_status === "tested") && man.maturity.max_in_phase3 === "tested" && man.maturity.never === "verified");
}
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);