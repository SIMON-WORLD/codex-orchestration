#!/usr/bin/env node
// Domain-level construct plan validator + canonical hash (NOT Core).
// Enforces the frozen M2 construct contract: safe declarative structured expressions ONLY; rejects
// any arbitrary expression/eval; enforces panel/time key requirements for lag/lead/difference/growth.
// Structural + plan-level guard checks only. Runtime data guards are enforced by the Python/pandas
// implementation and frozen benchmark evidence; this module is used by CI tests deterministically.
import { createHash } from "node:crypto";
import { canonicalJson } from "../../../core/artifact_hash.mjs";

const SUPPORTED_KINDS = new Set(["arithmetic", "log", "ratio", "difference", "growth_rate", "interaction", "lag", "lead", "indicator"]);
const OP_REQUIRED = {
  arithmetic: ["operator", "left", "right", "target"],
  log: ["source", "target"],
  ratio: ["numerator", "denominator", "target"],
  difference: ["source", "target"],
  growth_rate: ["source", "target"],
  interaction: ["terms", "target"],
  lag: ["source", "target"],
  lead: ["source", "target"],
  indicator: ["target", "predicate"],
};
const PRED_OPS = new Set(["gt", "gte", "lt", "lte", "eq", "neq", "and", "or"]);
function validatePredicate(pred, errs, path) {
  if (!pred || typeof pred !== "object") { errs.push(`${path}: predicate must be an object`); return; }
  const op = pred.op;
  if (!PRED_OPS.has(op)) { errs.push(`${path}: unsupported predicate op ${op} (no arbitrary expression/eval)`); return; }
  if (op === "and" || op === "or") {
    if (!Array.isArray(pred.args) || pred.args.length < 2) errs.push(`${path}: ${op} requires >=2 args`);
    else pred.args.forEach((a, i) => validatePredicate(a, errs, `${path}.args[${i}]`));
  } else {
    if (pred.left === undefined || pred.right === undefined) errs.push(`${path}: comparison op requires left/right`);
    if (pred.left && typeof pred.left === "object" && "op" in pred.left) validatePredicate(pred.left, errs, `${path}.left`);
    if (pred.right && typeof pred.right === "object" && "op" in pred.right) validatePredicate(pred.right, errs, `${path}.right`);
  }
}
export function validateConstructPlan(plan) {
  const errs = [];
  if (!plan || typeof plan !== "object") return ["plan must be an object"];
  if (plan.schema_version !== "1.0") errs.push("schema_version must be 1.0");
  if (typeof plan.plan_id !== "string" || !plan.plan_id.trim()) errs.push("plan_id required");
  if (!plan.input || !plan.input.dataset_id || !plan.input.file) errs.push("input requires dataset_id/file");
  if (!plan.output || !plan.output.dataset_id || !plan.output.file) errs.push("output requires dataset_id/file");
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) errs.push("operations required (non-empty)");
  else {
    const ids = new Set();
    for (const op of plan.operations) {
      if (!op || typeof op !== "object") { errs.push("operation must be object"); continue; }
      if (!op.op_id || !op.kind) { errs.push("operation requires op_id/kind"); continue; }
      if (ids.has(op.op_id)) errs.push("duplicate op_id " + op.op_id); ids.add(op.op_id);
      const kind = op.kind;
      if (!SUPPORTED_KINDS.has(kind)) { errs.push("unsupported op kind " + kind); continue; }
      for (const f of OP_REQUIRED[kind] || []) if (op[f] === undefined || op[f] === null) errs.push(`op ${op.op_id} (${kind}) missing ${f}`);
      if (kind === "interaction") {
        if (op.terms.length < 2) errs.push(`op ${op.op_id} interaction requires >=2 terms`);
        if (new Set(op.terms).size !== op.terms.length) errs.push(`op ${op.op_id} interaction has duplicate terms`);
      }
      if (kind === "arithmetic") {
        if (!["add", "subtract", "multiply", "divide"].includes(op.operator)) errs.push(`op ${op.op_id} arithmetic bad operator ${op.operator}`);
        // left/right must be column name (string) or scalar (number/bool) -> no eval
        if (typeof op.left !== "string" && typeof op.left !== "number") errs.push(`op ${op.op_id} arithmetic left must be column/scalar`);
        if (typeof op.right !== "string" && typeof op.right !== "number") errs.push(`op ${op.op_id} arithmetic right must be column/scalar`);
      }
      if (kind === "log" && !["natural", "10"].includes(op.base || "natural")) errs.push(`op ${op.op_id} log bad base`);
      if (kind === "indicator") validatePredicate(op.predicate, errs, `op ${op.op_id} predicate`);
      // panel/time requirement for lag/lead/difference/growth
      if (["lag", "lead", "difference", "growth_rate"].includes(kind)) {
        const pb = op.panel_by || plan.panel_by; const tb = op.time_by || plan.time_by;
        if (!pb || !tb) errs.push(`op ${op.op_id} ${kind} requires panel_by and time_by (declared)`);
      }
    }
  }
  return errs;
}
export function canonicalConstructPlanHash(plan) {
  return createHash("sha256").update(canonicalJson(plan), "utf8").digest("hex");
}
export function constructPlanIsValid(plan) { return validateConstructPlan(plan).length === 0; }