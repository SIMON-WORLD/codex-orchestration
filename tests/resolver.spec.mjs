#!/usr/bin/env node
// Capability Resolver 回归测试（13 场景）。使用 fixture capability / env，不真装软件。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";
import { resolveAll } from "../core/resolve_capabilities.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(readFileSync(join(root, "tests/fixtures/capabilities.json"), "utf8"));
const baseEnv = JSON.parse(readFileSync(join(root, "tests/fixtures/env.json"), "utf8"));

function run(capId, opts = {}) {
  const study = {
    study_id: "t",
    domain: "fixture",
    execution_context: { mode: opts.mode || "production", allow_experimental: !!opts.allow_experimental, preferred_runtimes: opts.preferred_runtimes || [] },
    selected_capabilities: { role: [capId] },
    decisions: opts.decisions || {},
    preconditions: opts.preconditions || {},
    manual_validations: opts.manual_validations || {},
  };
  const env = opts.env || baseEnv;
  const res = resolveAll(study, registry, env, { mode: study.execution_context.mode, allow_experimental: study.execution_context.allow_experimental, preferred_runtimes: study.execution_context.preferred_runtimes });
  return res.capabilities[capId];
}

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); pass++; }
  else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; }
}

console.log("Resolver fixture spec");

// 1) high + production + verified available -> resolved
let r = run("f.high.verified");
check("1 high/production/verified -> resolved", r.resolution === "resolved", `got=${r.resolution}`);

// 2) high + production + only tested -> blocked
r = run("f.high.tested");
check("2 high/production/only-tested -> blocked", r.resolution === "blocked", `got=${r.resolution}`);

// 3) high + test + tested + allow_experimental -> resolved + override recorded
r = run("f.high.tested", { mode: "test", allow_experimental: true });
check("3 high/test/tested/allow -> resolved+override", r.resolution === "resolved" && r.override_recorded === true, `got=${r.resolution} override=${r.override_recorded}`);

// 4) high + verified available + decision missing -> needs_decision
r = run("f.high.verified.decision", { decisions: {} });
check("4 high/verified + decision missing -> needs_decision", r.resolution === "needs_decision" && r.reason === "decision_requirements_missing", `got=${r.resolution}`);

// 5) high + verified but runtime missing -> blocked
r = run("f.high.verified.notenv", { env: { runtimes: { python: { available: false, known: false, version: null } }, packages: {} } });
check("5 high/verified but env missing -> blocked", r.resolution === "blocked", `got=${r.resolution}`);

// 6) medium + production + tested -> resolved
r = run("f.medium.tested");
check("6 medium/production/tested -> resolved", r.resolution === "resolved", `got=${r.resolution}`);

// 7) medium + experimental -> needs_decision
r = run("f.medium.experimental");
check("7 medium/experimental -> needs_decision", r.resolution === "needs_decision", `got=${r.resolution}`);

// 8) low + missing + fallback allowed -> resolved + fallback_recorded
r = run("f.low.allow", { env: {} });
check("8 low/missing + fallback allowed -> resolved+fallback_recorded", r.resolution === "resolved" && r.fallback_recorded === true, `got=${r.resolution} fb=${r.fallback_recorded}`);

// 9) low + missing + fallback not allowed -> blocked
r = run("f.low.nofallback", { env: {} });
check("9 low/missing + no fallback -> blocked", r.resolution === "blocked", `got=${r.resolution}`);

// 10) deprecated implementation never selected
r = run("f.deprecated");
check("10 deprecated never selected", r.resolution === "resolved" && r.selected_implementation?.id === "v", `got=${r.resolution} sel=${r.selected_implementation?.id}`);

// 11) preferred runtime unavailable -> choose next admissible
r = run("f.high.verified.multi", { preferred_runtimes: ["r", "python"], env: { runtimes: { python: { available: true, known: true, version: "3.12" }, r: { available: false, known: false, version: null } }, packages: {} } });
check("11 preferred runtime unavailable -> next", r.resolution === "resolved" && r.runtime === "python", `got=${r.resolution} runtime=${r.runtime}`);

// 12) machine scientific precondition mismatch -> blocked
r = run("f.machine.block", { preconditions: { "design.panel": "not_unit_time" } });
check("12 machine precondition mismatch -> blocked", r.resolution === "blocked", `got=${r.resolution}`);

// 13) manual scientific validation missing -> needs_decision
r = run("f.manual.missing", { manual_validations: {} });
check("13 manual validation missing -> needs_decision", r.resolution === "needs_decision", `got=${r.resolution}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
