# 06 · 角色团队（Role Team）

`codex-orchestration` 的「一条主导会话 + 多条独立会话」之上，进一步把多条 worker 会话组织成**角色团队**。**strict v1.3** 默认路径已经把「角色」与「具体科研方法」解耦：角色只负责**责任与权限范围**，方法由 **Study 的 `selected_capabilities`** 经 **Capability Registry → Resolver / Preflight** 决定。旧 `templates/role-team/roles.research.json` 仅作为 **Legacy v1.2 Compatibility** 保留（见文末）。

## 模型（strict v1.3）

```
协调者（本会话）
 ├─ domains/economics/roles.json      定义员工：责任 + capability_scope
 ├─ domains/economics/study_design…  定义本次研究：selected_capabilities + 人口/前提
 ├─ Capability Registry              能力及其 implementations（可见、验证状态）
 ├─ Resolver / Preflight             resolved / needs_decision / blocked
 ├─ 第1阶段(并行) → literature_search、data
 ├─ 第2阶段(并行) → literature_review、empirical
 ├─ 第3阶段(并行) → visualize、writing
 ├─ 第4阶段      → review
 └─ 合并 → 汇报
```

- **角色（role）** = 一条独立 worker 线程；其 prompt 由脚手架从 `responsibility` + `authority` + 所选能力的**方法引用**生成。
- **方法（method）**：**不由角色硬编码**，而由 `study.selected_capabilities`（每个 role 一个能力清单）→ registry → resolver 选出。
- **依赖（depends_on）**：无依赖可并行；有依赖的必须等上游产出并在下游线程中读取后再建。

> 注意：这里模型图里 `literature_review` 与 `empirical` 等角色是否可派发，**由 preflight 决定**；不要因为它“看起来就绪”就让它提前于其上游被创建（见 Dispatch 规则）。

## Role → capability_scope

`domains/economics/roles.json` 里每个角色用 **`capability_scope`** 声明「能承担哪些能力类别」，角色本身不再携带 `methodology` / `toolchain` / `journal` / `policy`。

| 字段 | 说明 |
|---|---|
| `id` | 角色唯一标识，用于 `depends_on` |
| `name` / `description` | 员工名 / 一句话职责 |
| `responsibility` | 该角色负责的事项（职责文本） |
| `authority` | `may_decide` 可自行决定项 / `must_escalate` 必须上浮项 |
| `inputs` / `outputs` | 上游输入 / 本角色产出（供下游引用） |
| `capability_scope` | 该角色可承担的能力类别（如 `economics.literature.*`、`economics.regression.*`） |
| `depends_on` | 上游角色 id 列表 |
| `target` | `projectless`（默认）或 `project`（共享工作区/数据） |

## Study → selected_capabilities

`domains/economics/study_design.example.json` 是一次具体研究的设计：`execution_context`（mode / preferred_runtimes / approved_overrides）+ **`selected_capabilities`**（每个 role 本次真正用到的能力）+ `decisions`（识别/聚类/删样本等关键决定）+ `preconditions` + `manual_validations`。

- 某次任务可能只 `selected`：`economics.regression.panel_fe`、`economics.stat.inference.clustered`；
- 另一次才 `selected`：`economics.causal.iv`、`economics.causal.iv.weak_diagnostics`。
- **不是**让 role 静态要求所有 causal 方法；resolver 只解析本次 `selected_capabilities`。

## Resolver / Preflight

`core/resolve_capabilities.mjs` 对每个 `selected_capabilities` 解析环境/版本/风险/验证状态，产出：

- **`resolved`**：可执行（implementation 满足环境与验证门槛）。
- **`needs_decision`**：环境/实现满足，但关键科研决定未确认 → 进入既有 `decision_gate`，用户确认后重新 preflight。
- **`blocked`**：HIGH-risk + production 无 `verified` implementation（`no_verified_implementation`）等 → **不派发**。

`plan.preflight` 汇总整体状态与每能力；`plan.roles[roleId]` 给出 `resolution`、`dispatch_allowed`、`selected_capabilities`。

## Dispatch 规则

**只有同时满足**以下三项才 `create_thread`：

1. `dispatch_allowed === true`（preflight 没有禁止）；
2. **DAG 阶段已到**（不是只因为角色 `ready` 就提前）；
3. **每个 `depends_on` 上游输出已完成并读取**（`read_thread` 取回其 `outputs` 并注入下游）。

否则：
- `blocked` → 不要 `create_thread`，上浮给用户或停在 preflight；
- `needs_decision` → 不要 `create_thread`，先让用户补关键决定。

## Artifact / Provenance（结构化产物与可复现契约）

一条确定性链路，把数值的“单一事实来源”固定下来：

