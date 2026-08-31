#!/usr/bin/env node
// Literature v1 - deterministic dedupe (Domain-level, NOT Core).
// Precedence: (1) canonical DOI exact; (2) exact source-specific stable ID (source-equivalent);
// (3) conservative normalized bibliographic identity (identical title_key + year + author family key, no DOI conflict).
// Unsafe fuzzy-title similarity is NEVER used for merging.
export function dedupeCandidates(candidates) {
  // candidates: [{ record_id, source, source_id, title_key, canonical_doi, year, author_family_key }]
  const n = candidates.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };
  const byDoi = new Map(), bySourceId = new Map();
  for (let i = 0; i < n; i++) {
    const c = candidates[i];
    if (c.canonical_doi) { const k = c.canonical_doi; if (byDoi.has(k)) union(i, byDoi.get(k)); else byDoi.set(k, i); }
    if (c.source && c.source_id) { const k = c.source + "::" + String(c.source_id).toLowerCase(); if (bySourceId.has(k)) union(i, bySourceId.get(k)); else bySourceId.set(k, i); }
  }
  // conservative normalized identity ONLY for candidates with no strong identity link that conflicts
  const groups = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
  // Build a normalized-identity map over single-doi candidates to catch safe merges
  const normKey = (c) => JSON.stringify([c.title_key || "", c.year ?? "", (c.author_family_key || "").split("|").filter(Boolean).sort().join("|")]);
  const normMap = new Map();
  for (let i = 0; i < n; i++) {
    const c = candidates[i];
    // only safe-merge candidates that have no DOI (or DOI is the SAME across would-be merges)
    const k = normKey(c);
    if (normMap.has(k)) { const j = normMap.get(k); const ci = candidates[j], cj = c; if (ci.canonical_doi && cj.canonical_doi && ci.canonical_doi !== cj.canonical_doi) continue; union(i, j); }
    else normMap.set(k, i);
  }
  const rootToIdx = new Map();
  for (let i = 0; i < n; i++) { const r = find(i); if (!rootToIdx.has(r)) rootToIdx.set(r, []); rootToIdx.get(r).push(i); }
  const groupsOut = [];
  let gid = 0;
  for (const idxs of rootToIdx.values()) {
    const members = idxs.map((i) => candidates[i]);
    const dois = [...new Set(members.map((m) => m.canonical_doi).filter(Boolean))];
    const titles = new Set(members.map((m) => m.title_key).filter(Boolean));
    const fams = new Set(members.map((m) => (m.author_family_key || "").split("|").filter(Boolean).sort().join("|")).filter(Boolean));
    const years = new Set(members.map((m) => m.year != null ? String(m.year) : null).filter(Boolean));
    let decision = "distinct", rule = "single", reason = "no merge", confidence = "high";
    if (members.length > 1) {
      if (dois.length === 1 && titles.size <= 1 && years.size <= 1 && fams.size <= 1) { decision = "dedupe_same"; rule = "canonical_doi"; reason = "identical canonical DOI + compatible core identity"; confidence = "high"; }
      else if (dois.length === 1 && titles.size <= 1 && years.size <= 1 && fams.size > 1) { decision = "conflict"; rule = "author_conflict"; reason = "same DOI/identity but inconsistent author list"; confidence = "conflict"; }
      else if (dois.length > 1) { decision = "conflict"; rule = "doi_conflict"; reason = "multiple distinct canonical DOIs in one group"; confidence = "conflict"; }
      else if (titles.size > 1 || years.size > 1) { decision = "conflict"; rule = "identity_conflict"; reason = "same-doi/low-link group has conflicting title/year"; confidence = "conflict"; }
      else { decision = "dedupe_same"; rule = "source_id_or_normalized"; reason = "source-specific stable ID or conservative normalized identity"; confidence = "high"; }
    }
    groupsOut.push({ group_id: "G" + (gid++), record_ids: members.map((m) => m.record_id), decision, rule, reason, confidence, member_count: members.length });
  }
  return groupsOut;
}
