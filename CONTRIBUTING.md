# Contributing

感谢贡献。本仓库是「Codex agent 式协作/编排手册 + 可安装 skill」，重点在于**准确**与**可持续维护**。

## 分支与提交

- 分支命名：`fix/<简述>`、`feat/<简述>`、`test/<简述>`、`docs/<简述>`。
- 提交信息：一行简洁中文/英文说明即可，能点出改动目的。
- 提交作者请用 GitHub noreply 邮箱（避免 GH007 隐私拦截）。

## 改动前必读

- 若改的是**工具清单/说明**：先看 `data/codex_app_tools.json` 与 `data/tool_notes.yaml`，**不要手改** `docs/03-tool-reference.md`。
- 改动后**必须**重跑：
  ```bash
  node scripts/emit_tool_inventory.mjs
  ```
  并把生成的 `docs/03-tool-reference.md` 一起提交，否则 CI 会报告“文档过期”。

## 校验清单（提交 PR 前）

- 运行生成脚本无报错、幂等（`git diff` 为空）。
- 工具名/字段与当前真实 Codex 行为一致（见 `docs/05-testing-guide.md` B/D 组）。
- 无任何密钥/令牌/`.codex/` 入库。
- `README.md` 链接有效。

## PR 说明

- 说明改动内容、如何验证、是否影响生成文件。
- 若附带 Issue，请在 PR 里关联。
- CI 会在 push/PR 时校验生成脚本与清单一致性；失败则需修复后重推。
