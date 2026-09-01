#!/usr/bin/env node
// Literature M2 explicit LIVE-probe script. Runs the ACTUAL M1 source adapters against their real endpoints
// and writes bounded live evidence. Intended to be run from a network-enabled execution environment;
// never substitutes fixture data on failure. Records source_unavailable/malformed_response honestly.
// Run: node domains/economics/benchmarks/literature/run_live_probe.mjs [--out live/live_probe.json]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const litRoot = join(ROOT, "domains/economics/literature");
const src = pathToFileURL(join(litRoot, "sources/crossref.mjs")).href;
const srcoa = pathToFileURL(join(litRoot, "sources/openalex.mjs")).href;
const crossref = await import(src); const openalex = await import(srcoa);
const QUERIES = [
  { query_id: "Q_A", query: "Using Geographic Variation in College Proximity to Estimate the Return to Schooling" },
  { query_id: "Q_B", query: "Does Compulsory School Attendance Affect Schooling and Earnings?" },
];
async function probe(sourceFns, opts) { const out = []; for (const q of QUERIES) { for (const [name, fn] of Object.entries(sourceFns)) { let r = null, e = null; try { r = await fn({ query: q.query, max_results: 5 }); } catch (ex) { e = ex.message; } out.push({ query: q.query_id, source: name, status: r?.status || (e ? "source_unavailable" : "unknown"), error_category: r?.error_category || (e ? "transport" : null), result_count: r?.result_count || 0, request_identity: r?.request_identity || null, endpoint_evidence: (e && !r) ? (e || "").slice(0, 120) : null }); } } return out; }
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i >= 0 ? process.argv[i + 1] : d; };
const OUT = arg("out", join(ROOT, "domains/economics/benchmarks/literature/live/live_probe.json"));
const results = await probe({ crossref: crossref.searchCrossref, openalex: openalex.searchOpenAlex });
const env = { node: process.version, run_at: new Date().toISOString(), note: "actual adapter runs via Node fetch; network-dependent" };
const payload = { benchmark_id: "lit_real_bibliographic_v1", env, executions: results };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(JSON.stringify(payload, null, 2));
