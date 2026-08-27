# codex-orchestration

> A continuously updated playbook for **agent-style collaboration with Codex**: one coordinator session dispatches work across independent threads, waits, verifies and merges. Bundled with an auto-refreshed `codex_app` tool reference and a **role-team layer** (N role worker threads with dependencies).

[![CI](https://github.com/SIMON-WORLD/codex-orchestration/actions/workflows/validate.yml/badge.svg)](https://github.com/SIMON-WORLD/codex-orchestration/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 简介

用 Codex 做**多会话 / 多线程协作**：一条会话当**主导者**，把任务拆成多条**独立会话**并行去做，最后统一验收、合并。本仓库把这套用法沉淀成手册、可安装 skill 和自动生成的工具参考。

## 功能

- **管理→工人**：`create_thread` → `send_message_to_thread` → `wait_threads` → `read_thread` → 合并。
- **进阶能力**：`fork` / `handoff` / 归档 / 置顶 / 分享 / 定时自动化（`automation_update`）。
- **角色团队层**：把多条 worker 会话组织成「有依赖的角色团队」（含科研预设）。
- **自动工具参考**：`docs/03-tool-reference.md` 由脚本生成，随 Codex 工具更新。

## 安装

把 `skills/` 下的两个 skill 复制到你的 `.agents/skills/`（或按版本用 `codex skill install` 安装）。装好后 Codex 会自动知道怎么用这些编排工具。

## 快速上手

```bash
# 生成科研角色团队的派发计划
node scripts/scaffold_role_team.mjs --roles templates/role-team/roles.research.json --question "<你的研究问题>"
```

再按 `skills/codex-role-team/SKILL.md` 的流程，让主导会话按阶段 `create_thread` / `wait_threads` / `read_thread` 调度并验收。完整用法见 `docs/`（从 `01` 开始）。

## 目录

| 路径 | 说明 |
|---|---|
| `docs/` | 手册（01 编排模型、02 模式、03 工具参考、…、06 角色团队） |
| `skills/` | 可安装 skill（`codex-orchestration`、`codex-role-team`） |
| `templates/role-team/` | 角色团队模板（schema 指南 + 科研预设） |
| `scripts/` | 工具参考生成、工具捕获、角色团队脚手架 |
| `data/` | 工具快照 + 人工用法说明（脚本输入） |

## 贡献

想改或想找 bug？见 [`CONTRIBUTING.md`](CONTRIBUTING.md)；让另一台机器/VM 按 [`docs/05-testing-guide.md`](docs/05-testing-guide.md) 测试，发现问题走 PR。

## 许可证

[MIT](LICENSE)