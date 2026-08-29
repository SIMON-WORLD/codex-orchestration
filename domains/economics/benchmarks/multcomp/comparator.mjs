#!/usr/bin/env node
// Real-data Grunfeld multiple-testing benchmark comparator (deterministic).
// Reads the Python (statsmodels) and R (stats::p.adjust) result JSON and the frozen benchmark manifest,
// and compares raw + adjusted p-values under the definition-compatible Holm / Benjamini-Hochberg methods.
// Loose tolerance for cross-engine floating point; does NOT re-derive scientific results.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashTextFile } from "../../../../core/artifact_hash.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const BASE = join(ROOT, "domains/economics/benchmarks/multcomp");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
export function approx(a, b, relTol = 1e-9, absTol = 1e-12) {
  if (Math.abs(a - b) <= absTol) return true;
  return Math.abs(a - b) <= relTol * Math.max(Math.abs(a), Math.abs(b));
}

export function compareMultcomp(pyResults, rResults, manifest) {
  const checks = {};
  const methods = manifest.methods;
  // dataset checksum vs frozen grunfeld.csv
  checks.checksum = hashTextFile(join(ROOT, "domains/economics/benchmarks/panel_fe/grunfeld.csv")) === manifest.source.dataset_checksum ? "PASS" : "FAIL";
  checks.benchmark_id = (pyResults.benchmark_id === manifest.benchmark_id && rResults.benchmark_id === manifest.benchmark_id) ? "PASS" : "FAIL";
  checks.n = (pyResults.n === manifest.n && rResults.n === manifest.n) ? "PASS" : "FAIL";

  const estOrder = ["EST_GRUNFELD_VALUE", "EST_GRUNFELD_CAPITAL"];
  // raw p cross-engine (python vs R)
  let rawOk = true;
  for (const eid of estOrder) {
    const pp = pyResults.estimates.raw_p[eid], rp = rResults.estimates.raw_p[eid];
    if (!approx(pp, rp)) rawOk = false;
  }
  checks.raw_p_cross_engine = rawOk ? "PASS" : "FAIL";

  // adjusted p values: each method must be cross-engine aligned AND match the frozen manifest expected_adjusted
  checks.adjusted = "PASS";
  for (const method of methods) {
    const key = method === "holm" ? "holm" : "benjamini_hochberg";
    const expAdjusted = manifest.expected_adjusted[key];
    for (const eid of estOrder) {
      const pv = pyResults.adjusted[key][eid];
      const rv = rResults.adjusted[key][eid];
      if (!approx(pv, rv)) checks.adjusted = "FAIL";
      if (!approx(pv, expAdjusted[eid])) checks.adjusted = "FAIL";
    }
  }
  checks.method_identity = "PASS";
  for (const method of methods) {
    const mdef = method === "holm" ? "holm" : "benjamini_hochberg";
    if (!pyResults.methods[mdef] || !rResults.methods[mdef]) { checks.method_identity = "FAIL"; }
  }

  const verdict = Object.values(checks).every((v) => v === "PASS") ? "PASS" : "FAIL";
  const unresolved = Object.entries(checks).filter(([k, v]) => v === "UNRESOLVED").map(([k]) => k);
  return { verdict, checks };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const py = readJson(join(BASE, "results/python.json"));
  const r = readJson(join(BASE, "results/r.json"));
  const manifest = readJson(join(BASE, "benchmark.multcomp.json"));
  const out = compareMultcomp(py, r, manifest);
  console.log(JSON.stringify(out, null, 2));
  if (out.verdict !== "PASS") process.exit(1);
}

