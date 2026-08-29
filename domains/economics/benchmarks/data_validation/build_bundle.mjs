#!/usr/bin/env node
// Data Validation Pack v1 benchmark: artifact/provenance bundle builder.
//
// TARGET ARCHITECTURE:
//   frozen Grunfeld data (grunfeld.csv) + explicit declared rules (rules.json)
//   -> actual data-validation implementation runner (data.val.python.pandas -> results/python.json)
//   -> artifact-construction adapter   [THIS FILE IS THE ADAPTER]
//   -> diagnostics / descriptive_facts / data_manifest / variable_dictionary / sample_flow
//   -> provenance validation (core/validate_artifacts.mjs)
//
// The adapter does NOT implement any data-cleaning/repair logic and does NOT re-derive scientific estimates.
// The model_registry / estimates artifacts are the ACCEPTED frozen panel-FE scientific context for the same
// dataset, sourced from the machine-readable accepted real-data result (benchmarks/multcomp/results/python.json,
// which itself derives estimate/std_error/ci/p programmatically from the frozen reghdfe result).
// The data-validation checks are read verbatim from the chosen implementation result.
import { copyFileSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashCanonicalJsonFile, hashTextFile, CANONICAL_HASH_MODE, CANONICAL_TEXT_HASH_MODE } from "../../../../core/artifact_hash.mjs";
import { buildReplicationStamp } from "../../../../core/build_replication_stamp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const PANEL_FE = join(ROOT, "domains/economics/benchmarks/panel_fe");
const DV = join(ROOT, "domains/economics/benchmarks/data_validation");
const MULTCOMP = join(ROOT, "domains/economics/benchmarks/multcomp");
const GRUNFELD_CSV = join(PANEL_FE, "grunfeld.csv");
const REGHDFE_RESULT = join(PANEL_FE, "results/stata.json");
const MULTCOMP_PY = join(MULTCOMP, "results/python.json");
const DV_RULES = join(DV, "rules.json");
const DV_PY = join(DV, "results/python.json");

