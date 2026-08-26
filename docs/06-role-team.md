# 06 · 角色团队（Role Team）

在 `codex-orchestration` 的「一条主导会话 + 多条独立会话」之上，更进一步：把多条 worker 会话组织成**角色团队**——一个主导会话当协调者，若干「员工」各司其职，按依赖顺序派发、等待、验收、合并。

## 模型

```
协调者（本会话）
 ├─ roles 文件：定义谁是员工、谁依赖谁
 ├─ 第1阶段(并行)  →  literature、data
 ├─ 第2阶段(并行)  →  empirical、visualize
 ├─ 第3阶段       →  writing
 ├─ 第4阶段       →  review
 └─ 合并 → 汇报
```

- **角色（role）** = 一条独立 worker 线程，带一个**自包含** `prompt`。
- **依赖（depends_on）**：无依赖的角色可并行；有依赖的必须等上游产出后再建。
- **上游注入**：下游角色需要的上游 `outputs`，由主导会话在下游线程创建后 `send_message_to_thread` 注入（或重建 prompt 时填入）。

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

## 科研旗舰预设

`templates/role-team/roles.research.json` 内置 6 个角色：

| 角色 | 职责 | 依赖 | 产出 |
|---|---|---|---|
| `literature` 文献专员 | 检索、筛选、综述文献 | — | `literature_review` |
| `data` 数据处理 | 整理/清洗/构造数据 | — | `data_summary` |
| `empirical` 实证/显著性 | 实证、稳健性、显著性 | `data` | `empirical_results` |
| `visualize` 可视化 | 论文级图表 | `data` | `figures` |
| `writing` 写作 | 结构化论文/报告 | `literature`,`data`,`empirical` | `manuscript` |
| `review` 审查/审稿 | 审稿意见 | `writing` | `review_report` |

依赖图：`literature`、`data` 并行；`data` 之后 `empirical` 与 `visualize` 并行；`literature`、`data`、`empirical` 汇入 `writing`；`writing` 汇入 `review`。

## 怎么跑

1. 选/写一个 roles 文件。
2. 生成派发计划：`node scripts/scaffold_role_team.mjs --roles templates/role-team/roles.research.json --question "<研究问题>" --out role-team-out/plan.json`。
3. 按阶段（并行组）`create_thread` 建角色线程；角色如需要共享数据/工作区用 `target: project`（先 `list_projects` 取 `projectId`）。
4. `wait_threads` 等待当前阶段完成 → `read_thread` 验收。
5. 把上游输出 `send_message_to_thread` 注入下游角色 → 进入下一阶段。
6. 全部完成后合并交付。

## 示例（示意）

```ts
// 第1阶段：并行两个角色
create_thread({ prompt: plan.roles.literature.prompt, target: { type: "projectless" } });
create_thread({ prompt: plan.roles.data.prompt, target: { type: "project", projectId } });
wait_threads({ targets: [{ threadId: lit }, { threadId: dat }], timeoutMs: 120000 });

// 第2阶段：注入 data 结果后再建 empirical
send_message_to_thread({ threadId: emp, prompt: plan.roles.empirical.prompt });
read_thread({ threadId: emp, includeOutputs: true });
```

## 与其它能力的关系

- 想更细的线程操作（fork / handoff / 归档 / 定时）→ `docs/02-orchestration-patterns.md`。
- 工具名与真实行为 → `docs/03-tool-reference.md`。
- 想让另一台机器/虚拟机测试 → `docs/05-testing-guide.md`。