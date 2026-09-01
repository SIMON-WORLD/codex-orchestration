#!/usr/bin/env node
// Literature M2 - frozen ADVERSARIAL benchmark runner.
// Promotes the deterministic hostile normalization/dedupe/verification mechanics from M1 into a
// clearly labeled, reproducible frozen suite. Each case injects source-shaped responses (via the
// DI seam) and asserts the canonical outcome. This runner is deterministic and CI-safe: it never
// hits a live network endpoint. It also exercises the source-service degradation matrix.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { runLiteratureSearch, canonicalLiteratureContentHash } from "../../../literature/run_literature_search.mjs";
import { jsonResp } from "../benchmark_helpers.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..", "..");
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

function makeFetchers(bodyBySource) {
  const fetchers = {};
  for (const [s, b] of Object.entries(bodyBySource)) fetchers[s] = typeof b === "function" ? b : async () => jsonResp(b);
  return fetchers;
}
function crItem(d) {
  return { DOI: d.doi, title: [d.title], author: d.authors || [], issued: { "date-parts": [[d.year, d.month || 1, d.day || 1]] }, "container-title": d.venue ? [d.venue] : [], type: "journal-article", URL: "https://doi.org/" + (d.doi || "") };
}
function oaItem(d) {
  return { id: d.oaid, display_name: d.title, authorships: (d.authors || []).map((a) => ({ author: { given_name: a.given || "", display_name: a.family || "" } })), publication_year: d.year, primary_location: { source: { display_name: d.venue || null } }, doi: d.doi || null, type: "article" };
}
async function run(bodyBySource = {}, request = {}) {
  return await runLiteratureSearch({ search_scope: "adversarial", query_strings: ["x"], requested_sources: Object.keys(bodyBySource).length ? Object.keys(bodyBySource) : ["crossref"], max_results: 5, ...request }, { fetchers: makeFetchers(bodyBySource) });
}
function verifyOf(log, g) { return log.canonical.verification.find((v) => v.group_id === g.group_id); }

