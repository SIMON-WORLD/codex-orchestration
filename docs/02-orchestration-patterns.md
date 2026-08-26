# 02 · 编排模式与调用示例

本页是“怎么做”的核心。所有示例都基于真实的 `codex_app` 工具，一行即可看懂。

## 模式 1：主导者派发多条独立会话（manager–worker）

这是最常用、也最能体现价值的一种。

```text
主导者
 ├─ create_thread(任务A)  →  worker A
 ├─ create_thread(任务B)  →  worker B
 └─ wait_threads([A, B])  →  等两者完成
       └─ read_thread(A) / read_thread(B)  →  验收
             └─ 合并结果，交给用户
```

示例调用（示意）：

```ts
// 建 worker
create_thread({ prompt: "任务A内容", target: { type: "projectless" } });
create_thread({ prompt: "任务B内容", target: { type: "projectless" } });

// 等结果
wait_threads({ targets: [{ threadId: "A" }, { threadId: "B" }], timeoutMs: 120000 });

// 验收
read_thread({ threadId: "A", turnLimit: 3 });
read_thread({ threadId: "B", turnLimit: 3 });
```

**要点**：任务之间要**互相独立**，否则不能并行（共享状态需要单独设计）。主导者负责验收与合并，不让 worker 互相干扰。

## 模式 2：长任务后台化

把耗时任务开成独立会话，让它慢慢跑，你随时回来查。

```ts
const t = create_thread({ prompt: "慢慢做的长任务", target: { type: "projectless" } });
// 之后任意时间：
read_thread({ threadId: t.threadId, includeOutputs: true });
```

好处：不阻塞你当前会话；可多次回来查看进度。

## 模式 3：基于上下文分叉（fork）

想“在当前这条会话的基础上，再开一条继续做别的方向”，用 `fork_thread`。它保留上下文与 git 状态。

```ts
fork_thread({ threadId: "当前会话" });
```

## 模式 4：交接（handoff）

把一条会话整体移交到另一处继续（本机 ↔ 远程 host ↔ worktree）。

```ts
handoff_thread({ threadId: "会话", destinationHostId: "local" });
get_handoff_status({ operationId: "opId", waitMs: 30000 });
```

## 模式 5：定时自动化（automation）

需要“每…做… / 提醒 / 持续监测”，用 `automation_update`。

```ts
automation_update({ mode: "create", name: "每日监测", prompt: "每天……", rrule: "FREQ=DAILY" });
```

## 会话组织小技巧

- 命名（`set_thread_title`）、置顶（`set_thread_pinned`）、归档（`set_thread_archived`）让侧边栏可控。
- 分享（`share_thread`）把结果给别人。
- 把某个任务切到前台（`navigate_to_codex_page`）或展示文件（`open_in_codex`）。
