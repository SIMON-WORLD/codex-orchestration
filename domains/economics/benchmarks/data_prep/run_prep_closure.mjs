#!/usr/bin/env node
// Phase-3 M3 - data-prep closure runner. Runs the full preparation chain twice:
//   real-data-derived variant -> Harmonize -> harmonized -> Construct -> constructed
// verifies deterministic repeatability, and writes the Pack-level provenance/closure manifest.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runHarmonize } from "../../data/run_harmonize.mjs";
import { runConstruct } from "../../data/run_construct.mjs";
import { canonicalHarmonizePlanHash } from "../../data/validate_harmonize_plan.mjs";
import { canonicalConstructPlanHash } from "../../data/validate_construct_plan.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const PREP = join(ROOT, "domains/economics/benchmarks/data_prep");
const shaFile = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const shaTextLf = (p) => createHash("sha256").update(readFileSync(p, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n")).digest("hex");

const canon = { dataset: "grunfeld_canonical", lf_sha: shaTextLf(join(ROOT, "domains/economics/benchmarks/panel_fe/grunfeld.csv")), working_raw_sha: shaFile(join(ROOT, "domains/economics/benchmarks/panel_fe/grunfeld.csv")) };
const variantFile = join(PREP, "sources/grunfeld_variant.csv");
const variantSha = shaFile(variantFile);
const variantGenHash = shaFile(join(PREP, "generate_variant.mjs"));
const hPlan = JSON.parse(readFileSync(join(PREP, "real_harmonize.plan.json"), "utf8"));
const cPlan = JSON.parse(readFileSync(join(PREP, "real_construct.plan.json"), "utf8"));

function runChain(tag) {
  const outDir = join(PREP, "results/chain_" + tag);
  mkdirSync(outDir, { recursive: true });
  const hurt = runHarmonize(join(PREP, "real_harmonize.plan.json"), { inDir: join(PREP, "sources"), outDir });
  if (!hurt.ok) throw new Error("harmonize chain failed: " + hurt.error);
  const constructed = runConstruct(join(PREP, "real_construct.plan.json"), { inDir: outDir, outDir });
  if (!constructed.ok) throw new Error("construct chain failed: " + constructed.error);
  return {
    harmonize_log: hurt.execution_log,
    harmonized_file: join(outDir, "harmonized.csv"), harmonized_sha: hurt.execution_log.output_sha256,
    construct_log: constructed.execution_log,
    constructed_file: join(outDir, "constructed.csv"), constructed_sha: constructed.execution_log.output_sha256,
  };
}
const r1 = runChain("run1");
const r2 = runChain("run2");
const determinism = {
  harmonize_plan_hash: canonicalHarmonizePlanHash(hPlan),
  construct_plan_hash: canonicalConstructPlanHash(cPlan),
  harmonized_sha_identical: r1.harmonized_sha === r2.harmonized_sha,
  constructed_sha_identical: r1.constructed_sha === r2.constructed_sha,
  op_semantics_identical: JSON.stringify(r1.construct_log.operations) === JSON.stringify(r2.construct_log.operations),
  harmonized_sha: r1.harmonized_sha, constructed_sha: r1.constructed_sha,
};

// independent oracle parity
const oracleOut = join(PREP, "oracle/parity.json");
let parity;
try { parity = JSON.parse(readFileSync(oracleOut, "utf8")); } catch { parity = null; }
const oracleEvidence = parity ? { file: "oracle/parity.json", kind: parity.oracle_kind, facts_checked: parity.facts_checked, all_ok: parity.all_ok, hash: shaTextLf(oracleOut) } : { kind: "not_run", note: "independent stdlib oracle not yet recorded" };

const manifest = {
  pack: "Data Harmonize / Construct Pack v1 (Phase 3)",
  evidence_scope: "data-preparation benchmark/provenance evidence only. Not a full research-workflow proof; that is M4.",
  capabilities: ["economics.data.harmonize", "economics.data.construct"],
  implementations: { harmonize: "data.harmonize.python.pandas", construct: "data.construct.python.pandas" },
  maturity: { harmonize: "experimental", construct: "experimental" }, // placeholder; decisions separate
  real_dataset: canon,
  derived_schema_variant: { file: "sources/grunfeld_variant.csv", variant_generation_id: "grunfeld_schema_variant_v1", variant_generation_hash: variantGenHash, raw_sha256: variantSha, note: "real_dataset_derived_schema_variant (NOT original/raw external Grunfeld source)" },
  harmonize: { plan_hash: canonicalHarmonizePlanHash(hPlan), harmonized_output_sha256: r1.harmonized_sha, execution_log_file: "results/chain_run1/harmonize_execution_log.json", execution_log_hash: shaTextLf(join(PREP, "results/chain_run1/harmonize_execution_log.json")) },
  construct: { plan_hash: canonicalConstructPlanHash(cPlan), constructed_output_sha256: r1.constructed_sha, execution_log_file: "results/chain_run1/construct_execution_log.json", execution_log_hash: shaTextLf(join(PREP, "results/chain_run1/construct_execution_log.json")) },
  determinism,
  oracle: oracleEvidence,
  synthetic_benchmarks: { harmonize: "domains/economics/benchmarks/data_harmonize/benchmark.harmonize.json", construct: "domains/economics/benchmarks/data_construct/benchmark.construct.json" },
  adversarial: { harmonize: "domains/economics/benchmarks/data_harmonize/results/adversarial/", construct: "domains/economics/benchmarks/data_construct/results/adversarial/", missingness_crossop: "domains/economics/benchmarks/data_prep/results/adversarial/missingness_crossop.json" },
  known_limitations: ["Harmonize normalize_key collision guard fixed (pre-existing panel-id duplicates no longer misreported as collisions); real Grunfeld is a clean balanced panel so no accidental m:m / duplicate-unit-time case arises natively", "Independent oracle is a stdlib math/csv calculator; Stata is available but not used as the comparator for the frozen M3 evidence", "No reshape / imputation / winsorization / outlier deletion / arbitrary eval / automatic sample exclusion; both capabilities remain owned by data role"],
};
mkdirSync(join(PREP, "results"), { recursive: true });
writeFileSync(join(PREP, "closure.phase3.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ determinism, harmonized_sha: r1.harmonized_sha, constructed_sha: r1.constructed_sha, oracle_all_ok: parity?.all_ok, manifest: "closure.phase3.json" }, null, 2));