#!/usr/bin/env node
// 通用「角色团队」派发计划生成器（领域无关）。
// 领域内容（output profile / toolchain / integrity 文本）一律来自 domains/<domain>/manifest.json；
// Core 只理解通用概念：task / role / output_profile / dependency / decision_gate / evidence_grading，
// 不硬编码任何领域字面量（如具体输出规范、具体方法、具体软件等）。
// 输入: --roles <roles.json> （必填）
//       --domain <name>      （可选：加载 domains/<name>/manifest.json 以提供 output_profiles / toolchain / 输出规范）
//       --output-profile <id>（可选：从 manifest.output_profiles 选择要注入的 profile，如 <某 profile id>）
//       --question "<...>"   （可选）
//       --inject <json>      （可选：预填上游输出，用于自包含预览/测试）
//       --out <path>         （可选：写 JSON，默认 role-team-out/plan.json；--dry-run 只打印不写）
//       --compat-mode        （可选：标记该次生成为 v1.2 兼容路径，写入 plan.meta.compatibility_mode）
//       --legacy-warning <s> （可选：兼容路径的提示文本，写入 plan.meta.legacy_warning）
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAll, loadRegistry } from "./resolve_capabilities.mjs";
import { validateSelectedCapabilities } from "./validate_role_scope.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), "utf8"));
}
function arg(name) {
  const i = process.argv.indexOf("--" + name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v === undefined ? "" : v;
}
function hasFlag(name) {
  return process.argv.includes("--" + name);
}

// ---- 领域包加载（Core 不硬编码任何领域内容） ----
function loadDomain(domain) {
  if (!domain) return null;
  const manifest = readJson(`domains/${domain}/manifest.json`);
  if (!manifest || typeof manifest !== "object") {
    throw new Error(`无法读取 domain manifest：domains/${domain}/manifest.json`);
  }
  return manifest;
}
function loadOutputProfile(domain, id, manifest) {
  if (!domain || !id) return null;
  const entry = manifest?.output_profiles?.[id];
  if (!entry?.path) {
    throw new Error(`未知 output profile "${id}"（domain=${domain}）：manifest.output_profiles 中无该配置`);
  }
  const p = readJson(`domains/${domain}/${entry.path}`);
  if (!p || !Array.isArray(p.rules)) {
    throw new Error(`无法加载 output profile "${id}"（domain=${domain}）：domains/${domain}/${entry.path} 缺少 rules`);
  }
  return p;
}

// ---- 解析 roles ----
function loadRoles(file) {
  let raw;
  try { raw = JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { throw new Error(`无法解析 roles 文件 ${file}：${e.message}`); }
  const roles = raw && Array.isArray(raw.roles) ? raw.roles : [];
  if (roles.length === 0) {
    console.warn("警告：roles 为空数组，将生成空的派发计划。");
    return { meta: raw?.meta || {}, roles: [] };
  }
  for (const r of roles) {
    if (typeof r?.id !== "string" || !r.id.trim()) throw new Error(`角色缺少有效的 id：${JSON.stringify(r)}`);
    if (typeof r?.name !== "string" || !r.name.trim()) throw new Error(`角色 "${r?.id}" 缺少有效的 name：${JSON.stringify(r)}`);
    if (typeof r?.prompt !== "string" || !r.prompt.trim()) {
      if (r?.capability_scope === undefined) throw new Error(`角色 "${r?.id}" 缺少有效的 prompt（自包含任务说明）：${JSON.stringify(r)}`);
      // v1.3 role：无 prompt，由 scaffold 根据 responsibility/authority + selected capabilities 生成
    }
    if (r.methodology !== undefined && (typeof r.methodology !== "object" || r.methodology === null)) throw new Error(`角色 "${r?.id}" 的 methodology 必须是对象：${JSON.stringify(r.methodology)}`);
    if (r.policy !== undefined) {
      if (typeof r.policy !== "object" || r.policy === null) throw new Error(`角色 "${r?.id}" 的 policy 必须是对象：${JSON.stringify(r.policy)}`);
      const modes = ["hard_stop", "semi_auto", "auto_note"];
      if (r.policy.mode !== undefined && !modes.includes(r.policy.mode)) throw new Error(`角色 "${r?.id}" 的 policy.mode 无效（应为 hard_stop/semi_auto/auto_note）：${r.policy.mode}`);
      for (const k of ["blocked_on", "confirm_on"]) {
        if (r.policy[k] !== undefined && (!Array.isArray(r.policy[k]) || !r.policy[k].every((x) => typeof x === "string" && x.trim()))) {
          throw new Error(`角色 "${r?.id}" 的 policy.${k} 必须是字符串数组：${JSON.stringify(r.policy[k])}`);
        }
      }
      if (r.policy.log_required !== undefined && typeof r.policy.log_required !== "boolean") throw new Error(`角色 "${r?.id}" 的 policy.log_required 必须是布尔值：${r.policy.log_required}`);
    }
    if (r.evidence_grading !== undefined && typeof r.evidence_grading !== "boolean") throw new Error(`角色 "${r?.id}" 的 evidence_grading 必须是布尔值：${r.evidence_grading}`);
  }
  const ids = new Set(roles.map((r) => r.id));
  for (const r of roles) {
    for (const dep of r.depends_on || []) {
      if (!ids.has(dep)) throw new Error(`角色 "${r.id}" 的 depends_on 引用了不存在的角色 "${dep}"`);
    }
  }
  return { meta: raw?.meta || {}, roles };
}

// ---- 拓扑排序：返回并行阶段数组 ----
function planStages(roles) {
  const byId = new Map(roles.map((r) => [r.id, r]));
  const remaining = new Set(roles.map((r) => r.id));
  const stages = [];
  let guard = 0;
  while (remaining.size > 0) {
    if (++guard > roles.length + 1) throw new Error("检测到角色依赖环，无法生成阶段顺序；请检查 depends_on。");
    const ready = [...remaining].filter((id) => ((byId.get(id).depends_on || []).every((d) => !remaining.has(d))));
    if (ready.length === 0) throw new Error("检测到角色依赖环，无法生成阶段顺序；请检查 depends_on。");
    stages.push(ready);
    for (const id of ready) remaining.delete(id);
  }
  return stages;
}

// ---- 为单个角色生成自包含 prompt ----
function buildPrompt(role, meta, question, upstreamSpec, inject, ctx) {
  const parts = [];
  parts.push(`# 任务：${role.name}`);
  parts.push("");
  if (role.description) parts.push(`${role.description}`);
  parts.push("");
  if (question) { parts.push("## 研究问题 / 任务主题"); parts.push(question); parts.push(""); }
  parts.push("## 你的职责");
  parts.push(role.prompt.trim());
  parts.push("");
  if (upstreamSpec.length > 0) {
    const real = upstreamSpec.filter((u) => u.status === "injected");
    const pending = upstreamSpec.filter((u) => u.status === "pending");
    if (real.length > 0) {
      parts.push("## 上游输入（已提供）");
      for (const u of real) for (const out of u.outputs) { const text = (inject && inject[out]) || `（${out}）`; parts.push(`### ${out}`); parts.push(String(text)); }
      parts.push("");
    }
    if (pending.length > 0) {
      parts.push("## 上游输入（待注入）");
      for (const u of pending) parts.push(`- ${u.role} 的输出（${u.outputs.join("、")}）将在其完成后由主导会话提供给本角色。`);
      parts.push("");
    }
  }
  // 输出规范：仅当有 domain + 已选 profile + 角色产出匹配时注入
  if (ctx.outputProfile && ctx.profileApplies(role)) {
    const p = ctx.outputProfile;
    parts.push(`## ${p.section || "输出规范"}`);
    parts.push(`本角色产出面向：${p.name}`);
    p.rules.forEach((r) => parts.push(`- ${r}`));
    parts.push("");
  }
  if (role.policy) {
    parts.push("## 决策门控");
    if (role.policy.blocked_on?.length) {
      parts.push(`以下属【关键决定】，无明确答案（或无人提供）时**禁止自行决定**：${role.policy.blocked_on.join("、")}。`);
      parts.push("如有待定项，停止并输出 intermediate 结果 + `decision_gate.md`（逐条列出待确认项），**不要输出 final**。");
    } else {
      parts.push("本角色若遇到研究实质性决定且无人工答案，停止并输出 intermediate + `decision_gate.md`。");
    }
    if (role.policy.confirm_on?.length) parts.push(`请把以下假设逐条列给用户确认：${role.policy.confirm_on.join("、")}。`);
    if (role.policy.log_required) parts.push("请同步记录 `decision_log`（你做了哪些假设、哪些待确认）。");
    parts.push("");
  }
  if (role.evidence_grading && ctx.evidenceGradingLines) {
    parts.push("## 证据分级");
    for (const line of ctx.evidenceGradingLines) parts.push(line);
    parts.push("");
  }
  const methodology = role.methodology;
  if (methodology && typeof methodology === "object") {
    parts.push("## 方法参考");
    if (methodology.repo) parts.push(`来源：${methodology.repo}${methodology.url ? " — " + methodology.url : ""}`);
    if (methodology.skill) parts.push(`优先：若当前环境可加载 \`${methodology.skill}\`，请先加载并按其实践执行。`);
    if (methodology.note) parts.push(methodology.note);
    if (Array.isArray(methodology.steps) && methodology.steps.length) {
      parts.push("核心步骤（如无法加载上述 skill，按此回退执行）：");
      methodology.steps.forEach((s, idx) => parts.push(`${idx + 1}. ${s}`));
    }
    parts.push("");
  }
  const toolchain = role.toolchain;
  if (toolchain && ctx.toolchains && ctx.toolchains[toolchain]) {
    parts.push("## 工具链");
    parts.push(`本角色请使用 ${ctx.toolchains[toolchain]}。`);
    parts.push("");
  }
  parts.push("## 交付要求");
  parts.push(`请只围绕本任务提交结果，并确保包含以下产出：${role.outputs?.join("、") || "任务结果"}。`);
  return parts.join("\n").trim();
}

function buildUpstreamSpec(role, inject, byId) {
  const spec = [];
  for (const dep of role.depends_on || []) {
    const up = byId.get(dep);
    const outputs = up?.outputs?.length ? up.outputs : [dep];
    const provided = (inject && outputs.filter((o) => inject[o]).length > 0) || (inject && inject[dep]);
    spec.push({ role: dep, outputs, status: provided ? "injected" : "pending" });
  }
  return spec;
}

// ---- main ----
// ---- v1.3 role：由 responsibility/authority + selected capabilities 渲染 prompt ----
function buildV13Prompt(role, selectedCaps, capRegistry, resolverResults, ctx, question) {
  const parts = [];
  parts.push(`# 任务：${role.name}`);
  parts.push("");
  if (role.description) parts.push(role.description);
  parts.push("");
  if (question) { parts.push("## 研究问题 / 任务主题"); parts.push(question); parts.push(""); }
  parts.push("## 职责");
  for (const r of role.responsibility || []) parts.push(`- ${r}`);
  parts.push("");
  parts.push("## 权限");
  if ((role.authority?.may_decide || []).length) parts.push(`可自行决定：${role.authority.may_decide.join("、")}`);
  if ((role.authority?.must_escalate || []).length) parts.push(`必须上报（不得自行决定）：${role.authority.must_escalate.join("、")}`);
  parts.push("");
  if (Array.isArray(role.inputs) && role.inputs.length) { parts.push("## 上游输入"); for (const i of role.inputs) parts.push(`- ${i}`); parts.push(""); }
  if (ctx.outputProfile && ctx.profileApplies(role)) {
    const p = ctx.outputProfile;
    parts.push(`## ${p.section || "输出规范"}`);
    parts.push(`本角色产出面向：${p.name}`);
    p.rules.forEach((x) => parts.push(`- ${x}`));
    parts.push("");
  }
  if (selectedCaps && selectedCaps.length) {
    parts.push("## 本任务选用的能力");
    for (const cap of selectedCaps) {
      parts.push(`- ${cap}`);
      const capObj = capRegistry[cap];
      if (capObj?.methodology) {
        if (capObj.methodology.note) parts.push(`  - 方法参考：${capObj.methodology.note}`);
        for (const ref of (capObj.methodology.references || [])) parts.push(`  - 来源：${ref.name || ref.url || ref}`);
      }
      const res = resolverResults?.[cap];
      if (res) {
        let line = `  - 状态：${res.resolution}`;
        if (res.runtime) line += `；runtime=${res.runtime}${res.runtime_instance ? ` (${res.runtime_instance})` : ""}`;
        if (res.reason) line += `；${res.reason}`;
        parts.push(line);
      }
    }
    parts.push("");
  }
  if ((role.authority?.must_escalate || []).length) {
    parts.push("## 决策门控");
    parts.push(`以下属【必须上报】决定，无用户确认时停止并输出 intermediate + decision_gate.md：${role.authority.must_escalate.join("、")}`);
    parts.push("");
  }
  parts.push("## 交付要求");
  parts.push(`请产出：${(role.outputs || []).join("、") || "任务结果"}`);
  return parts.join("\n").trim();
}

// ---- DAG 传播：上游 blocked/needs_decision 会影响下游 ----
function computeDispatch(roles, ownStatus, byId) {
  const order = planStages(roles).flat();
  const eff = {};
  for (const id of order) {
    const deps = byId.get(id).depends_on || [];
    const depEff = deps.map((d) => eff[d]);
    let st = ownStatus[id] || "ready";
    if (st === "blocked") eff[id] = "blocked";
    else if (depEff.some((x) => x === "blocked")) eff[id] = "blocked";
    else if (depEff.some((x) => x === "needs_decision")) eff[id] = "needs_decision";
    else eff[id] = st;
  }
  return eff;
}
const rolesFile = arg("roles");
if (!rolesFile) {
  console.error("用法：node core/scaffold_role_team.mjs --roles <roles.json> [--domain <name>] [--output-profile <id>] [--question \"...\"] [--inject <json>] [--study <study.json>] [--env <env.json>] [--out <path>] [--dry-run]");
  process.exit(2);
}
const question = arg("question") || "";
let inject = {};
if (arg("inject")) { try { inject = JSON.parse(readFileSync(arg("inject"), "utf8")); } catch (e) { throw new Error(`无法解析 --inject 文件 ${arg("inject")}：${e.message}`); } }
const domain = arg("domain") || null;
const manifest = loadDomain(domain);
const { meta, roles } = loadRoles(rolesFile);
const isV13Pack = roles.some((r) => r.capability_scope !== undefined && r.prompt === undefined);
const study = arg("study") ? JSON.parse(readFileSync(arg("study"), "utf8")) : null;

// output profile：--output-profile / meta.output_profile / study.execution_context.output_profile
const profileId = arg("output-profile") || (meta.output_profile ?? null) || (study?.execution_context?.output_profile ?? null) || null;
let outputProfile = null;
if (manifest && profileId) outputProfile = loadOutputProfile(domain, profileId, manifest);
const profileApplies = manifest?.output_apply_to_role_outputs ? (role) => (role.outputs || []).some((o) => manifest.output_apply_to_role_outputs.some((k) => String(o).toLowerCase().includes(k))) : () => false;
const toolchains = manifest?.toolchains || null;
if (toolchains) { for (const r of roles) { if (r.toolchain !== undefined && !toolchains[r.toolchain]) throw new Error(`角色 "${r.id}" 的 toolchain 无效（应为 ${Object.keys(toolchains).join("/")}）：${r.toolchain}`); } }

const byId = new Map(roles.map((r) => [r.id, r]));
const stages = planStages(roles);
const ctx = { outputProfile, profileApplies, toolchains, evidenceGradingLines: manifest?.research_integrity?.evidence_grading_lines || null };

let preflight = null;
let rolePlan = {};
let eff = null;
let scopeErrors = [];
if (study) {
  const regDir = `domains/${study.domain || domain}/capabilities`;
  const registry = loadRegistry(regDir);
  const env = arg("env") ? JSON.parse(readFileSync(arg("env"), "utf8")) : {};
  const pctx = { mode: study.execution_context?.mode || "production", allow_experimental: !!study.execution_context?.allow_experimental, preferred_runtimes: study.execution_context?.preferred_runtimes || [], approved_overrides: study.execution_context?.approved_overrides || [] };
  scopeErrors = isV13Pack ? validateSelectedCapabilities(study, roles, registry) : [];
  preflight = resolveAll(study, registry, env, pctx);
}
if (isV13Pack) {
  if (!study) throw new Error("v1.3 role pack 需要 --study（含 selected_capabilities）");
  const ownStatus = {};
  for (const r of roles) {
    const sel = study.selected_capabilities?.[r.id] || [];
    ownStatus[r.id] = sel.length ? (preflight.roles[r.id]?.status || "ready") : "ready";
  }
  eff = computeDispatch(roles, ownStatus, byId);
  const registry = preflight ? loadRegistry(`domains/${study.domain || domain}/capabilities`) : {};
  for (const r of roles) {
    const sel = study.selected_capabilities?.[r.id] || [];
    const upstreamSpec = buildUpstreamSpec(r, inject, byId);
    rolePlan[r.id] = { id: r.id, name: r.name, target: r.target || "projectless", resolution: eff[r.id] || "ready", dispatch_allowed: (eff[r.id] || "ready") === "ready", selected_capabilities: sel, prompt: buildV13Prompt(r, sel, registry, preflight?.capabilities, ctx, question), expected_outputs: r.outputs || [], upstream_spec: upstreamSpec };
  }
} else {
  for (const r of roles) {
    const upstreamSpec = buildUpstreamSpec(r, inject, byId);
    rolePlan[r.id] = { id: r.id, name: r.name, target: r.target || "projectless", toolchain: r.toolchain || null, policy_pending: (r.policy?.blocked_on?.length || 0) > 0, prompt: buildPrompt(r, meta, question, upstreamSpec, inject, ctx), expected_outputs: r.outputs || [], upstream_spec: upstreamSpec };
  }
}
if (scopeErrors.length) throw new Error("Role↔Capability scope 校验失败：\n  - " + scopeErrors.join("\n  - "));

const out = {
  meta: { source: rolesFile, domain: domain || null, output_profile: outputProfile?.id || null, question: question || null, stage_count: stages.length, ...meta, ...(hasFlag("compat-mode") ? { compatibility_mode: "legacy_v1_2", legacy_warning: arg("legacy-warning") || "v1.2 compatibility mode: not production-verified" } : {}) },
  stages: stages.map((ids, idx) => ({ stage: idx + 1, roles: ids })),
  roles: rolePlan,
  ...(preflight ? { preflight } : {}),
};

console.log(`角色团队阶段顺序（共 ${stages.length} 个阶段）：`);
stages.forEach((ids, i) => { console.log(`  第${i + 1}阶段（可并行）：${ids.map((id) => `${id}(${byId.get(id).name})`).join("、")}`); });
if (isV13Pack && eff) {
  const blocked = roles.filter((r) => eff[r.id] === "blocked");
  const needDec = roles.filter((r) => eff[r.id] === "needs_decision");
  console.log("\n⚠️ v1.3 preflight（strict production）：");
  if (blocked.length) console.log("  blocked（不派发）：" + blocked.map((r) => `${r.id}(${r.name})`).join("、"));
  if (needDec.length) console.log("  needs_decision（待决策）：" + needDec.map((r) => `${r.id}(${r.name})`).join("、"));
} else {
  const pendingRoles = roles.filter((r) => (r.policy?.blocked_on?.length || 0) > 0);
  if (pendingRoles.length > 0) { console.log("\n⚠️ 以下角色有【待确认的决策门控】："); pendingRoles.forEach((r) => console.log(`  - ${r.id}(${r.name})：${r.policy.blocked_on.join("、")}`)); }
}

const outPath = arg("out") || "role-team-out/plan.json";
if (!hasFlag("dry-run")) { const abs = isAbsolute(outPath) ? outPath : join(root, outPath); mkdirSync(dirname(abs), { recursive: true }); writeFileSync(abs, JSON.stringify(out, null, 2) + "\n", "utf8"); console.log(`\n已写入 ${outPath}`); } else { console.log("\n--dry-run：未写文件。"); }

