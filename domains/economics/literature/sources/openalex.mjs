#!/usr/bin/env node
// Literature v1 - OpenAlex real client (Domain-level). Node built-in fetch; DI seam for tests.
import { mapOpenAlexItem } from "./adapter_helpers.mjs";
export async function searchOpenAlex({ query, max_results = 5, fetcher = fetch }) {
  const url = "https://api.openalex.org/works?search=" + encodeURIComponent(query) + "&per-page=" + Number(max_results);
  let res;
  try { res = await fetcher(url); } catch { return { source: "openalex", status: "source_unavailable", error_category: "transport", request_identity: url, result_count: 0, records: [] }; }
  if (!res || !res.ok) return { source: "openalex", status: res ? "malformed_response" : "source_unavailable", error_category: res ? "http_" + res.status : "transport", request_identity: url, result_count: 0, records: [] };
  let body; try { body = await res.json(); } catch { return { source: "openalex", status: "malformed_response", error_category: "invalid_json", request_identity: url, result_count: 0, records: [] }; }
  const items = body?.results || [];
  return { source: "openalex", status: items.length ? "success" : "success_zero_records", error_category: null, request_identity: url, result_count: items.length, records: items.map(mapOpenAlexItem) };
}
