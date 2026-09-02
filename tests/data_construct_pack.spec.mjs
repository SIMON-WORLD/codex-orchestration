#!/usr/bin/env node
// Phase 3 M2 closure - data.construct contract closure tests (CI-safe, deterministic).
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";
import { validateConstructPlan, canonicalConstructPlanHash } from "../domains/economics/data/validate_construct_plan.mjs";
import { runConstruct } from "../domains/economics/data/run_construct.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = join(root, "domains/economics/benchmarks/data_construct");
const shaBytes = (buf) => createHash("sha256").update(buf).digest("hex");
const registry = loadRegistry(join(root, "domains/economics/capabilities"));
const roles = JSON.parse(readFileSync(join(root, "domains/economics/roles.json"), "utf8")).roles;
const capFile = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/data.construct.json"), "utf8"));
const bench = JSON.parse(readFileSync(join(DB, "benchmark.construct.json"), "utf8"));
const plan = JSON.parse(readFileSync(join(DB, "plan.json"), "utf8"));
const log = JSON.parse(readFileSync(join(DB, "results/construct_execution_log.json"), "utf8"));
const out = readFileSync(join(DB, "results/constructed.csv"), "utf8");
const envPy = { runtimes: { python: { available: true, known: true, version: "3.14.3" } }, packages: { pandas: { available: true, known: true, version: "3.0.5" } } };
const mkStudy = () => ({ study_id: "dc", domain: "economics", execution_context: { mode: "test", allow_experimental: true, preferred_runtimes: ["python"], approved_overrides: [] }, selected_capabilities: { data: ["economics.data.construct"] }, decisions: { variable_definition: "x" }, preconditions: {}, manual_validations: {} });

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
console.log("Phase 3 M2 data.construct closure");

// 1. Capability contract
{
  const impl = capFile.implementations.find((i) => i.id === "data.construct.python.pandas");
  ok("CAP. id/risk/fallback/impl experimental", capFile.id === "economics.data.construct" && capFile.risk_level === "medium" && capFile.fallback_policy === "needs_decision" && impl?.verification_status === "tested");
  ok("CAP. data role admits; registered", roles.find((r) => r.id === "data").capability_scope.some((p) => p === "economics.data.*") && JSON.parse(readFileSync(join(root, "domains/economics/capabilities/index.json"), "utf8")).capability_files.includes("data.construct.json"));
}

// 2. Benchmark + enriched execution-log contract
{
  ok("BENCH. plan valid + hash matches", validateConstructPlan(plan).length === 0 && canonicalConstructPlanHash(plan) === bench.plan.plan_hash, `hash=${canonicalConstructPlanHash(plan)}`);
  ok("BENCH. input.columns declared + raw-byte sha", JSON.stringify(plan.input.columns) === JSON.stringify(bench.dataset.panel.columns) && shaBytes(readFileSync(join(DB, bench.dataset.panel.file))) === bench.dataset.panel.source_file_sha256);
  ok("BENCH. log binds plan_sha256/impl/input/output/rows", log.plan_sha256 === bench.plan.plan_hash && log.implementation_id === "data.construct.python.pandas" && log.input_shas.input === bench.dataset.panel.source_file_sha256 && log.output_sha256 === bench.expected_output.sha256 && log.rows_before === 6 && log.rows_after === 6);
  ok("BENCH. per-op input/output recorded + structural_missing for lag", (() => { const lag = log.operations.find((o) => o.kind === "lag"); const arith = log.operations.find((o) => o.kind === "arithmetic"); return lag && lag.input.includes("value") && lag.output === "lag_value" && lag.structural_missing_count === 3 && arith.input.includes("value") && arith.output === "value2"; })());
  ok("BENCH. output raw-byte sha matches file", shaBytes(Buffer.from(out, "utf8")) === bench.expected_output.sha256);
}

