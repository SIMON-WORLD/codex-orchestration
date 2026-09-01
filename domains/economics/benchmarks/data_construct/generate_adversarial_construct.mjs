#!/usr/bin/env node
// One-time generator of frozen adversarial construct runtime evidence (python/pandas).
// Builds a small plan (+ variant source where needed), runs the real python implementation, and
// freezes the execution_log JSON under results/adversarial/<case>.json. CI tests read these frozen
// logs (no python needed in CI); the Node validator covers plan-level guards.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { runConstruct } from "../../data/run_construct.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const BENCH = join(HERE);
const ROOT = join(BENCH, "..", "..", "..", "..");
const TMP = join(ROOT, "role-team-out/construct_adv");
const OUT = join(BENCH, "results", "adversarial");
const shaBytes = (buf) => createHash("sha256").update(buf).digest("hex");
const PANEL = "firm,year,value,treated,total_value\nf001,1995,100,1,1000\nf001,1996,110,1,1100\n";

function writeCase(name, panelCsv, planBase, ops, opts = {}) {
  const dir = join(TMP, name); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "panel.csv"), panelCsv, "utf8");
  const sha = shaBytes(Buffer.from(panelCsv, "utf8"));
  const plan = { schema_version: "1.0", plan_id: "adv_construct_" + name, input: { dataset_id: "adv_panel", file: "panel.csv", sha256: sha }, output: { dataset_id: "adv_out", file: "out.csv", sort_by: ["firm", "year"] }, panel_by: "firm", time_by: "year", ...planBase, operations: ops };
  const planPath = join(dir, "plan.json"); writeFileSync(planPath, JSON.stringify(plan, null, 2) + "\n", "utf8");
  const res = runConstruct(planPath, { inDir: dir, outDir: dir });
  const log = res.execution_log || { overall: res.error ? "failed" : "unknown", runner_error: res.error };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name + ".json"), JSON.stringify({ case: name, implementation_id: "data.construct.python.pandas", overall: log.overall, warnings: log.warnings || [], errors: log.errors || [], operations: (log.operations || []).map((o) => ({ op_id: o.op_id, kind: o.kind, status: o.status, detail: o.detail })), input_shas: log.input_shas || {}, output_sha256: log.output_sha256 || null, runner_error: res.error || null, expected: { fail_closed: opts.expect === "fail", warning: opts.expect === "warning" } }, null, 2) + "\n", "utf8");
  console.log(name + " -> " + log.overall);
}

// D. log domain violation
writeCase("log_domain", "firm,year,value,treated\nf001,1995,0,1\n", { }, [{ op_id: "logv", kind: "log", source: "value", target: "log_value" }], { expect: "fail" });
// I. divide by zero (ratio)
writeCase("divide_by_zero", "firm,year,value,total_value\nf001,1995,100,0\n", { }, [{ op_id: "share", kind: "ratio", numerator: "value", denominator: "total_value", target: "share" }], { expect: "fail" });
// growth denominator zero
writeCase("growth_denom_zero", "firm,year,value\nf001,1995,0\nf001,1996,50\n", { }, [{ op_id: "growth", kind: "growth_rate", source: "value", target: "g_value" }], { expect: "fail" });
// K/L duplicate unit-time key (lag)
writeCase("lag_dup_unit_time", "firm,year,value\nf001,1995,100\nf001,1995,200\n", { }, [{ op_id: "lagv", kind: "lag", source: "value", target: "lag_value" }], { expect: "fail" });
// missing panel ordering -> lag with duplicate also; missing key column
writeCase("lag_missing_key", "firm,value\nf001,100\n", { }, [{ op_id: "lagv", kind: "lag", source: "value", target: "lag_value" }], { expect: "fail" });
// source mutation (sha mismatch)
{
  const dir = join(TMP, "source_mutation"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "panel.csv"), "firm,year,value\nf001,1995,100\n", "utf8");
  const plan = { schema_version: "1.0", plan_id: "adv_source_mutation", input: { dataset_id: "x", file: "panel.csv", sha256: "0".repeat(64) }, output: { dataset_id: "o", file: "out.csv" }, operations: [{ op_id: "arith", kind: "arithmetic", operator: "multiply", left: "value", right: 1, target: "v2" }] };
  const planPath = join(dir, "plan.json"); writeFileSync(planPath, JSON.stringify(plan), "utf8");
  const res = runConstruct(planPath, { inDir: dir, outDir: dir });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "source_mutation.json"), JSON.stringify({ case: "source_mutation", implementation_id: "data.construct.python.pandas", overall: res.execution_log?.overall || "failed", errors: res.execution_log?.errors || [], runner_error: res.error || null, expected: { fail_closed: true } }, null, 2) + "\n", "utf8");
  console.log("source_mutation -> " + (res.execution_log?.overall || "failed"));
}
// H. output column collision
writeCase("output_collision", "firm,year,value\nf001,1995,100\n", { }, [{ op_id: "arith", kind: "arithmetic", operator: "multiply", left: "value", right: 1, target: "value" }], { expect: "fail" });
rmSync(TMP, { recursive: true, force: true });
console.log("done");