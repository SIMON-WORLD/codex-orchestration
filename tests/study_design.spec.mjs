#!/usr/bin/env node
// study_design 契约校验：结构 + registry 成员。不推断科学问题、不做 admission。
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateStudyDesign, loadRegistry } from "../domains/economics/validate_study_design.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = loadRegistry();
const example = JSON.parse(readFileSync(join(root, "domains/economics/study_design.example.json"), "utf8"));

let pass = 0, fail = 0;
function check(name, errs, expectFail) {
  if (errs.length > 0 === expectFail) { console.log(`  ✅ ${name}${errs.length ? ` (${errs[0].code})` : ""}`); pass++; }
  else { console.log(`  ❌ ${name}（期望${expectFail ? "失败" : "通过"}，实际 errors=${JSON.stringify(errs)}）`); fail++; }
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }

// A. 当前 example 通过
check("A. current example passes", validateStudyDesign(example, registry), false);

// B. wrong domain fails
const badDomain = clone(example); badDomain.domain = "sociology";
check("B. wrong domain fails", validateStudyDesign(badDomain, registry), true);

// C. malformed selected_capabilities (empty array) fails
const badSel = clone(example); badSel.selected_capabilities.empirical = [];
check("C. malformed selected_capabilities (empty) fails", validateStudyDesign(badSel, registry), true);

// C2. selected_capabilities value not an array fails
const badSel2 = clone(example); badSel2.selected_capabilities.data = "economics.data.validation";
check("C2. selected_capabilities non-array fails", validateStudyDesign(badSel2, registry), true);

// D. unknown capability ID fails
const badCap = clone(example); badCap.selected_capabilities.empirical = ["economics.causal.rd"];
check("D. unknown capability ID fails", validateStudyDesign(badCap, registry), true);

// E. malformed execution_context (missing mode) fails
const badCtx = clone(example); delete badCtx.execution_context.mode;
check("E. malformed execution_context (missing mode) fails", validateStudyDesign(badCtx, registry), true);

// E2. invalid execution mode value fails
const badMode = clone(example); badMode.execution_context.mode = "staging";
check("E2. invalid execution mode fails", validateStudyDesign(badMode, registry), true);

// F. optional method-specific decisions may be absent (IV/DID-specific not globally required)
const sparse = clone(example); sparse.decisions = {}; sparse.preconditions = {}; sparse.manual_validations = {};
// remove method-specific fields entirely
delete sparse.decisions;
check("F. optional method-specific decisions may be absent", validateStudyDesign(sparse, registry), false);

// F2. a study without IV/DID-specific keys in decisions still passes (decisions only structured if present)
const noIv = clone(example); delete noIv.decisions.instrument; delete noIv.decisions.exclusion_restriction;
check("F2. IV-specific decisions optional", validateStudyDesign(noIv, registry), false);

// G. validator does not decide unresolved scientific questions itself
const undecided = clone(example);
undecided.decisions = {};        // nothing decided; contract only cares about structure
undecided.manual_validations = {};
const gErrs = validateStudyDesign(undecided, registry);
const decided = gErrs.some((e) => /needs_decision|blocked|UNRESOLVED|admission/i.test(e.code + " " + e.message));
check("G. validator does not decide unresolved scientific questions", gErrs.length === 0 && !decided, false);

// H. non-object study fails
check("H. non-object study fails", validateStudyDesign(null, registry), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
