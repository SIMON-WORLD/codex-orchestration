# 06 · 角色团队（Role Team）

在 `codex-orchestration` 的「一条主导会话 + 多条独立会话」之上，更进一步：把多条 worker 会话组织成**角色团队**——一个主导会话当协调者，若干「员工」各司其职，按依赖顺序派发、等待、验收、合并。科研旗舰预设面向**经济学实证论文**，内置「决策门控 + 证据分级 + 期刊规范 + 复现检查」。

## 模型

```
协调者（本会话）
 ├─ roles 文件：定义谁是员工、谁依赖谁
 ├─ 第1阶段(并行)  →  literature_search、data
 ├─ 第2阶段(并行)  →  literature_review、empirical
 ├─ 第3阶段(并行)  →  visualize、writing
 ├─ 第4阶段       →  review
 └─ 合并 → 汇报
```

- **角色（role）** = 一条独立 worker 线程，带一个**自包含** `prompt`。
- **依赖（depends_on）**：无依赖的角色可并行；有依赖的必须等上游产出后再建。
- **上游注入**：下游角色需要的上游 `outputs`，由主导会话在下游线程创建后 `send_message_to_thread` 注入（或重建 prompt 时填入）。
- **决策门控（policy）**：`data`/`empirical` 角色的关键决定（分析单位/处理定义/聚类层级/删样本/识别策略）会在无人工答案时**停止并输出 intermediate + `decision_gate.md`**，绝不输出 final。
- **证据分级（evidence_grading）**：`literature_review`/`writing`/`review` 角色对因果/机制措辞按六级标注、登记证据台账、禁止编造。

## roles 文件

见 `templates/role-team/README.md` 的字段说明。核心字段：

| 字段 | 说明 |
|---|---|
| `id` | 角色唯一标识，用于 `depends_on` 引用 |
| `name` / `description` | 员工名 / 一句话职责 |
| `prompt` | **自包含**任务说明（必须把输入、产出说全） |
| `inputs` / `outputs` | 上游接收 / 本角色产出 |
| `depends_on` | 上游角色 id 列表 |
| `target` | `projectless`（默认）或 `project`（共享工作区/数据） |
| `methodology` | 可选 | 锚定的成熟工作流（`skill`/`repo`/`url`/`note`/`steps[]`）；脚手架注入「方法参考 + 摘录步骤」 |
| `toolchain` | 可选 | 本角色工具链（`stata`/`r`/`python`）；有则注入「工具链」 |
| `policy` | 可选 | 决策门控：`mode`（`hard_stop`/`semi_auto`/`auto_note`）+ `blocked_on`/`confirm_on`/`log_required`；脚手架注入「决策门控」 |
| `evidence_grading` | 可选 | 布尔；真则注入「证据分级」（写作/综述/审查类角色） |

顶层 `meta`：`meta.journal`（`aer`/`zh_classic`）与 `meta.toolchain`（`stata`/`r`/`python`），由脚手架注入到相应角色。

## 科研旗舰预设（经济学实证论文）

`templates/role-team/roles.research.json` 内置 7 个角色：

| 角色 | 职责 | 依赖 | 产出 | 门控/分级 |
|---|---|---|---|---|
| `literature_search` 文献检索 | 多源检索、去重、筛选、来源核实 | — | `literature_search_log` | — |
| `literature_review` 文献综述 | 综述、分歧/空缺、引用核验 | `literature_search` | `literature_review` | evidence |
| `data` 数据处理 | 清洗、构造、描述性说明 | — | `data_summary`、`decision_log` | policy |
| `empirical` 实证/显著性 | 实证、稳健性、显著性 | `data` | `empirical_results`、`decision_log`、`replication_stamp` | policy |
| `visualize` 可视化 | 论文级图表 | `data`,`empirical` | `figures` | — |
| `writing` 写作 | 结构化论文/报告 | `literature_search`,`literature_review`,`data`,`empirical` | `manuscript` | evidence |
| `review` 审查/审稿 | 审稿人组 + 复现检查 | `writing` | `review_report`、`replicability_check` | evidence |

依赖图：`literature_search`、`data` 并行；`literature_search` 之后 `literature_review`、`data` 之后 `empirical`；`empirical` 后 `visualize` 与 `writing` 并行（`writing` 还依赖文献与数据）；`writing` 汇入 `review`。

> 数据/实证/可视化默认 `toolchain: stata`（可改 `r`/`python`）；文字类角色（综述/写作/审查）不带工具链。

## 科研预设的方法论锚定

每个角色都锚定了 GitHub 上「最成熟、被认可」的工作流，采用**混合模式**：优先加载锚定 skill（若可用），否则按摘录的核心步骤自包含执行，并标注来源。

