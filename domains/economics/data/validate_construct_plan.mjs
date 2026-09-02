#!/usr/bin/env node
// Domain-level construct plan validator + canonical hash (NOT Core).
// Enforces the frozen M2 closure construct contract:
//  - safe declarative structured expressions ONLY (no arbitrary eval / arbitrary expression execution)
//  - ordered dependency graph: each op may reference input columns or outputs of PRIOR ops only;
//    future-output reference and dependency cycles fail; no implicit topological reordering.
//  - unique op_id, unique output target, target must not collide with an original input column.
//  - periods for lag/lead/difference/growth_rate must be a positive integer when supplied.
//  - predicate and/or is strictly binary (exactly 2 args); contract == runtime.
//  - scientific_role on an op requires an approved scientific_decision binding (no invented definitions).
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
const PERIOD_KINDS = new Set(["lag", "lead", "difference", "growth_rate"]);
const PRED_OPS = new Set(["gt", "gte", "lt", "lte", "eq", "neq", "and", "or"]);

function collectPredicateCols(pred, out) {
  if (!pred || typeof pred !== "object") return;
  if (pred.op === "and" || pred.op === "or") { (pred.args || []).forEach((a) => collectPredicateCols(a, out)); return; }
  if (typeof pred.left === "string") out.push(pred.left);
  if (typeof pred.right === "string") out.push(pred.right);
  if (pred.left && typeof pred.left === "object" && "op" in pred.left) collectPredicateCols(pred.left, out);
  if (pred.right && typeof pred.right === "object" && "op" in pred.right) collectPredicateCols(pred.right, out);
}
function opRefCols(op) {
  const out = [];
  if (op.kind === "arithmetic") { if (typeof op.left === "string") out.push(op.left); if (typeof op.right === "string") out.push(op.right); }
  else if (op.kind === "log" || op.kind === "difference" || op.kind === "growth_rate" || op.kind === "lag" || op.kind === "lead") out.push(op.source);
  else if (op.kind === "ratio") out.push(op.numerator, op.denominator);
  else if (op.kind === "interaction") out.push(...op.terms);
  else if (op.kind === "indicator") collectPredicateCols(op.predicate, out);
  return [...new Set(out)];
}
function validatePredicate(pred, errs, path) {
  if (!pred || typeof pred !== "object") { errs.push(`${path}: predicate must be an object`); return; }
  const op = pred.op;
  if (!PRED_OPS.has(op)) { errs.push(`${path}: unsupported predicate op ${op} (no arbitrary expression/eval)`); return; }
  if (op === "and" || op === "or") {
    if (!Array.isArray(pred.args) || pred.args.length !== 2) errs.push(`${path}: ${op} requires EXACTLY 2 args (binary contract; none may be silently ignored)`);
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
  if (!Array.isArray(plan.input?.columns) || plan.input.columns.length === 0) errs.push("input.columns required (non-empty) to validate dependency graph");
  if (!plan.output || !plan.output.dataset_id || !plan.output.file) errs.push("output requires dataset_id/file");
  const defined = new Set((plan.input?.columns || []));
  const targets = new Set();
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) errs.push("operations required (non-empty; order is authoritative)");
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
        if (typeof op.left !== "string" && typeof op.left !== "number") errs.push(`op ${op.op_id} arithmetic left must be column/scalar`);
        if (typeof op.right !== "string" && typeof op.right !== "number") errs.push(`op ${op.op_id} arithmetic right must be column/scalar`);
      }
      if (kind === "log" && !["natural", "10"].includes(op.base || "natural")) errs.push(`op ${op.op_id} log bad base`);
      // periods: positive integer when supplied
      if (PERIOD_KINDS.has(kind) && op.periods !== undefined) {
        if (!Number.isInteger(op.periods) || op.periods < 1) errs.push(`op ${op.op_id} ${kind} periods must be a positive integer (got ${op.periods})`);
      }
      // panel/time requirement
      if (PERIOD_KINDS.has(kind)) {
        const pb = op.panel_by || plan.panel_by; const tb = op.time_by || plan.time_by;
        if (!pb || !tb) errs.push(`op ${op.op_id} ${kind} requires panel_by and time_by (declared)`);
      }
      // dependency graph (order is authoritative; no implicit reordering)
      const refs = opRefCols(op);
      for (const r of refs) if (!defined.has(r)) errs.push(`op ${op.op_id} (${kind}) references undef/low-future column '${r}' (must be an input column or a prior output)`);
      // target uniqueness + no collision with input column
      if (kind !== undefined && op.target !== undefined) {
        if (targets.has(op.target)) errs.push(`op ${op.op_id} duplicate output target '${op.target}'`);
        if ((plan.input?.columns || []).includes(op.target)) errs.push(`op ${op.op_id} output target '${op.target}' collides with an original input column`);
        targets.add(op.target);
      }
      // scientific decision binding
      if (op.scientific_role) {
        const b = plan.scientific_bindings?.[op.target];
        if (!b || b.approved !== true || !b.decision_ref) errs.push(`op ${op.op_id} declares scientific_role '${op.scientific_role}' but lacks an approved scientific_decision binding`);
      }
      if (kind === "indicator") validatePredicate(op.predicate, errs, `op ${op.op_id} predicate`);
      // after dependency check, target becomes defined for subsequent ops
      if (op.target) defined.add(op.target);
    }
  }
  // independent cycle check (should be impossible given ordering, but fail-closed on any built ref graph cycle)
  const byId = new Map(plan.operations?.map((o) => [o.op_id, o]));
  const seen = new Set(); const visiting = new Set();
  const visit = (id) => {
    if (visiting.has(id)) errs.push("dependency cycle detected"); return;
    if (seen.has(id)) return; visiting.add(id);
    const op = byId.get(id); if (op) { for (const r of opRefCols(op)) { // only op outputs (non-input column names)
      const producer = plan.operations.find((o) => o.target === r); if (producer) visit(producer.op_id); } }
    visiting.delete(id); seen.add(id);
  };
  for (const op of plan.operations || []) visit(op.op_id);
  return errs;
}
export function canonicalConstructPlanHash(plan) {
  return createHash("sha256").update(canonicalJson(plan), "utf8").digest("hex");
}
export function constructPlanIsValid(plan) { return validateConstructPlan(plan).length === 0; }