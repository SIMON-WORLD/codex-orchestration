#!/usr/bin/env node
// Literature v1 - Crossref real client (Domain-level). Node built-in fetch; DI seam for tests.
import { mapCrossrefItem } from "./adapter_helpers.mjs";
export async function searchCrossref({ query, max_results = 5, fetcher = fetch }) {
  const url = "https://api.crossref.org/works?query=" + encodeURIComponent(query) + "&rows=" + Number(max_results) + "&select=DOI,title,author,issued,container-title,type,URL";
  let res;
  try { res = await fetcher(url); } catch { return { source: "crossref", status: "source_unavailable", error_category: "transport", request_identity: url, result_count: 0, records: [] }; }
  if (!res || !res.ok) return { source: "crossref", status: res ? "malformed_response" : "source_unavailable", error_category: res ? "http_" + res.status : "transport", request_identity: url, result_count: 0, records: [] };
  let body; try { body = await res.json(); } catch { return { source: "crossref", status: "malformed_response", error_category: "invalid_json", request_identity: url, result_count: 0, records: [] }; }
  const items = (body?.message?.items) || [];
  return { source: "crossref", status: items.length ? "success" : "success_zero_records", error_category: null, request_identity: url, result_count: items.length, records: items.map(mapCrossrefItem) };
}
