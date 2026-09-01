#!/usr/bin/env node
// One-time generator of frozen adversarial harmonize runtime evidence (python/pandas).
// Each case builds a small plan (+ variant source where needed) in a temp dir, runs the real python
// implementation, and freezes the resulting execution_log JSON under results/adversarial/<case>.json.
// CI tests read these frozen logs (no python needed in CI); the Node validator covers plan-level guards.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { runHarmonize } from "../../data/run_harmonize.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH = join(HERE);
const ROOT = join(BENCH, "..", "..", "..", "..");
const TMP = join(ROOT, "role-team-out/harmonize_adv");
const OUT = join(BENCH, "results", "adversarial");
const shaText = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

function writeCase(name, mainCsv, lookupCsv, ops, opts = {}) {
  const dir = join(TMP, name); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "main.csv"), mainCsv, "utf8");
  // lookup optional (reuse a default if not provided)
  lookupCsv = lookupCsv ?? "firm_key,region\nf001,N\nf002,S\nf003,N\nf004,S\n";
  writeFileSync(join(dir, "lookup.csv"), lookupCsv, "utf8");
  const mainSha = shaText(mainCsv); const lookupSha = shaText(lookupCsv);
  const plan = {
    schema_version: "1.0", plan_id: "adv_" + name, unit_of_analysis: "firm-year (explicit)",
    inputs: [{ input_id: "main", dataset_id: "adv_main", file: "main.csv", sha256: mainSha }, { input_id: "lookup", dataset_id: "adv_lookup", file: "lookup.csv", sha256: lookupSha }],
    output: { dataset_id: "adv_out", file: "out.csv", sort_by: ["firm", "year"] }, operations: ops,
  };
  const planPath = join(dir, "plan.json"); writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n", "utf8");
  const res = runHarmonize(planPath, { inDir: dir, outDir: dir });
  const log = res.execution_log || { overall: res.error ? "failed" : "unknown", runner_error: res.error };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name + ".json"), JSON.stringify({ case: name, implementation_id: "data.harmonize.python.pandas", overall: log.overall, warnings: log.warnings || [], errors: log.errors || [], operations: (log.operations || []).map((o) => ({ op_id: o.op_id, kind: o.kind, status: o.status, detail: o.detail })), input_shas: log.input_shas || {}, output_sha256: log.output_sha256 || null, runner_error: res.error || null, expected: { fail_closed: opts.expect === "fail", warning: opts.expect === "warning" } }, null, 2) + "\n", "utf8");
  console.log(name + " -> " + log.overall);
}

const BASE_OPS = (extra = {}) => [
  { op_id: "rename", kind: "rename", mapping: { FirmID: "firm", Year: "year", ValueStr: "value", CatCode: "cat", DateStr: "obs_date", AmountUSD: "amount_usd" }, ...(extra.rename || {}) },
  { op_id: "coerce_value", kind: "coerce", column: "value", to: "numeric", ...(extra.coerce || {}) },
  { op_id: "norm_key", kind: "normalize_key", column: "firm", rules: ["trim", "lower_case"] },
  { op_id: "map_cat", kind: "map_code", column: "cat", mapping: { A: 1, B: 2, C: 3 }, unknown: "fail" },
  { op_id: "norm_date", kind: "normalize_date", column: "obs_date", in_format: "%Y-%m", out: "year_month" },
  { op_id: "merge_lookup", kind: "merge", right: "lookup", left_keys: ["firm"], right_keys: ["firm_key"], how: "left", cardinality: "1:1", unmatched: "warn", ...(extra.merge || {}) },
];
const MAIN = "FirmID,Year,ValueStr,CatCode,DateStr,AmountUSD\nF001,1995,100,A,1995-01,1000\n F002 ,1996,200,B,1996-01,2000\nF003,1995,150,A,1995-01,1500\nF004,1996,250,C,1996-01,2500\n";

// D. type coercion failure (one non-numeric value)
writeCase("type_coercion_fail", "FirmID,Year,ValueStr,CatCode,DateStr,AmountUSD\nF001,1995,100,A,1995-01,1000\nF002,1996,abc,B,1996-01,2000\n", null, BASE_OPS(), { expect: "fail" });
// E. invalid date/year
writeCase("invalid_date", "FirmID,Year,ValueStr,CatCode,DateStr,AmountUSD\nF001,1995,100,A,1995-13,1000\n", null, BASE_OPS(), { expect: "fail" });
// F. unknown code/category
writeCase("unknown_code", "FirmID,Year,ValueStr,CatCode,DateStr,AmountUSD\nF001,1995,100,Z,1995-01,1000\n", null, BASE_OPS(), { expect: "fail" });
// G. missing source column in rename
writeCase("missing_source_column", MAIN, null, [{ op_id: "rename", kind: "rename", mapping: { NotAColumn: "firm" } }], { expect: "fail" });
// A. duplicate key violates declared 1:1 (lookup has duplicate firm_key)
writeCase("dup_key_1to1", MAIN, "firm_key,region\nf001,N\nf001,S\nf002,S\nf003,N\nf004,S\n", BASE_OPS(), { expect: "fail" });
// J. key normalization creates duplicate identity
writeCase("key_normalization_dup", "FirmID,Year,ValueStr,CatCode,DateStr,AmountUSD\nF001,1995,100,A,1995-01,1000\n f001 ,1996,200,A,1996-01,2000\n", null, BASE_OPS(), { expect: "fail" });
// C. unmatched merge records (policy warn)
writeCase("unmatched_merge_warn", "FirmID,Year,ValueStr,CatCode,DateStr,AmountUSD\nF001,1995,100,A,1995-01,1000\nF002,1996,200,B,1996-01,2000\nF099,1995,150,A,1995-01,1500\n", null, BASE_OPS(), { expect: "warning" });
// K/N. unexpected row-count effect via inner merge (declared, reduces rows) -> recorded warning + reduced rows
writeCase("row_reduction_inner", MAIN, "firm_key,region\nf001,N\nf002,S\nf003,N\n", BASE_OPS({ merge: { how: "inner" } }), { expect: "warning" });
// I. source mutation (sha mismatch) -> fail closed
{
  const dir = join(TMP, "source_mutation"); mkdirSync(dir, { recursive: true });
  const mainCsv = "FirmID,Year,ValueStr\nF001,1995,100\n";
  writeFileSync(join(dir, "main.csv"), mainCsv, "utf8");
  const plan = { schema_version: "1.0", plan_id: "adv_source_mutation", inputs: [{ input_id: "main", dataset_id: "x", file: "main.csv", sha256: "0".repeat(64) }], output: { dataset_id: "o", file: "out.csv" }, operations: [{ op_id: "rename", kind: "rename", mapping: { FirmID: "firm" } }] };
  const planPath = join(dir, "plan.json"); writeFileSync(planPath, JSON.stringify(plan), "utf8");
  const res = runHarmonize(planPath, { inDir: dir, outDir: dir });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "source_mutation.json"), JSON.stringify({ case: "source_mutation", implementation_id: "data.harmonize.python.pandas", overall: res.execution_log?.overall || "failed", errors: res.execution_log?.errors || [], runner_error: res.error || null, expected: { fail_closed: true } }, null, 2) + "\n", "utf8");
  console.log("source_mutation -> " + (res.execution_log?.overall || "failed"));
}
rmSync(TMP, { recursive: true, force: true });
console.log("done");