#!/usr/bin/env node
// Real-data Grunfeld multiple-testing benchmark: artifact/provenance bundle builder.
//
// TARGET ARCHITECTURE:
//   accepted frozen Grunfeld scientific result (panel_fe/reghdfe)
//   -> actual benchmarked implementation runner (multcomp.python.statsmodels)
//   -> machine-readable implementation result (results/python.json)
//   -> artifact-construction adapter   [THIS FILE IS THE ADAPTER]
//   -> multiple_testing artifact
//   -> provenance validation
//
// The adapter does NOT implement Holm, Benjamini-Hochberg, or a Student-t distribution.
// It maps the chosen benchmarked implementation result (results/python.json) into the artifact bundle,
// and only *verifies* source identity / provenance against the accepted frozen reghdfe result
// (coefficient, std error, N, residual df, dataset checksum).
//
// R (multcomp.r.base / results/r.json) remains the independent definition-compatible cross-engine check.
//
// The benchmark family is an ENGINEERING VERIFICATION family (the two coefficient significance tests on the
// frozen Grunfeld two-way FE result). It is NOT automatically a substantive research-family recommendation.
import { copyFileSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashCanonicalJsonFile, hashTextFile, CANONICAL_HASH_MODE, CANONICAL_TEXT_HASH_MODE } from "../../../../core/artifact_hash.mjs";
import { buildReplicationStamp } from "../../../../core/build_replication_stamp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const PANEL_FE = join(ROOT, "domains/economics/benchmarks/panel_fe");
const GRUNFELD_CSV = join(PANEL_FE, "grunfeld.csv");
const REGHDFE_RESULT = join(PANEL_FE, "results/stata.json");
const PY_RESULT = join(HERE, "results/python.json");

