#!/usr/bin/env node
// Phase-1 E2E integrated artifact-bundle builder (MAP-ONLY adapter).
// Sources the FRESH Data Validation / Panel FE / Multiple Testing / estimate-frame results and maps them
// into a single artifact bundle (data_manifest .. presentation_manifest). It does NOT re-implement
// estimators or statistical methods; it maps + verifies provenance.
import { copyFileSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashCanonicalJsonFile, hashTextFile, CANONICAL_HASH_MODE, CANONICAL_TEXT_HASH_MODE } from "../../../core/artifact_hash.mjs";
import { buildReplicationStamp } from "../../../core/build_replication_stamp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const PANEL_FE = join(ROOT, "domains/economics/benchmarks/panel_fe");
const DV = join(ROOT, "domains/economics/benchmarks/data_validation");
const RUN = join(ROOT, "role-team-out/phase1_run");
function readJson(p) { return JSON.parse(readFileSync(p, "utf8")); }
function write(path, obj) { writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8"); }

export function buildPhase1Bundle(bundleDir, runDir = RUN) {
  rmSync(bundleDir, { recursive: true, force: true }); mkdirSync(bundleDir, { recursive: true });
  copyFileSync(join(PANEL_FE, "grunfeld.csv"), join(bundleDir, "grunfeld.csv"));
  const dv = readJson(join(runDir, "data_validation.json"));
  const panel = readJson(join(runDir, "panel_fe.json"));
  const est = readJson(join(runDir, "estimates.json"));
  const mt = readJson(join(runDir, "multcomp.json"));
  const rules = readJson(join(DV, "rules.json"));
  const n = dv.n;
  const datasetSha = hashTextFile(join(PANEL_FE, "grunfeld.csv"));
  if (dv.dataset_checksum !== datasetSha) throw new Error("fresh data-validation checksum != frozen grunfeld.csv");
  if (panel.dataset_checksum !== datasetSha) throw new Error("fresh panel-fe checksum != frozen grunfeld.csv");
  if (mt.dataset_checksum !== datasetSha) throw new Error("fresh multcomp checksum != frozen grunfeld.csv");

  const estimates = Object.values(est.frames).map((f) => ({ estimate_id: f.estimate_id, model_id: "MODEL_GRUNFELD", term: f.term, estimate: f.estimate, std_error: f.std_error, ci_lower: f.ci_lower, ci_upper: f.ci_upper, p_value: f.p_value, n, multiple_testing_family_ids: f.multiple_testing_family_ids }));
  const dataManifest = { artifact_id: "DATASET_GRUNFELD", artifact_type: "data_manifest", schema_version: "1.0", producer_role: "data", producer_task_id: "task_data_grunfeld", created_at: "2026-08-30T00:00:00Z", inputs: [], dataset_id: rules.dataset_id, data_path: "grunfeld.csv", observation_count: n, variable_count: rules.variables.length, dataset_sha256: datasetSha, dataset_hash_mode: CANONICAL_TEXT_HASH_MODE, source_refs: [{ name: "Grunfeld", source: "R package plm dataset Grunfeld (public, 10 firms, 1935-1954)", url: "https://github.com/SIMON-WORLD/codex-orchestration/blob/main/domains/economics/benchmarks/panel_fe/grunfeld.csv" }] };
  const variableDictionary = { artifact_id: "VARDICT_GRUNFELD", artifact_type: "variable_dictionary", schema_version: "1.0", producer_role: "data", producer_task_id: "task_data_grunfeld", created_at: "2026-08-30T00:00:00Z", inputs: [dataManifest.artifact_id], variables: rules.variables.map((v) => ({ name: v.name, definition: v.definition, type: v.type, unit: v.unit })) };
  const sampleFlow = { artifact_id: "SAMPLEFLOW_GRUNFELD", artifact_type: "sample_flow", schema_version: "1.0", producer_role: "data", producer_task_id: "task_data_grunfeld", created_at: "2026-08-30T00:00:00Z", inputs: [dataManifest.artifact_id], steps: rules.sample_flow_steps };
  const descriptiveFacts = { artifact_id: "DESCFACTS_GRUNFELD", artifact_type: "descriptive_facts", schema_version: "1.0", producer_role: "data", producer_task_id: "task_data_grunfeld", created_at: "2026-08-30T00:00:00Z", inputs: [dataManifest.artifact_id], facts: [
    { fact_id: "FACT_GRUNFELD_N", name: "sample_size", value: n, unit: "observations", sample_id: rules.dataset_id, source_data_ref: "grunfeld.csv", computation_ref: "data_manifest.observation_count" },
    { fact_id: "FACT_GRUNFELD_FIRMS", name: "firms", value: panel.cluster_count, unit: "firms", sample_id: rules.dataset_id, source_data_ref: "grunfeld.csv", computation_ref: "reghdfe e(N_clust)" },
    { fact_id: "FACT_GRUNFELD_MISSING", name: "selected-variable missing observations", value: Object.fromEntries(Object.entries(dv.facts.missingness || {}).map(([k, v]) => [k, v.n_missing])), unit: "count", sample_id: rules.dataset_id, source_data_ref: "grunfeld.csv", computation_ref: "data-validation runner" },
  ] };
  const modelRegistry = { artifact_id: "MODELREG_GRUNFELD", artifact_type: "model_registry", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_emp_grunfeld", created_at: "2026-08-30T00:00:00Z", inputs: [dataManifest.artifact_id], models: [{ model_id: "MODEL_GRUNFELD", capability_id: "economics.regression.panel_fe", implementation_id: panel.implementation_id, runtime: "stata", runtime_instance: "stata.reghdfe", sample_id: rules.dataset_id, outcome: "invest", treatment: ["value", "capital"], specification: "invest ~ value + capital + firm FE + year FE (cluster=firm)", fixed_effects: ["firm", "year"], vcov_spec: "one-way cluster=firm (aes_cluster)", clustering: "firm", n, code_ref: "domains/economics/benchmarks/panel_fe/runners/run_stata.do", data_ref: "grunfeld.csv", result_ref: "ESTIMATES_GRUNFELD" }] };
  const estimatesArtifact = { artifact_id: "ESTIMATES_GRUNFELD", artifact_type: "estimates", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_emp_grunfeld", created_at: "2026-08-30T00:00:00Z", inputs: [modelRegistry.artifact_id], estimates };
  const diagnostics = { artifact_id: "DIAGNOSTICS_GRUNFELD", artifact_type: "diagnostics", schema_version: "1.0", producer_role: "data", producer_task_id: "task_data_grunfeld", created_at: "2026-08-30T00:00:00Z", inputs: [dataManifest.artifact_id], diagnostics: dv.checks.map((c) => ({ diagnostic_id: "DIAG_DV_" + c.check_id, name: c.name, value: c.value, method: "data-validation structural check", status: c.status, code_ref: "domains/economics/benchmarks/data_validation/runners/run_stata.mjs", result_ref: "results/stata.json" })) };
  const multipleTesting = { artifact_id: "MT_GRUNFELD", artifact_type: "multiple_testing", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_emp_grunfeld", created_at: "2026-08-30T00:00:00Z", families: (() => { const fams = []; for (const k of ["holm", "benjamini_hochberg"]) { fams.push({ family_id: k === "holm" ? "FAM_GRUNFELD_MHT_HOLM" : "FAM_GRUNFELD_MHT_BH", method: k, member_estimate_ids: estimates.map((e) => e.estimate_id), adjusted_results: estimates.map((e) => ({ estimate_id: e.estimate_id, raw_p_value: e.p_value, adjusted_p_value: mt.adjusted[k][e.estimate_id] })) }); } return fams; })() };

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

  const manifestPaths = ["data_manifest.json", "variable_dictionary.json", "sample_flow.json", "descriptive_facts.json", "model_registry.json", "estimates.json", "diagnostics.json", "multiple_testing.json", "replication_stamp.json"];
  const artifactManifest = { schema_version: "1.0", artifacts: manifestPaths.map((p) => ({ path: p, hash_mode: CANONICAL_HASH_MODE, sha256: hashCanonicalJsonFile(join(bundleDir, p)) })) };
  write(join(bundleDir, "artifact_manifest.json"), artifactManifest);

  const presentationManifest = { artifact_id: "PRESENTATION_GRUNFELD", artifact_type: "presentation_manifest", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_pres_grunfeld", created_at: "2026-08-30T00:00:00Z", views: [
    { view_id: "V_GRUNFELD_ESTIMATES", view_type: "table", output_ref: "output/tables/grunfeld_estimates.md", source_refs: [{ artifact_id: "ESTIMATES_GRUNFELD", item_ids: estimates.map((e) => e.estimate_id), source_hash: hashCanonicalJsonFile(join(bundleDir, "estimates.json")), source_hash_mode: CANONICAL_HASH_MODE }] },
    { view_id: "V_GRUNFELD_DESCRIPTIVE", view_type: "table", output_ref: "output/tables/grunfeld_descriptive.md", source_refs: [{ artifact_id: "DESCFACTS_GRUNFELD", item_ids: descriptiveFacts.facts.map((f) => f.fact_id), source_hash: hashCanonicalJsonFile(join(bundleDir, "descriptive_facts.json")), source_hash_mode: CANONICAL_HASH_MODE }] },
    { view_id: "V_GRUNFELD_DIAGNOSTICS", view_type: "table", output_ref: "output/tables/grunfeld_diagnostics.md", source_refs: [{ artifact_id: "DIAGNOSTICS_GRUNFELD", item_ids: diagnostics.diagnostics.map((d) => d.diagnostic_id), source_hash: hashCanonicalJsonFile(join(bundleDir, "diagnostics.json")), source_hash_mode: CANONICAL_HASH_MODE }] },
    { view_id: "V_GRUNFELD_MODELS", view_type: "table", output_ref: "output/tables/grunfeld_models.md", source_refs: [{ artifact_id: "MODELREG_GRUNFELD", item_ids: ["MODEL_GRUNFELD"], source_hash: hashCanonicalJsonFile(join(bundleDir, "model_registry.json")), source_hash_mode: CANONICAL_HASH_MODE }] },
  ] };
  write(join(bundleDir, "presentation_manifest.json"), presentationManifest);

  return { datasetSha, n, estimates, multipleTesting, bundleDir };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const bd = process.argv.indexOf("--out") >= 0 ? process.argv[process.argv.indexOf("--out") + 1] : join(ROOT, "role-team-out/phase1_bundle");
  const info = buildPhase1Bundle(bd);
  console.log(JSON.stringify({ bundleDir: info.bundleDir, datasetSha256: info.datasetSha, n: info.n, estimate_ids: info.estimates.map((e) => e.estimate_id) }, null, 2));
}
