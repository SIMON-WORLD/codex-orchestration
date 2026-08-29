#!/usr/bin/env node
// Real-data Grunfeld presentation benchmark: artifact/provenance bundle builder.
// Reads the accepted panel-FE reghdfe result + frozen grunfeld.csv programmatically and builds a
// complete valid artifact bundle (data_manifest .. presentation_manifest) that passes validateArtifacts.
//
// Artifact-construction adapter (documented explicitly):
//   - scientific values (term / estimate / std_error / n) come from panel_fe/results/stata.json (canonical reghdfe).
//   - p_value: two-sided finite-df Student-t p from t = coef/se with df = stored reghdfe residual df (df_r).
//   - ci_lower/ci_upper: coef +/- qt(0.975, df)*se (same t inference). CI is a deterministic adapter output
//     required by the estimates contract; it is NOT new estimator evidence and NOT renderer logic.
import { copyFileSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashCanonicalJsonFile, hashTextFile, CANONICAL_HASH_MODE } from "../../../../../core/artifact_hash.mjs";
import { buildReplicationStamp } from "../../../../../core/build_replication_stamp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..", ".."); // repo root
const PANEL_FE = join(ROOT, "domains/economics/benchmarks/panel_fe");
const GRUNFELD_CSV = join(PANEL_FE, "grunfeld.csv");
const REGHDFE_RESULT = join(PANEL_FE, "results/stata.json");

