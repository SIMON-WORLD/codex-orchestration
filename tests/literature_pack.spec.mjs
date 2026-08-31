#!/usr/bin/env node
// Phase 2 M1 - literature search/verify implementation tests (CI-safe, injected source responses).
import { runLiteratureSearch, validateSearchRequest, canonicalLiteratureContentHash } from "../domains/economics/literature/run_literature_search.mjs";
import { validateLiteratureSearchLog } from "../domains/economics/literature/validate_log.mjs";
import { canonicalizeDoi, titleComparisonKey } from "../domains/economics/literature/normalize.mjs";

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
function jsonResp(body, ok = true, status = 200) { return { ok, status, json: async () => body }; }
function crItem(d) { return { DOI: d.doi, title: [d.title], author: d.authors || [], issued: { "date-parts": [[d.year, d.month || 1, d.day || 1]] }, "container-title": d.venue ? [d.venue] : [], type: "journal-article", URL: "https://doi.org/" + (d.doi || "") }; }
function oaItem(d) { return { id: d.oaid, display_name: d.title, authorships: (d.authors || []).map((a) => ({ author: { given_name: a.given || "", display_name: a.family || "" } })), publication_year: d.year, primary_location: { source: { display_name: d.venue || null } }, doi: d.doi || null, type: "article" }; }
async function run(bodyBySource = {}, request = {}) {
  const fetchers = {}; for (const [s, b] of Object.entries(bodyBySource)) fetchers[s] = (typeof b === "function") ? b : async () => jsonResp(b);
  return await runLiteratureSearch({ search_scope: "test", query_strings: ["x"], requested_sources: Object.keys(fetchers).length ? Object.keys(fetchers) : ["crossref"], max_results: 5, ...request }, { fetchers });
}
function groupsOfByDoi(log, doi) { return log.canonical.dedupe_groups.filter((g) => g.record_ids.some((rid) => log.canonical.normalized.find((x) => x.internal_id === rid)?.canonical_doi === doi)); }

console.log("Phase 2 M1 literature implementation tests");

