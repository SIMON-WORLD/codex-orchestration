#!/usr/bin/env node
// Phase-3 M4 - Data-prep E2E closure runner (Domain-level).
// Proves: Source variant -> Harmonize -> Construct -> Validation -> Data Acceptance -> Empirical gate.
// Real E2E uses the frozen Phase-3 Grunfeld prep benchmark. The empirical estimator is the existing
// panel_fe runner; its coefficients must match the frozen canonical result within tolerance.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveAll, loadRegistry } from "../../../core/resolve_capabilities.mjs";
import { evaluateStudyDesign } from "../evaluate_study_design.mjs";
import { validateStudyDesign } from "../validate_study_design.mjs";
import { runHarmonize } from "../data/run_harmonize.mjs";
import { runConstruct } from "../data/run_construct.mjs";
import { canonicalHarmonizePlanHash } from "../data/validate_harmonize_plan.mjs";
import { canonicalConstructPlanHash } from "../data/validate_construct_plan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const PY = join(ROOT, "role-team-out/p7-venv/Scripts/python.exe");
const shaBuf = (b) => createHash("sha256").update(b).digest("hex");
const shaFile = (p) => shaBuf(readFileSync(p));
const shaTextLf = (p) => shaBuf(Buffer.from(readFileSync(p, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n"), "utf8"));
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
function arg(name, def) { const i = process.argv.indexOf("--" + name); return i >= 0 ? process.argv[i + 1] : def; }
function resolvePath(p) { return isAbsolute(p) ? p : join(ROOT, p); }
function probeEnv() {
  const r = { node: { available: false, known: true, version: null }, python: { available: false, known: true, version: null }, stata: { available: false, known: true, version: null } };
  let o = spawnSync("node", ["--version"], { encoding: "utf8" }); if (o.status === 0) r.node = { available: true, known: true, version: (o.stdout || "").trim().replace(/^v/, "") };
  o = spawnSync(PY, ["-c", "import pandas,linearmodels,sys;print(sys.version.split()[0]);print(pandas.__version__);print(linearmodels.__version__)"], { encoding: "utf8" });
  if (o.status === 0) { const L = (o.stdout || "").trim().split(/\r?\n/); r.python = { available: true, known: true, version: L[0], packages: { pandas: { available: true, known: true, version: L[1] }, linearmodels: { available: true, known: true, version: L[2] } } }; }
  const stata = "D:/Software/Stata/StataNow19/StataMP-64.exe"; r.stata = { available: existsSync(stata), known: true, version: "19" };
  return { runtimes: r };
}

const TOL = 1e-4;

export function buildDataAcceptance(study, chain) {
  return {
    study_id: study.study_id, run_id: shaTextLf(join(chain.outDir, "construct_execution_log.json")).slice(0, 16),
    source_variant_sha256: chain.source_variant_sha256, canonical_grunfeld_sha256_lf: chain.canonical_lf_sha,
    harmonize: { plan_hash: canonicalHarmonizePlanHash(chain.hPlan), harmonized_sha256: chain.harmonized_sha, execution_log_sha256: chain.harmonize_evidence },
    construct: { plan_hash: canonicalConstructPlanHash(chain.cPlan), constructed_sha256: chain.constructed_sha, execution_log_sha256: chain.construct_evidence },
    validation: { result_sha256: chain.validation_sha, rules_id: chain.rules_id, rules_sha256: chain.rules_sha, summary: chain.validation_summary },
    accepted: true, timestamp: null,
  };
}

export function runPhase3(studyPath, opts = {}) {
  const study = readJson(resolvePath(studyPath));
  const registry = loadRegistry(join(ROOT, "domains/economics/capabilities"));
  const contractErrors = validateStudyDesign(study);
  const directive = evaluateStudyDesign(study, registry);
  const envObj = opts.env || probeEnv();
  const ctx = { mode: study.execution_context.mode, allow_experimental: !!study.execution_context.allow_experimental, preferred_runtimes: study.execution_context.preferred_runtimes || [], approved_overrides: [] };
  const preflight = resolveAll(study, registry, envObj, ctx);
  const dataIds = study.selected_capabilities.data || []; const empIds = study.selected_capabilities.empirical || [];
  const runTag = opts.tag || "run1";
  const outDir = join(ROOT, "domains/economics/benchmarks/data_prep/results/e2e_" + runTag);
  mkdirSync(outDir, { recursive: true });
  const prepDir = join(ROOT, "domains/economics/benchmarks/data_prep");
  const hurt = runHarmonize(join(prepDir, "real_harmonize.plan.json"), { inDir: join(prepDir, "sources"), outDir });
  if (!hurt.ok) throw new Error("harmonize failed: " + hurt.error);
  const hLogFile = join(outDir, "harmonize_execution_log.json");
  const cst = runConstruct(join(prepDir, "real_construct.plan.json"), { inDir: outDir, outDir });
  if (!cst.ok) throw new Error("construct failed: " + cst.error);
  const cLogFile = join(outDir, "construct_execution_log.json");
  const constructedCsv = join(outDir, "constructed.csv");
  const rulesPath = resolvePath(study.prep.validation_rules || "domains/economics/benchmarks/data_validation/rules.json");
  const valOut = join(outDir, "data_validation.json");
  const rules = readJson(rulesPath);
  const vres = spawnSync(PY, [join(ROOT, "domains/economics/benchmarks/data_validation/runners/run_python.py"), "--csv", constructedCsv, "--rules", rulesPath, "--out", valOut], { encoding: "utf8", timeout: 120000, windowsHide: true });
  if (vres.status !== 0) throw new Error("data validation failed: " + (vres.stderr || "").slice(0, 400));
  const val = readJson(valOut);
  const acc = buildDataAcceptance(study, {
    outDir, hPlan: readJson(join(prepDir, "real_harmonize.plan.json")), cPlan: readJson(join(prepDir, "real_construct.plan.json")),
    source_variant_sha256: shaFile(join(prepDir, "sources/grunfeld_variant.csv")), canonical_lf_sha: shaTextLf(join(ROOT, "domains/economics/benchmarks/panel_fe/grunfeld.csv")),
    harmonized_sha: hurt.execution_log.output_sha256, harmonize_evidence: shaTextLf(hLogFile),
    constructed_sha: cst.execution_log.output_sha256, construct_evidence: shaTextLf(cLogFile),
    validation_sha: shaTextLf(valOut), rules_id: rules.rules_id, rules_sha: shaTextLf(rulesPath), validation_summary: val.summary,
  });
  writeFileSync(join(outDir, "data_acceptance.json"), JSON.stringify(acc, null, 2) + "\n", "utf8");
  const chainFiles = {
    source_variant: join(prepDir, "sources/grunfeld_variant.csv"),
    harmonized_csv: join(outDir, "harmonized.csv"),
    harmonize_plan: join(prepDir, "real_harmonize.plan.json"),
    harmonize_log: hLogFile,
    constructed_csv: join(outDir, "constructed.csv"),
    construct_plan: join(prepDir, "real_construct.plan.json"),
    construct_log: cLogFile,
    validation: valOut,
    rules: rulesPath,
  };
  const bindingErrs = verifyAcceptance(acc, chainFiles);
  const gate = acc.accepted === true && val.summary.fail === 0 && acc.validation.result_sha256 === shaTextLf(valOut) && bindingErrs.length === 0;
  const pfOut = join(outDir, "panel_fe.json");
  if (gate) {
    const pf = spawnSync(PY, [join(ROOT, "domains/economics/benchmarks/panel_fe/runners/run_python.py"), "--csv", constructedCsv, "--benchmark-id", "phase3_e2e_panel_fe", "--out", pfOut], { encoding: "utf8", timeout: 180000, windowsHide: true });
    if (pf.status === 0) writeFileSync(pfOut, pf.stdout, "utf8");
  }
  let empirical = null;
  if (gate && existsSync(pfOut)) { const pf = readJson(pfOut); const frozen = readJson(resolvePath(study.prep.frozen_empirical_reference || "domains/economics/benchmarks/panel_fe/results/python.json")); const coeffOk = Object.keys(frozen.coefficients).every((k) => Math.abs(pf.coefficients[k] - frozen.coefficients[k]) < TOL); empirical = { implementation_id: pf.implementation_id, n: pf.n, coefficients: pf.coefficients, matches_frozen_within_tol: coeffOk, canonical_coefficients: frozen.coefficients, frozen_impl: frozen.implementation_id }; }
  const record = { study_id: study.study_id, run_tag: runTag, mode: study.execution_context.mode, role_chain: { data: ["harmonize", "construct", "validation"], empirical: ["panel_fe"] }, director: directive.status, contract_valid: contractErrors.length === 0, preflight: { overall: preflight.overall, data_resolutions: Object.fromEntries(dataIds.map((c) => [c, preflight.capabilities[c]?.resolution])), empirical_resolutions: Object.fromEntries(empIds.map((c) => [c, preflight.capabilities[c]?.resolution])) }, data_acceptance: acc, empirical_gate: gate, binding_errors: bindingErrs, empirical, hashes: { harmonize_plan: canonicalHarmonizePlanHash(readJson(join(prepDir, "real_harmonize.plan.json"))), construct_plan: canonicalConstructPlanHash(readJson(join(prepDir, "real_construct.plan.json"))), harmonized: acc.harmonize.harmonized_sha256, constructed: acc.construct.constructed_sha256, validation: acc.validation.result_sha256 }, overall: gate && empirical?.matches_frozen_within_tol ? "completed" : gate ? "empirical_completed" : "blocked_empirical", out_dir: outDir };
  writeFileSync(join(outDir, "execution_record.json"), JSON.stringify(record, null, 2) + "\n", "utf8");
  return record;
}

export function verifyAcceptance(acc, chainFiles) {
  const errs = [];
  if (chainFiles.source_variant && shaFile(chainFiles.source_variant) !== acc.source_variant_sha256) errs.push("source_variant_sha256_mismatch");
  if (chainFiles.harmonized_csv && shaFile(chainFiles.harmonized_csv) !== acc.harmonize.harmonized_sha256) errs.push("harmonized_sha256_mismatch");
  if (chainFiles.harmonize_plan && canonicalHarmonizePlanHash(readJson(chainFiles.harmonize_plan)) !== acc.harmonize.plan_hash) errs.push("harmonize_plan_hash_mismatch");
  if (chainFiles.harmonize_log && shaTextLf(chainFiles.harmonize_log) !== acc.harmonize.execution_log_sha256) errs.push("harmonize_evidence_mismatch");
  if (chainFiles.constructed_csv && shaFile(chainFiles.constructed_csv) !== acc.construct.constructed_sha256) errs.push("constructed_sha256_mismatch");
  if (chainFiles.construct_plan && canonicalConstructPlanHash(readJson(chainFiles.construct_plan)) !== acc.construct.plan_hash) errs.push("construct_plan_hash_mismatch");
  if (chainFiles.construct_log && shaTextLf(chainFiles.construct_log) !== acc.construct.execution_log_sha256) errs.push("construct_evidence_mismatch");
  if (chainFiles.validation && shaTextLf(chainFiles.validation) !== acc.validation.result_sha256) errs.push("validation_result_mismatch");
  if (chainFiles.rules && shaTextLf(chainFiles.rules) !== acc.validation.rules_sha256) errs.push("rules_sha256_mismatch");
  return errs;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const studyPath = arg("study", "domains/economics/study.phase3.grunfeld.json");
  const tag = arg("tag", "run1");
  const r = runPhase3(studyPath, { tag });
  console.log(JSON.stringify({ overall: r.overall, empirical_gate: r.empirical_gate, empirical: r.empirical, data_acceptance: r.data_acceptance, out_dir: r.out_dir }, null, 2));
  process.exit(r.overall === "completed" ? 0 : 1);
}