# Role Team 模板读者指南（v1.2 legacy）

> **状态：`templates/role-team/` 属于 v1.2 `legacy_v1_2` compatibility 模板**，仅作向后兼容，**not production-verified**。其中 `roles.research.json`（科研预设）与 `roles.json`（通用示例）都走 `scripts/scaffold_role_team.mjs`，并在生成的 plan 里记为 `compatibility_mode: legacy_v1_2`。
>
> **strict v1.3（默认科研路径）**请用领域包：
> - 角色：`domains/economics/roles.json`
> - 一次研究的设计（`selected_capabilities` + 关键决定）：`domains/economics/study_design.example.json`
> - 能力注册表：`domains/economics/capabilities/`
> - 生成计划：`node core/scaffold_role_team.mjs --domain economics --roles domains/economics/roles.json --study domains/economics/study_design.example.json --out role-team-out/plan.json`
>
> 本文件只说明 **v1.2 模板**的字段格式，供需要兼容旧行为的场景使用。

这份模板用来定义一个「角色团队」：谁是员工（role），谁依赖谁（depends_on），每个员工拿到什么任务（prompt）。`roles.research.json` 是科研预设；`roles.json` 是最小的通用示例。

## roles 文件长什么样

```json
{
  "meta": { "title": "我的角色团队", "description": "……" },
  "roles": [
    {
      "id": "literature",
      "name": "文献专员",
      "description": "检索、筛选、整理给定主题的高质量文献",
      "prompt": "（自包含）完整任务说明……",
      "inputs": ["research_question"],
      "outputs": ["literature_review"],
      "depends_on": [],
      "target": "projectless"
    }
  ]
}
```

## v1.2 字段说明

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 角色唯一标识，小写英文，用来在 `depends_on` 里引用 |
| `name` | 是 | 角色的中文名/员工名 |
| `description` | 建议 | 一句话说明这个角色干什么 |
| `prompt` | 是 | **自包含**任务说明：把要干什么、输入是什么、输出什么说全 |
| `inputs` | 建议 | 这个角色需要从上游接收的输入条目名 |
| `outputs` | 建议 | 这个角色产出的结果条目名，供下游 `inputs` 引用 |
| `depends_on` | 建议 | 上游角色 id 列表；为空表示无依赖（可并行） |
| `target` | 可选 | `projectless`（默认）或 `project`；需要共享工作区/数据用 `project` |
| `methodology` | 可选 | 锚定的成熟工作流（`skill`/`repo`/`url`/`note`/`steps[]`）；脚手架会注入「方法参考 + 摘录步骤」 |
| `toolchain` | 可选 | 本角色工具链（`stata`/`r`/`python`）；有则脚手架注入「工具链」，只影响计算类角色 |
| `policy` | 可选 | 决策门控：`mode`（`hard_stop`/`semi_auto`/`auto_note`）+ `blocked_on`/`confirm_on`/`log_required`；脚手架注入「决策门控」 |
| `evidence_grading` | 可选 | 布尔；真则注入「证据分级」（六级因果措辞+证据台账，写作/综述/审查类角色设 true） |

## 顶层 meta 与期刊规范（v1.2）

`meta.journal` 可选，取值 `aer`（默认，AER/QJE/JPE/ReStud 国际标准）或 `zh_classic`（中文经管四刊）。脚手架会把对应「期刊规范」注入产出论文的角色（writing/review/empirical）。`meta.toolchain` 默认 `stata`，可改 `r`/`python`，给计算类角色定工具链。

## 改造成自己领域（v1.2 legacy）

1. 复制 `roles.research.json` 或 `roles.json`。
2. 改 `meta` 和每个角色的 `id`/`name`/`prompt`/`inputs`/`outputs`。
3. 用 `depends_on` 连好上下游：独立角色可并行，有依赖的必须等上游。
4. 跑脚手架生成派发计划复核顺序：`node scripts/scaffold_role_team.mjs --roles <你的文件> --question "<任务>" --out role-team-out/plan.json`。
5. 按 `skills/codex-role-team/SKILL.md` 的流程让主导会话创建并调度这些角色线程。

## 关于「混合」回退（v1.2 legacy）

角色线程是独立会话，不一定能读到本仓库或你本机的 skill。v1.2 科研角色采用**混合**：prompt 优先加载锚定的成熟 skill（若可用），否则按 `methodology.steps` 的核心步骤**自包含回退**执行，并标注来源。**这是 v1.2 legacy 的默认行为**；在 **strict v1.3**（`domains/economics/…`）中这类静默回退被禁止——HIGH-risk capability 无 `verified` implementation 时直接 `blocked`。
