# Economics Research Workflow — Upstream Source Map

> **范围**：为 `domains/economics` 建立一份**有出处**的 Source Map，作为以后设计 Role / Capability / Policy / Artifact / Benchmark 的依据。
> **定位**：本研究只做来源梳理与证据评估，**不重构**现有 workflow，不改动现有 `roles.json` / capabilities / policies / artifacts / benchmarks。
> **配套机器可读文件**：本目录下的 `source-catalog.json`（19 条来源，含 `source_id` / `url` / `source_type` / `authority` / `maturity` / `phases` / `adopt` / `not_copy` / `supports` / `evidence`）。本文档是对该目录的解释与总结，所有关键设计建议都以 `source_id` 追溯到具体来源。

---

## 0. 阅读约定：区分「来源明确支持」与「我们的工程抽象」

本仓库核心原则是**证据可追溯**。以下两类结论在本映射中严格分开：

- **来源明确支持（source-supported）**：某个来源（DIME / AEA / SSDE / PRISMA / 实证工具官方文档等）明确给出做法、规范或实现，我们可以直接引用或复刻。
- **我们的工程抽象（our engineering abstraction）**：为了把来源规约落到 `codex-orchestration` 的 schema / policy / resolver / artifact 上，我们**自行设计**的字段、状态机或边界。这类设计**没有**权威来源逐字背书，必须标注为工程决定，并说明它从哪个来源的哪条实践**派生**而来。

> 凡下文出现「来源支持」即 source-supported；出现「工程抽象 / 工程决定」即 our engineering abstraction。

---

## 1. 来源总览（19 条）

下表按 `source_type` 分组，便于快速定位。

### 1.1 机构标准 / 可复现性规范（institutional_standard）

| source_id | 名称 | 权威 | 覆盖阶段 |
|---|---|---|---|
| `src-dime-data-handbook` | World Bank DIME Analytics Data Handbook | World Bank DIME Analytics（高） | 数据管理 / 可复现性 / 文档 / 全流程 |
| `src-dime-standards` | World Bank DIME Research Standards（Pillar 3） | World Bank DIME Analytics（高） | 研究伦理 / 透明 / 可复现 / 数据安全 / 数据发布 |
| `src-aea-data-editor` | AEA Data Editor / Data & Code Availability Policy | AEA Data Editor（高） | 复现包 / 投稿 / 审查 / 复现检查 / 存缴 |
| `src-ssde-template-readme` | Social Science Data Editors Template README | SSDE（高） | 数据/代码文档 / 复现包 |
| `src-aea-replication-template` | AEA Data Editor replication-template-development | AEA Data Editor + SSDE（中高） | 复现包脚手架 |
| `src-aea-style` | AEA journals data & code / publication style | AEA（高） | 稿件风格 / 投稿 / 摘要长度 / 排版 |
| `src-prisma` | PRISMA 2020 systematic review statement | PRISMA 2020（高） | 系统综述 / 检索策略 / 筛选 / 报告 |

### 1.2 文献 / 元数据 工具（tool）

| source_id | 名称 | 权威 | 覆盖阶段 |
|---|---|---|---|
| `src-openalex` | OpenAlex scholarly API | OurResearch / OpenAlex（高） | 文献检索 / 引用元数据 / DOI 验证 |
| `src-crossref` | Crossref REST API | Crossref（高） | DOI 解析 / 题录元数据 |

### 1.3 实证方法（method）