```
source data
  → structured artifacts（data_manifest / variable_dictionary / sample_flow / descriptive_facts）
  → model_registry + estimates + diagnostics
  → deterministic replication_stamp（core/build_replication_stamp.mjs 纯函数）
  → core/validate_artifacts.mjs（复用同一纯函数重建 expected stamp 做 deterministic 比较）
  → PASS / FAIL
```

- **`replication_stamp`** 只能由 builder 从 structured artifacts 确定性生成，worker/LLM 不手填统计量。
- **`descriptive_facts`** 由 source data 确定性生成（`domains/economics/benchmarks/issue5/…`）。
- **`validate_artifacts`** 机器校验：stamp↔estimates↔model_registry 一致、model/estimate 引用完整、`sample_flow` 算术、`data_manifest` source-data hash（freshness）、`artifact_manifest` checksum、multiple-testing family 完整性。
- **`artifact_manifest`** 记录每个 JSON 的 canonical hash（独立于自身，避免 self-hash）。

> **Structural consistency ≠ scientific estimator correctness。** 以上只证明「同一数值没被多处手写、source/output 未 stale/tampered」；统计实现本身的正确性（如 Holm 数值、事件研究动态、DID 估计量）属于 **Capability benchmark / Phase 7**，届时用真实公开 replication 数据集升级 `verified`。当前 registry 的 high-risk implementation 仍是 `experimental/reference`，**未** `verified`。

## 怎么跑（strict v1.3）

1. 准备/修改 Study 设计（`selected_capabilities` + `decisions` + `preconditions`）。
2. 生成派发计划：
   `node core/scaffold_role_team.mjs --domain economics --roles domains/economics/roles.json --study domains/economics/study_design.example.json --out role-team-out/plan.json`
3. 先读 `plan.preflight` 与 `plan.roles`；处理 `blocked` / `needs_decision`。
4. 按阶段（并行组）`create_thread`；共享数据/工作区用 `target: project`（先 `list_projects` 取 `projectId`）。
5. `wait_threads` 等待当前阶段完成 → `read_thread` 验收 → 把上游输出经 `send_message_to_thread` 注入下游角色 → 进入下一阶段。
6. 若 worker 返回 `decision_gate.md` / `[BLOCKED]`，**先上浮给用户确认**，不要自动合并。
7. 全部完成后合并交付，把结构化 artifacts、`replication_stamp`、`decision_log`、`replicability_check` 一并归档。

## 示例（示意）

```ts
// 第1阶段：仅当 preflight 允许（dispatch_allowed + 阶段到位 + 无上游依赖）
create_thread({ prompt: plan.roles.literature_search.prompt, target: { type: "projectless" } });
wait_threads({ targets: [{ threadId: search }], timeoutMs: 120000 });

// 若 data 为 needs_decision → 先询问用户分析单位/处理定义/删样本，再继续
// 第2阶段：读到 data 上游输出并注入后才创建 empirical
send_message_to_thread({ threadId: emp, prompt: plan.roles.empirical.prompt });
read_thread({ threadId: emp, includeOutputs: true });
```

## Legacy v1.2 Compatibility

旧科研预设 `templates/role-team/roles.research.json` + `scripts/scaffold_role_team.mjs` 走 `compatibility_mode: legacy_v1_2`，**仅为向后兼容，not production-verified**。其字段与行为如下，**不属于 strict v1.3 默认**：

- **旧角色字段**：`methodology`（锚定 skill + `steps[]`）、`toolchain`（`stata`/`r`/`python`）、`policy`（决策门控 `hard_stop`/`semi_auto`/`auto_note`）、`evidence_grading`（六级因果措辞）。
- **旧顶层**：`meta.journal`（`aer`/`zh_classic`）、`meta.toolchain`。
- **混合回退**：科研角色 prompt 优先加载锚定 skill（若可用），否则按 `methodology.steps` **自包含回退**执行，并标注来源 URL。这是 legacy 的默认行为。
- **需授权/Stata**：`meta.toolchain`/角色 `toolchain` 默认 `stata`，无 Stata 环境验证或跑流程时改为 `python`/`r`。

> **strict v1.3 不允许**这条回退：HIGH-risk capability 在 `production` 下若无 `verified` implementation，Resolver 直接 `blocked`（`no_verified_implementation`），不会静默走 `methodology.steps`。`methodology`/`toolchain`/`journal`/`policy` 等旧字段在 strict 角色中不再出现。

## 与其它能力的关系

- 更细的线程操作（fork / handoff / 归档 / 定时）→ `docs/02-orchestration-patterns.md`。
- 工具名与真实行为 → `docs/03-tool-reference.md`。
- 让另一台机器/虚拟机测试 → `docs/05-testing-guide.md`。
