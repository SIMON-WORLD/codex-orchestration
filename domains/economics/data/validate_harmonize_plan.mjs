#!/usr/bin/env node
// Domain-level harmonize plan validator + canonical hash (NOT Core).
// Enforces the frozen M1 harmonize contract: narrow explicit operations, guards (no fuzzy, no m:m,
// no silent repair), deterministic canonical plan hash for provenance/tamper binding.
// Structural + plan-level guard checks only. Runtime data guards (coercion failure, unknown code,
// merge unmatched, source-sha mismatch) are enforced by the Python/pandas implementation and the
// frozen benchmark evidence; this module is used by CI tests deterministically.
import { createHash } from "node:crypto";
import { canonicalJson } from "../../../core/artifact_hash.mjs";

const SUPPORTED_KINDS = new Set(["rename", "coerce", "normalize_key", "map_code", "normalize_date", "convert_unit", "merge"]);
const OP_REQUIRED = {
  rename: ["mapping"],
  coerce: ["column", "to"],
  normalize_key: ["column", "rules"],
  map_code: ["column", "mapping", "unknown"],
  normalize_date: ["column", "in_format"],
  convert_unit: ["source_column", "target_column", "source_unit", "target_unit", "factor", "factor_mode"],
  merge: ["right", "right_keys", "how", "cardinality", "unmatched"],
};
export function validateHarmonizePlan(plan) {
  const errs = [];
  if (!plan || typeof plan !== "object") return ["plan must be an object"];
  if (plan.schema_version !== "1.0") errs.push("schema_version must be 1.0");
  if (typeof plan.plan_id !== "string" || !plan.plan_id.trim()) errs.push("plan_id required");
  if (!Array.isArray(plan.inputs) || plan.inputs.length === 0) errs.push("inputs required (non-empty)");
  else {
    const ids = new Set();
    for (const inp of plan.inputs) {
      if (!inp.input_id || !inp.dataset_id || !inp.file) errs.push("input must have input_id/dataset_id/file");
      if (ids.has(inp.input_id)) errs.push("duplicate input_id " + inp.input_id); else ids.add(inp.input_id);
    }
  }
  if (!plan.output || !plan.output.dataset_id || !plan.output.file) errs.push("output requires dataset_id/file");
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) errs.push("operations required (non-empty ordered list)");
  else {
    const opIds = new Set();
    for (const op of plan.operations) {
      if (!op || typeof op !== "object") { errs.push("operation must be an object"); continue; }
      if (!op.op_id || !op.kind) { errs.push("operation requires op_id and kind"); continue; }
      const kind = op.kind;
      if (!SUPPORTED_KINDS.has(kind)) { errs.push("unsupported op kind " + kind); continue; }
      if (opIds.has(op.op_id)) errs.push("duplicate op_id " + op.op_id); opIds.add(op.op_id);
      for (const f of OP_REQUIRED[kind] || []) if (op[f] === undefined || op[f] === null) errs.push(`op ${op.op_id} (${kind}) missing ${f}`);
      // plan-level guards
      if (kind === "rename") {
        const targets = Object.values(op.mapping || {});
        if (new Set(targets).size !== targets.length) errs.push(`op ${op.op_id} rename has duplicate target columns`);
      }
      if (kind === "merge") {
        const inputIds = new Set((plan.inputs || []).map((i) => i.input_id));
        if (!inputIds.has(op.right)) errs.push(`op ${op.op_id} merge references unknown input`);
        if (op.cardinality === "m:m") errs.push(`op ${op.op_id} merge m:m is not supported (fail closed)`);
        if ((op.left_keys || []).length === 0 || (op.right_keys || []).length === 0) errs.push(`op ${op.op_id} merge requires keys`);
        if (op.left_keys && op.right_keys && op.left_keys.length !== op.right_keys.length) errs.push(`op ${op.op_id} merge left/right key cardinality mismatch`);
      }
      if (kind === "map_code" && op.unknown !== "fail") errs.push(`op ${op.op_id} map_code unknown policy must be fail (no fuzzy) `);
    }
  }
  return errs;
}
export function canonicalHarmonizePlanHash(plan) {
  return createHash("sha256").update(canonicalJson(plan), "utf8").digest("hex");
}
export function harmonizePlanIsValid(plan) { return validateHarmonizePlan(plan).length === 0; }