| source_id | 名称 | 权威 | 覆盖阶段 |
|---|---|---|---|
| `src-fixest` | fixest (R) | lrberge / CRAN（高） | 面板 FE / 聚类稳健 |
| `src-reghdfe` | reghdfe / ivreghdfe (Stata) | sergiocorreia（高） | 面板 FE / 高维 FE / IV |
| `src-linearmodels` | linearmodels (Python) | bashtage（高） | 面板 FE（PanelOLS）/ IV |
| `src-pyfixest` | PyFixest（fixest 的 Python 移植） | py-econometrics（中高） | 面板 FE |
| `src-statsmodels` | statsmodels (Python) | statsmodels 项目（高） | OLS / 聚类稳健 / 多重检验 |
| `src-did-r` | did (R) — Callaway & Sant'Anna (2021) | bcallaway11（高） | 交叠/交错 DID |
| `src-csdid-stata` | csdid / drdid (Stata) | friosavila（高） | 交错 DID |
| `src-honestdid` | HonestDiD (Rambachan & Roth) | asheshrambachan（高） | DID 敏感性/稳健 |
| `src-rdrobust` | rdrobust / rdpackages | rdpackages（高） | RD 设计 |
| `src-ivreg2` | ivreg2 (Stata, Baum/Schaffer/Stillman) | Boston College（高） | 工具变量 |

> 注：`src-aea-replication-template` 的 `source_type` 在目录中记作 `replication_repo`（它同时是「脚手架」也是「可复现工作流」）；其余来源类型与上表一致。完整字段见 `source-catalog.json`。

---

## 2. 各来源可被采用的做法（要点）

每个来源的完整 `adopt` / `not_copy` / `supports` / `evidence` 在 `source-catalog.json` 逐条给出。本节汇总**最值得采用**的几点，并标注对应 `source_id`。

### 2.1 数据纪律（DIME）
- **单一入口 pipeline**：master / run-all 脚本作为唯一启动点；`data_raw → data_working → data_final → code → output` 分层目录。— `src-dime-data-handbook`
- **数据文档 + 变量字典**：variable dictionary 是机器可读事实来源。— `src-dime-data-handbook`
- **Pillar 3 - Research Reproducibility**：数据/代码可得性 + 主脚本 + 运行日志 + 校验和的可复现检查清单。— `src-dime-standards`
- **`decision_log` 契约**：对「样本排除 / 变量构造 / 单位变更」等决策显式留痕。— `src-dime-data-handbook` + `src-dime-standards`

### 2.2 复现包 / 存缴（AEA / SSDE）
- **Data & Code Availability Policy（DCAP）**：预发布复现检查，replication 到本地/远程 package，openICPSR 存缴。— `src-aea-data-editor`
- **复现包 README 模板**：README schema 描述「程序 → 输出」映射、数据权限、运行说明。— `src-ssde-template-readme`
- **复现脚手架**：AEA 复现模板给出目录约定与检查流程。— `src-aea-replication-template`

### 2.3 实证工具（跨引擎）
- **面板 FE 规范**：unit+time FE + cluster-robust；不同软件对嵌套 FE / small-sample correction 处理不同，需要 canonical inference 定义。— `src-fixest`、`src-reghdfe`、`src-linearmodels`、`src-pyfixest`
- **交错 DID**：Callaway & Sant'Anna 估计 + 动态效应 + 平行趋势诊断。— `src-did-r`
- **DID 稳健性**：HonestDiD 敏感性分析（对 pre-trend / 交错处理的稳健界）。— `src-honestdid`
- **RD 设计**：局部多项式 + 带宽选择 + 稳健 SE。— `src-rdrobust`
- **工具变量**：ivreg2（GMM / 2SLS + 弱工具诊断）。— `src-ivreg2`
- **多重检验**：statsmodels `multipletests`。— `src-statsmodels`

### 2.4 文献严谨性（PRISMA / OpenAlex / Crossref）
- **PRISMA 式检索策略 + 筛选**：可复现的 search strategy、screening flow、eligibility coding。— `src-prisma`
- **引用元数据核验**：DOI / 作者 / 期刊 / 年校验，OpenAlex + Crossref 双源交叉。— `src-openalex`、`src-crossref`

### 2.5 写作 / 风格（AEA style）
- **摘要组织与篇幅**：AER/QJE/JPE 式摘要结构。— `src-aea-style`
- **注意**：期刊格式作为 **late-binding `output_profile`**，不应反向决定科学执行参数。— `src-aea-style`（`not_copy` 部分）