const CASES = [
  {
    id: "ADV_DOI_VARIANTS", kind: "doi_variants", parent: "A",
    desc: "same canonical DOI (case/prefix variants) dedupe deterministically",
    run: () => run({ crossref: { message: { items: [crItem({ doi: "10.1234/AbC", title: "A Paper", authors: [{ given: "A", family: "B" }], year: 2020 })] } }, openalex: { results: [oaItem({ oaid: "W1", title: "A Paper", authors: [{ given: "A", family: "B" }], year: 2020, doi: "https://doi.org/10.1234/ABC" })] } }),
    check: (log) => { const gs = log.canonical.dedupe_groups.filter((x) => x.decision === "dedupe_same"); return { pass: gs.length === 1 && gs[0].record_ids.length === 2 && verifyOf(log, gs[0])?.state === "verified", detail: { groups: gs.map((g) => ({ decision: g.decision, members: g.record_ids.length, state: verifyOf(log, g)?.state })) } }; },
  },
  {
    id: "ADV_SAME_TITLE_DISTINCT", kind: "same_title_distinct", parent: "B",
    desc: "same normalized title + different DOI/year/author do NOT merge",
    run: () => run({ crossref: { message: { items: [crItem({ doi: "10.1111/a", title: "Growth and Inequality", year: 2010, authors: [{ given: "A", family: "B" }] }), crItem({ doi: "10.1111/b", title: "Growth and Inequality", year: 2022, authors: [{ given: "C", family: "D" }] })] } } }),
    check: (log) => { const s = log.canonical.dedupe_groups.filter((g) => g.decision === "dedupe_same" && g.record_ids.length === 2); return { pass: s.length === 0, detail: { merged: s.length } }; },
  },
  {
    id: "ADV_DOI_TITLE_CONFLICT", kind: "doi_title_conflict", parent: "C",
    desc: "same DOI + incompatible title -> conflicting",
    run: () => run({ crossref: { message: { items: [crItem({ doi: "10.1111/z", title: "Title One", year: 2020, authors: [{ given: "A", family: "B" }] }), crItem({ doi: "10.1111/z", title: "Title Two", year: 2020, authors: [{ given: "A", family: "B" }] })] } } }),
    check: (log) => { const g = log.canonical.dedupe_groups.find((x) => x.record_ids.length === 2); return { pass: g && g.decision === "conflict" && verifyOf(log, g)?.state === "conflicting", detail: { decision: g?.decision, state: g ? verifyOf(log, g)?.state : null } }; },
  },
  {
    id: "ADV_AUTHOR_CONFLICT", kind: "author_conflict", parent: "D",
    desc: "same DOI + same title but different author family -> conflicting",
    run: () => run({ crossref: { message: { items: [crItem({ doi: "10.1111/y", title: "Title", year: 2020, authors: [{ given: "A", family: "B" }] }), crItem({ doi: "10.1111/y", title: "Title", year: 2020, authors: [{ given: "X", family: "Y" }] })] } } }),
    check: (log) => { const g = log.canonical.dedupe_groups.find((x) => x.record_ids.length === 2); return { pass: g && g.decision === "conflict", detail: { decision: g?.decision, rule: g?.rule } }; },
  },
  {
    id: "ADV_TYPED_DATE", kind: "typed_date", parent: "E",
    desc: "typed date parsed to a numeric year",
    run: () => run({ crossref: { message: { items: [crItem({ doi: "10.1111/d", title: "T", year: 2019, authors: [{ given: "A", family: "B" }] })] } } }),
    check: (log) => ({ pass: log.canonical.normalized[0]?.year === 2019, detail: { year: log.canonical.normalized[0]?.year } }),
  },
  {
    id: "ADV_SOURCE_UNAVAILABLE", kind: "source_unavailable", parent: "F",
    desc: "source unavailable -> source_unavailable, no record, no verified",
    run: () => run({ crossref: async () => { throw new Error("net down"); } }),
    check: (log) => ({ pass: log.canonical.source_executions[0].status === "source_unavailable" && log.canonical.candidates.length === 0, detail: { status: log.canonical.source_executions[0].status, candidates: log.canonical.candidates.length } }),
  },
  {
    id: "ADV_MALFORMED_DOI", kind: "malformed_doi", parent: "G",
    desc: "malformed DOI rejected, never guessed",
    run: () => run({ crossref: { message: { items: [crItem({ doi: "not-a-doi", title: "Bad DOI", authors: [{ given: "A", family: "B" }], year: 2020 })] } } }),
    check: (log) => { const n = log.canonical.normalized[0]; return { pass: n && n.canonical_doi === null && n.doi_valid === false, detail: { canonical_doi: n?.canonical_doi, doi_valid: n?.doi_valid } }; },
  },
  {
    id: "ADV_MISSING_DOI_MULTI", kind: "missing_doi_multi", parent: "H",
    desc: "missing DOI + two independent agreeing records -> verified",
    run: () => run({ crossref: { message: { items: [crItem({ doi: null, title: "No DOI Work", authors: [{ given: "A", family: "B" }], year: 2020 })] } }, openalex: { results: [oaItem({ oaid: "Wn", title: "No DOI Work", authors: [{ given: "A", family: "B" }], year: 2020, doi: null })] } }),
    check: (log) => { const g = log.canonical.dedupe_groups.find((x) => x.record_ids.length === 2); return { pass: g && verifyOf(log, g)?.state === "verified", detail: { state: g ? verifyOf(log, g)?.state : null, rule: g?.rule } }; },
  },
  {
    id: "ADV_MISSING_DOI_SINGLE", kind: "missing_doi_single", parent: "I",
    desc: "missing DOI + one coherent record -> partially_verified",
    run: () => run({ crossref: { message: { items: [crItem({ doi: null, title: "Single No DOI", authors: [{ given: "A", family: "B" }], year: 2020 })] } } }),
    check: (log) => { const g = log.canonical.dedupe_groups[0]; return { pass: verifyOf(log, g)?.state === "partially_verified", detail: { state: verifyOf(log, g)?.state } }; },
  },
  {
    id: "ADV_MULTI_SOURCE_SAME", kind: "multi_source_same", parent: "J",
    desc: "same work returned by multiple sources -> verified, sources preserved",
    run: () => run({ crossref: { message: { items: [crItem({ doi: "10.66/order", title: "Order", authors: [{ given: "A", family: "B" }], year: 2020 })] } }, openalex: { results: [oaItem({ oaid: "W4", title: "Order", authors: [{ given: "A", family: "B" }], year: 2020, doi: "10.66/order" })] } }),
    check: (log) => { const g = log.canonical.dedupe_groups.find((x) => x.record_ids.length === 2); const srcs = g ? [...new Set(log.canonical.normalized.filter((x) => g.record_ids.includes(x.internal_id)).map((x) => x.source))] : []; return { pass: g && verifyOf(log, g)?.state === "verified" && srcs.length === 2, detail: { state: g ? verifyOf(log, g)?.state : null, sources: srcs } }; },
  },
  {
    id: "ADV_WP_VS_PUBLISHED", kind: "wp_vs_published", parent: "K",
    desc: "working-paper + published version same title/authors different DOI -> distinct",
    run: () => run({ crossref: { message: { items: [crItem({ doi: "10.1/wp", title: "Same Title", authors: [{ given: "D", family: "Card" }], year: 1993, venue: "NBER Working Paper" }), crItem({ doi: "10.2/pub", title: "Same Title", authors: [{ given: "D", family: "Card" }], year: 1995, venue: "Aspects of Labour Economics" })] } } }),
    check: (log) => { const merged = log.canonical.dedupe_groups.filter((g) => g.decision === "dedupe_same" && g.record_ids.length === 2); return { pass: merged.length === 0, detail: { merged: merged.length } }; },
  },
  {
    id: "ADV_INCOMPLETE", kind: "incomplete_metadata", parent: "L",
    desc: "incomplete metadata -> not incorrectly verified",
    run: () => run({ crossref: { message: { items: [{ DOI: "10.33/inc", title: ["Incomplete"], author: [], issued: {}, "container-title": [], type: "journal-article", URL: null }] } } }),
    check: (log) => { const g = log.canonical.dedupe_groups[0]; return { pass: verifyOf(log, g)?.state !== "verified", detail: { state: verifyOf(log, g)?.state } }; },
  },
  {
    id: "ADV_ZERO_RESULTS", kind: "zero_results", parent: "M",
    desc: "zero results -> success_zero_records, 0 candidates",
    run: () => run({ crossref: { message: { items: [] } } }),
    check: (log) => ({ pass: log.canonical.source_executions[0].status === "success_zero_records" && log.canonical.candidates.length === 0, detail: { status: log.canonical.source_executions[0].status } }),
  },
  {
    id: "ADV_ONE_SOURCE_FAIL", kind: "one_source_fail", parent: "N",
    desc: "one source succeeds, one fails -> partial run recorded honestly",
    run: () => run({ crossref: { message: { items: [crItem({ doi: "10.44/n", title: "N", authors: [], year: 2020 })] } }, openalex: async () => { throw new Error("down"); } }),
    check: (log) => { const st = log.canonical.source_executions.map((s) => s.status); return { pass: st.includes("success") && st.includes("source_unavailable") && log.canonical.source_executions.find((s) => s.status === "source_unavailable").source === "openalex", detail: { statuses: st } }; },
  },
  {
    id: "ADV_FUZZY_MERGE_REJECTED", kind: "fuzzy_title_no_merge", parent: "O",
    desc: "unsafe fuzzy-title merge rejected (different DOI -> distinct)",
    run: () => run({ crossref: { message: { items: [crItem({ doi: "10.55/x", title: "The Effect of X on Y", authors: [{ given: "A", family: "B" }], year: 2020 }), crItem({ doi: "10.55/y", title: "Effect of X on Y: A Study", authors: [{ given: "A", family: "B" }], year: 2020 })] } } }),
    check: (log) => { const merged = log.canonical.dedupe_groups.filter((g) => g.decision === "dedupe_same" && g.record_ids.length === 2); return { pass: merged.length === 0, detail: { merged: merged.length } }; },
  },
  {
    id: "ADV_ORDER_INVARIANT", kind: "order_invariant", parent: "P",
    desc: "source-order permutation -> identical canonical hash",
    run: async () => {
      const a = await run({ crossref: { message: { items: [crItem({ doi: "10.66/order", title: "Order", authors: [{ given: "A", family: "B" }], year: 2020 })] } }, openalex: { results: [oaItem({ oaid: "W4", title: "Order", authors: [{ given: "A", family: "B" }], year: 2020, doi: "10.66/order" })] } });
      const b = await run({ openalex: { results: [oaItem({ oaid: "W4", title: "Order", authors: [{ given: "A", family: "B" }], year: 2020, doi: "10.66/order" })] }, crossref: { message: { items: [crItem({ doi: "10.66/order", title: "Order", authors: [{ given: "A", family: "B" }], year: 2020 })] } } });
      return { a, b };
    },
    check: ({ a, b }) => ({ pass: canonicalLiteratureContentHash(a.canonical) === canonicalLiteratureContentHash(b.canonical), detail: { hashA: canonicalLiteratureContentHash(a.canonical).slice(0, 12), hashB: canonicalLiteratureContentHash(b.canonical).slice(0, 12) } }),
  },
  {
    id: "ADV_MAX_RESULTS", kind: "max_results", parent: "Q",
    desc: "bounded max-results accepted",
    run: () => run({ crossref: { message: { items: [crItem({ doi: "10.77/q1", title: "Q1", authors: [], year: 2020 })] } }, openalex: { results: [] } }, { max_results: 3 }),
    check: (log) => ({ pass: log.canonical.request.max_results === 3, detail: { max_results: log.canonical.request.max_results } }),
  },
  {
    id: "ADV_NO_SECRET_LEAK", kind: "no_secret_leak", parent: "R",
    desc: "no credential/error leakage into canonical log",
    run: () => run({ crossref: async () => { throw new Error("403 unauthorized"); } }),
    check: (log) => { const txt = JSON.stringify(log.canonical) + JSON.stringify(log.execution_metadata); return { pass: !/token|api[-_]?key|secret|authorization/i.test(txt), detail: {} }; },
  },
];

