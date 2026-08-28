#!/usr/bin/env node
// Issue #6 adversarial regression：用真实 strict v1.3 roles.json + registry + scaffold/preflight，
// 证明"unavailable workflow 不被选、available workflow 可选、HIGH risk missing verified 会 block、无 silent methodology fallback、strict/legacy 分离"。
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const TMP = join(root, "role-team-out/issue6_tests");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }

function runScaffold(study, env) {
  rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
  const sp = join(TMP, "study.json"), ep = join(TMP, "env.json"), pp = join(TMP, "plan.json");
  writeFileSync(sp, JSON.stringify(study, null, 2), "utf8");
  writeFileSync(ep, JSON.stringify(env, null, 2), "utf8");
  const res = spawnSync(process.execPath, [join(root, "core/scaffold_role_team.mjs"), "--domain", "economics", "--roles", "domains/economics/roles.json", "--study", sp, "--env", ep, "--out", pp], { encoding: "utf8" });
  if (res.status !== 0) throw new Error("scaffold failed: " + (res.stderr || res.stdout));
  return JSON.parse(readFileSync(pp, "utf8"));
}
const study = (caps, extra) => ({ domain: "economics", study_id: "s", execution_context: { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: extra?.approved_overrides || [] }, selected_capabilities: caps, decisions: { search_scope: "2020-2026", clustering_level: "unit", control_set: "x", fixed_effects: "unit+time", sample_exclusion: "age16-65" }, preconditions: { "design.panel": "unit_time" }, manual_validations: {} });
const envPy = { runtimes: { python: { available: true, known: true, version: "3.12" } }, packages: { linearmodels: { available: true, known: true, version: "7.0" } } };
const envEmpty = { runtimes: {}, packages: {}, resources: {} };

console.log("Issue #6 adversarial regression");

// #6-8 missing workflow -> not selected
let p = runScaffold(study({ literature_search: ["economics.literature.search"] }), { resources: { workflows: {} } });
let cap = p.preflight.capabilities["economics.literature.search"];
check("#6-8 缺失 workflow -> 不作为可执行实现（fallback，selected_implementation=null）", cap.resolution === "resolved" && cap.selected_implementation === null, `res=${cap.resolution} sel=${cap.selected_implementation?.name}`);

// #6-9 available workflow -> 被选择
p = runScaffold(study({ literature_search: ["economics.literature.search"] }), { resources: { workflows: { "nature-literature-pipeline": { available: true, known: true, version: null } } } });
cap = p.preflight.capabilities["economics.literature.search"];
check("#6-9 available workflow -> 被选择", cap.resolution === "resolved" && cap.selected_implementation?.name === "nature-literature-pipeline", `sel=${cap.selected_implementation?.name}`);

// #6-10 HIGH prod 无 verified -> blocked + dispatch_allowed=false
p = runScaffold(study({ empirical: ["economics.regression.panel_fe"] }), envPy);
check("#6-10 HIGH prod 无 verified -> blocked", p.roles.empirical.resolution === "blocked" && p.roles.empirical.dispatch_allowed === false, `res=${p.roles.empirical.resolution}`);
cap = p.preflight.capabilities["economics.regression.panel_fe"];
check("#6-10b reason = no_verified_implementation", cap.reason === "no_verified_implementation", `reason=${cap.reason}`);

// #6-11 approval 不能绕过 high-risk verified_only
p = runScaffold(study({ empirical: ["economics.regression.panel_fe"] }, { approved_overrides: [{ capability: "economics.regression.panel_fe", implementation: "panel.fe.python.linearmodels", approved: true }] }), envPy);
check("#6-11 approval 不能绕过 high-risk -> blocked", p.roles.empirical.resolution === "blocked" && p.roles.empirical.dispatch_allowed === false, `res=${p.roles.empirical.resolution}`);

// #6-12 strict role 无 legacy methodology/toolchain/policy
const roles = JSON.parse(readFileSync(join(root, "domains/economics/roles.json"), "utf8")).roles;
let legacyFields = false;
for (const r of roles) for (const k of ["methodology", "toolchain", "journal", "policy"]) if (r[k] !== undefined) legacyFields = true;
check("#6-12 strict roles.json 无 methodology/toolchain/policy", !legacyFields);
const skill = readFileSync(join(root, "skills/codex-role-team/SKILL.md"), "utf8");
check("#6-12b SKILL strict 段无 methodology.steps 默认 fallback", !/otherwise fall back to that role/i.test(skill));

// #6-13 legacy 路径仍 legacy_v1_2
const rr = spawnSync(process.execPath, [join(root, "scripts/scaffold_role_team.mjs"), "--roles", "templates/role-team/roles.research.json", "--out", join(TMP, "legacy.json")], { encoding: "utf8" });
const legacy = JSON.parse(readFileSync(join(TMP, "legacy.json"), "utf8"));
check("#6-13 legacy 路径 compatibility_mode=legacy_v1_2", rr.status === 0 && legacy.meta.compatibility_mode === "legacy_v1_2");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