function approx(a, b, relTol = 1e-9, absTol = 1e-12) { return Math.abs(a - b) <= absTol || Math.abs(a - b) <= relTol * Math.max(Math.abs(a), Math.abs(b)); }
function write(path, obj) { writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8"); }

export function buildMultcompBundle(bundleDir, pyResultPath = PY_RESULT) {
  rmSync(bundleDir, { recursive: true, force: true }); mkdirSync(bundleDir, { recursive: true });
  copyFileSync(GRUNFELD_CSV, join(bundleDir, "grunfeld.csv"));

  const result = JSON.parse(readFileSync(REGHDFE_RESULT, "utf8"));
  const py = JSON.parse(readFileSync(pyResultPath, "utf8"));
  const coefs = result.coefficients, ses = result.std_errors;
  const n = result.n;
  const dfR = Number(result.inference_configuration?.stata_dof_evidence?.df_r);
  if (!Number.isFinite(dfR) || dfR <= 0) throw new Error("reghdfe residual df (df_r) unavailable");

  const terms = ["value", "capital"];
  const estimateIds = terms.map((t) => `EST_GRUNFELD_${t.toUpperCase()}`);

  // ---- Source-identity verification (adapter reads the frozen result only to verify provenance) ----
  for (const t of terms) {
    const eid = `EST_GRUNFELD_${t.toUpperCase()}`;
    if (!approx(py.estimates.estimate[eid], coefs[t])) throw new Error(`source-identity mismatch: estimate ${eid} != reghdfe ${t}`);
    if (!approx(py.estimates.std_error[eid], ses[t])) throw new Error(`source-identity mismatch: std_error ${eid} != reghdfe ${t}`);
  }
  if (Number(py.source?.residual_df) !== dfR) throw new Error(`source-identity mismatch: residual_df python(${py.source?.residual_df}) != reghdfe(${dfR})`);
  if (py.n !== n) throw new Error(`source-identity mismatch: n python(${py.n}) != reghdfe(${n})`);

  // ---- Map the benchmarked implementation result into the artifact bundle ----
  const estimates = estimateIds.map((eid) => {
    const term = eid.replace("EST_GRUNFELD_", "").toLowerCase();
    return {
      estimate_id: eid,
      model_id: "MODEL_GRUNFELD",
      term,
      estimate: py.estimates.estimate[eid],
      std_error: py.estimates.std_error[eid],
      ci_lower: py.estimates.ci_lower[eid],
      ci_upper: py.estimates.ci_upper[eid],
      p_value: py.estimates.raw_p[eid],
      n,
      multiple_testing_family_ids: ["FAM_GRUNFELD_MHT_HOLM", "FAM_GRUNFELD_MHT_BH"],
    };
  });

  const mkFamily = (familyId, method, key) => ({
    family_id: familyId,
    method,
    member_estimate_ids: estimateIds,
    adjusted_results: estimateIds.map((eid) => ({ estimate_id: eid, raw_p_value: py.estimates.raw_p[eid], adjusted_p_value: py.adjusted[key][eid] })),
  });
  const multipleTesting = {
    artifact_id: "MT_GRUNFELD", artifact_type: "multiple_testing", schema_version: "1.0",
    producer_role: "review", producer_task_id: "task_review_grunfeld", created_at: "2026-08-29T00:00:00Z",
    families: [
      mkFamily("FAM_GRUNFELD_MHT_HOLM", "holm", "holm"),
      mkFamily("FAM_GRUNFELD_MHT_BH", "benjamini_hochberg", "benjamini_hochberg"),
    ],
  };

  const datasetSha = hashTextFile(GRUNFELD_CSV); // text_file_sha256_lf
  const dataManifest = {
    artifact_id: "DATASET_GRUNFELD", artifact_type: "data_manifest", schema_version: "1.0",
    producer_role: "data", producer_task_id: "task_data_grunfeld", created_at: "2026-08-29T00:00:00Z",
    inputs: [], dataset_id: "GRUNFELD_1935_1954", data_path: "grunfeld.csv",
    observation_count: n, variable_count: 5,
    dataset_sha256: datasetSha, dataset_hash_mode: CANONICAL_TEXT_HASH_MODE,
    source_refs: [{ name: "Grunfeld", source: "R package plm dataset Grunfeld (public, 10 firms, 1935-1954)", url: "https://github.com/SIMON-WORLD/codex-orchestration/blob/main/domains/economics/benchmarks/panel_fe/grunfeld.csv" }],
  };
  const variableDictionary = {
    artifact_id: "VARDICT_GRUNFELD", artifact_type: "variable_dictionary", schema_version: "1.0",
    producer_role: "data", producer_task_id: "task_data_grunfeld", created_at: "2026-08-29T00:00:00Z",
    inputs: [dataManifest.artifact_id],
    variables: [
      { name: "firm", definition: "firm identifier (1-10)", type: "integer" },
      { name: "year", definition: "calendar year (1935-1954)", type: "integer" },
      { name: "invest", definition: "gross investment (outcome)", type: "float", unit: "million USD" },
      { name: "value", definition: "market value of the firm", type: "float", unit: "million USD" },
      { name: "capital", definition: "capital stock", type: "float", unit: "million USD" },
    ],
  };
  const sampleFlow = {
    artifact_id: "SAMPLEFLOW_GRUNFELD", artifact_type: "sample_flow", schema_version: "1.0",
    producer_role: "data", producer_task_id: "task_data_grunfeld", created_at: "2026-08-29T00:00:00Z",
    inputs: [dataManifest.artifact_id],
    steps: [{ step_id: "STEP_LOAD_FROZEN", description: "load frozen grunfeld.csv (complete balanced panel)", n_before: n, n_after: n, n_removed: 0, reason: "no drops" }],
  };
  const descriptiveFacts = {
    artifact_id: "DESCFACTS_GRUNFELD", artifact_type: "descriptive_facts", schema_version: "1.0",
    producer_role: "data", producer_task_id: "task_data_grunfeld", created_at: "2026-08-29T00:00:00Z",
    inputs: [dataManifest.artifact_id],
    facts: [
      { fact_id: "FACT_GRUNFELD_N", name: "sample_size", value: n, unit: "observations", sample_id: "GRUNFELD_1935_1954", source_data_ref: "grunfeld.csv", computation_ref: "data_manifest.observation_count" },
      { fact_id: "FACT_GRUNFELD_FIRMS", name: "firms", value: result.cluster_count, unit: "firms", sample_id: "GRUNFELD_1935_1954", source_data_ref: "grunfeld.csv", computation_ref: "reghdfe e(N_clust)" },
    ],
  };
  const modelRegistry = {
    artifact_id: "MODELREG_GRUNFELD", artifact_type: "model_registry", schema_version: "1.0",
    producer_role: "empirical", producer_task_id: "task_emp_grunfeld", created_at: "2026-08-29T00:00:00Z",
    inputs: [dataManifest.artifact_id],
    models: [{
      model_id: "MODEL_GRUNFELD", capability_id: "economics.regression.panel_fe", implementation_id: "panel.fe.stata.reghdfe",
      runtime: "stata", runtime_instance: "stata.reghdfe", sample_id: "GRUNFELD_1935_1954",
      outcome: "invest", treatment: ["value", "capital"],
      specification: "invest ~ value + capital + firm FE + year FE (cluster=firm)",
      fixed_effects: ["firm", "year"], vcov_spec: "one-way cluster=firm (aes_cluster)", clustering: "firm",
      n, code_ref: "domains/economics/benchmarks/panel_fe/runners/run_stata.do", data_ref: "grunfeld.csv", result_ref: "ESTIMATES_GRUNFELD",
    }],
  };
  const estimatesArtifact = { artifact_id: "ESTIMATES_GRUNFELD", artifact_type: "estimates", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_emp_grunfeld", created_at: "2026-08-29T00:00:00Z", inputs: [modelRegistry.artifact_id], estimates };
  const diagnostics = {
    artifact_id: "DIAGNOSTICS_GRUNFELD", artifact_type: "diagnostics", schema_version: "1.0",
    producer_role: "empirical", producer_task_id: "task_emp_grunfeld", created_at: "2026-08-29T00:00:00Z",
    inputs: [modelRegistry.artifact_id],
    diagnostics: [
      { diagnostic_id: "DIAG_GRUNFELD_CLUSTERS", model_id: "MODEL_GRUNFELD", name: "cluster_count", value: result.cluster_count, method: "reghdfe e(N_clust)", code_ref: "domains/economics/benchmarks/panel_fe/runners/run_stata.do", result_ref: "results/stata.json" },
      { diagnostic_id: "DIAG_GRUNFELD_RESID_DF", model_id: "MODEL_GRUNFELD", name: "residual_df", value: dfR, method: "reghdfe e(df_r)", code_ref: "domains/economics/benchmarks/panel_fe/runners/run_stata.do", result_ref: "results/stata.json" },
    ],
  };

  write(join(bundleDir, "data_manifest.json"), dataManifest);
  write(join(bundleDir, "variable_dictionary.json"), variableDictionary);
  write(join(bundleDir, "sample_flow.json"), sampleFlow);
  write(join(bundleDir, "descriptive_facts.json"), descriptiveFacts);
  write(join(bundleDir, "model_registry.json"), modelRegistry);
  write(join(bundleDir, "estimates.json"), estimatesArtifact);
  write(join(bundleDir, "diagnostics.json"), diagnostics);
  write(join(bundleDir, "multiple_testing.json"), multipleTesting);

  const sourceHashes = { model_registry: hashCanonicalJsonFile(join(bundleDir, "model_registry.json")), estimates: hashCanonicalJsonFile(join(bundleDir, "estimates.json")), diagnostics: hashCanonicalJsonFile(join(bundleDir, "diagnostics.json")) };
  write(join(bundleDir, "replication_stamp.json"), buildReplicationStamp(modelRegistry.models, estimatesArtifact.estimates, sourceHashes));

  const artifactManifest = {
    schema_version: "1.0",
    artifacts: ["data_manifest.json", "variable_dictionary.json", "sample_flow.json", "descriptive_facts.json", "model_registry.json", "estimates.json", "diagnostics.json", "multiple_testing.json", "replication_stamp.json"]
      .map((p) => ({ path: p, hash_mode: CANONICAL_HASH_MODE, sha256: hashCanonicalJsonFile(join(bundleDir, p)) })),
  };
  write(join(bundleDir, "artifact_manifest.json"), artifactManifest);

  return { datasetSha, dfR, estimates, multipleTesting, source: "results/python.json" };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const bd = process.argv.indexOf("--out") >= 0 ? process.argv[process.argv.indexOf("--out") + 1] : join(ROOT, "role-team-out/multcomp_bundle");
  const info = buildMultcompBundle(bd);
  console.log(JSON.stringify({ bundleDir: bd, datasetSha256: info.datasetSha, residual_df: info.dfR, source: info.source, estimates: info.estimates.map((e) => ({ estimate_id: e.estimate_id, term: e.term, estimate: e.estimate, std_error: e.std_error, p_value: e.p_value, n: e.n })) }, null, 2));
}