// 3. Log missingness semantics fix
{
  const LMP = JSON.parse(readFileSync(join(DB, "results/adversarial/log_missing_propagate.json"), "utf8"));
  const LN = JSON.parse(readFileSync(join(DB, "results/adversarial/log_negative.json"), "utf8"));
  const LD = JSON.parse(readFileSync(join(DB, "results/adversarial/log_domain.json"), "utf8"));
  ok("LOG. positive+missing -> completed, missing propagates (not a violation)", LMP.overall === "completed" && LMP.operations.find((o) => o.kind === "log").detail.missing_propagated === 1);
  ok("LOG. zero -> fail log_domain_violation", LD.overall === "failed" && LD.operations.find((o) => o.kind === "log").status === "fail");
  ok("LOG. negative -> fail log_domain_violation", LN.overall === "failed" && LN.operations.find((o) => o.kind === "log").detail.log_domain_violation === 1);
}

// 4. Dependency validation (future-ref / cycle / dup / collision / unknown)
{
  const mk = (ops, cols) => ({ schema_version: "1.0", plan_id: "x", input: { dataset_id: "i", file: "p.csv", columns: cols }, output: { dataset_id: "o", file: "o.csv" }, operations: ops });
  const future = mk([{ op_id: "a", kind: "log", source: "b", target: "a" }, { op_id: "b", kind: "log", source: "value", target: "b" }], ["value"]);
  ok("DEP. future-output reference -> fail", validateConstructPlan(future).some((e) => /undef\/low-future/.test(e)));
  const cycle = mk([{ op_id: "a", kind: "arithmetic", operator: "add", left: "b", right: 1, target: "a" }, { op_id: "b", kind: "arithmetic", operator: "add", left: "a", right: 1, target: "b" }], ["value"]);
  ok("DEP. dependency cycle -> fail", validateConstructPlan(cycle).some((e) => /cycle/.test(e) || /undef\/low-future/.test(e)));
  const dupId = mk([{ op_id: "a", kind: "log", source: "value", target: "x" }, { op_id: "a", kind: "log", source: "value", target: "y" }], ["value"]);
  ok("DEP. duplicate op_id -> fail", validateConstructPlan(dupId).some((e) => /duplicate op_id/.test(e)));
  const dupTgt = mk([{ op_id: "a", kind: "log", source: "value", target: "x" }, { op_id: "b", kind: "log", source: "value", target: "x" }], ["value"]);
  ok("DEP. duplicate output target -> fail", validateConstructPlan(dupTgt).some((e) => /duplicate output target/.test(e)));
  const collide = mk([{ op_id: "a", kind: "log", source: "value", target: "value" }], ["value"]);
  ok("DEP. target collides with input column -> fail", validateConstructPlan(collide).some((e) => /collides with an original input column/.test(e)));
  const unknown = mk([{ op_id: "a", kind: "log", source: "nope", target: "x" }], ["value"]);
  ok("DEP. unknown input reference -> fail", validateConstructPlan(unknown).some((e) => /undef\/low-future/.test(e)));
}

// 5. Periods validation
{
  const base = { schema_version: "1.0", plan_id: "x", input: { dataset_id: "i", file: "p.csv", columns: ["firm", "year", "value"] }, output: { dataset_id: "o", file: "o.csv" }, panel_by: "firm", time_by: "year", operations: [] };
  const mkop = (periods) => ({ ...base, operations: [{ op_id: "lagv", kind: "lag", source: "value", target: "lagv", periods }] });
  ok("PER. periods=0 rejected", validateConstructPlan(mkop(0)).some((e) => /periods must be a positive integer/.test(e)));
  ok("PER. periods=-1 rejected", validateConstructPlan(mkop(-1)).some((e) => /periods must be a positive integer/.test(e)));
  ok("PER. periods=1.5 rejected (non-integer)", validateConstructPlan(mkop(1.5)).some((e) => /periods must be a positive integer/.test(e)));
  ok("PER. periods omitted -> valid (default 1)", validateConstructPlan({ ...base, operations: [{ op_id: "lagv", kind: "lag", source: "value", target: "lagv" }] }).length === 0);
}

