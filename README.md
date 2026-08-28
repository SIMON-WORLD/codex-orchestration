# codex-orchestration

> A continuously updated playbook for **agent-style collaboration with Codex**: one coordinator session dispatches work across independent threads, waits, verifies and merges. Bundled with an auto-refreshed `codex_app` tool reference and a **role-team layer** (N role worker threads with dependencies, plus a strict v1.3 Economics capability registry).

[![CI](https://github.com/SIMON-WORLD/codex-orchestration/actions/workflows/validate.yml/badge.svg)](https://github.com/SIMON-WORLD/codex-orchestration/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 简介

用 Codex 做**多会话 / 多线程协作**：一条会话当**主导者**，把任务拆成多条**独立会话**并行去做，最后统一验收、合并。本仓库把这套用法沉淀成手册、可安装 skill、自动生成的工具参考，以及一套 **strict v1.3** 的 Economics 角色 + 能力注册表。

## 功能

- **管理→工人**：`create_thread` → `send_message_to_thread` → `wait_threads` → `read_thread` → 合并。
- **进阶能力**：`fork` / `handoff` / 归档 / 置顶 / 分享 / 定时自动化（`automation_update`）。
- **角色团队层（strict v1.3）**：角色只定义**责任 + 权限范围（`capability_scope`）**；具体科研方法由 **Study 的 `selected_capabilities`** → **Capability Registry** → **Resolver / Preflight** 决定，产出 `resolved / needs_decision / blocked`。
- **自动工具参考**：`docs/03-tool-reference.md` 由脚本生成，随 Codex 工具更新。

## 安装

把 `skills/` 下的两个 skill 复制到你的 `.agents/skills/`（或按版本用 `codex skill install` 安装）。装好后 Codex 会自动知道怎么用这些编排工具。

## 快速上手（strict v1.3，默认）

```bash
# 生成科研角色团队的派发计划（含 Capability Resolver / Preflight）
node core/scaffold_role_team.mjs \
  --domain economics \
  --roles domains/economics/roles.json \
  --study domains/economics/study_design.example.json \
  --out role-team-out/plan.json
```

然后按 `skills/codex-role-team/SKILL.md` 的流程：**先读 `plan.preflight` 与 `plan.roles`**。对每个角色：

- `resolution: blocked` → **不要 `create_thread`**；
- `resolution: needs_decision` → **不要 `create_thread`**，把决策门 `decision_gate` 上浮给用户；
- `dispatch_allowed: true` **且** DAG 阶段到位 **且** 所有 `depends_on` 上游输出已读取 → 才 `create_thread`。

> **旧科研预设 `templates/role-team/roles.research.json` + `scripts/scaffold_role_team.mjs` 为 `legacy_v1_2` compatibility only，not production-verified**。其 `methodology` / `policy` / `meta.journal` 旧行为仅作向后兼容，**不再是默认科研路径**。在缺 anchor skill 时，旧路径会按 `methodology.steps` 自包含回退；**strict v1.3 / HIGH-risk 不允许**这种静默回退。
>
> **当前状态**：真实 registry（`domains/economics/capabilities/`）中**没有**已验证（`verified`）的 high-risk economics implementation。`production` 模式下 high-risk capability 会 `blocked`（`no_verified_implementation`），直到 Phase 7 用真实 replication benchmark 实证后才能升级 `verified`。

## 目录

| 路径 | 说明 |
|---|---|
| `docs/` | 手册（01 编排模型、02 模式、03 工具参考、…、06 角色团队） |
| `skills/` | 可安装 skill（`codex-orchestration`、`codex-role-team`） |
| `core/` | v1.3 通用核心：`scaffold_role_team.mjs`、`resolve_capabilities.mjs`、artifact/provenance 校验 |
| `domains/economics/` | strict v1.3 领域包：`roles.json`、`capabilities/*`、`manifest.json`、`study_design.example.json` |
| `templates/role-team/` | v1.2 模板（schema 指南 + `roles.research.json`，`legacy_v1_2`） |
| `scripts/` | 工具参考生成、工具捕获、v1.2 角色团队脚手架（compat） |
| `data/` | 工具快照 + 人工用法说明（脚本输入） |

## 贡献

想改或想找 bug？见 [`CONTRIBUTING.md`](CONTRIBUTING.md)；让另一台机器/VM 按 [`docs/05-testing-guide.md`](docs/05-testing-guide.md) 测试，发现问题走 PR。

## 许可证

[MIT](LICENSE)