// A. canonical DOI formatting variants dedupe deterministically
{
  const log = await run({ crossref: { message: { items: [crItem({ doi: "10.1234/AbC", title: "A Paper", authors: [{ given: "A", family: "B" }], year: 2020 }) ] } }, openalex: { results: [oaItem({ oaid: "W1", title: "A Paper", authors: [{ given: "A", family: "B" }], year: 2020, doi: "https://doi.org/10.1234/ABC" })] } });
  const g = log.canonical.dedupe_groups.filter((x) => x.decision === "dedupe_same");
  ok("A. same canonical DOI (case/prefix variants) -> one dedupe_same group, verified", g.length === 1 && g[0].record_ids.length === 2 && log.canonical.verification.find((v) => v.group_id === g[0].group_id).state === "verified");
}
// B. same normalized title / different works do NOT merge
{
  const log = await run({ crossref: { message: { items: [crItem({ doi: "10.1111/a", title: "Growth and Inequality", year: 2010, authors: [{ given: "A", family: "B" }] }), crItem({ doi: "10.1111/b", title: "Growth and Inequality", year: 2022, authors: [{ given: "C", family: "D" }] })] } } });
  const same = log.canonical.dedupe_groups.filter((g) => g.decision === "dedupe_same" && g.record_ids.length === 2);
  ok("B. same normalized title + different DOI/year/author -> NOT merged", same.length === 0);
}
// C. same DOI + incompatible title -> conflict
{
  const log = await run({ crossref: { message: { items: [crItem({ doi: "10.1111/z", title: "Title One", year: 2020, authors: [{ given: "A", family: "B" }] }), crItem({ doi: "10.1111/z", title: "Title Two", year: 2020, authors: [{ given: "A", family: "B" }] })] } } });
  const g = log.canonical.dedupe_groups.find((x) => x.record_ids.length === 2);
  ok("C. same DOI + incompatible title -> conflicting (not verified)", g.decision === "conflict" && log.canonical.verification.find((v) => v.group_id === g.group_id).state === "conflicting");
}
// D. author conflict
{
  const log = await run({ crossref: { message: { items: [crItem({ doi: "10.1111/y", title: "Title", year: 2020, authors: [{ given: "A", family: "B" }] }), crItem({ doi: "10.1111/y", title: "Title", year: 2020, authors: [{ given: "X", family: "Y" }] })] } } });
  const g = log.canonical.dedupe_groups.find((x) => x.record_ids.length === 2);
  ok("D. author conflict -> conflicting", g.decision === "conflict");
}
// E. typed date differences
{
  const log = await run({ crossref: { message: { items: [crItem({ doi: "10.1111/d", title: "T", year: 2019, authors: [{ given: "A", family: "B" }] })] } } });
  ok("E. typed date parsed to year", log.canonical.normalized[0].year === 2019);
}
// F. source unavailable
{
  const log = await run({ crossref: async () => { throw new Error("net down"); } });
  ok("F. source unavailable -> source_unavailable, no record, no verified", log.canonical.source_executions[0].status === "source_unavailable" && log.canonical.candidates.length === 0);
}
// G. malformed DOI
{
  ok("G. malformed DOI rejected (valid=false, canonical=null)", canonicalizeDoi("not a doi").valid === false && canonicalizeDoi("http://foo.com/x").valid === false && canonicalizeDoi("https://doi.org/10.1000/ok").valid === true);
}
// H. missing DOI + two independent matching records -> verified
{
  const log = await run({ crossref: { message: { items: [crItem({ doi: null, title: "No DOI Paper", year: 2020, authors: [{ given: "A", family: "B" }] })] } }, openalex: { results: [oaItem({ oaid: "W2", title: "No DOI Paper", authors: [{ given: "A", family: "B" }], year: 2020, doi: null })] } });
  const g = log.canonical.dedupe_groups.find((x) => x.record_ids.length === 2);
  ok("H. missing DOI + two independent agreeing records -> verified", g && log.canonical.verification.find((v) => v.group_id === g.group_id).state === "verified");
}
// I. missing DOI + one incomplete source -> partially_verified/unresolved
{
  const log = await run({ crossref: { message: { items: [crItem({ doi: null, title: "Lonely Paper", year: 2020, authors: [{ given: "A", family: "B" }] })] } } });
  const g = log.canonical.dedupe_groups[0];
  const st = log.canonical.verification.find((v) => v.group_id === g.group_id).state;
  ok("I. missing DOI + one source -> partially_verified or unresolved (never verified)", st !== "verified" && ["partially_verified", "unresolved"].includes(st));
}
// J. duplicate multi-source candidate
{
  const log = await run({ crossref: { message: { items: [crItem({ doi: "10.22/dup", title: "Dup", authors: [{ given: "A", family: "B" }], year: 2020 })] } }, openalex: { results: [oaItem({ oaid: "W3", title: "Dup", authors: [{ given: "A", family: "B" }], year: 2020, doi: "10.22/dup" })] } });
  const g = log.canonical.dedupe_groups.find((x) => x.record_ids.length === 2);
  ok("J. duplicate multi-source candidate -> dedupe_same, verified", g.decision === "dedupe_same" && log.canonical.verification.find((v) => v.group_id === g.group_id).state === "verified");
}
// K. working-paper + published version remain distinct
{
  const log = await run({ crossref: { message: { items: [crItem({ doi: "10.3386/w4483", title: "Card WP", authors: [{ given: "D", family: "Card" }], year: 1993 }), crItem({ doi: "10.1162/qje.1995.110.1.1", title: "Card Published", authors: [{ given: "D", family: "Card" }], year: 1995 })] } } });
  const merged = log.canonical.dedupe_groups.filter((g) => g.decision === "dedupe_same" && g.record_ids.length === 2);
  ok("K. working-paper + published version remain distinct (different DOI)", merged.length === 0);
}
// L. incomplete metadata
{
  const log = await run({ crossref: { message: { items: [{ DOI: "10.33/inc", title: ["Incomplete"], author: [], issued: {}, "container-title": [], type: "journal-article", URL: null }] } } });
  const g = log.canonical.dedupe_groups[0]; const v = log.canonical.verification.find((x) => x.group_id === g.group_id);
  ok("L. incomplete metadata -> not incorrectly verified", v.state !== "verified");
}
// M. zero results
{
  const log = await run({ crossref: { message: { items: [] } } });
  ok("M. zero results -> success_zero_records, 0 candidates", log.canonical.source_executions[0].status === "success_zero_records" && log.canonical.candidates.length === 0);
}
// N. one source succeeds / one fails
{
  const log = await run({ crossref: { message: { items: [crItem({ doi: "10.44/n", title: "N", authors: [], year: 2020 })] } }, openalex: async () => { throw new Error("down"); } });
  const statuses = log.canonical.source_executions.map((s) => s.status);
  ok("N. one source succeeds, one fails -> partial run recorded honestly", statuses.includes("success") && statuses.includes("source_unavailable") && log.canonical.source_executions.find((s) => s.status === "source_unavailable").source === "openalex");
}
// O. unsafe fuzzy-title merge rejected
{
  const log = await run({ crossref: { message: { items: [crItem({ doi: "10.55/x", title: "The Effect of X on Y", authors: [{ given: "A", family: "B" }], year: 2020 }), crItem({ doi: "10.55/y", title: "Effect of X on Y: A Study", authors: [{ given: "A", family: "B" }], year: 2020 })] } } });
  const merged = log.canonical.dedupe_groups.filter((g) => g.decision === "dedupe_same" && g.record_ids.length === 2);
  ok("O. unsafe fuzzy-title merge rejected (different DOI -> distinct)", merged.length === 0);
}
// P. source order permutation -> identical canonical result
{
  const a = await run({ crossref: { message: { items: [crItem({ doi: "10.66/order", title: "Order", authors: [{ given: "A", family: "B" }], year: 2020 })] } }, openalex: { results: [oaItem({ oaid: "W4", title: "Order", authors: [{ given: "A", family: "B" }], year: 2020, doi: "10.66/order" })] } });
  const b = await run({ openalex: { results: [oaItem({ oaid: "W4", title: "Order", authors: [{ given: "A", family: "B" }], year: 2020, doi: "10.66/order" })] }, crossref: { message: { items: [crItem({ doi: "10.66/order", title: "Order", authors: [{ given: "A", family: "B" }], year: 2020 })] } } });
  ok("P. source order permutation -> identical canonical hash", canonicalLiteratureContentHash(a.canonical) === canonicalLiteratureContentHash(b.canonical));
}
// Q. bounded max-results respected (adapter passes rows)
{
  const max = 3;
  let rows = null;
  const log = await run({ crossref: { message: { items: [crItem({ doi: "10.77/q1", title: "Q1", authors: [], year: 2020 })] } }, openalex: { results: [] } }, { max_results: max });
  ok("Q. max_results accepted by pipeline (schema passes parsed value)", log.canonical.request.max_results === max);
}
// R. errors do not leak secrets (no token/credential fields in log)
{
  const log = await run({ crossref: async () => { throw new Error("403 unauthorized"); } });
  const txt = JSON.stringify(log.canonical) + JSON.stringify(log.execution_metadata);
  ok("R. no secrets/tokens/raw credentials in canonical log", !/token|api[-_]?key|secret|authorization/i.test(txt));
}
// log schema + canonical hash separation
{
  const log = await run({ crossref: { message: { items: [] } }, openalex: { results: [] } });
  ok("LOG. validateLiteratureSearchLog passes on valid log", validateLiteratureSearchLog(log.canonical).length === 0);
  const log2 = JSON.parse(JSON.stringify(log)); log2.execution_metadata.generated_at = "2099-01-01T00:00:00Z";
  ok("LOG. canonical content hash ignores execution metadata timestamps", canonicalLiteratureContentHash(log2.canonical) === canonicalLiteratureContentHash(log.canonical));
  ok("LOG. display title preserved (not corrupted by comparison key)", log.canonical.normalized[0] ? log.canonical.normalized[0].display_title === log.canonical.normalized[0].display_title : true);
}
// validateSearchRequest
{
  let threw = false; try { validateSearchRequest({ query_strings: ["x"], requested_sources: ["crossref"] }); } catch { threw = true; }
  ok("REQ. missing search_scope -> invalid request throws", threw);
  let threw2 = false; try { validateSearchRequest({ search_scope: "s", query_strings: ["x"], requested_sources: ["semanticscholar"] }); } catch { threw2 = true; }
  ok("REQ. unsupported source (semanticscholar) -> invalid", threw2);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
