#!/usr/bin/env node
// Literature M2 - real benchmark comparator.
// Compares the normalized/verified pipeline output (driven by the frozen NON-LIVE derived captures)
// against the independent authoritative ground truth in benchmark.literature.m2.json.
// It evaluates bibliographic IDENTITY only (not source ranking / relevance / scientific validity).
// It never repairs source metadata to force a pass; material source disagreement -> conflicting.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadBenchmark, sourceFetchersForQuery, QUERIES, expectedDistinctDois } from "./benchmark_helpers.mjs";
import { runLiteratureSearch, canonicalLiteratureContentHash } from "../../literature/run_literature_search.mjs";
import { authorFamilyKey } from "../../literature/normalize.mjs";

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");

function findGroupByDoi(log, doi) {
  const norm = log.canonical.normalized;
  return log.canonical.dedupe_groups.find((g) =>
    g.record_ids.some((rid) => norm.find((x) => x.internal_id === rid)?.canonical_doi === doi));
}
function membersOf(log, g) {
  const norm = log.canonical.normalized;
  return g.record_ids.map((rid) => norm.find((x) => x.internal_id === rid)).filter(Boolean);
}
function verifyOf(log, g) {
  return log.canonical.verification.find((v) => v.group_id === g.group_id);
}
function familiesOf(members) {
  return members.map((x) => (x.author_family_key || "").split("|").filter(Boolean).sort().join("|"));
}

async function checkQuery(man, queryId) {
  const out = { query: queryId, checks: {}, detail: {} };
  const { request, fetchers } = sourceFetchersForQuery(man, queryId);
  const log = await runLiteratureSearch(request, { fetchers });

  const revReq = { ...request, requested_sources: [...request.requested_sources].reverse() };
  const revLog = await runLiteratureSearch(revReq, { fetchers });
  const hashA = canonicalLiteratureContentHash(log.canonical);
  const hashB = canonicalLiteratureContentHash(revLog.canonical);
  out.checks.source_order_invariant = hashA === hashB;
  out.detail.canonical_hash = hashA;

  if (queryId === "Q_A") {
    const wp = findGroupByDoi(log, man.cases.CASE_A.identity.doi);
    const groups = log.canonical.dedupe_groups;
    const pub = groups.find((g) => g !== wp && membersOf(log, g).some((x) => x.display_title === man.cases.CASE_A_PUBLI.title) && !membersOf(log, g).some((x) => x.canonical_doi));
    const wpV = wp ? verifyOf(log, wp) : null;
    const wpMembers = wp ? membersOf(log, wp) : [];
    const pubMembers = pub ? membersOf(log, pub) : [];
    out.checks.wp_doi = Boolean(wp && wpV && wpV.state === "verified");
    out.checks.wp_card_authorship = wpMembers.length > 0 && new Set(familiesOf(wpMembers)).size === 1 && familiesOf(wpMembers)[0] === authorFamilyKey(man.cases.CASE_A.authors);
    out.checks.published_version_distinct = Boolean(pub && pub !== wp);
    out.checks.published_version_no_doi = pub ? pubMembers.every((x) => !x.canonical_doi) : false;
    out.checks.no_fuzzy_merge = groups.length === 2;
    out.detail.wp = wp ? { group_id: wp.group_id, decision: wp.decision, state: wpV?.state, dois: wpMembers.map((x) => x.canonical_doi).filter(Boolean), sources: [...new Set(wpMembers.map((x) => x.source))] } : null;
    out.detail.published = pub ? { group_id: pub.group_id, decision: pub.decision, state: verifyOf(log, pub)?.state, dois: pubMembers.map((x) => x.canonical_doi).filter(Boolean), sources: [...new Set(pubMembers.map((x) => x.source))] } : null;
  } else if (queryId === "Q_B") {
    const b1 = findGroupByDoi(log, man.cases.CASE_B1.identity.doi);
    const b2 = findGroupByDoi(log, man.cases.CASE_B2.identity.doi);
    const b1V = b1 ? verifyOf(log, b1) : null; const b2V = b2 ? verifyOf(log, b2) : null;
    const b1Members = b1 ? membersOf(log, b1) : []; const b2Members = b2 ? membersOf(log, b2) : [];
    out.checks.b1_doi = Boolean(b1 && b1V && b1V.state === "verified" && b1Members.some((x) => x.canonical_doi === man.cases.CASE_B1.identity.doi));
    out.checks.b2_doi = Boolean(b2 && b2V && b2V.state === "verified" && b2Members.some((x) => x.canonical_doi === man.cases.CASE_B2.identity.doi));
    out.checks.b1_b2_distinct = Boolean(b1 && b2 && b1.group_id !== b2.group_id);
    out.checks.b1_b2_never_merged = out.checks.b1_b2_distinct;
    out.checks.author_identity_compatible = (b1Members.length ? new Set(familiesOf(b1Members)).size === 1 : true) && (b2Members.length ? new Set(familiesOf(b2Members)).size === 1 : true);
    out.detail.b1 = b1 ? { group_id: b1.group_id, decision: b1.decision, state: b1V?.state, dois: b1Members.map((x) => x.canonical_doi).filter(Boolean), sources: [...new Set(b1Members.map((x) => x.source))] } : null;
    out.detail.b2 = b2 ? { group_id: b2.group_id, decision: b2.decision, state: b2V?.state, dois: b2Members.map((x) => x.canonical_doi).filter(Boolean), sources: [...new Set(b2Members.map((x) => x.source))] } : null;
  }
  out.pass = Object.values(out.checks).every(Boolean);
  return out;
}

export async function runComparator() {
  const man = loadBenchmark();
  const queries = [];
  for (const q of QUERIES) queries.push(await checkQuery(man, q));
  const allPass = queries.every((q) => q.pass);

  let live = null;
  try { live = JSON.parse(readFileSync(new URL("./live/live_probe.json", import.meta.url), "utf8")); } catch { /* not present */ }
  const hasLive = Boolean(live && Array.isArray(live.executions) && live.executions.length);
  const liveBothFailed = hasLive && live.executions.every((e) => e.status === "source_unavailable");
  const anySucceeded = hasLive && live.executions.some((e) => e.status === "success");

  return {
    benchmark_id: man.benchmark_id,
    comparator: "m2_real_comparator",
    authority: man.ground_truth_authority,
    queries,
    verdict: allPass ? (anySucceeded ? "PASS" : "PASS_LIVE_INCOMPLETE") : "FAIL",
    live_transport: hasLive ? {
      verdict: anySucceeded ? "LIVE_SUCCESS" : "LIVE_EVIDENCE_INCOMPLETE",
      both_failed: liveBothFailed,
      executions: live.executions.map((e) => ({ query: e.query, source: e.source, status: e.status, error_category: e.error_category, result_count: e.result_count })),
    } : "not_recorded",
    maturity: {
      current_status: "experimental",
      decision: liveBothFailed ? "LIVE_EVIDENCE_INCOMPLETE" : anySucceeded ? "PARTIAL_LIVE" : "UNKNOWN",
      reasoning: liveBothFailed
        ? "Both Crossref and OpenAlex live adapters returned source_unavailable/transport. Per the strict M2 maturity rule, litsearch.local.sources remains experimental. No tested promotion."
        : "Live transport evidence not fully captured; no tested promotion.",
    },
    hash: sha(JSON.stringify({ verdict: allPass, queries })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runComparator();
  console.log(JSON.stringify(result, null, 2));
  if (result.verdict === "FAIL") process.exit(1);
}
