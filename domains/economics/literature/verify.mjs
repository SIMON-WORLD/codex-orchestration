#!/usr/bin/env node
// Literature v1 - bibliographic verification states (Domain-level, NOT Core).
// Verification = bibliographic identity confidence ONLY; never content validity.
// States: verified / partially_verified / conflicting / unresolved. Each carries evidence + reason codes.
export function verifyGroup(group, memberCandidates) {
  const ms = memberCandidates || [];
  const dois = [...new Set(ms.map((m) => m.canonical_doi).filter(Boolean))];
  const titles = new Set(ms.map((m) => m.title_key).filter(Boolean));
  const years = new Set(ms.map((m) => m.year != null ? String(m.year) : null).filter(Boolean));
  const famKeys = new Set(ms.map((m) => (m.author_family_key || "").split("|").filter(Boolean).sort().join("|")).filter(Boolean));
  const sources = [...new Set(ms.map((m) => m.source).filter(Boolean))];
  const strong = (titles.size <= 1 && years.size <= 1 && famKeys.size <= 1);
  let state, evidence, reason_codes = [];
  if (dois.length >= 1) {
    // authoritative DOI path
    if (dois.length === 1 && strong) {
      state = "verified"; reason_codes = ["authoritative_doi", "core_fields_compatible"];
      evidence = { doi: dois[0], sources, note: state === "verified" ? "valid canonical DOI confirmed by authoritative metadata + compatible core identity" : "" };
    } else if (dois.length > 1 || !strong) {
      state = "conflicting"; reason_codes = dois.length > 1 ? ["multiple_dois"] : ["doi_identity_conflict"];
      evidence = { dois, sources, note: "same/claimed DOI group has materially inconsistent bibliographic fields" };
    }
  } else {
    // no DOI path
    if (sources.length >= 2 && strong) {
      state = "verified"; reason_codes = ["multi_source_agreement", "no_doi"];
      evidence = { sources, note: "two or more independent authoritative/stable identities agree strongly on the same work, no material conflict" };
    } else if (ms.length >= 1 && (sources.length === 1 || (titles.size === 1 && years.size === 1))) {
      state = "partially_verified"; reason_codes = ["single_source_or_incomplete", "no_doi"];
      evidence = { sources, note: "one authoritative source with coherent metadata but no independent confirmation (or incomplete but agreeing identity)" };
    } else {
      state = "unresolved"; reason_codes = ["insufficient_evidence", "no_doi"];
      evidence = { sources, note: "insufficient independent/consistent bibliographic identity evidence" };
    }
  }
  return { group_id: group.group_id, state, evidence, reason_codes };
}
