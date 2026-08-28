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


## Presentation provenance（派生视图绑定）

`presentation_manifest.json` 是**可选的**「派生视图」provenance 绑定，把渲染出的表格/图绑回其科学起源。它不是科学数值的来源：

```
model_registry / estimates / diagnostics / descriptive_facts
   ↓ source_refs（含 source_hash + canonical_json_sha256_v1）
presentation_manifest.json
   ↓ view.output_ref
rendered tables / figures
```

- **只存 provenance/binding 元数据**：view_id / view_type(table|figure) / output_ref / source_refs。
- 每个 `source_ref` 用 `artifact_id`（+ 可选 `item_ids`，如 `model_id`/`estimate_id`/`diagnostic_id`/`fact_id`）加上**源 artifact 的 canonical hash** 绑定到确切上游版本。
- `presentation_manifest` **不得内嵌**估计值、标准误、p 值、系数等科学数值；那些数值仍来自被引用的上游 artifact（`model_registry`/`estimates`/`diagnostics`/`descriptive_facts`），它们才是单一事实来源。
- `core/validate_artifacts.mjs` 会：校验 presentation 结构、`source_refs` 非空、源 artifact 必须存在于 bundle、不可用另一 presentation view 作为科学来源、`item_ids` 必须存在于源 artifact、并重算源 artifact 的 canonical hash 以验证版本未漂移。
- `presentation_manifest` 不存在时，现有 bundle 仍有效（该 artifact 可选）。

