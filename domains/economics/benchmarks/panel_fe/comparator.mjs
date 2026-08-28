#!/usr/bin/env node
// P7 panel_fe cross-engine comparator.
// Alignment is ground in manifest.canonical_inference + per-runner evidence
// (is_canonical_definition), then cross-checked: a runner that claims canonical
// must have SE matching the canonical reference engine. No loose-tolerance PASS.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashTextFile } from "../../../../core/artifact_hash.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..");
const CSV = join(root, "domains/economics/benchmarks/panel_fe/grunfeld.csv");
const MAN = join(root, "domains/economics/benchmarks/panel_fe/benchmark.grunfeld.json");
const R = join(root, "domains/economics/benchmarks/panel_fe/results");
const COEF_TOL = 1e-9, SE_TOL = 1e-9;
function num(x){ return typeof x === "number" && Number.isFinite(x) ? x : null; }
function relErr(a, b){ if (b === 0) return Math.abs(a); return Math.abs(a - b) / Math.abs(b); }

export function comparePanelFe(manifest, results, actualChecksum) {
  const checks = { benchmark_id: "PASS", dataset_checksum: "PASS", n: "PASS", cluster_count: "PASS", coefficient_names: "PASS", coefficients: "PASS", canonical_covariance: "PASS" };
  let fail = false;
  for (const r of results) {
    if (r.benchmark_id !== manifest.benchmark_id) { checks.benchmark_id = "FAIL"; fail = true; }
    if (r.dataset_checksum !== actualChecksum) { checks.dataset_checksum = "FAIL"; fail = true; }
    if (num(r.n) !== manifest.expected_sample.n) { checks.n = "FAIL"; fail = true; }
    if (num(r.cluster_count) !== manifest.expected_sample.cluster_count) { checks.cluster_count = "FAIL"; fail = true; }
    if (!r.coefficients || !("value" in r.coefficients) || !("capital" in r.coefficients)) { checks.coefficient_names = "FAIL"; fail = true; }
  }
  const coefDetail = {};
  for (const term of ["value", "capital"]) {
    let ref = null; const detail = {};
    for (const r of results) {
      const v = num(r.coefficients?.[term]); detail[r.implementation_id] = v;
      if (ref === null) ref = v;
      else if (v === null || relErr(v, ref) > COEF_TOL) { checks.coefficients = "FAIL"; fail = true; }
    }
    coefDetail[term] = detail;
  }
  // covariance alignment grounded in manifest.canonical_inference + runner evidence
  const canon = manifest.canonical_inference || {};
  const refEngine = canon.canonical_reference_engine;
  const refResult = results.find((r) => r.implementation_id === refEngine);
  const covAlignment = {};
  let canonical = "PASS";
  if (!refResult) { checks.canonical_covariance = "UNRESOLVED"; fail = true; }
  else {
    // canonical reference SE
    const refSE = {};
    for (const t of ["value", "capital"]) refSE[t] = num(refResult.std_errors?.[t]);
    for (const r of results) {
      if (r.implementation_id === refEngine) { covAlignment[r.implementation_id] = "ALIGNED"; continue; }
      if (r.inference_configuration?.is_canonical_definition === true) {
        let ok = true;
        for (const t of ["value", "capital"]) {
          const v = num(r.std_errors?.[t]);
          if (v === null || refSE[t] === null || relErr(v, refSE[t]) > SE_TOL) ok = false;
        }
        covAlignment[r.implementation_id] = ok ? "ALIGNED" : "FAIL";
        if (!ok) { checks.canonical_covariance = "FAIL"; fail = true; }
      } else {
        covAlignment[r.implementation_id] = "UNRESOLVED";
      }
    }
    // canonical_covariance = PASS if reference + at least one other aligned, and no FAIL
    const anyCanonicalMatch = Object.values(covAlignment).filter((v) => v === "ALIGNED").length >= 2;
    if (checks.canonical_covariance === "FAIL") { canonical = "FAIL"; }
    else if (anyCanonicalMatch) { canonical = "PASS"; }
    else { canonical = "UNRESOLVED"; }
    checks.canonical_covariance = canonical;
  }
  checks.covariance_alignment = covAlignment;

  let verdict = fail ? "FAIL" : "UNRESOLVED";
  if (!fail && Object.values(covAlignment).every((v) => v === "ALIGNED") && canonical === "PASS") verdict = "PASS";
  return { benchmark_id: manifest.benchmark_id, verdict, checks, coefficients_detail: coefDetail, canonical_se: { reference_engine: refEngine, verdict: checks.canonical_covariance } };
}

function readJson(p){ return JSON.parse(readFileSync(p, "utf8")); }
const isMain = process.argv[1] && new URL(import.meta.url).href === new URL(`file://${process.argv[1]}`).href;
function arg(name, def){ const i=process.argv.indexOf("--"+name); return i>=0?process.argv[i+1]:def; }
if (isMain) {
  const csv = arg("csv", CSV);
  const manPath = arg("manifest", MAN);
  const dir = arg("results-dir", R);
  const manifest = readJson(manPath);
  const results = [ readJson(join(dir, "python.json")), readJson(join(dir, "r.json")), readJson(join(dir, "stata.json")) ];
  const out = comparePanelFe(manifest, results, hashTextFile(csv));
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.verdict === "FAIL" ? 1 : 0);
}