// Source-service degradation matrix (section 14). Each case returns log; check asserts the honest
// separation of successful evidence vs unavailable/malformed sources and no false upgrade.
const MATRIX = [
  {
    id: "DEG_BOTH_OK", desc: "both sources succeed",
    run: () => run({ crossref: { message: { items: [crItem({ doi: "10.1/d", title: "D", authors: [{ given: "A", family: "B" }], year: 2020 })] } }, openalex: { results: [oaItem({ oaid: "Wd", title: "D", authors: [{ given: "A", family: "B" }], year: 2020, doi: "10.1/d" })] } }),
    check: (log) => { const st = log.canonical.source_executions.map((s) => s.status); return { pass: st.every((x) => x === "success") && log.canonical.candidates.length === 2, detail: { statuses: st, candidates: log.canonical.candidates.length } }; },
  },
  {
    id: "DEG_CROSSREF_FAIL", desc: "Crossref succeeds / OpenAlex unavailable",
    run: () => run({ crossref: { message: { items: [crItem({ doi: "10.2/d", title: "D", authors: [{ given: "A", family: "B" }], year: 2020 })] } }, openalex: async () => { throw new Error("down"); } }),
    check: (log) => { const se = log.canonical.source_executions; const cr = se.find((s) => s.source === "crossref"); const oa = se.find((s) => s.source === "openalex"); return { pass: cr.status === "success" && oa.status === "source_unavailable" && log.canonical.candidates.length === 1, detail: { statuses: se.map((s) => `${s.source}:${s.status}`), candidates: log.canonical.candidates.length } }; },
  },
  {
    id: "DEG_OPENALEX_FAIL", desc: "OpenAlex succeeds / Crossref unavailable",
    run: () => run({ crossref: async () => { throw new Error("down"); }, openalex: { results: [oaItem({ oaid: "Wd2", title: "D2", authors: [{ given: "A", family: "B" }], year: 2020, doi: "10.3/d" })] } }),
    check: (log) => { const se = log.canonical.source_executions; const cr = se.find((s) => s.source === "crossref"); const oa = se.find((s) => s.source === "openalex"); return { pass: cr.status === "source_unavailable" && oa.status === "success" && log.canonical.candidates.length === 1, detail: { statuses: se.map((s) => `${s.source}:${s.status}`), candidates: log.canonical.candidates.length } }; },
  },
  {
    id: "DEG_BOTH_FAIL", desc: "both sources unavailable",
    run: () => run({ crossref: async () => { throw new Error("down"); }, openalex: async () => { throw new Error("down"); } }),
    check: (log) => { const st = log.canonical.source_executions.map((s) => s.status); return { pass: st.every((x) => x === "source_unavailable") && log.canonical.candidates.length === 0 && log.canonical.verification.every((v) => v.state !== "verified"), detail: { statuses: st, candidates: log.canonical.candidates.length } }; },
  },
  {
    id: "DEG_ONE_ZERO", desc: "one source returns zero results",
    run: () => run({ crossref: { message: { items: [] } }, openalex: { results: [oaItem({ oaid: "Wz", title: "Z", authors: [{ given: "A", family: "B" }], year: 2020, doi: "10.4/z" })] } }),
    check: (log) => { const se = log.canonical.source_executions; const cr = se.find((s) => s.source === "crossref"); const oa = se.find((s) => s.source === "openalex"); return { pass: cr.status === "success_zero_records" && oa.status === "success" && log.canonical.candidates.length === 1, detail: { statuses: se.map((s) => `${s.source}:${s.status}`), candidates: log.canonical.candidates.length } }; },
  },
  {
    id: "DEG_ONE_MALFORMED", desc: "one source returns malformed response",
    run: () => run({ crossref: { message: { items: [crItem({ doi: "10.5/m", title: "M", authors: [{ given: "A", family: "B" }], year: 2020 })] } }, openalex: async () => jsonResp({ not: "a valid response" }, false, 500) }),
    check: (log) => { const se = log.canonical.source_executions; const cr = se.find((s) => s.source === "crossref"); const oa = se.find((s) => s.source === "openalex"); return { pass: cr.status === "success" && oa.status === "malformed_response" && log.canonical.candidates.length === 1, detail: { statuses: se.map((s) => `${s.source}:${s.status}`), candidates: log.canonical.candidates.length } }; },
  },
];

