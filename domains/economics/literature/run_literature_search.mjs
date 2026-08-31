#!/usr/bin/env node
// Literature v1 - search pipeline orchestrator (Domain-level). Canonical output is order-independent.
import { createHash } from "node:crypto";
import { canonicalizeDoi as canonDoi, titleComparisonKey, normalizeAuthors, normalizeDate, authorFamilyKey } from "./normalize.mjs";
import { dedupeCandidates } from "./dedupe.mjs";
import { verifyGroup } from "./verify.mjs";
import { searchCrossref } from "./sources/crossref.mjs";
import { searchOpenAlex } from "./sources/openalex.mjs";
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const SUPPORTED = { crossref: searchCrossref, openalex: searchOpenAlex };
export const SUPPORTED_SOURCES = Object.keys(SUPPORTED);
export function validateSearchRequest(req) {
  const errs = [];
  if (!req || typeof req !== "object") errs.push("request must be an object");
  if (errs.length) { const e = new Error("invalid literature search request: " + errs.join(", ")); e.code = "invalid_request"; throw e; }
  if (!req.search_scope || typeof req.search_scope !== "string") errs.push("search_scope required");
  const qs = req.query_strings || [];
  if (!Array.isArray(qs) || qs.length === 0 || qs.some((q) => typeof q !== "string" || !q.trim())) errs.push("query_strings must be a non-empty array of strings");
  const srcs = req.requested_sources || [];
  if (!Array.isArray(srcs) || srcs.length === 0 || srcs.some((s) => !SUPPORTED_SOURCES.includes(s))) errs.push("requested_sources must include only supported sources (crossref, openalex)");
  if (errs.length) { const e = new Error("invalid literature search request: " + errs.join(", ")); e.code = "invalid_request"; throw e; }
  return true;
}
export async function runLiteratureSearch(request, opts = {}) {
  validateSearchRequest(request);
  const { fetchers = {} } = opts;
  const max_results = Number(request.max_results || request.pagination?.max_results || 20);
  const request_id = request.request_id || ("req_" + sha(request.search_scope + "|" + request.query_strings.join("") + "|" + [...request.requested_sources].sort().join(",")).slice(0, 12));
  const sourceExecutions = [], allRecords = [];
  for (const src of request.requested_sources) {
    const fn = SUPPORTED[src]; const fetcher = fetchers[src];
    if (!fn) { sourceExecutions.push({ source: src, status: "unsupported_source", error_category: "unsupported", request_identity: null, result_count: 0, records: [] }); continue; }
    const out = await fn({ query: request.query_strings[0], max_results, fetcher });
    sourceExecutions.push({ source: src, status: out.status, error_category: out.error_category, request_identity: out.request_identity, result_count: out.result_count, records: out.records });
    allRecords.push(...out.records);
  }
  const rawCandidates = allRecords.map((r) => {
    const recId = "rec_" + sha(r.source + "|" + (r.source_id || "") + "|" + (r.display_title || "")).slice(0, 12);
    return { record_id: recId, source: r.source, source_id: r.source_id, display_title: r.display_title, authors_supplied: r.authors, date_supplied: r.issued_date, venue_supplied: r.venue, doi_supplied: r.doi_supplied, url: r.url };
  });
  rawCandidates.sort((a, b) => a.record_id.localeCompare(b.record_id));
  const normalized = rawCandidates.map((c) => {
    const doi = canonDoi(c.doi_supplied); const auth = normalizeAuthors(c.authors_supplied); const date = normalizeDate(c.date_supplied);
    return { internal_id: c.record_id, display_title: c.display_title, title_key: titleComparisonKey(c.display_title), canonical_doi: doi.canonical, doi_original: doi.original, doi_valid: doi.valid, authors: auth, author_family_key: authorFamilyKey(auth), year: date.year, year_semantics: date.semantics, venue: c.venue_supplied, source: c.source, source_id: c.source_id };
  });
  const dedupeInput = normalized.map((x) => ({ record_id: x.internal_id, source: x.source, source_id: x.source_id, title_key: x.title_key, canonical_doi: x.canonical_doi, year: x.year, author_family_key: x.author_family_key }));
  let groups = dedupeCandidates(dedupeInput);
  groups = groups.map((g) => ({ ...g, sort_key: [...g.record_ids].sort().join(",") })).sort((a, b) => a.sort_key.localeCompare(b.sort_key));
  groups.forEach((g, i) => { g.group_id = "G" + i; delete g.sort_key; });
  const byId = new Map(normalized.map((x) => [x.internal_id, x]));
  const verification = groups.map((g) => verifyGroup(g, g.record_ids.map((rid) => byId.get(rid))));
  sourceExecutions.sort((a, b) => a.source.localeCompare(b.source));
  const execution_metadata = { generated_at: new Date().toISOString(), request_id };
  const canonical = {
    schema_version: "1.0",
    request: { request_id, search_scope: request.search_scope, query_strings: request.query_strings, requested_sources: [...request.requested_sources].sort(), max_results, pagination: request.pagination || null },
    source_executions: sourceExecutions.map((s) => ({ source: s.source, status: s.status, error_category: s.error_category, request_identity: s.request_identity, result_count: s.result_count })),
    candidates: rawCandidates,
    normalized, dedupe_groups: groups, verification,
  };
  return { canonical, execution_metadata };
}
export function canonicalLiteratureContentHash(log) { const { execution_metadata, ...canonical } = log; return sha(JSON.stringify(canonical)); }
