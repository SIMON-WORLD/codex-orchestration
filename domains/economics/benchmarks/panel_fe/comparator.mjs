#!/usr/bin/env node
// P7 panel_fe cross-engine comparator.
// Reads the benchmark manifest + three runner result JSONs and emits a verdict.
// Only strictly compares SEs within an aligned covariance family;
// an engine whose covariance family differs from the canonical "aes_cluster"
// is marked UNRESOLVED (not a loose-tolerance PASS).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hashTextFile, CANONICAL_TEXT_HASH_MODE } from "../../../../core/artifact_hash.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..");
const CSV = join(root, "domains/economics/benchmarks/panel_fe/grunfeld.csv");
const MAN = join(root, "domains/economics/benchmarks/panel_fe/benchmark.grunfeld.json");
const R = join(root, "domains/economics/benchmarks/panel_fe/results");
const CANONICAL_FAMILY = "aes_cluster";
function num(x){ return typeof x === "number" && Number.isFinite(x) ? x : null; }
function relErr(a, b){ if (b === 0) return Math.abs(a); return Math.abs(a - b) / Math.abs(b); }
const COEF_TOL = 1e-9, SE_TOL = 1e-9;

export function comparePanelFe(manifest, results, actualChecksum) {
  const checks = { benchmark_id: "PASS", dataset_checksum: "PASS", n: "PASS", cluster_count: "PASS", coefficient_names: "PASS", coefficients: "PASS", canonical_covariance: "PASS" };
  const engines = results.map((r) => r.implementation_id);
  let fail = false;

  // benchmark_id + checksum
  for (const r of results) {
    if (r.benchmark_id !== manifest.benchmark_id) { checks.benchmark_id = "FAIL"; fail = true; }
    if (r.dataset_checksum !== actualChecksum) { checks.dataset_checksum = "FAIL"; fail = true; }
  }
  // n / cluster_count
  for (const r of results) {
    if (num(r.n) !== manifest.expected_sample.n) { checks.n = "FAIL"; fail = true; }
    if (num(r.cluster_count) !== manifest.expected_sample.cluster_count) { checks.cluster_count = "FAIL"; fail = true; }
  }
  // coefficient names
  for (const r of results) if (!r.coefficients || !("value" in r.coefficients) || !("capital" in r.coefficients)) { checks.coefficient_names = "FAIL"; fail = true; }
  // coefficients strict
  const coefDetail = {};
  for (const term of ["value", "capital"]) {
    let ref = null;
    const detail = {};
    for (const r of results) {
      const v = num(r.coefficients?.[term]);
      detail[r.implementation_id] = v;
      if (ref === null) ref = v;
      else if (v === null || relErr(v, ref) > COEF_TOL) { checks.coefficients = "FAIL"; fail = true; }
    }
    coefDetail[term] = detail;
  }
  // covariance grouping
  const byFamily = {};
  for (const r of results) {
    const fam = r.inference_configuration?.covariance_family || "unknown";
    (byFamily[fam] = byFamily[fam] || []).push(r);
  }
  const covAlignment = {};
  const canonicalEngines = [];
  let canonicalSeVerdict = "PASS";
  for (const [fam, grp] of Object.entries(byFamily)) {
    if (fam === CANONICAL_FAMILY) canonicalEngines.push(...grp.map((r) => r.implementation_id));
    for (const r of grp) covAlignment[r.implementation_id] = fam === CANONICAL_FAMILY ? "ALIGNED" : "UNRESOLVED";
  }
  if (canonicalEngines.length >= 2) {
    // strict SE compare within canonical family
    const canon = results.filter((r) => r.inference_configuration?.covariance_family === CANONICAL_FAMILY);
    for (const term of ["value", "capital"]) {
      let ref = null;
      for (const r of canon) {
        const v = num(r.std_errors?.[term]);
        if (ref === null) ref = v;
        else if (v === null || relErr(v, ref) > SE_TOL) { canonicalSeVerdict = "FAIL"; fail = true; }
      }
    }
  } else {
    canonicalSeVerdict = "UNRESOLVED";
  }
  checks.canonical_covariance = canonicalSeVerdict;
  checks.covariance_alignment = covAlignment;

  let verdict = fail ? "FAIL" : "UNRESOLVED";
  if (!fail && Object.values(covAlignment).every((v) => v === "ALIGNED") && canonicalSeVerdict === "PASS") verdict = "PASS";
  return { benchmark_id: manifest.benchmark_id, verdict, checks, coefficients_detail: coefDetail, canonical_se: { engines: canonicalEngines, verdict: canonicalSeVerdict } };
}

function readJson(p){ return JSON.parse(readFileSync(p, "utf8")); }
const isMain = process.argv[1] && new URL(import.meta.url).href === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const manifest = readJson(MAN);
  const results = [
    readJson(join(R, "python.json")),
    readJson(join(R, "r.json")),
    readJson(join(R, "stata.json")),
  ];
  const actualChecksum = hashTextFile(CSV);
  const out = comparePanelFe(manifest, results, actualChecksum);
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.verdict === "FAIL" ? 1 : 0);
}

