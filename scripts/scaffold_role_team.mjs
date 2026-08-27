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

const TOOLCHAIN = {
  stata: "Stata（reghdfe / esttab / coefplot / winsor2 / csdid / rdrobust，见 MixtapeTools）",
  r: "R（fixest / modelsummary / broom / tidyverse，见 christopherkenny / 应用统计）",
  python: "Python（linearmodels / statsmodels / pyfixest / pandas，见 StatsPAI / 全实证流程）",
};

// 期刊规范（meta.journal）；脚手架据此注入「## 期刊规范」。
const JOURNAL = {
  aer: {
    name: "AER / QJE / JPE / ReStud（国际顶刊）",
    rules: [
      "摘要 100–150 词（硬上限 200 词），标题 5–17 词中位约 10 词",
      "正文 ≤ 约 40 页（含表格图）；AER: Insights 短文 ≤ 6000 词",
      "必须提供数据 + 代码复现包（AEA Data Editor / DCAS 标准）",
      "识别驱动：先讲识别策略与识别假设，再给实证部分",
      "区分 ITT 与 TOT、分配与实施、基线分母与不显著结果",
    ],
  },
  zh_classic: {
    name: "经济研究 / 管理世界 / 金融研究 / 中国工业经济",
    rules: [
      "中文摘要约 300 字，关键词 3–5 个",
      "正文篇幅约 1.5 万字，符合中文经管期刊结构（摘要—引言—文献—研究设计—数据—实证—结论）",
      "数据与代码可得性说明，可附复现包",
      "识别驱动：先讲研究设计与识别，再给实证",
      "因果措辞分级，避免把相关写成因果",
    ],
  },
};

const POLICY_MODES = ["hard_stop", "semi_auto", "auto_note"];

// 这些角色产出的结果会进入期刊/论文格式流程，因此注入期刊规范。
function journalApplies(role) {
  const outs = role.outputs || [];
  return outs.some((o) => /manuscript|review_report|replicability_check|empirical_results|paper/i.test(o));
}

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
    if (
      typeof r?.prompt !== "string" || !r.prompt.trim()
    ) {
      throw new Error(`角色 "${r.id}" 缺少有效的 prompt（自包含任务说明）：${JSON.stringify(r)}`);
    }
    if (r.methodology !== undefined && (typeof r.methodology !== "object" || r.methodology === null)) {
      throw new Error(`角色 "${r.id}" 的 methodology 必须是对象：${JSON.stringify(r.methodology)}`);
    }
    if (r.toolchain !== undefined && !TOOLCHAIN[r.toolchain]) {
      throw new Error(`角色 "${r.id}" 的 toolchain 无效（应为 stata/r/python）：${r.toolchain}`);
    }
    if (r.policy !== undefined) {
      if (typeof r.policy !== "object" || r.policy === null) {
        throw new Error(`角色 "${r.id}" 的 policy 必须是对象：${JSON.stringify(r.policy)}`);
      }
      if (r.policy.mode !== undefined && !POLICY_MODES.includes(r.policy.mode)) {
        throw new Error(`角色 "${r.id}" 的 policy.mode 无效（应为 hard_stop/semi_auto/auto_note）：${r.policy.mode}`);
      }
      for (const k of ["blocked_on", "confirm_on"]) {
        if (r.policy[k] !== undefined) {
          if (!Array.isArray(r.policy[k]) || !r.policy[k].every((x) => typeof x === "string" && x.trim())) {
            throw new Error(`角色 "${r.id}" 的 policy.${k} 必须是字符串数组：${JSON.stringify(r.policy[k])}`);
          }
        }
      }
      if (r.policy.log_required !== undefined && typeof r.policy.log_required !== "boolean") {
        throw new Error(`角色 "${r.id}" 的 policy.log_required 必须是布尔值：${r.policy.log_required}`);
      }
    }
    if (r.evidence_grading !== undefined && typeof r.evidence_grading !== "boolean") {
      throw new Error(`角色 "${r.id}" 的 evidence_grading 必须是布尔值：${r.evidence_grading}`);
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
  const meta = raw?.meta || {};
  if (meta.toolchain !== undefined && !TOOLCHAIN[meta.toolchain]) {
    throw new Error(`meta.toolchain 无效（应为 stata/r/python）：${meta.toolchain}`);
  }
  if (meta.journal !== undefined && !JOURNAL[meta.journal]) {
    throw new Error(`meta.journal 无效（应为 aer/zh_classic）：${meta.journal}`);
  }
  return { meta, roles };
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
function buildPrompt(role, meta, question, upstreamSpec, inject) {
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
  if (meta.journal && JOURNAL[meta.journal] && journalApplies(role)) {
    const j = JOURNAL[meta.journal];
    parts.push("## 期刊规范");
    parts.push(`本角色产出面向：${j.name}`);
    j.rules.forEach((r) => parts.push(`- ${r}`));
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
    if (role.policy.confirm_on?.length) {
      parts.push(`请把以下假设逐条列给用户确认：${role.policy.confirm_on.join("、")}。`);
    }
    if (role.policy.log_required) {
      parts.push("请同步记录 `decision_log`（你做了哪些假设、哪些待确认）。");
    }
    parts.push("");
  }
  if (role.evidence_grading) {
    parts.push("## 证据分级");
    parts.push("每条因果/机制结论都需登记进证据台账，并标注证据级别：identified / model-implied / exclusion / consistent-with / suggestive / speculative。");
    parts.push("禁止把相关性写成因果；明确区分 ITT 与 TOT、分配与实施、基线分母与不显著结果；再好的文笔也不能抵消一处事实错误。");
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
  if (toolchain && TOOLCHAIN[toolchain]) {
    parts.push("## 工具链");
    parts.push(`本角色请使用 ${TOOLCHAIN[toolchain]}。`);
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
    toolchain: r.toolchain || null,
    policy_pending: (r.policy?.blocked_on?.length || 0) > 0,
    prompt: buildPrompt(r, meta, question, upstreamSpec, inject),
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

const pendingRoles = roles.filter((r) => (r.policy?.blocked_on?.length || 0) > 0);
if (pendingRoles.length > 0) {
  console.log("\n⚠️ 以下角色有【待确认的决策门控】（需人工回答，否则它们会停在 intermediate，不输出 final）：");
  pendingRoles.forEach((r) => console.log(`  - ${r.id}(${r.name})：${r.policy.blocked_on.join("、")}`));
}

const outPath = arg("out") || "role-team-out/plan.json";
if (!hasFlag("dry-run")) {
  const abs = isAbsolute(outPath) ? outPath : join(root, outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(`\n已写入 ${outPath}（各角色自包含 prompt 见 roles.*.prompt，或直接看上面的阶段顺序）`);
} else {
  console.log("\n--dry-run：未写文件。可用 --out 指定输出路径。");
}