// ---- Student-t (deterministic, used only by the artifact-construction adapter) ----
function gammln(xx) {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = xx, y = xx;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
function betacf(a, b, x) {
  const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d; let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = -((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; const del = d * c; h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}
function betai(a, b, x) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(gammln(a + b) - gammln(a) - gammln(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}
function studentTCdf(t, df) {
  const x = df / (df + t * t);
  const ib = betai(df / 2, 0.5, x);
  return t >= 0 ? 1 - 0.5 * ib : 0.5 * ib;
}
function studentTTwoSidedP(t, df) { const c = studentTCdf(Math.abs(t), df); return 2 * (1 - c); }
function studentTQuantile(p, df) { let lo = 0, hi = 100; for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (studentTCdf(mid, df) < p) lo = mid; else hi = mid; } return (lo + hi) / 2; }

function write(path, obj) { writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8"); }

export function buildGrunfeldBundle(bundleDir) {
  rmSync(bundleDir, { recursive: true, force: true }); mkdirSync(bundleDir, { recursive: true });
  copyFileSync(GRUNFELD_CSV, join(bundleDir, "grunfeld.csv"));

  const result = JSON.parse(readFileSync(REGHDFE_RESULT, "utf8"));
  const coefs = result.coefficients, ses = result.std_errors;
  const n = result.n;
  const dfR = Number(result.inference_configuration?.stata_dof_evidence?.df_r);
  if (!Number.isFinite(dfR) || dfR <= 0) throw new Error("reghdfe residual df (df_r) unavailable");
  const tcrit = studentTQuantile(0.975, dfR);

  const terms = ["value", "capital"];
  const estimates = terms.map((term, i) => {
    const est = coefs[term], se = ses[term];
    const t = est / se;
    const p = studentTTwoSidedP(t, dfR);
    return {
      estimate_id: `EST_GRUNFELD_${term.toUpperCase()}`,
      model_id: "MODEL_GRUNFELD",
      term, estimate: est, std_error: se,
      ci_lower: est - tcrit * se, ci_upper: est + tcrit * se,
      p_value: p, n,
    };
  });

  const datasetSha = hashTextFile(GRUNFELD_CSV); // text_file_sha256_lf

  const dataManifest = {
    artifact_id: "DATASET_GRUNFELD", artifact_type: "data_manifest", schema_version: "1.0",
    producer_role: "data", producer_task_id: "task_data_grunfeld", created_at: "2026-08-29T00:00:00Z",
    inputs: [], dataset_id: "GRUNFELD_1935_1954", data_path: "grunfeld.csv",
    observation_count: n, variable_count: 5,
    dataset_sha256: datasetSha, dataset_hash_mode: "text_file_sha256_lf",
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
      model_id: "MODEL_GRUNFELD", capability_id: "economics.regression.panel_fe",
      implementation_id: result.implementation_id, runtime: "stata", runtime_instance: "stata.19",
      sample_id: "GRUNFELD_1935_1954", outcome: "invest", treatment: terms,
      specification: "invest_it = b1*value_it + b2*capital_it + firm FE + year FE + error_it",
      fixed_effects: ["firm", "year"], vcov_spec: "cluster(firm)", clustering: "firm", n,
      code_ref: "domains/economics/benchmarks/panel_fe/runners/run_stata.do",
      data_ref: "grunfeld.csv", result_ref: "ESTIMATES_GRUNFELD",
    }],
  };
  const estimatesArtifact = {
    artifact_id: "ESTIMATES_GRUNFELD", artifact_type: "estimates", schema_version: "1.0",
    producer_role: "empirical", producer_task_id: "task_emp_grunfeld", created_at: "2026-08-29T00:00:00Z",
    inputs: [modelRegistry.artifact_id], estimates,
  };
  const diagnostics = {
    artifact_id: "DIAGNOSTICS_GRUNFELD", artifact_type: "diagnostics", schema_version: "1.0",
    producer_role: "empirical", producer_task_id: "task_emp_grunfeld", created_at: "2026-08-29T00:00:00Z",
    inputs: [modelRegistry.artifact_id],
    diagnostics: [
      { diagnostic_id: "DIAG_GRUNFELD_CLUSTERS", model_id: "MODEL_GRUNFELD", name: "cluster_count", value: result.cluster_count, method: "reghdfe e(N_clust)", code_ref: "domains/economics/benchmarks/panel_fe/runners/run_stata.do", result_ref: "results/stata.json" },
      { diagnostic_id: "DIAG_GRUNFELD_RESID_DF", model_id: "MODEL_GRUNFELD", name: "residual_df", value: dfR, method: "reghdfe e(df_r)", code_ref: "domains/economics/benchmarks/panel_fe/runners/run_stata.do", result_ref: "results/stata.json" },
    ],
  };

  // write scientific + data artifacts first (stamp/artifact_manifest/presentation depend on their hashes)
  write(join(bundleDir, "data_manifest.json"), dataManifest);
  write(join(bundleDir, "variable_dictionary.json"), variableDictionary);
  write(join(bundleDir, "sample_flow.json"), sampleFlow);
  write(join(bundleDir, "descriptive_facts.json"), descriptiveFacts);
  write(join(bundleDir, "model_registry.json"), modelRegistry);
  write(join(bundleDir, "estimates.json"), estimatesArtifact);
  write(join(bundleDir, "diagnostics.json"), diagnostics);

  const sourceHashes = {
    model_registry: hashCanonicalJsonFile(join(bundleDir, "model_registry.json")),
    estimates: hashCanonicalJsonFile(join(bundleDir, "estimates.json")),
    diagnostics: hashCanonicalJsonFile(join(bundleDir, "diagnostics.json")),
  };
  const stamp = buildReplicationStamp(modelRegistry.models, estimatesArtifact.estimates, sourceHashes);
  write(join(bundleDir, "replication_stamp.json"), stamp);

  const artifactManifest = {
    schema_version: "1.0",
    artifacts: ["data_manifest.json", "variable_dictionary.json", "sample_flow.json", "descriptive_facts.json", "model_registry.json", "estimates.json", "diagnostics.json", "replication_stamp.json"]
      .map((p) => ({ path: p, hash_mode: CANONICAL_HASH_MODE, sha256: hashCanonicalJsonFile(join(bundleDir, p)) })),
  };
  write(join(bundleDir, "artifact_manifest.json"), artifactManifest);

  const multipleTesting = { artifact_id: "MT_GRUNFELD", artifact_type: "multiple_testing", schema_version: "1.0", producer_role: "review", producer_task_id: "task_review_grunfeld", families: [] };
  write(join(bundleDir, "multiple_testing.json"), multipleTesting);

  const presentationManifest = {
    artifact_id: "PRESENTATION_GRUNFELD", artifact_type: "presentation_manifest", schema_version: "1.0",
    producer_role: "empirical", producer_task_id: "task_pres_grunfeld", created_at: "2026-08-29T00:00:00Z",
    views: [{
      view_id: "V_GRUNFELD_TABLE", view_type: "table", output_ref: "output/tables/grunfeld_estimates.tex",
      source_refs: [{ artifact_id: estimatesArtifact.artifact_id, item_ids: estimates.map((e) => e.estimate_id), source_hash: hashCanonicalJsonFile(join(bundleDir, "estimates.json")), source_hash_mode: CANONICAL_HASH_MODE }],
    }],
  };
  write(join(bundleDir, "presentation_manifest.json"), presentationManifest);

  return { datasetSha, dfR, tcrit, estimates, result };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const bd = process.argv.indexOf("--out") >= 0 ? process.argv[process.argv.indexOf("--out") + 1] : join(ROOT, "role-team-out/grunfeld_pres_bundle");
  const info = buildGrunfeldBundle(bd);
  console.log(JSON.stringify({ bundleDir: bd, datasetSha256: info.datasetSha, residual_df: info.dfR, estimates: info.estimates.map((e) => ({ estimate_id: e.estimate_id, term: e.term, estimate: e.estimate, std_error: e.std_error, p_value: e.p_value, n: e.n })) }, null, 2));
}

