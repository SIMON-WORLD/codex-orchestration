#!/usr/bin/env node
// Literature M2 - build ground-truth-derived source captures (NON-LIVE).
// Constructs source-shaped Crossref/OpenAlex records from the OFFICIAL ground-truth identities,
// reusing the exact item builders exported by benchmark_helpers.mjs so the frozen capture and the
// pipeline input can never diverge. These captures are NOT live transport evidence; live endpoint
// evidence is recorded separately (live/live_probe.json).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBenchmark, crItem, oaItem } from "./benchmark_helpers.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const bench = join(ROOT, "domains/economics/benchmarks/literature");
const man = loadBenchmark();
const cases = man.cases;
function fields(id) { const c = cases[id]; return { title: c.title, authors: c.authors, identity: c.identity }; }
const ids = ["CASE_A", "CASE_A_PUBLI", "CASE_B1", "CASE_B2"];
const cr = ids.map((id) => ({ id, item: crItem(fields(id)) }));
const oa = ids.map((id) => ({ id, item: oaItem(fields(id)) }));
const capture = (items, source) => ({
  capture_meta: {
    capture_kind: "derived_from_official_ground_truth",
    non_live: true,
    source_source: "official NBER/QJE/JSTOR ground truth",
    note: "NOT live transport evidence; live probe recorded separately in live/live_probe.json",
    source,
    built_from: "benchmark.literature.m2.json",
  },
  source,
  items,
});
mkdirSync(join(bench, "captures"), { recursive: true });
writeFileSync(join(bench, "captures/derived_crossref.json"), JSON.stringify(capture(cr, "crossref"), null, 2) + "\n", "utf8");
writeFileSync(join(bench, "captures/derived_openalex.json"), JSON.stringify(capture(oa, "openalex"), null, 2) + "\n", "utf8");
console.log(JSON.stringify({ derived_crossref: cr.length, derived_openalex: oa.length, ids }, null, 2));
