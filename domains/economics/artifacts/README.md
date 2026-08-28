# Economics Artifacts（领域示例 / 契约说明）

v1.3 artifact = 机器可读单源契约：

```
executable code → model_registry / estimates / diagnostics → core/build_replication_stamp.mjs → replication_stamp.json → core/validate_artifacts.mjs → PASS/FAIL
data side → data_manifest / variable_dictionary / sample_flow / descriptive_facts / decision_log
```

- **worker/LLM 不手写 stamp 数字**；stamp 只能由 builder 从 estimates 确定性生成。
- `descriptive_facts.json` 是机器事实来源（如 `panel_attrition_rate`），prose 不得自行"猜"。
- `claim_ledger.json` 仅 schema skeleton（本轮不做 manuscript parser）。
- 这些文件只作为**示例**（`data.example.json` / `empirical.example.json`），具体数值为 fixture/synthetic，不可用于提升 Capability verification_status。

最小可运行契约测试见 `tests/fixtures/artifacts/valid/` 与 `tests/artifacts.spec.mjs`。