---

## 3. A. Economics Research Workflow 的完整 research lifecycle 应如何划分

综合三大来源（DIME 数据生态、AEA/SSDE 复现生态、实证方法工具生态），建议把全流程划分为 **7 个主阶段**，各自对应明确产出与可追溯性要求：

| 阶段 | 主要活动 | 关键产出 | 权威来源支撑 |
|---|---|---|---|
| ① 问题与设计 | research question → study design → selected_capabilities | `study_design` / `decision_log` | `src-dime-standards`（透明与伦理） |
| ② 文献 | systematic search → dedupe/screen → citation verify → synthesis | `literature_search_log` / `literature_review` | `src-prisma`、`src-openalex`、`src-crossref` |
| ③ 数据 | acquire → clean → validate → construct → document | `data_manifest` / `variable_dictionary` / `sample_flow` / `descriptive_facts` / `decision_log` | `src-dime-data-handbook`、`src-dime-standards` |
| ④ 实证 | estimation + diagnostics（panel FE / DID / IV / RD / multcomp） | `model_registry` / `estimates` / `diagnostics` | `src-fixest`、`src-reghdfe`、`src-did-r`、`src-ivreg2`、`src-rdrobust`、`src-honestdid`、`src-linearmodels`、`src-pyfixest`、`src-statsmodels` |
| ⑤ 呈现 | figures + tables | `figures` / `tables` | （可视化标准来源薄弱，见 §5） |
| ⑥ 写作与投稿 | manuscript assembly → late-binding output_profile | `manuscript` | `src-aea-style`（仅风格层支持） |
| ⑦ 审查与复现 | adversarial review → replicability check → deposit | `review_report` / `replicability_check` / `replication_stamp` | `src-aea-data-editor`、`src-ssde-template-readme`、`src-aea-replication-template` |

> 这条生命周期是**我们面向本仓库的工程划分**，而非某个来源原样给出的「阶段目录」；但**每一阶段的可复现性标准**都能追溯到上述来源。见 `source_map 约定`（§0）：阶段划分 = 工程抽象；阶段内的规则 = 来源支持。

---

## 4. B. 当前 `roles.json` 中哪些角色已有充分来源依据

| 角色 | 来源依据强度 | 说明 |
|---|---|---|
| `data` | **强** | DIME Data Handbook + DIME Standards（Pillar 3）直接支撑：目录分层、变量字典、样本流、决策留痕、校验和。本角色的 `data_manifest` / `variable_dictionary` / `sample_flow` / `descriptive_facts` / `decision_log` 产出与此高度对应。 |
| `empirical` | **强（方法层）** | 面板 FE（fixest / reghdfe / linearmodels / pyfixest）、交错 DID（did / csdid）、IV（ivreg2）、RD（rdrobust）、多重检验（statsmodels）均有成熟权威实现；`model_registry` / `estimates` / `diagnostics` 契约与「程序 → 机器可读结果」一致。 |
| `literature_search` | **中强** | PRISMA 2020（检索策略 / 筛选）+ OpenAlex/Crossref（元数据核验）提供明确依据。 |
| `literature_review` | **中** | PRISMA 支持「合成与编码」；但 `organizing_framework`（辩论 / 缺口组织）与「证据分级」属于本仓库工程抽象。 |
| `review` | **中强（复现侧）** | AEA Data Editor + SSDE Template README 明确支撑 `replicability_check` / `replication_stamp`；但「adversarial reviewer 视角」是本仓库工程抽象，无权威来源。 |
| `writing` | **中（仅风格层）** | AEA style 只支持风格/摘要组织；「claim-traceability / evidence ledger」是本仓库工程抽象。 |
| `visualize` | **弱** | 目录中**没有**经济学出版级图表的权威标准来源；本角色当前无对应 benchmark / policy 强支撑。 |

