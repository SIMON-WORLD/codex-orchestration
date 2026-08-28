#!/usr/bin/env node
// P3 Role↔Capability scope / dispatch 回归。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { validateSelectedCapabilities } from "../core/validate_role_scope.mjs";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const roles = JSON.parse(readFileSync(join(root, "domains/economics/roles.json"), "utf8")).roles;
const registry = loadRegistry(join(root, "domains/economics/capabilities"));

let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
const S = (selectedCaps, extras = {}) => ({ domain: "economics", execution_context: { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] }, selected_capabilities: selectedCaps, decisions: extras.decisions || {}, preconditions: extras.preconditions || {}, manual_validations: extras.manual_validations || {} });
const R = (roles) => new Map(roles.map((r) => [r.id, r]));
function dispatch(roles, ownStatus) {
  const byId = R(roles);
  const order = (() => { const rem = new Set(roles.map((r) => r.id)); const st = []; let g = 0; while (rem.size) { const ready = [...rem].filter((id) => (byId.get(id).depends_on || []).every((d) => !rem.has(d))); st.push(...ready); ready.forEach((id) => rem.delete(id)); if (g++ > roles.length) break; } return st; })();
  const eff = {};
  for (const id of order) {
    const dep = (byId.get(id).depends_on || []).map((d) => eff[d]);
    let s = ownStatus[id] || "ready";
    if (s === "blocked") eff[id] = "blocked";
    else if (dep.some((x) => x === "blocked")) eff[id] = "blocked";
    else if (dep.some((x) => x === "needs_decision")) eff[id] = "needs_decision";
    else eff[id] = s;
  }
  return eff;
}
function preflightStatus(study) {
  const res = resolveAll(study, registry, {}, { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] });
  return res.roles;
}

console.log("Role scope spec");

// 1
check("1 empirical scope regression.* + panel_fe -> valid", validateSelectedCapabilities(S({ empirical: ["economics.regression.panel_fe"] }), roles, registry).length === 0);
// 2
check("2 empirical scope causal.* + causal.iv -> valid", validateSelectedCapabilities(S({ empirical: ["economics.causal.iv"] }), roles, registry).length === 0);
// 3
check("3 literature_search selected causal.iv -> FAIL", validateSelectedCapabilities(S({ literature_search: ["economics.causal.iv"] }), roles, registry).length > 0);
// 4
check("4 unknown role -> FAIL", validateSelectedCapabilities(S({ not_a_role: ["economics.literature.search"] }), roles, registry).length > 0);
// 5
check("5 unknown capability -> FAIL", validateSelectedCapabilities(S({ literature_search: ["economics.not.real"] }), roles, registry).length > 0);
// 6
check("6 capability_scope=[] but selected -> FAIL", validateSelectedCapabilities(S({ writing: ["economics.literature.search"] }), roles, registry).length > 0);

// 7：只解析 selected panel_fe，不解析 DID/IV
const res7 = resolveAll(S({ empirical: ["economics.regression.panel_fe"] }), registry, {}, { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] });
check("7 resolver 只解析 selected panel_fe", Object.keys(res7.capabilities).length === 1 && !!res7.capabilities["economics.regression.panel_fe"], `keys=${Object.keys(res7.capabilities).join(",")}`);

// 8：DAG 传播 —— blocked empirical 不拖停 independent literature_search；下游 writing/review 被阻塞（visualize 已移除）
const eff8 = dispatch(roles, { literature_search: "ready", empirical: "blocked" });
check("8 blocked empirical -> literature_search ready（unrelated 分支可继续）", eff8.literature_search === "ready" && eff8.empirical === "blocked", `lit=${eff8.literature_search} emp=${eff8.empirical}`);
check("8b blocked empirical -> writing/review 被阻塞", eff8.writing === "blocked" && eff8.review === "blocked");

// 9：DAG 传播 —— data needs_decision -> 下游 empirical/writing 阻塞/等待，independent 继续
const eff9 = dispatch(roles, { data: "needs_decision", literature_search: "ready", empirical: "blocked" });
check("9 data needs_decision -> empirical 阻塞，independent literature 继续", eff9.data === "needs_decision" && eff9.empirical === "blocked" && eff9.literature_search === "ready", `data=${eff9.data} emp=${eff9.empirical}`);
check("9b 下游 writing/review 阻塞", eff9.writing === "blocked" && eff9.review === "blocked");

