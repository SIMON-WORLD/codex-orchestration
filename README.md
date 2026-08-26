# codex-orchestration

> 一份**持续更新**的 Codex 使用手册——讲清楚如何用 Codex 做 **agent 式协作**：一条会话当主导者，把任务拆成多条独立会话并行去做，等结果、验收、合并。附带一份**可自动刷新**的 `codex_app` 工具参考。

## 这是什么

- 面向用 Codex 做**多会话 / 多线程协作**的人。
- 核心主线：**`create_thread`（建会话）→ `send_message_to_thread`（派活）→ `wait_threads`（等结果）→ `read_thread`（验收）→ 合并**。
- 覆盖 `fork` / `handoff` / 分享 / 定时自动化（`automation_update`）等进阶能力。
- 工具参考由脚本 `scripts/emit_tool_inventory.mjs` 自动生成，能随新工具出现而更新，避免手册过期。

## 为什么做

用 Codex 时，很多人只会“单线程”提问。这套编排能力其实能显著提效：

- 一条会话当**主导者**，同时派多条**独立会话**干不同任务，最后统一验收合并。
- 长任务可以开成独立会话慢慢跑，随时回来查看，不阻塞手头别的事。
- 需要定时的活交给 `automation_update`，设一次就持续跟进。

本仓库把「怎么正确使用 Codex 做 agent 式协作」沉淀成可共享、可持续维护的手册。

## 快速上手

1. **读文档**：`docs/`（从 `01` 开始）。
2. **装 skill（可选）**：把 `skills/codex-orchestration` 复制到你的 `.agents/skills/`（或按版本用 `codex skill install`）。装好后，Codex 会自动知道怎么用这类编排工具。
3. **看工具参考**：`docs/03-tool-reference.md`。

## 目录

| 路径 | 说明 |
|---|---|
| `docs/01-agents-and-threads.md` | agent 式协作模型 + 线程层级（thread / worktree / subagent / handoff） |
| `docs/02-orchestration-patterns.md` | 编排模式与调用示例 |
| `docs/03-tool-reference.md` | `codex_app` 工具参考（**脚本生成**，勿手改） |
| `docs/04-faq-troubleshooting.md` | 常见问题与故障排查 |
| `docs/05-testing-guide.md` | 面向独立测试 Agent / VM 的系统性测试清单 |
| `skills/codex-orchestration/SKILL.md` | 可安装的 Codex skill |
| `scripts/emit_tool_inventory.mjs` | 生成工具参考表的脚本 |
| `CONTRIBUTING.md` | 贡献与 PR 规范 |
| `data/` | 工具定义快照 + 人工用法说明（脚本输入） |

## 保持工具参考最新

工具随 Codex 版本变化。更新步骤：

1. 在某条 fully-enabled 的 Codex 会话捕获当前 `codex_app` 工具定义，更新 `data/codex_app_tools.json`。
2. 更新 `data/tool_notes.yaml`（人工维护“何时用 / 示例”）。
3. 运行 `node scripts/emit_tool_inventory.mjs` 重新生成 `docs/03-tool-reference.md`。

> 人工说明单独放在 `data/tool_notes.yaml`，因此重新生成时不会覆盖你的注释。CI 会校验生成文件是否过期。

## 协作 / 测试

- 想让**另一台机器 / 虚拟机里的 Codex** 帮你测试找 bug？按 [`docs/05-testing-guide.md`](docs/05-testing-guide.md) 执行，发现问题走 PR（见 [`CONTRIBUTING.md`](CONTRIBUTING.md)）。

## 许可证

[MIT](LICENSE)
