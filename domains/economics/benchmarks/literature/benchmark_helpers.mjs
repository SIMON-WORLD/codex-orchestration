#!/usr/bin/env node
// Literature M2 - benchmark helpers. Reads the ground-truth manifest and the frozen (NON-LIVE)
// derived source captures, and provides per-query fetchers + expected identity invariants.
//
// Design rule: the captured source-shaped items (captures/derived_*.json) are THE single frozen
// record of what each source returns for the benchmark. sourceFetchersForQuery() reads those
// captures rather than re-building items inline, so the pipeline input and the audit record can
// never diverge. build_derived_captures.mjs writes those captures from the same ground-truth
// manifest via the same item builders exported here.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const BENCH = join(ROOT, "domains/economics/benchmarks/literature");

export function loadBenchmark() {
  return JSON.parse(readFileSync(join(BENCH, "benchmark.literature.m2.json"), "utf8"));
}

// Which case ids each source returns for each query (matches the frozen captures).
export const QUERY_CASES = {
  Q_A: { crossref: ["CASE_A", "CASE_A_PUBLI"], openalex: ["CASE_A"] },
  Q_B: { crossref: ["CASE_B1", "CASE_B2"], openalex: ["CASE_B1", "CASE_B2"] },
};

export function loadCapture(source) {
  const file = source === "crossref" ? "derived_crossref.json" : "derived_openalex.json";
  const cap = JSON.parse(readFileSync(join(BENCH, "captures", file), "utf8"));
  if (cap.source !== source) throw new Error("capture source mismatch: " + source);
  return cap;
}

// ---- source-shaped item builders (crossref / openalex) -------------------------------
// These produce the raw source return item used by the ACTUAL M1 adapters (mapCrossrefItem /
// mapOpenAlexItem). Both build_derived_captures.mjs and sourceFetchersForQuery() use these so
// the frozen capture and the pipeline input are the same shape.
export function crItem({ title, authors, identity }) {
  const doi = identity.doi || null;
  const year = Number(identity.issue_date ? String(identity.issue_date).slice(0, 4) : null) || identity.year || null;
  const month = identity.issue_date ? (Number(String(identity.issue_date).slice(5, 7)) || 1) : 1;
  const container = identity.journal || identity.container ||
    (identity.series ? identity.series + (identity.number ? " " + identity.number : "") : null);
  return {
    DOI: doi,
    title: [title],
    author: authors.map((a) => ({ given: a.given, family: a.family })),
    issued: { "date-parts": [[year || null, month, 1]] },
    "container-title": container ? [container] : [],
    type: identity.kind === "journal_article" ? "journal-article" : "report",
    URL: doi ? "https://doi.org/" + doi : null,
  };
}
export function oaItem({ title, authors, identity }) {
  const year = Number(identity.issue_date ? String(identity.issue_date).slice(0, 4) : null) || identity.year || null;
  const source = identity.journal || identity.container || identity.series || null;
  return {
    id: "W_" + (identity.doi ? identity.doi.replace(/[^a-z0-9]/gi, "") : title.replace(/[^a-z0-9]/gi, "").slice(0, 8)),
    display_name: title,
    authorships: authors.map((a) => ({ author: { given_name: a.given || "", display_name: a.family || "" } })),
    publication_year: year,
    primary_location: { source: { display_name: source } },
    doi: identity.doi || null,
    type: identity.kind === "journal_article" ? "article" : "report",
  };
}

export function jsonResp(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

// Build the HTTP-fetch-level fetchers for a query by wrapping the frozen capture items into the
// source-specific API response shape the real adapters expect (crossref -> message.items,
// openalex -> results).
export function sourceFetchersForQuery(man, queryId) {
  const qc = QUERY_CASES[queryId];
  if (!qc) throw new Error("unknown query " + queryId);
  const cr = loadCapture("crossref").items.filter((i) => qc.crossref.includes(i.id)).map((i) => i.item);
  const oa = loadCapture("openalex").items.filter((i) => qc.openalex.includes(i.id)).map((i) => i.item);
  const title = queryId === "Q_A" ? man.cases.CASE_A.title : man.cases.CASE_B1.title;
  return {
    request: {
      search_scope: "m2_real_bibliographic_benchmark",
      query_strings: [title],
      requested_sources: ["crossref", "openalex"],
    },
    fetchers: {
      crossref: async () => jsonResp({ message: { items: cr } }),
      openalex: async () => jsonResp({ results: oa }),
    },
  };
}

export const QUERIES = ["Q_A", "Q_B"];

// Expected: by query, the set of distinct work identities (DOIs) that must appear as separate
// groups (not merged). null represents a legitimate no-DOI identity that must remain its own group.
export function expectedDistinctDois(man, queryId) {
  if (queryId === "Q_A") return [man.cases.CASE_A.identity.doi, null]; // WP DOI + published (no DOI) -> 2 distinct groups
  if (queryId === "Q_B") return [man.cases.CASE_B1.identity.doi, man.cases.CASE_B2.identity.doi]; // two distinct groups
  return [];
}