| 角色 | 锚定来源 | 仓库 | 说明 |
|---|---|---|---|
| literature_search | 文献发现/检索 | `brycewang-stanford/Auto-Empirical-Research-Skills` | 23k+ skills 集，检索严谨性 |
| literature_review | lit-review / nature-ref-verifier | `thinkingwithagents/skills` | 多会话综述 + 引用核验（Emily Beam） |
| data | EconAgentSkills / DIME working-with-data | `JonasWeinert/EconAgentSkills` | DIME Wiki 数据纪律、decision_log |
| empirical | EconAgentSkills / StatsPAI / Full-empirical-analysis-skill（DIME + 现代 DiD/IV/RDD） | `JonasWeinert/EconAgentSkills` | 现代 DiD（CS/SunAB/BJS）、弱 IV、rdrobust、honestdid、rwolf、oster、wild bootstrap |
| visualize | MixtapeTools（figures / coefplot） | `scunning1975/MixtapeTools` | 论文级系数图/事件研究图 |
| writing | econ-writing-skills / econ-TopJournal-writing-Skill / top-journal-style-benchmark | `mimaowang/econ-writing-skills` | Cochrane/McCloskey/Thomson/Nikolov/Oster + 10 篇 Top-5 校准、证据台账 |
| review | econ-audit / econ-empirical-paper-reviewer / AER-Skills / nature-reviewer | `Brian-ren-pro/econ-empirical-paper-skills` | 内部审稿人组 + DCAS/复现检查 |

## 决策门控、证据分级与期刊规范

- **决策门控**：`data`/`empirical` 的 `policy.blocked_on`（分析单位/处理定义/聚类层级/删样本/识别策略）无人工答案时，角色停止，输出 intermediate + `decision_gate.md` 把待确认项逐条列给用户；`confirm_on` 的假设也要逐条确认；并记录 `decision_log`。**目的：杜绝 agent 静默合成/替研究者做研究决定。**
- **证据分级**：综述/写作/审查角色把每条因果/机制结论登记进证据台账，按 `identified / model-implied / exclusion / consistent-with / suggestive / speculative` 六级标注；禁止把相关写成因果，区分 ITT/TOT、分配与实施、基线分母与不显著结果。
- **期刊规范**：`meta.journal` 默认 `aer`（AER/QJE/JPE/ReStud：摘要 100–150 词、≤40 页、AEA 复现包）；可切 `zh_classic`（中文经管四刊：约 300 字摘要、约 1.5 万字、数据/代码可得性）。脚手架注入到产出论文的角色（writing/review/empirical）。
- **复现/打包检查**：`review` 角色输出 `replicability_check`，按 DCAS/DCAP 检查数据+代码可得性、master do-file、`decision_log`，不新增独立打包角色。

## 怎么跑

1. 选/写一个 roles 文件。
2. 生成派发计划：`node scripts/scaffold_role_team.mjs --roles templates/role-team/roles.research.json --question "<研究问题>" --out role-team-out/plan.json`。
3. 按阶段（并行组）`create_thread` 建角色线程；共享数据/工作区用 `target: project`（先 `list_projects` 取 `projectId`）。
4. `wait_threads` 等待当前阶段完成 → `read_thread` 验收。
5. 把上游输出 `send_message_to_thread` 注入下游角色 → 进入下一阶段。若 worker 返回 `decision_gate.md`/`[BLOCKED]`，**先上浮给用户确认**，不要自动合并。
6. 全部完成后合并交付，并把 `decision_log`/`replicability_check` 一并归档。

## 示例（示意）

```ts
// 第1阶段：并行文献检索 + 数据处理
create_thread({ prompt: plan.roles.literature_search.prompt, target: { type: "projectless" } });
create_thread({ prompt: plan.roles.data.prompt, target: { type: "project", projectId } });
wait_threads({ targets: [{ threadId: search }, { threadId: data }], timeoutMs: 120000 });

// 若 data 返回 decision_gate.md → 先询问用户分析单位/处理定义/删样本，再继续
// 第2阶段：注入 data 结果后再建 empirical
send_message_to_thread({ threadId: emp, prompt: plan.roles.empirical.prompt });
read_thread({ threadId: emp, includeOutputs: true });
```

## 与其它能力的关系

- 想更细的线程操作（fork / handoff / 归档 / 定时）→ `docs/02-orchestration-patterns.md`。
- 工具名与真实行为 → `docs/03-tool-reference.md`。
- 想让另一台机器/虚拟机测试 → `docs/05-testing-guide.md`。
