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
| `scripts/capture_codex_tools.mjs` | 从本机会话自动捕获工具清单的脚本 |
| `CONTRIBUTING.md` | 贡献与 PR 规范 |
| `data/` | 工具定义快照 + 人工用法说明（脚本输入） |
| `data/` | 工具快照（capture 生成）+ 人工说明 / 中文角色 / override |

## 保持工具参考最新

工具随 Codex 版本变化。**自动刷新**：

1. 运行 `node scripts/capture_codex_tools.mjs` —— 从本机 Codex 会话的 `dynamic_tools` 自动捕获真实 `codex_app` 工具清单，写入 `data/codex_app_tools.json`（跨会话取并集，再合并一个很小的 `data/codex_app_tools.override.json`）。
2. 运行 `node scripts/emit_tool_inventory.mjs` —— 重新生成 `docs/03-tool-reference.md`（“作用”列优先用 `data/tool_roles_zh.json` 的中文角色，无则回退英文描述）。
3. 人工维护 `data/tool_notes.yaml`（“何时用 / 示例”）与 `data/tool_roles_zh.json`（中文角色标签）——这两层稳定、可选。

> 单条会话的 `dynamic_tools` 可能不全，所以 capture 会跨多个会话取并集。CI 会校验“数据 → 文档”一致性。
## 协作 / 测试

- 想让**另一台机器 / 虚拟机里的 Codex** 帮你测试找 bug？按 [`docs/05-testing-guide.md`](docs/05-testing-guide.md) 执行，发现问题走 PR（见 [`CONTRIBUTING.md`](CONTRIBUTING.md)）。

## 许可证

[MIT](LICENSE)


