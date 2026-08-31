#!/usr/bin/env node
// Literature v1 - source adapter helpers (Domain-level).
export function classifyResponse(res, ok) {
  if (!res) return { status: "source_unavailable", error_category: "transport" };
  if (!ok) return { status: "malformed_response", error_category: "http_" + res.status };
  return null;
}
function pickFirst(a) { return Array.isArray(a) && a.length ? a[0] : null; }
export function mapCrossrefItem(item) {
  const title = pickFirst(item.title) || "";
  const container = pickFirst(item["container-title"]) || null;
  const doi = item.DOI || null;
  return {
    source: "crossref",
    source_id: doi,
    display_title: title,
    authors: (item.author || []).map((a) => ({ given: a.given || "", family: a.family || "" })),
    issued_date: (item.issued && item.issued["date-parts"] && item.issued["date-parts"][0]) ? { year: item.issued["date-parts"][0][0] || null, month: item.issued["date-parts"][0][1] || null, day: item.issued["date-parts"][0][2] || null } : null,
    venue: container,
    doi_supplied: doi,
    url: item.URL || null,
    type: item.type || null,
  };
}
export function mapOpenAlexItem(item) {
  const authors = ((item.authorships || [])).map((a) => ({ given: a.author?.given_name || "", family: a.author?.display_name || "" }));
  return {
    source: "openalex",
    source_id: item.id,
    display_title: item.display_name || "",
    authors,
    issued_date: item.publication_year ? { year: item.publication_year, month: null, day: null } : null,
    venue: item.primary_location?.source?.display_name || null,
    doi_supplied: item.doi || null,
    url: item.doi || null,
    type: item.type || null,
    openalex_id: item.id,
  };
}