---

## 5. C. 哪些 Role / Capability / Policy 目前来源依据薄弱

### 5.1 来源依据薄弱的 Role
- **`visualize`**：缺乏权威的「经济学出版级图表规范」来源；`visual_defaults` 授权是工程决定。
- **`literature_review`**：`organizing_framework`（组织框架 / 辩论 / 缺口）与「causal / mechanism 证据分级」没有直接权威来源，属于工程抽象；PRISMA 只覆盖到检索/筛选/报告。
- **`writing`**：稿件组装契约（section_order、claim-traceability）无逐字来源；AEA style 只到「风格」。

### 5.2 来源依据薄弱的 Capability
- **`economics.causal.iv`**：方法来源存在（`src-ivreg2`、`src-pyfixest`），但本 registry 尚无该 capability 的**已基准化 implementation**（无 `tested`/`verified`），`verification_status` 无 benchmark evidence。
- **`economics.causal.did.twfe` / `economics.causal.did.staggered`**：方法来源强（`src-did-r`、`src-csdid-stata`、`src-honestdid`），但 capability 尚未跑真实 / synthetic benchmark，无法升级 `tested`。
- **`economics.stat.testing.multcomp`**：statsmodels 提供 `multipletests`（来源支持），但无 benchmark evidence 支撑 `tested`。
- **`economics.regression.panel_fe`**：来源与已落地 benchmark 最完整（fixest/reghdfe 已 `tested`）；linearmodels 因 covariance definition 差异保持 `experimental`（此为如实记录，不是来源缺陷）。

### 5.3 来源依据薄弱的 Policy / 抽象
- **`verification_status`（reference/experimental/tested/verified）**：这是**本仓库的工程抽象**，不是某个来源的字段。DIME/AEA 只有「是否可复现 / 复现检查通过」的二元或清单式概念；我们没有权威来源背书 4 档状态梯子。→ 需在文档中明确是工程抽象。
- **`risk_level` 分级（low/medium/high）+ HARD STOP**：属工程抽象；来源（DIME Pillar 3、AEA DCAP）支持「必须可复现 / 缺证据即拦截」的**精神**，但不给出 low/medium/high 三档数值。
- **`approved_overrides`（run-level approval）**：工程抽象；AEA/SSDE 无「批准覆盖复现门槛」概念，且本仓库明确规定 HIGH+production 不可绕过 `verified_only`。
- **`output_profile`（late-binding journal）**：工程抽象，但**精神**来自 `src-aea-style`（`not_copy` 段：期刊格式不应反向决定科学执行）。

---

## 6. D. 下一阶段最值得优先建设的 5 个部分

基于「来源强度 × 当前缺口」排序：

1. **数据纪律 + decision_log 契约**（`src-dime-data-handbook` + `src-dime-standards` Pillar 3）
   - 强化 `data` role 与 `economics.data.validation` capability；把 `data_manifest` / `variable_dictionary` / `sample_flow` / `descriptive_facts` / `decision_log` 作为机器事实单源。
   - 已部分开启（P4 已建 `descriptive_facts` 等 contract），本轮可据此把 `data.validation` 的 benchmark 标准（重复/缺失/attrition/merge mismatch/unit error）对 DIME 复现清单锚定。

2. **replicability_check / replication_stamp 契约**（`src-aea-data-editor` + `src-ssde-template-readme` + `src-aea-replication-template`）
   - 强化 `review` role；把 `replication_stamp` 与 `replicability_check` 对照 AEA DCAP 复现检查与 SSDE README 模板做机器校验。P4 已建 builder/validator，本轮可扩充 `replicability_check` 对 AEA/SSDE 清单字段的映射。

3. **文献严谨性**（`src-prisma` + `src-openalex` + `src-crossref`）
   - 完善 `literature_search` / `literature_review` capability：search strategy、screening flow、citation 双源核验（OpenAlex↔Crossref）、标注 hallucinated reference rate。