function write(path, obj) { writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8"); }

export function buildDataValidationBundle(bundleDir) {
  rmSync(bundleDir, { recursive: true, force: true }); mkdirSync(bundleDir, { recursive: true });
  copyFileSync(GRUNFELD_CSV, join(bundleDir, "grunfeld.csv"));

  const rules = JSON.parse(readFileSync(DV_RULES, "utf8"));
  const result = JSON.parse(readFileSync(REGHDFE_RESULT, "utf8"));
  const mtPy = JSON.parse(readFileSync(MULTCOMP_PY, "utf8"));
  const dvPy = JSON.parse(readFileSync(DV_PY, "utf8"));
  const n = result.n;
  const dfR = Number(result.inference_configuration?.stata_dof_evidence?.df_r);

  const datasetSha = hashTextFile(GRUNFELD_CSV);
  if (dvPy.dataset_checksum !== datasetSha) throw new Error("data-validation result checksum != frozen grunfeld.csv");
  if (dvPy.n !== n) throw new Error("data-validation result n != frozen reghdfe n");
  if (dvPy.summary.fail > 0) throw new Error("data-validation result reports failures on frozen clean dataset: " + JSON.stringify(dvPy.summary));

  const terms = ["value", "capital"];
  const estimateIds = terms.map((t) => `EST_GRUNFELD_${t.toUpperCase()}`);
  const estimates = estimateIds.map((eid) => ({
    estimate_id: eid,
    model_id: "MODEL_GRUNFELD",
    term: eid.replace("EST_GRUNFELD_", "").toLowerCase(),
    estimate: mtPy.estimates.estimate[eid],
    std_error: mtPy.estimates.std_error[eid],
    ci_lower: mtPy.estimates.ci_lower[eid],
    ci_upper: mtPy.estimates.ci_upper[eid],
    p_value: mtPy.estimates.raw_p[eid],
    n,
  }));

  const dataManifest = {
    artifact_id: "DATASET_GRUNFELD", artifact_type: "data_manifest", schema_version: "1.0",
    producer_role: "data", producer_task_id: "task_data_grunfeld", created_at: "2026-08-29T00:00:00Z",
    inputs: [], dataset_id: rules.dataset_id, data_path: "grunfeld.csv",
    observation_count: n, variable_count: rules.variables.length,
    dataset_sha256: datasetSha, dataset_hash_mode: CANONICAL_TEXT_HASH_MODE,
    source_refs: [{ name: "Grunfeld", source: "R package plm dataset Grunfeld (public, 10 firms, 1935-1954)", url: "https://github.com/SIMON-WORLD/codex-orchestration/blob/main/domains/economics/benchmarks/panel_fe/grunfeld.csv" }],
  };
  const variableDictionary = {
    artifact_id: "VARDICT_GRUNFELD", artifact_type: "variable_dictionary", schema_version: "1.0",
    producer_role: "data", producer_task_id: "task_data_grunfeld", created_at: "2026-08-29T00:00:00Z",
    inputs: [dataManifest.artifact_id],
    variables: rules.variables.map((v) => ({ name: v.name, definition: v.definition, type: v.type, unit: v.unit })),
  };
  const sampleFlow = {
    artifact_id: "SAMPLEFLOW_GRUNFELD", artifact_type: "sample_flow", schema_version: "1.0",
    producer_role: "data", producer_task_id: "task_data_grunfeld", created_at: "2026-08-29T00:00:00Z",
    inputs: [dataManifest.artifact_id],
    steps: rules.sample_flow_steps,
  };
  const descriptiveFacts = {
    artifact_id: "DESCFACTS_GRUNFELD", artifact_type: "descriptive_facts", schema_version: "1.0",
    producer_role: "data", producer_task_id: "task_data_grunfeld", created_at: "2026-08-29T00:00:00Z",
    inputs: [dataManifest.artifact_id],
    facts: [
      { fact_id: "FACT_GRUNFELD_N", name: "sample_size", value: n, unit: "observations", sample_id: rules.dataset_id, source_data_ref: "grunfeld.csv", computation_ref: "data_manifest.observation_count" },
      { fact_id: "FACT_GRUNFELD_FIRMS", name: "firms", value: result.cluster_count, unit: "firms", sample_id: rules.dataset_id, source_data_ref: "grunfeld.csv", computation_ref: "reghdfe e(N_clust)" },
      { fact_id: "FACT_GRUNFELD_MISSING", name: "selected-variable missing observations", value: Object.fromEntries(Object.entries(dvPy.facts.missingness || {}).map(([k, v]) => [k, v.n_missing])), unit: "count", sample_id: rules.dataset_id, source_data_ref: "grunfeld.csv", computation_ref: "data-validation runner" },
    ],
  };
  const modelRegistry = {
    artifact_id: "MODELREG_GRUNFELD", artifact_type: "model_registry", schema_version: "1.0",
    producer_role: "empirical", producer_task_id: "task_emp_grunfeld", created_at: "2026-08-29T00:00:00Z",
    inputs: [dataManifest.artifact_id],
    models: [{
      model_id: "MODEL_GRUNFELD", capability_id: "economics.regression.panel_fe", implementation_id: "panel.fe.stata.reghdfe",
      runtime: "stata", runtime_instance: "stata.reghdfe", sample_id: rules.dataset_id,
      outcome: "invest", treatment: ["value", "capital"],
      specification: "invest ~ value + capital + firm FE + year FE (cluster=firm)",
      fixed_effects: ["firm", "year"], vcov_spec: "one-way cluster=firm (aes_cluster)", clustering: "firm",
      n, code_ref: "domains/economics/benchmarks/panel_fe/runners/run_stata.do", data_ref: "grunfeld.csv", result_ref: "ESTIMATES_GRUNFELD",
    }],
  };
  const estimatesArtifact = { artifact_id: "ESTIMATES_GRUNFELD", artifact_type: "estimates", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_emp_grunfeld", created_at: "2026-08-29T00:00:00Z", inputs: [modelRegistry.artifact_id], estimates };
  // data-validation checks as diagnostics (map-only from the chosen implementation result)
  const diagnostics = {
    artifact_id: "DIAGNOSTICS_GRUNFELD", artifact_type: "diagnostics", schema_version: "1.0",
    producer_role: "data", producer_task_id: "task_data_grunfeld", created_at: "2026-08-29T00:00:00Z",
    inputs: [dataManifest.artifact_id],
    diagnostics: dvPy.checks.map((c) => ({
      diagnostic_id: "DIAG_DV_" + c.check_id,
      name: c.name,
      value: c.value,
      method: "data-validation structural check",
      status: c.status,
      code_ref: "domains/economics/benchmarks/data_validation/runners/run_python.py",
      result_ref: "results/python.json",
    })),
  };

  write(join(bundleDir, "data_manifest.json"), dataManifest);
  write(join(bundleDir, "variable_dictionary.json"), variableDictionary);
  write(join(bundleDir, "sample_flow.json"), sampleFlow);
  write(join(bundleDir, "descriptive_facts.json"), descriptiveFacts);
  write(join(bundleDir, "model_registry.json"), modelRegistry);
  write(join(bundleDir, "estimates.json"), estimatesArtifact);
  write(join(bundleDir, "diagnostics.json"), diagnostics);

  const sourceHashes = { model_registry: hashCanonicalJsonFile(join(bundleDir, "model_registry.json")), estimates: hashCanonicalJsonFile(join(bundleDir, "estimates.json")), diagnostics: hashCanonicalJsonFile(join(bundleDir, "diagnostics.json")) };
  write(join(bundleDir, "replication_stamp.json"), buildReplicationStamp(modelRegistry.models, estimatesArtifact.estimates, sourceHashes));

  const artifactManifest = {
    schema_version: "1.0",
    artifacts: ["data_manifest.json", "variable_dictionary.json", "sample_flow.json", "descriptive_facts.json", "model_registry.json", "estimates.json", "diagnostics.json", "replication_stamp.json"]
      .map((p) => ({ path: p, hash_mode: CANONICAL_HASH_MODE, sha256: hashCanonicalJsonFile(join(bundleDir, p)) })),
  };
  write(join(bundleDir, "artifact_manifest.json"), artifactManifest);

  return { datasetSha, n, dfR, checks: dvPy.checks, summary: dvPy.summary, estimates };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const bd = process.argv.indexOf("--out") >= 0 ? process.argv[process.argv.indexOf("--out") + 1] : join(ROOT, "role-team-out/data_validation_bundle");
  const info = buildDataValidationBundle(bd);
  console.log(JSON.stringify({ bundleDir: bd, datasetSha256: info.datasetSha, n: info.n, residual_df: info.dfR, summary: info.summary, check_ids: info.checks.map((c) => c.check_id) }, null, 2));
}
