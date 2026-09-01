#!/usr/bin/env node
// Phase 3 M2 - data.construct capability contract + frozen synthetic benchmark + adversarial evidence.
// CI-safe: uses committed frozen (python-produced) evidence + the deterministic Node plan validator.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";
import { validateConstructPlan, canonicalConstructPlanHash } from "../domains/economics/data/validate_construct_plan.mjs";

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
const envNoPy = { runtimes: { python: { available: false, known: false, version: null } }, packages: {} };
const mkStudy = (caps, decisions = { variable_definition: "defined vars" }, mode = "production") => ({
  study_id: "dc_test", domain: "economics",
  execution_context: { mode, allow_experimental: mode === "test", preferred_runtimes: ["python"], approved_overrides: [] },
  selected_capabilities: { data: caps }, decisions, preconditions: {}, manual_validations: {},
});

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }

console.log("Phase 3 M2 data.construct vault");

// 1. Capability contract
{
  ok("CAP. id/risk/fallback correct", capFile.id === "economics.data.construct" && capFile.risk_level === "medium" && capFile.fallback_policy === "needs_decision");
  const impl = capFile.implementations.find((i) => i.id === "data.construct.python.pandas");
  ok("CAP. impl python/pandas experimental + benchmark_ref", impl?.runtime === "python" && impl.verification_status === "experimental" && impl.verification?.benchmark_ref === "domains/economics/benchmarks/data_construct/");
  ok("CAP. registered in index", JSON.parse(readFileSync(join(root, "domains/economics/capabilities/index.json"), "utf8")).capability_files.includes("data.construct.json"));
  const dataRole = roles.find((r) => r.id === "data");
  ok("CAP. data role admits economics.data.* (construct in scope)", dataRole.capability_scope.some((p) => p === "economics.data.*"));
  ok("CAP. no arbitrary eval in capability description", !/eval\s*\(|eval\(/i.test(capFile.description) || /no arbitrary eval/.test(capFile.description));
}

// 2. Frozen benchmark + plan consistency
{
  ok("BENCH. plan valid and hash matches manifest", validateConstructPlan(plan).length === 0 && canonicalConstructPlanHash(plan) === bench.plan.plan_hash, `hash=${canonicalConstructPlanHash(plan)}`);
  ok("BENCH. all 9 op families present", ["arithmetic","log","ratio","difference","growth_rate","interaction","lag","lead","indicator"].every((k) => log.operations.some((o) => o.kind === k)));
  ok("BENCH. execution log completed + all ops ok", log.overall === "completed" && log.operations.every((o) => o.status === "ok"));
  ok("BENCH. input sha in log matches manifest raw-byte", log.input_shas.input === bench.dataset.panel.source_file_sha256);
  ok("BENCH. output sha matches manifest + recomputed file", log.output_sha256 === bench.expected_output.sha256 && shaBytes(Buffer.from(out, "utf8")) === bench.expected_output.sha256);
  ok("BENCH. rows/cols match expected", bench.expected_output.rows === 6 && bench.expected_output.columns === 14 && log.rows_after === 6 && log.cols_after === 14);
  ok("BENCH. eligibility flag computed for firms f001/f003 (firm 2 = 0)", bench.expected_facts.eligible_firms.includes("f001") && bench.expected_facts.eligible_firms.includes("f003"));
  const outRows = out.trim().split("\n").slice(1).map((l) => l.split(","));
  const eligibleByFirm = Object.fromEntries(outRows.map((r) => [r[2], r[1]]));
  ok("BENCH. indicator flag never applied to sample (all rows retained, flag is a column)", outRows.length === 6 && outRows.every((r) => r[2] in eligibleByFirm));
}

// 3. Immutability + determinism
{
  const srcBytes = readFileSync(join(DB, bench.dataset.panel.file));
  ok("IMMUT. source file raw-byte sha matches manifest", shaBytes(srcBytes) === bench.dataset.panel.source_file_sha256);
  ok("IMMUT. CRLF<->LF byte change alters source_file_sha256 (raw-byte identity)", (() => { const lf = readFileSync(join(DB, bench.dataset.panel.file), "utf8"); const lfHash = shaBytes(Buffer.from(lf, "utf8")); const crlfHash = shaBytes(Buffer.from(lf.split("\n").join("\r\n"), "utf8")); return lfHash === bench.dataset.panel.source_file_sha256 && crlfHash !== lfHash; })());
}

// 4. Frozen adversarial runtime evidence
{
  const cases = {
    log_domain: "failed", divide_by_zero: "failed", growth_denom_zero: "failed", lag_dup_unit_time: "failed",
    lag_missing_key: "failed", source_mutation: "failed", output_collision: "failed",
  };
  for (const [name, exp] of Object.entries(cases)) {
    const r = JSON.parse(readFileSync(join(DB, "results/adversarial", name + ".json"), "utf8"));
    ok(`ADV.${name} overall=${exp}`, r.overall === exp, `got=${r.overall}`);
  }
  const ld = JSON.parse(readFileSync(join(DB, "results/adversarial/log_domain.json"), "utf8"));
  ok("ADV.log_domain fails closed (log domain violation)", ld.operations.some((o) => o.kind === "log" && o.status === "fail"));
  const dz = JSON.parse(readFileSync(join(DB, "results/adversarial/divide_by_zero.json"), "utf8"));
  ok("ADV.divide_by_zero fails closed", dz.operations.some((o) => o.status === "fail"));
  const dup = JSON.parse(readFileSync(join(DB, "results/adversarial/lag_dup_unit_time.json"), "utf8"));
  ok("ADV.lag_dup_unit_time fails (duplicate unit-time key)", dup.operations.some((o) => o.kind === "lag" && o.status === "fail"));
  const oc = JSON.parse(readFileSync(join(DB, "results/adversarial/output_collision.json"), "utf8"));
  ok("ADV.output_collision fails", oc.operations.some((o) => o.status === "fail"));
  const sm = JSON.parse(readFileSync(join(DB, "results/adversarial/source_mutation.json"), "utf8"));
  ok("ADV.source_mutation fails closed (sha mismatch)", sm.overall === "failed" && sm.errors.some((e) => /sha mismatch/i.test(e.error || "")));
}

// 5. Plan-level guards (Node, deterministic)
{
  const mut = structuredClone(plan);
  mut.operations.push({ op_id: "evil", kind: "indicator", target: "x", predicate: { op: "bogus", left: "value", right: 0 } });
  ok("GUARD. arbitrary/unsupported predicate op rejected", validateConstructPlan(mut).some((e) => /unsupported predicate op/.test(e)));
  const arith = structuredClone(plan); arith.operations[0].operator = "modulo";
  ok("GUARD. arithmetic bad operator rejected", validateConstructPlan(arith).some((e) => /bad operator/.test(e)));
  const inter = structuredClone(plan); inter.operations.find((o) => o.kind === "interaction").terms = ["value"];
  ok("GUARD. interaction <2 terms rejected", validateConstructPlan(inter).some((e) => />=2 terms/.test(e)));
  const lagNoTime = structuredClone(plan); lagNoTime.operations.find((o) => o.kind === "lag").time_by = null; delete lagNoTime.time_by;
  ok("GUARD. lag without declared time_by (no panel/time) rejected", validateConstructPlan(lagNoTime).some((e) => /panel_by and time_by/.test(e)));
  const tampered = structuredClone(plan); tampered.input.sha256 = "f".repeat(64);
  ok("GUARD. plan tamper changes canonical hash", canonicalConstructPlanHash(tampered) !== canonicalConstructPlanHash(plan));
  const reordered = { ...plan, operations: [...plan.operations].reverse() };
  ok("GUARD. operation-order change changes plan hash", canonicalConstructPlanHash(reordered) !== canonicalConstructPlanHash(plan));
}

// 6. Resolver / role / maturity
{
  const ctx = { mode: "production", allow_experimental: false, preferred_runtimes: ["python"], approved_overrides: [] };
  const rProd = resolveAll(mkStudy(["economics.data.construct"]), registry, envPy, ctx).capabilities["economics.data.construct"];
  ok("RES. production + python+pandas + experimental -> needs_decision (medium approval)", rProd.resolution === "needs_decision" && rProd.reason === "medium_approval_required", `got=${rProd.resolution}/${rProd.reason}`);
  const rTest = resolveAll(mkStudy(["economics.data.construct"]), registry, envPy, { mode: "test", allow_experimental: true, preferred_runtimes: ["python"], approved_overrides: [] }).capabilities["economics.data.construct"];
  ok("RES. controlled test mode resolves to experimental", rTest.resolution === "resolved" && rTest.verification_status === "experimental", `got=${rTest.resolution}/${rTest.verification_status}`);
  const rNoPy = resolveAll(mkStudy(["economics.data.construct"]), registry, envNoPy, ctx).capabilities["economics.data.construct"];
  ok("RES. no python runtime -> medium needs_decision", rNoPy.resolution === "needs_decision", `got=${rNoPy.resolution}/${rNoPy.reason}`);
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const coreHits = readdirSync(join(root, "core")).filter((f) => f.endsWith(".mjs")).filter((f) => /data\.construct|economics\.data\.construct|construct/.test(stripComments(readFileSync(join(root, "core", f), "utf8"))));
  ok("RES. no Core special-case for construct", coreHits.length === 0, `hits=${coreHits.join(",")}`);
  ok("MATURITY. data.construct implementation experimental", capFile.implementations.every((i) => i.verification_status === "experimental" && i.verification_status !== "tested" && i.verification_status !== "verified"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);