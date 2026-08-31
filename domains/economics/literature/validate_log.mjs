#!/usr/bin/env node
// Domain-local validator for literature_search_log.json (NOT Core).
import { readFileSync } from "node:fs";
export function validateLiteratureSearchLog(log) {
  const errs = [];
  if (!log || typeof log !== "object") return ["log must be an object"];
  if (log.schema_version !== "1.0") errs.push("schema_version must be 1.0");
  if (!log.request || !log.request.search_scope) errs.push("request.search_scope required");
  if (!Array.isArray(log.request?.query_strings) || !log.request.query_strings.length) errs.push("request.query_strings required");
  if (!Array.isArray(log.request?.requested_sources) || !log.request.requested_sources.length) errs.push("request.requested_sources required");
  if (!Array.isArray(log.source_executions)) errs.push("source_executions must be array");
  for (const se of log.source_executions || []) if (!["success","success_zero_records","source_unavailable","malformed_response","unsupported_source"].includes(se.status)) errs.push("source_execution bad status " + se.status);
  if (!Array.isArray(log.candidates) || !Array.isArray(log.normalized) || !Array.isArray(log.dedupe_groups) || !Array.isArray(log.verification)) errs.push("candidates/normalized/dedupe_groups/verification must be arrays");
  for (const v of log.verification || []) if (!["verified","partially_verified","conflicting","unresolved"].includes(v.state)) errs.push("verification bad state " + v.state);
  return errs;
}
