# 04 · 常见问题与故障排查

## Q1：为什么我的会话只有 3 个 `codex_app` 工具？

某些会话只拿到 3 个基础应用工具（`load_workspace_dependencies`、`navigate_to_codex_page`、`read_thread_terminal`），**没有** `create_thread` / `send_message_to_thread` / `wait_threads` 等线程管理工具。

**原因**：Codex 桌面端会按“远程功能门控”给每条会话写一份“动态工具清单”。如果创建/写入清单那一刻门控未生效，该会话就被**精简**（只剩 3 个），而且之后**不会自动补齐**。

**相关**：

- Codex 官方 issue #33947：`thread_tools` gate 在重新启用后不会恢复已有任务的工具清单。
- #37075：使用自定义（非 OpenAI）provider 时，桌面端会省略 `codex_app` 的 project/thread 工具，只留 3 个。
- #29223 / #30233：又有“新会话没收到线程工具”的类似现象。

**怎么处理**：

1. **新建一条会话**（在功能门控生效时创建）看是否能拿到完整工具。
2. 不同会话工具不一致是已知现象；主导编排通常由**主线**承担（它往往有完整工具），worker 只需完成任务即可。
3. 若账号当前门控确实关闭，可能需要等待官方开启/修复，或换到标准 OpenAI 接入路径。

## Q2：用自定义模型（如 DeepSeek）还能用线程工具吗？

**可以，但不稳定。** `codex_app` 线程工具是**应用侧原生**工具，正常应能在自定义模型下使用。但 #37075 表明自定义 provider 下可能被精简成 3 个。若某条会话被精简，通常通过**新建会话**或由**完整工具的主线**来编排解决。

## Q3：新建任务落在哪个盘/哪个目录？

- **projectless 任务**（`create_thread({ target: { type: "projectless" } })`）默认落在系统“文档”下的 Codex 目录。可在 Codex 设置里改 **Projectless task folder**。
- **project 任务**（`target: { type: "project", projectId }`）会绑定到该项目（git 仓库会以 worktree 形式放进项目里）。

> 注意：如果系统“文档”已重定向到 D，Codex 也会跟着写 D；如果只是把文件复制到 D 而系统“文档”仍指向 C，Codex 仍会写 C。

## Q4：`create_thread` 需要哪些字段？

`create_thread` 要求 `prompt` 和 `target`：

- `target.type` 取 `project` / `projectless` / `chatgptWorkCloud`。
- `project` 需 `projectId`（用 `list_projects` 查）与 `environment.type`。
- `title` 可选。**不要**传 `message`/`content`/`text`/`kind`（会被拒绝）。

## Q5：怎么判断一条会话“拿没拿到”线程工具？

在一个会话里让它“列出当前可用的 `codex_app` 工具”，或直接让它尝试 `create_thread`。能列出/能建即说明工具齐全。

## Q6：这些工具会不会被误用，导致创建一堆会话？

会。建议：

- 用 `create_thread` 前先问清楚“是否真的要开独立任务”。
- 用 `list_threads` / `read_thread` 先确认再派活。
- 收尾用 `set_thread_archived` 归档，避免侧边栏杂乱。