// 11：端到端 v1.3 scaffold（roles.json + study_design.example，无 env，strict production）
const r11 = spawnSync(process.execPath, [join(root, "core/scaffold_role_team.mjs"), "--domain", "economics", "--roles", "domains/economics/roles.json", "--study", "domains/economics/study_design.example.json", "--out", join(root, "role-team-out/_p3_e2e.json")], { encoding: "utf8" });
if (r11.status === 0) {
  const plan = JSON.parse(readFileSync(join(root, "role-team-out/_p3_e2e.json"), "utf8"));
  check("11a v1.3 literature_search ready+dispatch", plan.roles.literature_search.resolution === "ready" && plan.roles.literature_search.dispatch_allowed === true);
  check("11b v1.3 empirical blocked+no dispatch", plan.roles.empirical.resolution === "blocked" && plan.roles.empirical.dispatch_allowed === false);
  check("11c no visualize role; writing blocked（依赖 blocked empirical）", !("visualize" in plan.roles) && plan.roles.writing.resolution === "blocked");  const stageOf = (plan, id) => plan.stages.findIndex((s) => s.roles.includes(id));
  // 12：DAG 分离 —— literature_review 虽 policy-ready(dispatch_allowed)，但 stage 晚于 literature_search，不会提前派发
  check("12a literature_search 与 literature_review 均 dispatch_allowed", plan.roles.literature_search.dispatch_allowed === true && plan.roles.literature_review.dispatch_allowed === true);
  check("12b literature_review stage 晚于 literature_search（不提前派发）", stageOf(plan, "literature_review") > stageOf(plan, "literature_search"), `ls=${stageOf(plan,"literature_search")} lr=${stageOf(plan,"literature_review")}`);
} else {
  check("11 v1.3 scaffold exit 0", false, `status=${r11.status}`);
}
// 10：legacy roles.research.json 不回归（v1.2 compat 仍 exit 0 + legacy 标记）
const r10 = spawnSync(process.execPath, [join(root, "scripts/scaffold_role_team.mjs"), "--roles", "templates/role-team/roles.research.json", "--out", join(root, "role-team-out/_legacy_check.json")], { encoding: "utf8" });
check("10 legacy roles.research.json compat exit 0", r10.status === 0, `status=${r10.status}`);
const legacy = JSON.parse(readFileSync(join(root, "role-team-out/_legacy_check.json"), "utf8"));
check("10b legacy 标记 legacy_v1_2", legacy.meta.compatibility_mode === "legacy_v1_2");

// 13：literature_search authority 与 capability decision_requirement 不冲突
const litRole = roles.find((r) => r.id === "literature_search");
const litCap = registry["economics.literature.search"];
check("13a literature_search.may_decide 不含 search_scope", !(litRole.authority.may_decide || []).includes("search_scope"));
check("13b keyword_strings 保留在 may_decide", (litRole.authority.may_decide || []).includes("keyword_strings"));
check("13c capability 的 decision_requirements 含 search_scope（由 study design 提供）", (litCap.decision_requirements || []).includes("search_scope"));

// M1-M5: RFC worker Role migration
check("M1 exactly 6 worker roles", roles.length === 6, `got=${roles.length}`);
check("M2 no visualize role", !roles.some((r) => r.id === "visualize"));
check("M3 no economics_director role in roles.json", !roles.some((r) => r.id === "economics_director"));
const knownIds = new Set(roles.map((r) => r.id));
const badDep = roles.filter((r) => (r.depends_on || []).some((d) => !knownIds.has(d))).map((r) => r.id);
check("M4 all depends_on resolve", badDep.length === 0, `bad=${badDep.join(",")}`);
const ex = JSON.parse(readFileSync(join(root, "domains/economics/study_design.example.json"), "utf8"));
const exErrs = validateSelectedCapabilities(ex, roles, registry);
check("M5 example selected caps authorized by role scope", exErrs.length === 0, exErrs.join(";"));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);




