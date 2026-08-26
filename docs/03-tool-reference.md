# codex_app 工具参考

> 本文由 `scripts/emit_tool_inventory.mjs` 自动生成（快照时间 2026-08-26）。工具变化时更新 `data/codex_app_tools.json` 与 `data/tool_notes.yaml` 后重跑脚本，勿手改本文。

## 分类

- **会话/任务编排（主导者派发核心）**（9）：`create_thread`、`send_message_to_thread`、`wait_threads`、`read_thread`、`list_threads`、`list_archived_threads`、`fork_thread`、`handoff_thread`、`get_handoff_status`
- **会话组织与展示**（6）：`set_thread_title`、`set_thread_pinned`、`set_thread_archived`、`navigate_to_codex_page`、`open_in_codex`、`share_thread`
- **定时/自动化/托管**（1）：`automation_update`
- **应用/运行时/杂项**（7）：`load_workspace_dependencies`、`read_thread_terminal`、`list_projects`、`capture_screen_context`、`consume_usage_reset`、`end_realtime_voice_call`、`uninstall_plugin`

## 会话/任务编排（主导者派发核心）

| 工具 | 作用 | 何时用 | 示例 |
|---|---|---|---|
| `create_thread` | 新建一条独立 Codex 会话/任务。 | 需要把一件事开成一条独立会话去干（主导者派发）。 | `create_thread({prompt:'...', target:{type:'projectless'}})` |
| `send_message_to_thread` | 向已有会话发送一条后续消息（派活/补充/纠偏）。 | 给某条会话补派活、补充要求或纠偏。 | `send_message_to_thread({threadId:'...', prompt:'...'})` |
| `wait_threads` | 等待一条或多条会话跑到完成或需关注，返回最新状态。 | 并行派了多条会话后，等它们跑完/拿最新状态。 | `wait_threads({targets:[{threadId:'...'}], timeoutMs:120000})` |
| `read_thread` | 读取某条会话的内容与历史。 | 回头查看/验收某条会话的内容与历史。 | `read_thread({threadId:'...', turnLimit:3})` |
| `list_threads` | 列出最近会话（含置顶）。 | 找回某条会话、看目前有哪些。 | `list_threads({limit:20})` |
| `list_archived_threads` | 列出已归档会话。 | 找回已归档的会话。 | `list_archived_threads({limit:10})` |
| `fork_thread` | 复制出一条新会话（含上下文/git 状态）。 | 基于某条会话再开一个分支，保留上下文/git 状态。 | `fork_thread({threadId:'...', environment:{type:'same-directory'}})` |
| `handoff_thread` | 将会话（含 git 状态）移交到本机/远程 host 或 worktree。 | 把会话（含 git 状态）移交到本机/远程或 worktree 继续。 | `handoff_thread({threadId:'...', destinationHostId:'local'})` |
| `get_handoff_status` | 查询交接进度/结果。 | 交接后确认是否完成。 | `get_handoff_status({operationId:'...', waitMs:30000})` |

## 会话组织与展示

| 工具 | 作用 | 何时用 | 示例 |
|---|---|---|---|
| `set_thread_title` | 重命名会话。 | 让侧边栏更好认。 | `set_thread_title({threadId:'...', title:'新标题'})` |
| `set_thread_pinned` | 置顶/取消置顶会话。 | 固定常用会话。 | `set_thread_pinned({threadId:'...', pinned:true})` |
| `set_thread_archived` | 归档/取消归档会话。 | 收尾后归档。 | `set_thread_archived({threadId:'...', archived:true})` |
| `navigate_to_codex_page` | 把某会话切到主应用前台。 | 让我把某个任务切到前台给你看。 | `navigate_to_codex_page({threadId:'...'})` |
| `open_in_codex` | 在 Codex 面板展示文件/浏览器标签/终端/评审。 | 在面板展示文件/浏览器/终端/评审。 | `open_in_codex({target:{type:'file', path:'...'}})` |
| `share_thread` | 生成该会话的不可变分享链接。 | 把某个任务分享给别人。 | `share_thread({threadId:'...'})` |

## 定时/自动化/托管

| 工具 | 作用 | 何时用 | 示例 |
|---|---|---|---|
| `automation_update` | 创建/更新/查看/删除定时任务、提醒、监控、跟进。 | 需要定时/提醒/监控/反复跟进时。 | `automation_update({mode:'create', name:'...', prompt:'...', rrule:'...'})` |

## 应用/运行时/杂项

| 工具 | 作用 | 何时用 | 示例 |
|---|---|---|---|
| `load_workspace_dependencies` | 定位本机 Node/Python 与常用库路径（表格/PPT/文档）。 | 做表格/PPT/文档时定位本机运行时与库。 | `load_workspace_dependencies()` |
| `read_thread_terminal` | 读取当前会话的终端输出。 | 看当前会话的命令运行输出。 | `read_thread_terminal()` |
| `list_projects` | 列出可用项目（create_thread 指定归属时用）。 | create_thread 指定归属项目时先查项目 id。 | `list_projects()` |
| `capture_screen_context` | 语音对话时读取当前 Codex 页面/侧栏状态。 | 仅语音对话时读取当前页面状态；普通文字会话不要用。 | `capture_screen_context()` |
| `consume_usage_reset` | 兑换一次用量额度重置。 | 仅当用户明确要使用一次额度重置。 | `consume_usage_reset({idempotencyKey:'...'})` |
| `end_realtime_voice_call` | 结束语音对话。 | 用户让我挂断语音对话时。 | `end_realtime_voice_call()` |
| `uninstall_plugin` | 卸载某个已安装的 Codex 插件。 | 用户明确要卸载某个插件。 | `uninstall_plugin({plugin:'example'})` |

