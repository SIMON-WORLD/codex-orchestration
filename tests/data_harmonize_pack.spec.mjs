#!/usr/bin/env node
// Phase 3 M1 - data.harmonize capability contract + frozen synthetic benchmark + adversarial evidence.
// CI-safe: uses committed frozen (python-produced) evidence + the deterministic Node plan validator.
// Does NOT spawn python in CI.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";
import { validateHarmonizePlan, canonicalHarmonizePlanHash } from "../domains/economics/data/validate_harmonize_plan.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = join(root, "domains/economics/benchmarks/data_harmonize");
const shaBytes = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const shaText = shaBytes;
const registry = loadRegistry(join(root, "domains/economics/capabilities"));
const roles = JSON.parse(readFileSync(join(root, "domains/economics/roles.json"), "utf8")).roles;
const capFile = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/data.harmonize.json"), "utf8"));
const bench = JSON.parse(readFileSync(join(DB, "benchmark.harmonize.json"), "utf8"));
const plan = JSON.parse(readFileSync(join(DB, "plan.json"), "utf8"));
const log = JSON.parse(readFileSync(join(DB, "results/harmonize_execution_log.json"), "utf8"));
const out = readFileSync(join(DB, "results/harmonized.csv"), "utf8");
const envPy = { runtimes: { python: { available: true, known: true, version: "3.14.3" } }, packages: { pandas: { available: true, known: true, version: "3.0.5" } } };
const envNoPy = { runtimes: { python: { available: false, known: false, version: null } }, packages: {} };
const mkStudy = (caps, decisions = { variable_definition: "clean panel" }, mode = "production") => ({
  study_id: "dh_test", domain: "economics",
  execution_context: { mode, allow_experimental: mode === "test", preferred_runtimes: ["python"], approved_overrides: [] },
  selected_capabilities: { data: caps }, decisions, preconditions: {}, manual_validations: {},
});

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }

console.log("Phase 3 M1 data.harmonize vault");

// 1. Capability contract
{
  ok("CAP. id/risk/fallback correct", capFile.id === "economics.data.harmonize" && capFile.risk_level === "medium" && capFile.fallback_policy === "needs_decision");
  const impl = capFile.implementations.find((i) => i.id === "data.harmonize.python.pandas");
  ok("CAP. implementation python/pandas experimental + benchmark_ref", impl?.runtime === "python" && impl.verification_status === "experimental" && impl.verification?.benchmark_ref === "domains/economics/benchmarks/data_harmonize/");
  ok("CAP. registered in capability index", JSON.parse(readFileSync(join(root, "domains/economics/capabilities/index.json"), "utf8")).capability_files.includes("data.harmonize.json"));
  const dataRole = roles.find((r) => r.id === "data");
  ok("CAP. data role admits economics.data.* (harmonize in scope)", dataRole.capability_scope.some((p) => p === "economics.data.*"));
  ok("CAP. no new worker role required (data role exists; scope admits)", Boolean(dataRole));
}

// 2. Frozen benchmark evidence + plan consistency
{
  ok("BENCH. plan valid and hash matches manifest", validateHarmonizePlan(plan).length === 0 && canonicalHarmonizePlanHash(plan) === bench.plan.plan_hash, `hash=${canonicalHarmonizePlanHash(plan)}`);
  ok("BENCH. execution log overall completed + impl id", log.overall === "completed" && log.implementation_id === "data.harmonize.python.pandas");
  ok("BENCH. input shas in log match manifest source shas", log.input_shas.main === bench.dataset.main.sha256 && log.input_shas.lookup === bench.dataset.lookup.sha256);
  ok("BENCH. output sha in log matches manifest + recomputed output", log.output_sha256 === bench.expected_output.sha256 && shaText(out) === bench.expected_output.sha256);
  ok("BENCH. rows/cols match expected", bench.expected_output.rows === 4 && bench.expected_output.columns === 11 && log.rows_after === 4 && log.cols_after === 11);
  ok("BENCH. all operations ok (rename/coerce/normalize_key/map_code/date/unit/merge)", log.operations.every((o) => o.status === "ok"));
  const mergeOp = log.operations.find((o) => o.kind === "merge");
  ok("BENCH. merge 1:1 matched=4 unmatched=0", mergeOp.detail.matched === 4 && mergeOp.detail.unmatched === 0 && bench.expected_facts.merge.matched === 4);
  ok("BENCH. zero coercion/code failures + zero warnings", bench.expected_facts.coercion_failures === 0 && bench.expected_facts.code_failures === 0 && log.warnings.length === 0);
}

// 3. Determinism + immutability
{
  ok("IMMUT. committed source files byte-identical to declared shas", shaText(readFileSync(join(DB, bench.dataset.main.file), "utf8")) === bench.dataset.main.sha256 && shaText(readFileSync(join(DB, bench.dataset.lookup.file), "utf8")) === bench.dataset.lookup.sha256);
  ok("IMMUT. harmonized output is a separate file (source untouched)", bench.expected_output.file.startsWith("results/harmonized.csv"));
  ok("IMMUT. CRLF<->LF byte change alters source_file_sha256 (raw-byte identity)", (() => { const m = bench.dataset.main.source_file_sha256 || bench.dataset.main.sha256; const lf = readFileSync(join(DB, bench.dataset.main.file), "utf8"); const lfHash = shaBytes(lf); const crlfHash = shaBytes(lf.split("\n").join("\r\n")); return lfHash === m && crlfHash !== lfHash; })());
}

