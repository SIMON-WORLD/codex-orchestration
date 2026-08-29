#!/usr/bin/env node
// IV card 2SLS -> artifact bundle builder.
// Maps the accepted linearmodels IV2SLS output (real estimator output) into model_registry/estimates/diagnostics/
// replication_stamp/artifact_manifest. Only deterministic adapter work: CI/p are taken from the actual estimator
// output (run_python captures tstats/pvalues/conf_int). No new estimand, no recomputation of scientific results.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashCanonicalJsonFile, hashTextFile, CANONICAL_HASH_MODE, CANONICAL_TEXT_HASH_MODE } from "../../../../core/artifact_hash.mjs";
import { buildReplicationStamp } from "../../../../core/build_replication_stamp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const IV = join(ROOT, "domains/economics/benchmarks/iv");
const CSV = join(IV, "card.csv");
const PYRES = join(IV, "results/python.json");

function write(path, obj) { writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8"); }

export function buildIvBundle(bundleDir) {
  rmSync(bundleDir, { recursive: true, force: true }); mkdirSync(bundleDir, { recursive: true });
  copyFileSync(CSV, join(bundleDir, "card.csv"));
  const py = JSON.parse(readFileSync(PYRES, "utf8"));
  const n = py.n;
  const createdAt = "2026-08-29T00:00:00Z";
  const terms = Object.keys(py.coefficients);
  const csvHash = hashTextFile(CSV);

  const dataManifest = { artifact_id: "DATASET_CARD", artifact_type: "data_manifest", schema_version: "1.0", producer_role: "data", producer_task_id: "task_data_card", created_at: createdAt, inputs: [], dataset_id: "CARD_NLSYM_3010", data_path: "card.csv", observation_count: n, variable_count: 34, dataset_hash_mode: CANONICAL_TEXT_HASH_MODE, dataset_sha256: csvHash };
  const variableDictionary = { artifact_id: "VARDICT_CARD", artifact_type: "variable_dictionary", schema_version: "1.0", producer_role: "data", producer_task_id: "task_data_card", created_at: createdAt, inputs: [dataManifest.artifact_id], variables: [ { name: "lwage", definition: "log hourly wage (outcome)", type: "float" }, { name: "educ", definition: "years of education (endogenous)", type: "float" }, { name: "nearc4", definition: "indicator: grew up near a 4-year college (excluded instrument)", type: "integer" }, { name: "exper", definition: "labor market experience", type: "float" }, { name: "black", definition: "black indicator", type: "integer" }, { name: "smsa", definition: "lives in SMSA (urban)", type: "integer" }, { name: "south", definition: "lives in South", type: "integer" } ] };
  const sampleFlow = { artifact_id: "SAMPLEFLOW_CARD", artifact_type: "sample_flow", schema_version: "1.0", producer_role: "data", producer_task_id: "task_data_card", created_at: createdAt, inputs: [dataManifest.artifact_id], steps: [ { step_id: "STEP_FROZEN", description: "load frozen card.csv (complete sample)", n_before: n, n_after: n, n_removed: 0, reason: "no drops" } ] };
  const descriptiveFacts = { artifact_id: "DESCFACTS_CARD", artifact_type: "descriptive_facts", schema_version: "1.0", producer_role: "data", producer_task_id: "task_data_card", created_at: createdAt, inputs: [dataManifest.artifact_id], facts: [ { fact_id: "FACT_CARD_N", name: "sample_size", value: n, unit: "observations", sample_id: "CARD_NLSYM_3010", source_data_ref: "card.csv", computation_ref: "data_manifest.observation_count" } ] };

  const modelRegistry = { artifact_id: "MODELREG_IV", artifact_type: "model_registry", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_emp_card", created_at: createdAt, inputs: [dataManifest.artifact_id], models: [ { model_id: "MODEL_IV", capability_id: "economics.causal.iv", implementation_id: "causal.iv.python.linearmodels", runtime: "python", runtime_instance: "python.codex", sample_id: "CARD_NLSYM_3010", outcome: "lwage", treatment: ["educ"], specification: "lwage ~ 1 + exper + expersq + black + smsa + south + [educ ~ nearc4]", fixed_effects: [], vcov_spec: "homoskedastic (unadjusted)", clustering: "none", n, code_ref: "domains/economics/benchmarks/iv/runners/run_python.py", data_ref: "card.csv", result_ref: "ESTIMATES_IV" } ] };

  const diag = py.diag || {};
  const estimates = terms.map((term) => {
    const est = py.coefficients[term];
    const se = py.std_errors[term];
    const lo = diag.ci_lower?.[term]; const hi = diag.ci_upper?.[term]; const p = diag.pvalues?.[term];
    return { estimate_id: "EST_IV_" + term.toUpperCase(), model_id: "MODEL_IV", term, estimate: est, std_error: se, ci_lower: lo, ci_upper: hi, p_value: p, n };
  });
  const estimatesArtifact = { artifact_id: "ESTIMATES_IV", artifact_type: "estimates", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_emp_card", created_at: createdAt, inputs: [modelRegistry.artifact_id], estimates };

  const diagnostics = { artifact_id: "DIAGNOSTICS_IV", artifact_type: "diagnostics", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_emp_card", created_at: createdAt, inputs: [modelRegistry.artifact_id], diagnostics: [
    { diagnostic_id: "DIAG_IV_COV", model_id: "MODEL_IV", name: "covariance", value: py.inference_configuration.covariance, method: "linearmodels IV2SLS cov_type", code_ref: "domains/economics/benchmarks/iv/runners/run_python.py", result_ref: "results/python.json" },
    { diagnostic_id: "DIAG_IV_FS", model_id: "MODEL_IV", name: "first_stage_diagnostic", value: (py.diag && py.diag.first_stage && py.diag.first_stage.note) || "not exposed", method: "linearmodels first_stage", code_ref: "domains/economics/benchmarks/iv/runners/run_python.py", result_ref: "results/python.json" },
    { diagnostic_id: "DIAG_IV_OVERID", model_id: "MODEL_IV", name: "overid_sargan", value: "invalid_exactly_identified", method: "linearmodels IV2SLS", code_ref: "domains/economics/benchmarks/iv/runners/run_python.py", result_ref: "results/python.json" },
    { diagnostic_id: "DIAG_IV_CROSSENGINE", model_id: "MODEL_IV", name: "cross_engine_comparison", value: { python_educ: py.coefficients.educ, stata_educ: JSON.parse(readFileSync(join(IV, "results/stata.json"), "utf8")).coefficients.educ, note: "coef/SE/N match under homoskedastic 2SLS; weak-id/underid/AR/S are ivreg2-native / linearmodels does not expose them" }, method: "comparator", code_ref: "domains/economics/benchmarks/iv/comparator.mjs", result_ref: "results/stata.json" },
  ] };

  write(join(bundleDir, "data_manifest.json"), dataManifest);
  write(join(bundleDir, "variable_dictionary.json"), variableDictionary);
  write(join(bundleDir, "sample_flow.json"), sampleFlow);
  write(join(bundleDir, "descriptive_facts.json"), descriptiveFacts);
  write(join(bundleDir, "model_registry.json"), modelRegistry);
  write(join(bundleDir, "estimates.json"), estimatesArtifact);
  write(join(bundleDir, "diagnostics.json"), diagnostics);

  const sourceHashes = { model_registry: hashCanonicalJsonFile(join(bundleDir, "model_registry.json")), estimates: hashCanonicalJsonFile(join(bundleDir, "estimates.json")), diagnostics: hashCanonicalJsonFile(join(bundleDir, "diagnostics.json")) };
  write(join(bundleDir, "replication_stamp.json"), buildReplicationStamp(modelRegistry.models, estimatesArtifact.estimates, sourceHashes));
  write(join(bundleDir, "artifact_manifest.json"), { schema_version: "1.0", artifacts: ["data_manifest.json","variable_dictionary.json","sample_flow.json","descriptive_facts.json","model_registry.json","estimates.json","diagnostics.json","replication_stamp.json"].map((p) => ({ path: p, hash_mode: CANONICAL_HASH_MODE, sha256: hashCanonicalJsonFile(join(bundleDir, p)) })) });
  write(join(bundleDir, "multiple_testing.json"), { artifact_id: "MT_IV", artifact_type: "multiple_testing", schema_version: "1.0", producer_role: "review", producer_task_id: "task_review_iv", families: [] });

  return { csvHash, n, estimates };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const bd = process.argv.indexOf("--out") >= 0 ? process.argv[process.argv.indexOf("--out") + 1] : join(ROOT, "role-team-out/iv_bundle");
  const info = buildIvBundle(bd);
  console.log(JSON.stringify({ bundleDir: bd, dataset_sha256: info.csvHash, n: info.n, estimate_ids: info.estimates.map((e) => e.estimate_id) }, null, 2));
}