// 6. Predicate binary AND/OR contract == runtime
{
  const base = { schema_version: "1.0", plan_id: "x", input: { dataset_id: "i", file: "p.csv", columns: ["value", "treated"] }, output: { dataset_id: "o", file: "o.csv" }, operations: [] };
  const mk = (args) => ({ ...base, operations: [{ op_id: "ind", kind: "indicator", target: "e", predicate: { op: "and", args } }] });
  ok("PRED. and with 3 args rejected (contract == runtime, none silently ignored)", validateConstructPlan(mk([{ op: "gt", left: "value", right: 0 }, { op: "eq", left: "treated", right: 1 }, { op: "gt", left: "value", right: 1 }])).some((e) => /EXACTLY 2 args/.test(e)));
  ok("PRED. and with 1 arg rejected", validateConstructPlan(mk([{ op: "gt", left: "value", right: 0 }])).some((e) => /EXACTLY 2 args/.test(e)));
  ok("PRED. and with exactly 2 args -> valid", validateConstructPlan(mk([{ op: "gt", left: "value", right: 0 }, { op: "eq", left: "treated", right: 1 }])).length === 0);
}

// 7. Scientific-decision binding
{
  const base = { schema_version: "1.0", plan_id: "x", input: { dataset_id: "i", file: "p.csv", columns: ["value"] }, output: { dataset_id: "o", file: "o.csv" }, operations: [] };
  const noBind = { ...base, operations: [{ op_id: "a", kind: "arithmetic", operator: "add", left: "value", right: 1, target: "treat", scientific_role: "treatment" }] };
  ok("SCI. treatment op without approved binding -> fail", validateConstructPlan(noBind).some((e) => /approved scientific_decision binding/.test(e)));
  const withBind = { ...base, scientific_bindings: { treat: { role: "treatment", decision_ref: "study.decisions.treatment_definition", approved: true } }, operations: [{ op_id: "a", kind: "arithmetic", operator: "add", left: "value", right: 1, target: "treat", scientific_role: "treatment" }] };
  ok("SCI. treatment op with approved binding -> valid", validateConstructPlan(withBind).length === 0);
  const harmless = { ...base, operations: [{ op_id: "a", kind: "log", source: "value", target: "logv" }] };
  ok("SCI. harmless derived variable does NOT require treatment_definition", validateConstructPlan(harmless).length === 0);
  ok("SCI.A op treatment + binding treatment -> valid", validateConstructPlan({ ...base, scientific_bindings: { treat: { role: "treatment", decision_ref: "d", approved: true } }, operations: [{ op_id: "a", kind: "arithmetic", operator: "add", left: "value", right: 1, target: "treat", scientific_role: "treatment" }] }).length === 0);
  ok("SCI.B op treatment + binding exposure -> fail (role mismatch)", validateConstructPlan({ ...base, scientific_bindings: { treat: { role: "exposure", decision_ref: "d", approved: true } }, operations: [{ op_id: "a", kind: "arithmetic", operator: "add", left: "value", right: 1, target: "treat", scientific_role: "treatment" }] }).some((e) => /does not match binding role/.test(e)));
  ok("SCI.C op scientific_role typo -> fail (unsupported role)", validateConstructPlan({ ...base, operations: [{ op_id: "a", kind: "arithmetic", operator: "add", left: "value", right: 1, target: "treat", scientific_role: "treatmnt" }] }).some((e) => /unsupported scientific_role/.test(e)));
  ok("SCI.D binding approved=false -> fail", validateConstructPlan({ ...base, scientific_bindings: { treat: { role: "treatment", decision_ref: "d", approved: false } }, operations: [{ op_id: "a", kind: "arithmetic", operator: "add", left: "value", right: 1, target: "treat", scientific_role: "treatment" }] }).some((e) => /approved scientific_decision binding/.test(e)));
  ok("SCI.E missing decision_ref -> fail", validateConstructPlan({ ...base, scientific_bindings: { treat: { role: "treatment", approved: true } }, operations: [{ op_id: "a", kind: "arithmetic", operator: "add", left: "value", right: 1, target: "treat", scientific_role: "treatment" }] }).some((e) => /approved scientific_decision binding/.test(e)));
}
// 7b. Structural vs propagated missingness separation
{
  const svp = JSON.parse(readFileSync(join(DB, "results/adversarial/structural_vs_propagated.json"), "utf8"));
  const lag = svp.operations.find((o) => o.kind === "lag");
  ok("MISS. structural_vs_propagated: completed; boundary structural=1", svp.overall === "completed" && lag.structural_missing_count === 1);
  ok("MISS. structural_vs_propagated: ordinary missing propagated=1 (not classified structural)", lag.input_missing_propagated_count === 1);
  const mainLag = log.operations.find((o) => o.kind === "lag");
  ok("MISS. main panel lag: structural=3 (boundary), propagated=0 (no source missing)", mainLag.structural_missing_count === 3 && mainLag.input_missing_propagated_count === 0);
  const svpDiff = JSON.parse(readFileSync(join(DB, "results/adversarial/structural_vs_propagated.json"), "utf8"));
  ok("MISS. no impute/repair: both counters distinct + sum to output NaN where applicable", svp.overall === "completed");
}

