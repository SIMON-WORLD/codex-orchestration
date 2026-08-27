#!/usr/bin/env node
// Capability Resolver 回归测试（原 13 场景 + P2.1 新增）。使用 fixture capability / env，不真装软件。
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
    study_id: "t", domain: "fixture",
    execution_context: { mode: opts.mode || "production", allow_experimental: !!opts.allow_experimental, preferred_runtimes: opts.preferred_runtimes || [], approved_overrides: opts.approved_overrides || [] },
    selected_capabilities: { role: [capId] },
    decisions: opts.decisions || {}, preconditions: opts.preconditions || {}, manual_validations: opts.manual_validations || {},
  };
  const env = opts.env || baseEnv;
  const res = resolveAll(study, registry, env, { mode: study.execution_context.mode, allow_experimental: study.execution_context.allow_experimental, preferred_runtimes: study.execution_context.preferred_runtimes, approved_overrides: study.execution_context.approved_overrides });
  return res.capabilities[capId];
}
const envPython = (v) => ({ runtimes: { python: { available: true, known: true, version: v } }, packages: {} });
const envNoPy = () => ({ runtimes: { python: { available: false, known: false, version: null } }, packages: {} });
const envWorkflow = (avail) => ({ resources: { workflows: avail ? { wf: { available: true, known: true, version: null } } : {} }, runtimes: {}, packages: {} });

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }

console.log("Resolver fixture spec");

// --- 原 13 场景 ---
let r = run("f.high.verified"); check("1 high/production/verified -> resolved", r.resolution === "resolved", `got=${r.resolution}`);
r = run("f.high.tested"); check("2 high/production/only-tested -> blocked", r.resolution === "blocked", `got=${r.resolution}`);
r = run("f.high.tested", { mode: "test", allow_experimental: true }); check("3 high/test/tested/allow -> resolved+override", r.resolution === "resolved" && r.override_recorded === true, `got=${r.resolution}`);
r = run("f.high.verified.decision", { decisions: {} }); check("4 high/verified + decision missing -> needs_decision", r.resolution === "needs_decision" && r.reason === "decision_missing", `got=${r.resolution}/${r.reason}`);
r = run("f.high.verified.notenv", { env: envNoPy() }); check("5 high/verified but env missing -> blocked", r.resolution === "blocked", `got=${r.resolution}`);
r = run("f.medium.tested"); check("6 medium/production/tested -> resolved", r.resolution === "resolved", `got=${r.resolution}`);
r = run("f.medium.experimental"); check("7 medium/experimental -> needs_decision", r.resolution === "needs_decision", `got=${r.resolution}`);
r = run("f.low.allow", { env: {} }); check("8 low/missing + fallback allowed -> resolved+fallback_recorded", r.resolution === "resolved" && r.fallback_recorded === true, `got=${r.resolution}`);
r = run("f.low.nofallback", { env: {} }); check("9 low/missing + no fallback -> blocked", r.resolution === "blocked", `got=${r.resolution}`);
r = run("f.deprecated"); check("10 deprecated never selected", r.resolution === "resolved" && r.selected_implementation?.id === "v", `got=${r.resolution} sel=${r.selected_implementation?.id}`);
r = run("f.high.verified.multi", { preferred_runtimes: ["r", "python"], env: envPython("3.12") }); check("11 preferred runtime unavailable -> next", r.resolution === "resolved" && r.runtime === "python", `got=${r.resolution}/${r.runtime}`);
r = run("f.machine.block", { preconditions: { "design.panel": "not_unit_time" } }); check("12 machine precondition mismatch -> blocked", r.resolution === "blocked", `got=${r.resolution}`);
r = run("f.manual.missing", { manual_validations: {} }); check("13 manual validation missing -> needs_decision", r.resolution === "needs_decision", `got=${r.resolution}`);

// --- P2.1 新增回归 ---
r = run("f.low.workflow.missing", { env: envWorkflow(false) }); check("14 workflow missing -> not selectable (blocked)", r.resolution === "blocked" && !r.selected_implementation, `got=${r.resolution} sel=${r.selected_implementation?.id}`);
r = run("f.low.workflow.available", { env: envWorkflow(true) }); check("15 workflow available -> selectable (resolved, wf)", r.resolution === "resolved" && r.selected_implementation?.id === "wf", `got=${r.resolution} sel=${r.selected_implementation?.id}`);
r = run("f.medium.experimental", { approved_overrides: [{ capability: "f.medium.experimental", implementation: "m.py", approved: true }] }); check("16 medium experimental + approval -> resolved+approval_recorded", r.resolution === "resolved" && r.approval_recorded === true, `got=${r.resolution}`);
r = run("f.high.experimental", { approved_overrides: [{ capability: "f.high.experimental", implementation: "h.py.exp", approved: true }] }); check("17 high production experimental + approval -> still blocked", r.resolution === "blocked", `got=${r.resolution}`);
r = run("f.high.verified.unknownver", { env: envPython("unknown") }); check("18 unknown version -> blocked + version_requirement_unsatisfied", r.resolution === "blocked" && r.reason === "version_requirement_unsatisfied", `got=${r.resolution}/${r.reason}`);
r = run("f.high.verified.notenv", { env: envNoPy() }); check("19 verified unavailable reason", r.reason === "verified_implementation_unavailable", `got=${r.reason}`);
r = run("f.high.tested"); check("20 no-verified reason (high production tested)", r.reason === "no_verified_implementation", `got=${r.reason}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

