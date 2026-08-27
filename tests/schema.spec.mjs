#!/usr/bin/env node
// Capability schema 拒绝用例（坏样例必须 FAIL）。
import assert from "node:assert";
import { validateCapability } from "../core/validate_capability_schema.mjs";

let pass = 0, fail = 0;
function check(name, errs, expectFail) {
  if (errs.length > 0 === expectFail) { console.log(`  ✅ ${name}${errs.length ? " (" + errs[0] + ")" : ""}`); pass++; }
  else { console.log(`  ❌ ${name}（期望${expectFail ? "失败" : "通过"}，实际 errors=${JSON.stringify(errs)}）`); fail++; }
}

const good = {
  id: "e.x", domain: "economics", description: "ok", risk_level: "medium",
  methodology: { references: [{ name: "n" }] },
  implementations: [{ id: "i", kind: "tool", runtime: "python", verification_status: "reference", environment_requirements: { runtime: "python" }, verification: { evidence: null, benchmark_ref: null } }],
  scientific_preconditions: [], decision_requirements: [], fallback_policy: "needs_decision",
};
check("A. good capability passes", validateCapability(good), false);

// B. capability-level environment_requirements -> reject
check("B. capability-level environment_requirements rejected", validateCapability({ ...good, environment_requirements: { runtime: "python" } }), true);

// C. implementation missing verification_status -> reject
const noStatus = JSON.parse(JSON.stringify(good)); delete noStatus.implementations[0].verification_status;
check("C. implementation missing verification_status rejected", validateCapability(noStatus), true);

// D. unknown risk_level -> reject
check("D. unknown risk_level rejected", validateCapability({ ...good, risk_level: "extreme" }), true);

// E. malformed scientific_precondition -> reject
check("E. malformed scientific_precondition (kind=foo) rejected", validateCapability({ ...good, scientific_preconditions: [{ kind: "foo" }] }), true);

// F. capability-level maturity -> reject
check("F. manual maturity rejected", validateCapability({ ...good, maturity: { value: "verified" } }), true);

// G. implementation missing environment_requirements -> reject
const noEnv = JSON.parse(JSON.stringify(good)); delete noEnv.implementations[0].environment_requirements;
check("G. implementation missing environment_requirements rejected", validateCapability(noEnv), true);

// H. unknown fallback_policy -> reject
check("H. unknown fallback_policy rejected", validateCapability({ ...good, fallback_policy: "always" }), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
