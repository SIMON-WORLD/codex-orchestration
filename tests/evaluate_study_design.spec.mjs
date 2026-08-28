#!/usr/bin/env node
// Economics Director 决策状态评估：structure-ready 后判断是否有未决科学决策。
// 不做：实现选择 / runtime / verification_status / admission / 重复 resolver。
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateStudyDesign, evaluateIfValid } from "../domains/economics/evaluate_study_design.mjs";
import { loadRegistry } from "../domains/economics/validate_study_design.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = loadRegistry();
const example = JSON.parse(readFileSync(join(root, "domains/economics/study_design.example.json"), "utf8"));

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name} ${detail || ""}`); fail++; } }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function hasUnresolved(res, cap, field) { return res.unresolved_decisions.some((u) => u.capability === cap && u.field === field); }

// A. 结构合法 + 所有选定 capability 决策已决 -> ready
const a = evaluateStudyDesign(example, registry);
ok("A. structurally valid + all decisions resolved -> ready", a.status === "ready" && a.unresolved_decisions.length === 0, `status=${a.status}`);

// B. 缺少 panel_fe 决策要求 -> needs_decision
const bStudy = clone(example); delete bStudy.decisions.clustering_level;
const b = evaluateStudyDesign(bStudy, registry);
ok("B. missing panel_fe decision requirement -> needs_decision", b.status === "needs_decision" && hasUnresolved(b, "economics.regression.panel_fe", "clustering_level"), `status=${b.status}`);

// C. 缺少 DID-specific design decision（estimator_choice）-> needs_decision（且不牵连 panel_fe）
const cStudy = clone(example); delete cStudy.decisions.estimator_choice;
const c = evaluateStudyDesign(cStudy, registry);
ok("C. missing DID-specific estimator_choice -> needs_decision", c.status === "needs_decision" && hasUnresolved(c, "economics.causal.did.staggered", "estimator_choice"), `status=${c.status}`);
ok("C2. DID decision does not implicate panel_fe", !hasUnresolved(c, "economics.regression.panel_fe", "estimator_choice"));

// C3. 缺少 DID 机器前置条件 design.treatment_timing -> needs_decision（on_missing=needs_decision）
const c3 = clone(example); delete c3.preconditions["design.treatment_timing"];
const c3r = evaluateStudyDesign(c3, registry);
ok("C3. missing DID design.treatment_timing precondition -> needs_decision", c3r.status === "needs_decision" && hasUnresolved(c3r, "economics.causal.did.staggered", "design.treatment_timing"), `status=${c3r.status}`);

// D. 未选中的 capability 的决策不要求 -> ready（仅 panel_fe，去掉 did/iv 关键字段）
const dStudy = clone(example);
dStudy.selected_capabilities = { empirical: ["economics.regression.panel_fe"] };
delete dStudy.decisions.treatment_definition; delete dStudy.decisions.estimator_choice; delete dStudy.decisions.instrument;
delete dStudy.preconditions["design.treatment_timing"];
const d = evaluateStudyDesign(dStudy, registry);
ok("D. decisions for unselected capability not required -> ready", d.status === "ready" && d.unresolved_decisions.length === 0, `status=${d.status}`);

// E. 未决项报告 capability ID + field
const eStudy = clone(example); delete eStudy.decisions.fixed_effects;
const e = evaluateStudyDesign(eStudy, registry);
const eShape = e.unresolved_decisions.every((u) => typeof u.capability === "string" && u.capability.length > 0 && typeof u.field === "string" && u.field.length > 0);
ok("E. unresolved items report capability id + field", eShape && e.unresolved_decisions.length > 0, JSON.stringify(e.unresolved_decisions));

// F. 评估器不检查 runtime/environment/verification status：
//    即使 high-risk production + 无 verified 实现，只要决策已决 -> ready（resolver 会另判 admission）。
const fStudy = clone(example); // example = high-risk production，panel_fe/did 无 verified
const f = evaluateStudyDesign(fStudy, registry);
ok("F. evaluator does not inspect verification_status (no-verified high-risk still ready)", f.status === "ready", `status=${f.status}`);

// G. high-risk production admission 不在此评估：
const gStudy = clone(example); gStudy.execution_context.mode = "production"; gStudy.execution_context.allow_experimental = false;
const g = evaluateStudyDesign(gStudy, registry);
const noAdmission = !g.unresolved_decisions.some((u) => /verified|admission|runtime|environment/i.test(u.field + " " + u.capability));
ok("G. high-risk production admission not evaluated here", g.status === "ready" && noAdmission, `status=${g.status}`);

// H. 集成：结构校验失败 -> 不做决策评估
const badStudy = clone(example); badStudy.domain = "sociology";
const h = evaluateIfValid(badStudy, registry);
ok("H. invalid structure -> evaluation skipped (ok=false)", h.ok === false && Array.isArray(h.errors) && h.errors.length > 0);

// H2. 集成：结构合法 -> 返回决策评估
const h2 = evaluateIfValid(example, registry);
ok("H2. valid structure -> evaluation runs", h2.ok === true && h2.result?.status === "ready");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