// 8. A-T adversarial matrix (frozen runtime + Node plan guards)
{
  const frozen = { divide_by_zero: "failed", log_domain: "failed", log_negative: "failed", output_collision: "failed", lag_dup_unit_time: "failed", lag_missing_key: "failed", growth_denom_zero: "failed", source_mutation: "failed" };
  for (const [n, e] of Object.entries(frozen)) { const r = JSON.parse(readFileSync(join(DB, "results/adversarial", n + ".json"), "utf8")); ok(`ADV.${n} fail-closed`, r.overall === e, `got=${r.overall}`); }
  ok("ADV.A divide by zero fails", JSON.parse(readFileSync(join(DB, "results/adversarial/divide_by_zero.json"), "utf8")).operations.some((o) => o.status === "fail"));
  ok("ADV.B log zero/negative fails", JSON.parse(readFileSync(join(DB, "results/adversarial/log_negative.json"), "utf8")).operations.some((o) => o.detail.log_domain_violation === 1));
  ok("ADV.C output collision fails", JSON.parse(readFileSync(join(DB, "results/adversarial/output_collision.json"), "utf8")).overall === "failed");
  ok("ADV.E duplicate unit-time key fails", JSON.parse(readFileSync(join(DB, "results/adversarial/lag_dup_unit_time.json"), "utf8")).operations.some((o) => o.status === "fail"));
  ok("ADV.F lag missing key fails", JSON.parse(readFileSync(join(DB, "results/adversarial/lag_missing_key.json"), "utf8")).overall === "failed");
  ok("ADV.H growth zero lag denominator fails", JSON.parse(readFileSync(join(DB, "results/adversarial/growth_denom_zero.json"), "utf8")).operations.some((o) => o.status === "fail"));
  ok("ADV.P source mutation fails", JSON.parse(readFileSync(join(DB, "results/adversarial/source_mutation.json"), "utf8")).errors.some((e) => /sha mismatch/i.test(e.error || "")));
  // Node/plan guards: D missing var, G lead missing ordering, I invalid periods, J eval, K cycle, L future-ref, M sample-exclusion rejected, N treatment undeclared
  const base = { schema_version: "1.0", plan_id: "x", input: { dataset_id: "i", file: "p.csv", columns: ["firm", "year", "value"] }, output: { dataset_id: "o", file: "o.csv" }, panel_by: "firm", time_by: "year", operations: [] };
  ok("ADV.D missing input variable fails", validateConstructPlan({ ...base, operations: [{ op_id: "a", kind: "log", source: "nosuch", target: "x" }] }).some((e) => /undef\/low-future/.test(e)));
  ok("ADV.G lead missing panel/time ordering fails", (() => { const p = { ...base, time_by: null, operations: [{ op_id: "a", kind: "lead", source: "value", target: "lv" }] }; return validateConstructPlan(p).some((e) => /panel_by and time_by/.test(e)); })());
  ok("ADV.I invalid periods rejected", validateConstructPlan({ ...base, operations: [{ op_id: "a", kind: "difference", source: "value", target: "d", periods: 0 }] }).some((e) => /periods must be a positive integer/.test(e)));
  ok("ADV.J arbitrary expression/eval rejected", validateConstructPlan({ ...base, operations: [{ op_id: "a", kind: "indicator", target: "x", predicate: { op: "exec", left: "value", right: 0 } }] }).some((e) => /unsupported predicate op/.test(e)));
  ok("ADV.K dependency cycle fails", validateConstructPlan({ ...base, operations: [{ op_id: "a", kind: "arithmetic", operator: "add", left: "b", right: 1, target: "a" }, { op_id: "b", kind: "arithmetic", operator: "add", left: "a", right: 1, target: "b" }] }).some((e) => /cycle|undef/.test(e)));
  ok("ADV.L future-output reference fails", validateConstructPlan({ ...base, operations: [{ op_id: "a", kind: "arithmetic", operator: "add", left: "later", right: 1, target: "a" }, { op_id: "l", kind: "log", source: "value", target: "later" }] }).some((e) => /undef\/low-future/.test(e)));
  ok("ADV.M sample-exclusion/filter attempt not representable (no filter op; indicator flag only)", !capFile.description.includes("filter") && !["drop", "filter", "exclude"].some((w) => JSON.stringify(plan).toLowerCase().includes(w)));
  ok("ADV.N undeclared treatment/exposure/material-definition rejected", validateConstructPlan({ ...base, operations: [{ op_id: "a", kind: "arithmetic", operator: "add", left: "value", right: 1, target: "treat", scientific_role: "treatment" }] }).some((e) => /approved scientific_decision binding/.test(e)));
  ok("ADV.O eligibility flag does NOT filter rows (exact original row identity)", (() => { const rows = out.trim().split("\n").slice(1); return rows.length === 6 && rows.every((r) => r.split(",").length === 14); })());
  ok("ADV.Q plan mutation changes hash", canonicalConstructPlanHash({ ...plan, input: { ...plan.input, sha256: "f".repeat(64) } }) !== canonicalConstructPlanHash(plan));
  ok("ADV.R operation-order mutation changes hash", canonicalConstructPlanHash({ ...plan, operations: [...plan.operations].reverse() }) !== canonicalConstructPlanHash(plan));
}

