#!/usr/bin/env node
// Literature v1 - normalization helpers (Domain-level, NOT Core).
// Normalization is for COMPARISON/dedup only; the display title / authors / dates are preserved as supplied.
// DOI canonicalization is conservative: trim whitespace, case-insensitive identity, strip only known DOI
// URL/prefix wrappers (https://doi.org/, doi:). Malformed DOIs are REJECTED, never guessed from arbitrary text.
export function normalizeText(s) {
  return String(s == null ? "" : s).normalize("NFKC").replace(/\s+/g, " ").trim();
}
export function titleComparisonKey(title) {
  return normalizeText(title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
// DOI canonicalization -> { canonical, original, valid }
export function canonicalizeDoi(raw) {
  const original = raw == null ? "" : String(raw).trim();
  if (!original) return { canonical: null, original: "", valid: false, reason: "missing" };
  let s = original.trim();
  // strip known wrappers
  s = s.replace(/^https?:\/\/doi\.org\//i, "").replace(/^doi:\s*/i, "");
  // DOI identity is case-insensitive; canonicalize to lowercase for comparison only (display uses original)
  const m = s.match(/^10\.\d{4,9}\/[^\s]+$/i);
  if (!m) return { canonical: null, original, valid: false, reason: "malformed" };
  return { canonical: s.toLowerCase().trim(), original, valid: true };
}
export function normalizeAuthors(authors) {
  // authors may be array of {given,family} or {name}; or strings.
  const out = [];
  for (const a of authors || []) {
    if (typeof a === "string") { out.push({ given: "", family: a.trim() }); continue; }
    const given = (a.given || a.name || "").toString().trim();
    const family = (a.family || "").toString().trim();
    out.push({ given, family });
  }
  return out;
}
export function normalizeDate(date) {
  // date may be {year, month?, day?} or {date-parts:[[y,m,d]]} (Crossref) or {year} (OpenAlex).
  if (Array.isArray(date?.["date-parts"])) { const p = date["date-parts"][0]; return { year: p?.[0] ?? null, month: p?.[1] ?? null, day: p?.[2] ?? null, semantics: "issued" }; }
  if (date && typeof date === "object") { return { year: date.year ?? null, month: date.month ?? null, day: date.day ?? null, semantics: "single" }; }
  if (typeof date === "string" || typeof date === "number") return { year: Number(date) || null, month: null, day: null, semantics: "year" };
  return { year: null, month: null, day: null, semantics: "unknown" };
}
export function authorFamilyKey(authors) {
  return (authors || []).map((a) => (a.family || "").toLowerCase()).join("|");
}
