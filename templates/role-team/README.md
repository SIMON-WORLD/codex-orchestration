# Role Team 模板读者指南

这份模板用来定义「一个角色团队」：谁是员工（role），谁依赖谁（depends_on），每个员工拿到什么任务（prompt）。开箱即用的科研预设见 `roles.research.json`；`roles.json` 是最小的通用示例。

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

## 字段说明

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
| `methodology` | 可选 | 锚定的成熟工作流（`skill`/`repo`/`url`/`note`/`steps[]`）；脚手架会在 prompt 里注入「方法参考 + 摘录步骤」 |
| `toolchain` | 可选 | 本角色工具链（`stata`/`r`/`python`）；有则脚手架注入「工具链」，只影响计算类角色 |

## 怎么改造成自己领域

1. 复制 `roles.research.json` 或 `roles.json`。
2. 改 `meta` 和每个角色的 `id`/`name`/`prompt`/`inputs`/`outputs`。
3. 用 `depends_on` 连好上下游：独立角色可并行，有依赖的必须等上游。
4. 跑脚手架生成派发计划复核顺序：`node scripts/scaffold_role_team.mjs --roles <你的文件> --question "<任务>" --out role-team-out/plan.json`。
5. 按 `skills/codex-role-team/SKILL.md` 的流程让主导会话创建并调度这些角色线程。

## 为什么提示词用「混合」模式

角色线程是独立会话，不一定能读到本仓库或你本机的 skill。科研角色采用**混合**：prompt 优先加载锚定的成熟 skill（若可用），否则按 `methodology.steps` 的核心步骤**自包含回退**执行，并标注来源。每个角色都必须把任务、输入、产出契约说全，才能在任何环境里独立跑起来。上游输出由主导会话用 `send_message_to_thread` 或重建 prompt 注入，不要指望 worker 自己去找。