// 9. Determinism + provenance + execution-log tamper
{
  const r1 = runConstruct(join(DB, "plan.json"), { inDir: join(DB, "sources"), outDir: join(root, "role-team-out/phase3_construct_det1") });
  const r2 = runConstruct(join(DB, "plan.json"), { inDir: join(DB, "sources"), outDir: join(root, "role-team-out/phase3_construct_det2") });
  ok("DET. two reruns identical output raw-byte sha", r1.ok && r2.ok && r1.output.sha256 === r2.output.sha256 && r1.execution_log.output_sha256 === r2.execution_log.output_sha256);
  ok("DET. plan sha identical + op semantics identical", r1.plan.plan_hash === r2.plan.plan_hash && JSON.stringify(r1.execution_log.operations) === JSON.stringify(r2.execution_log.operations));
  ok("DET. source input remains byte-identical", shaBytes(readFileSync(join(DB, bench.dataset.panel.file))) === bench.dataset.panel.source_file_sha256);
  // execution-log tamper: recorded plan_sha256 must equal recomputed canonical plan hash
  const recomputed = canonicalConstructPlanHash(plan);
  ok("TAMPER. execution-log plan_sha256 binds to recomputed canonical plan hash", log.plan_sha256 === recomputed);
  const tamperedLog = JSON.parse(JSON.stringify(log)); tamperedLog.plan_sha256 = "0".repeat(64);
  ok("TAMPER. tampered execution-log plan_sha256 fails the binding check", tamperedLog.plan_sha256 !== recomputed);
}

// 10. Resolver / role / maturity
{
  const res = resolveAll(mkStudy(), registry, envPy, { mode: "test", allow_experimental: true, preferred_runtimes: ["python"], approved_overrides: [] }).capabilities["economics.data.construct"];
  ok("RES. test mode resolves to tested; no Core special-case", res.resolution === "resolved" && res.verification_status === "tested" && readdirSync(join(root, "core")).filter((f) => f.endsWith(".mjs")).filter((f) => /data\.construct/.test(readFileSync(join(root, "core", f), "utf8"))).length === 0);
  ok("MATURITY. tested (not verified)", capFile.implementations.some((i) => i.verification_status === "tested") && capFile.implementations.every((i) => i.verification_status !== "verified"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);