4. **因果方法工具链基准化**（`src-did-r`、`src-csdid-stata`、`src-honestdid`、`src-rdrobust`、`src-ivreg2`）
   - 为 `causal.did.twfe` / `causal.did.staggered` / `causal.iv` 建立 benchmark 与 `diagnostics` 契约；复用 P7 panel_fe 的 cross-engine + synthetic known-result 范式。

5. **output_profile（late-binding）**（`src-aea-style`）
   - 把 `target_journal` 保留为 run-level `execution_context`，科学执行 journal-neutral；AEA style 只进「写作/呈现」层。

---

## 7. E. 最值得深入拆解的成熟 repo / workflow

1. **`worldbank/dime-standards` + DIME Data Handbook**——可复现性标准最完整，直接对应 `data` 角色与 `decision_log` 契约。
2. **`AEADataEditor/replication-template-development` + `social-science-data-editors/template_README`**——复现包脚手架 / README schema，是 `replication_stamp` / `replicability_check` 的权威参照。
3. **`lrberge/fixest` ↔ `py-econometrics/pyfixest` ↔ `sergiocorreia/reghdfe`**——跨引擎面板 FE 比较，P7 已用它建立 canonical inference；值得继续拆解 covariance / DoF 约定。
4. **`bcallaway11/did` + `friosavila/csdid_drdid` + `asheshrambachan/HonestDiD`**——交错 DID 生态，未来 `causal.did.*` capability 的基准基础。
5. **`rdpackages/rdrobust` + `ivreg2`**——RD / IV 成熟实现，未来 `causal.rd.*` 与 `causal.iv` capability 的基石。

---

## 8. 关键发现与缺口总结

**最重要的发现**
- **复现性标准高度成熟且一致**：DIME（数据侧）与 AEA/SSDE（投稿/复现包侧）对「程序→输出→单源事实→可复现检查」的要求高度一致，是当前 `data` / `review` 角色最强的来源基础。
- **panel FE 已有跨引擎基准**：fixest 与 reghdfe 在 canonical AER/Stata nested-in-cluster convention 下对齐并通过 synthetic + real benchmark（`tested`）；linearmodels 因 DoF 定义差异保持 `experimental`（如实，不强行一致）。这是 P7 的落地成果，可复用到其它因果工具。
- **文献严谨性有权威标准**：PRISMA 2020 + OpenAlex + Crossref 足以支撑 `literature_search` / `literature_review` 的检索与引用核验，但**合成（organizing_framework / 证据分级）**是工程抽象。

**主要缺口**
- `visualize` 缺权威来源；`writing` 的 claim-traceability 属工程抽象。
- `causal.iv`、`causal.did.*`、`stat.testing.multcomp` 虽方法来源强，但**尚无基准化 implementation**（未升级 `tested`）。
- `verification_status`、`risk_level`、`approved_overrides`、`output_profile` 均为**本仓库工程抽象**，无来源逐字背书；需在文档中明确，避免被误读为外部权威标准。

---

## 9. 结论与后续建议

- **本仓库现有 `data` / `empirical` / `review` 角色的核心契约，有强权威来源支撑（DIME + AEA/SSDE + 实证工具）。**
- **`literature_*` 的检索/核验有权威来源（PRISMA + OpenAlex + Crossref），但「组织/分级」是工程抽象。**
- **`visualize`、`writing` 的呈现层契约，以及 `verification_status` / `risk_level` / `approved_overrides` / `output_profile` 这些 schema，属于工程抽象，无逐字来源。**
- 下一阶段最优先建设顺序见 §6：数据纪律 → 复现包契约 → 文献严谨性 → 因果工具基准化 → output_profile 延迟绑定。

> 本映射**不修改**任何现有 Role / Capability / Policy / Artifact / Benchmark；仅建立来源证据与工程边界。所有面向用户的未来设计决策都应标注「来源支持」或「工程抽象」。
