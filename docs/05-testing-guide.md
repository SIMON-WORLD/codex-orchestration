# 05 · 测试指引（面向独立的测试 Agent / VM）

本页是一份**可执行、可复现**的测试清单，供另一台机器（如虚拟机里的 Codex 实例）系统地测这个仓库、找出 bug，并**通过 PR 反馈**。测试环境的 Codex 可以随便折腾、破坏性测试；主机尽量少动。

## 准备工作

1. 克隆仓库：
   ```bash
   git clone https://github.com/SIMON-WORLD/codex-orchestration.git
   cd codex-orchestration
   ```
2. 安装 skill（可选，测试 B 组会用到）：
   - 复制 `skills/codex-orchestration` 到本机 `.agents/skills/`（或按版本用 `codex skill install`）。

## A 组 · skill 有效性与可加载性

- [ ] `SKILL.md` 第一篇 frontmatter 是否合法（`---` 开头、含 `name:` 与 `description:`）。
- [ ] 在 Codex 里，当任务匹配 `description` 时，会话能否自动加载该 skill。
- [ ] skill 内引用的工具名（`create_thread` 等）是否与当前 Codex 实际工具一致（用「列出 codex_app 工具」验证）。

## B 组 · 工具参考（docs/03）与实际是否一致

- [ ] 逐条核对 `docs/03-tool-reference.md` 的 23 个工具名，与当前会话实际暴露的 `codex_app` 工具是否**完全一致**（有没有多/少/改名）。
- [ ] `create_thread` 的字段约束是否正确：`prompt` + `target`，且 `target.type` 只能 `project`/`projectless`/`chatgptWorkCloud`；`project` 需 `projectId`；`title` 可选；**不能**传 `message`/`content`/`text`/`kind`。
- [ ] `wait_threads`：`targets` 数组，最多 8 个，成员含 `threadId`（可带 `hostId`、`afterCursor`）；`timeoutMs` 语义是否符合。
- [ ] `read_thread`：`threadId` 必填，`hostId`/`cursor`/`turnLimit`/`includeOutputs`/`maxOutputCharsPerItem` 是否属实。
- [ ] 分组是否合理、有无遗漏工具。

## C 组 · 生成脚本正确性与健壮性

- [ ] `node scripts/emit_tool_inventory.mjs` 能否无报错运行。
- [ ] **幂等性**：连续跑两次，`docs/03-tool-reference.md` 是否一致（`git diff` 应为空）。
- [ ] 故意给 `data/codex_app_tools.json` 塞坏数据（缺字段、空数组、非法 JSON）脚本是否**报错而不是静默产出错表**。
- [ ] `tool_notes.yaml` 里出现「json 里没有的工具」或「某工具没有 notes」，脚本是否优雅处理。
- [ ] 输出 Markdown 表格对 `|`、反引号等特殊字符的转义是否安全。

## D 组 · 编排模式与真实行为

- [ ] 在真实 Codex 会话里，按 `docs/02` 的步骤走一遍：
   1. `create_thread` 建 2 条 worker（`projectless` 与 `project` 两种 target 各测一次）。
   2. `send_message_to_thread` 补派活。
   3. `wait_threads` 等结果。
   4. `read_thread` 验收。
   5. 合并结果。
- [ ] 测 `fork_thread`、`handoff_thread`、`get_handoff_status` 是否与文档描述一致。
- [ ] 测 `automation_update` 创建/更新/删除是否可用。
- [ ] 测**边界/破坏性输入**：`create_thread` 传错字段（如 `message`）、缺 `prompt`、`target.type` 非法 → 观察报错是否符合文档预期。

## E 组 · 文档一致性与准确性

- [ ] `README.md` 与各 `docs/*` 的链接是否都能解析。
- [ ] 文档里的「23 个」「#33947/#37075」「projectless 默认落盘位置」等表述是否都真实。
- [ ] 中文表述是否清晰、无歧义、无错别字。

## F 组 · 安全与仓库卫生

- [ ] `git ls-files` 里**没有**任何令牌/密钥/`.codex/`。
- [ ] `.gitignore` 覆盖了本地缓存、令牌、node_modules。
- [ ] `LICENSE`（MIT）存在。

## 如何反馈（走 PR / Issue）

- **发现问题但先不改** → 开一个 **Issue**，写清：复现步骤、预期、实际、相关文件行号。
- **能修复** → 建分支（建议 `fix/<简述>` 或 `test/<简述>`），做**最小**改动，**先跑 C 组（生成脚本）+ B 组（一致性）**，提交后开 **PR** 到 `SIMON-WORLD/codex-orchestration`。PR 里写：改了什么、如何验证、是否影响生成文件。若修改了 `data/` 或工具清单，**必须重跑 `node scripts/emit_tool_inventory.mjs` 并提交生成的 `docs/03-tool-reference.md`**，否则 CI 会拒绝。
- 遵循 `CONTRIBUTING.md` 的规范。
