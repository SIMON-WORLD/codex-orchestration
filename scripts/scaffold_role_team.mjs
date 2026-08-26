#!/usr/bin/env node
// 生成「角色团队」派发计划（不调用任何线程工具）。
// 输入: --roles <roles.json> （必填）
//       --question "<研究问题/任务主题>" （可选）
//       --inject <json> （可选：预填上游输出，用于自包含预览/测试）
//       --out <path> （可选：写 JSON 到该路径，默认 role-team-out/plan.json；--dry-run 只打印不写）
// 输出: 人类可读的阶段顺序（stdout）+ 逐角色自包含 prompt（JSON）
// 说明: create_thread / send_message_to_thread 等是 Codex 的 agent 工具，只能在主导会话里调用；
//       本脚本只负责校验 roles、计算顺序、生成每个角色可独立执行的 prompt。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

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

// ---- 解析 roles ----
function loadRoles(file) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`无法解析 roles 文件 ${file}：${e.message}`);
  }
  const roles = raw && Array.isArray(raw.roles) ? raw.roles : [];
  if (roles.length === 0) {
    console.warn("警告：roles 为空数组，将生成空的派发计划。");
    return { meta: raw?.meta || {}, roles: [] };
  }
  for (const r of roles) {
    if (typeof r?.id !== "string" || !r.id.trim()) {
      throw new Error(`角色缺少有效的 id：${JSON.stringify(r)}`);
    }
    if (typeof r?.name !== "string" || !r.name.trim()) {
      throw new Error(`角色 "${r.id}" 缺少有效的 name：${JSON.stringify(r)}`);
    }
    if (typeof r?.prompt !== "string" || !r.prompt.trim()) {
      throw new Error(`角色 "${r.id}" 缺少有效的 prompt（自包含任务说明）：${JSON.stringify(r)}`);
    }
  }
  const ids = new Set(roles.map((r) => r.id));
  for (const r of roles) {
    for (const dep of r.depends_on || []) {
      if (!ids.has(dep)) {
        throw new Error(`角色 "${r.id}" 的 depends_on 引用了不存在的角色 "${dep}"`);
      }
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
    if (++guard > roles.length + 1) {
      throw new Error("检测到角色依赖环，无法生成阶段顺序；请检查 depends_on。");
    }
    const ready = [...remaining].filter((id) => {
      const deps = byId.get(id).depends_on || [];
      return deps.every((d) => !remaining.has(d));
    });
    if (ready.length === 0) {
      throw new Error("检测到角色依赖环，无法生成阶段顺序；请检查 depends_on。");
    }
    stages.push(ready);
    for (const id of ready) remaining.delete(id);
  }
  return stages;
}

// ---- 为单个角色生成自包含 prompt ----
function buildPrompt(role, question, upstreamSpec, inject) {
  const parts = [];
  parts.push(`# 任务：${role.name}`);
  parts.push("");
  if (role.description) parts.push(`${role.description}`);
  parts.push("");
  if (question) {
    parts.push("## 研究问题 / 任务主题");
    parts.push(question);
    parts.push("");
  }
  parts.push("## 你的职责");
  parts.push(role.prompt.trim());
  parts.push("");
  if (upstreamSpec.length > 0) {
    const real = upstreamSpec.filter((u) => u.status === "injected");
    const pending = upstreamSpec.filter((u) => u.status === "pending");
    if (real.length > 0) {
      parts.push("## 上游输入（已提供）");
      for (const u of real) {
        for (const out of u.outputs) {
          const text = (inject && inject[out]) || `（${out}）`;
          parts.push(`### ${out}`);
          parts.push(String(text));
        }
      }
      parts.push("");
    }
    if (pending.length > 0) {
      parts.push("## 上游输入（待注入）");
      for (const u of pending) {
        parts.push(`- ${u.role} 的输出（${u.outputs.join("、")}）将在其完成后由主导会话提供给本角色。`);
      }
      parts.push("");
    }
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
    spec.push({
      role: dep,
      outputs,
      status: provided ? "injected" : "pending",
    });
  }
  return spec;
}

// ---- main ----
const rolesFile = arg("roles");
if (!rolesFile) {
  console.error("用法：node scripts/scaffold_role_team.mjs --roles <roles.json> [--question \"...\"] [--inject <json>] [--out <path>] [--dry-run]");
  process.exit(2);
}

const question = arg("question") || "";
let inject = {};
if (arg("inject")) {
  try {
    inject = JSON.parse(readFileSync(arg("inject"), "utf8"));
  } catch (e) {
    throw new Error(`无法解析 --inject 文件 ${arg("inject")}：${e.message}`);
  }
}

const { meta, roles } = loadRoles(rolesFile);
const byId = new Map(roles.map((r) => [r.id, r]));
const stages = planStages(roles);

const rolePlan = {};
for (const r of roles) {
  const upstreamSpec = buildUpstreamSpec(r, inject, byId);
  rolePlan[r.id] = {
    id: r.id,
    name: r.name,
    target: r.target || "projectless",
    prompt: buildPrompt(r, question, upstreamSpec, inject),
    expected_outputs: r.outputs || [],
    upstream_spec: upstreamSpec,
  };
}

const out = {
  meta: { source: rolesFile, question: question || null, stage_count: stages.length, ...meta },
  stages: stages.map((ids, idx) => ({ stage: idx + 1, roles: ids })),
  roles: rolePlan,
};

// 人类可读顺序
console.log(`角色团队阶段顺序（共 ${stages.length} 个阶段）：`);
stages.forEach((ids, i) => {
  const names = ids.map((id) => `${id}(${byId.get(id).name})`).join("、");
  console.log(`  第${i + 1}阶段（可并行）：${names}`);
});

const outPath = arg("out") || "role-team-out/plan.json";
if (!hasFlag("dry-run")) {
  const abs = isAbsolute(outPath) ? outPath : join(root, outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`\n已写入 ${outPath}（各角色自包含 prompt 见 roles.*.prompt，或直接看上面的阶段顺序）`);
} else {
  console.log("\n--dry-run：未写文件。可用 --out 指定输出路径。");
}