// 4. Frozen adversarial runtime evidence (python-produced, committed)
{
  const cases = {
    type_coercion_fail: { overall: "failed" }, invalid_date: { overall: "failed" }, unknown_code: { overall: "failed" },
    missing_source_column: { overall: "failed" }, dup_key_1to1: { overall: "failed" }, key_normalization_dup: { overall: "failed" },
    unmatched_merge_warn: { overall: "completed" }, row_reduction_inner: { overall: "completed" }, source_mutation: { overall: "failed" },
  };
  for (const [name, exp] of Object.entries(cases)) {
    const r = JSON.parse(readFileSync(join(DB, "results/adversarial", name + ".json"), "utf8"));
    ok(`ADV.${name} overall=${exp.overall}`, r.overall === exp.overall, `got=${r.overall}`);
  }
  const co = JSON.parse(readFileSync(join(DB, "results/adversarial/type_coercion_fail.json"), "utf8"));
  ok("ADV.type_coercion_fail surfaces coerce error", co.operations.some((o) => o.kind === "coerce" && o.status === "fail"));
  const unk = JSON.parse(readFileSync(join(DB, "results/adversarial/unknown_code.json"), "utf8"));
  ok("ADV.unknown_code fails closed (no fuzzy mapping)", unk.operations.some((o) => o.kind === "map_code" && o.status === "fail"));
  const dup = JSON.parse(readFileSync(join(DB, "results/adversarial/dup_key_1to1.json"), "utf8"));
  ok("ADV.dup_key_1to1 fails on cardinality violation", dup.operations.some((o) => o.kind === "merge" && o.status === "fail"));
  const um = JSON.parse(readFileSync(join(DB, "results/adversarial/unmatched_merge_warn.json"), "utf8"));
  ok("ADV.unmatched_merge_warn recorded as warning (allowed policy)", um.overall === "completed" && um.warnings.some((w) => w.unmatched_records === 1));
  const rr = JSON.parse(readFileSync(join(DB, "results/adversarial/row_reduction_inner.json"), "utf8"));
  ok("ADV.row_reduction_inner records row-count effect (warning)", rr.overall === "completed" && rr.warnings.some((w) => w.row_count_effect && w.row_count_effect.before === 4 && w.row_count_effect.after === 3));
  const sm = JSON.parse(readFileSync(join(DB, "results/adversarial/source_mutation.json"), "utf8"));
  ok("ADV.source_mutation fails closed (sha mismatch)", sm.overall === "failed" && sm.errors.some((e) => /sha mismatch/i.test(e.error || "")));
}

// 5. Plan-level guards (Node, deterministic)
{
  const mm = structuredClone(plan); mm.operations[mm.operations.length - 1].cardinality = "m:m";
  ok("GUARD. m:m merge plan rejected", validateHarmonizePlan(mm).some((e) => /m:m/.test(e)));
  const renameDup = structuredClone(plan); renameDup.operations[0].mapping = { A: "x", B: "x" };
  ok("GUARD. duplicate rename targets rejected", validateHarmonizePlan(renameDup).some((e) => /duplicate target/.test(e)));
  const unkInput = structuredClone(plan); unkInput.operations[unkInput.operations.length - 1].right = "nope";
  ok("GUARD. merge unknown input rejected", validateHarmonizePlan(unkInput).some((e) => /unknown input/.test(e)));
  const fuzzyCode = structuredClone(plan); fuzzyCode.operations.find((o) => o.kind === "map_code").unknown = "warn";
  ok("GUARD. map_code unknown != fail rejected (no fuzzy)", validateHarmonizePlan(fuzzyCode).some((e) => /unknown policy/.test(e)));
  // tamper / order
  const tampered = structuredClone(plan); tampered.inputs[0].sha256 = "f".repeat(64);
  ok("GUARD. plan content tamper changes canonical hash", canonicalHarmonizePlanHash(tampered) !== canonicalHarmonizePlanHash(plan));
  const reordered = { ...plan, operations: [...plan.operations].reverse() };
  ok("GUARD. operation-order change changes plan hash (where materially different)", canonicalHarmonizePlanHash(reordered) !== canonicalHarmonizePlanHash(plan));
}

// 6. Resolver / role / maturity
{
  const ctx = { mode: "production", allow_experimental: false, preferred_runtimes: ["python"], approved_overrides: [] };
  const rProd = resolveAll(mkStudy(["economics.data.harmonize"]), registry, envPy, ctx).capabilities["economics.data.harmonize"];
  ok("RES. production + python+pandas + experimental -> needs_decision (medium approval), not resolved", rProd.resolution === "needs_decision" && rProd.reason === "medium_approval_required", `got=${rProd.resolution}/${rProd.reason}`);
  const rTest = resolveAll(mkStudy(["economics.data.harmonize"]), registry, envPy, { mode: "test", allow_experimental: true, preferred_runtimes: ["python"], approved_overrides: [] }).capabilities["economics.data.harmonize"];
  ok("RES. controlled test mode resolves to experimental", rTest.resolution === "resolved" && rTest.verification_status === "experimental", `got=${rTest.resolution}/${rTest.verification_status}`);
  const rNoPy = resolveAll(mkStudy(["economics.data.harmonize"]), registry, envNoPy, ctx).capabilities["economics.data.harmonize"];
  ok("RES. no python runtime -> medium needs_decision (no impl approval required)", rNoPy.resolution === "needs_decision", `got=${rNoPy.resolution}/${rNoPy.reason}`);
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const coreHits = readdirSync(join(root, "core")).filter((f) => f.endsWith(".mjs")).filter((f) => /data\.harmonize|economics\.data\.harmonize|harmonize/.test(stripComments(readFileSync(join(root, "core", f), "utf8"))));
  ok("RES. no Core special-case for harmonize", coreHits.length === 0, `hits=${coreHits.join(",")}`);
  ok("MATURITY. data.harmonize implementation experimental (not tested/verified)", capFile.implementations.every((i) => i.verification_status === "experimental" && i.verification_status !== "tested" && i.verification_status !== "verified"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);