export async function runAdversarialSuite() {
  const results = [];
  for (const c of CASES) {
    let log;
    try { log = await c.run(); } catch (e) { results.push({ id: c.id, parent: c.parent, kind: c.kind, pass: false, detail: { error: e.message } }); continue; }
    const r = c.check(log);
    results.push({ id: c.id, parent: c.parent, kind: c.kind, desc: c.desc, pass: r.pass, detail: r.detail });
  }
  const matrix = [];
  for (const c of MATRIX) {
    let log;
    try { log = await c.run(); } catch (e) { matrix.push({ id: c.id, pass: false, detail: { error: e.message } }); continue; }
    const r = c.check(log);
    matrix.push({ id: c.id, desc: c.desc, pass: r.pass, detail: r.detail });
  }
  const verdict = results.every((r) => r.pass) && matrix.every((r) => r.pass) ? "PASS" : "FAIL";
  return { benchmark_id: "lit_adversarial_v1", kind: "frozen_deterministic_adversarial", cases: results, degradation_matrix: matrix, verdict, hash: sha(JSON.stringify(results)) };
}

if (process.argv[1] && process.argv[1].endsWith("run_adversarial.mjs")) {
  const out = await runAdversarialSuite();
  const dir = join(ROOT, "domains/economics/benchmarks/literature/adversarial");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "adversarial_result.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(out, null, 2));
  if (out.verdict === "FAIL") process.exit(1);
}
