# Economics Research Workflow — Deep Dive into Mature Real Projects

> **范围**：基于公开、高质量的**经济学科研项目 / 复现/工作流**拆解「真实研究项目如何运转」，并与现有 `domains/economics/roles.json` 对照。
> **配套机器可读文件**：本目录 `workflow-cases.json`（7 条案例，每条含 `evidence_class` 区分 `real_project_observed` / `institutional_standard` / `workflow_template` / `tool`）。本文档是对该目录的解释、证据强度评估与跨项目综合。
> **定位**：只做研究与设计建议，**不修改** 现有 roles / capabilities / policies / artifacts / benchmarks。

---

## 0. 阅读约定：三类「证据来源」+ 证据强度

本研究严格区分三类来源，并对每一条「阶段结论」给出**证据强度**：

- **real-project observed practice（真实项目观察）**：某个**真实已发表/正规研究项目仓库**，我们实际读到的结构与脚本。**只有 3 个**：`case-dime-niger-asp`、`case-euro-scm`、`case-learning-poverty`。
- **institutional standard（机构标准）**：AEA Data Editor / SSDE / World Bank DIME / PRISMA 等机构发布的规范。在 source-map 中用 `src-*` 标识，**不冒充 workflow case**。
- **workflow / template precedent（工作流/模板先例）**：可复用的工作流/模板（`case-aea-replication-template`、`case-ssde-readme`、`case-ietoolkit`、`case-journal-skills`）。它们**不是真实论文项目**，不能单独作为「真实项目共同阶段」的证据。

> **重要**：`case-journal-skills` 属于 **workflow/template precedent**（期刊级 skill 库 + `00_master.do` 骨架），**不是**真实论文项目。它只能证明「某一阶段在期刊投稿工作流中是合理拆分」，**不能**证明「文献 / referee / rebuttal 是真实论文项目的共同阶段」。

---

## 1. 案例清单与证据分类

| case_id | 项目 / 来源 | `evidence_class` | 是否真实论文项目 |
|---|---|---|---|
| `case-dime-niger-asp` | World Bank DIME 真实已发表论文复现（Nature 2022） | `real_project_observed` | ✅ 是 |
| `case-euro-scm` | Adopting the Euro (SCM, EJPE) 复现 | `real_project_observed` | ✅ 是 |
| `case-learning-poverty` | World Bank EduAnalytics Learning Poverty | `real_project_observed` | ✅ 是（正规项目仓库） |
| `case-aea-replication-template` | AEA Data Editor replication template | `institutional_standard`, `workflow_template` | ❌ 模板 |
| `case-ssde-readme` | Social Science Data Editors Template README | `institutional_standard`, `workflow_template` | ❌ 模板 |
| `case-ietoolkit` | World Bank DIME ietoolkit（`iefolder`） | `institutional_standard`, `tool` | ❌ 工具 |
| `case-journal-skills` | Awesome-Journal-Skills（每刊 workflow skills） | `workflow_template` | ❌ 模板/工作流库 |

**结论**：能代表「真实论文项目如何运转」的**真实仓库只有 3 个**（niger-asp / euro-scm / learning-poverty）。其余 4 个是机构标准、模板或工作流库，用来支撑「某阶段被推荐/被标准化」，但**不计入**真实项目观察计数。

---

## 2. 各候选 stage 的证据强度评级

> 记 R = 真实项目数量（共 3）。「真实项目」仅指上述 3 个。`institutional` = 机构标准来源（`src-*`）；`workflow` = 模板/工作流先例（`case-*` 中的非真实项目）。

| # | 候选 stage | 真实项目 R | institutional / template | workflow / template | 强度 | observed vs proposed |
|---|---|---|---|---|---|---|
| 0 | 项目脚手架 / 环境 | **3/3** `niger-asp`(01_PROGRAMS+globals+master) `euro-scm`(Paths.do+Master.do) `lp`(profile+run_all) | `src-dime-data-handbook`、`src-dime-standards`、`src-aea-replication-template`(config.do/devcontainer) | `case-ietoolkit`(iefolder)、`case-journal-skills`(00_master.do) | **strong** | **observed common pattern** |
| 1 | 问题与识别设计 | **2/3** `euro-scm`(Master.do 控制面板) `niger-asp`(master 注释规格) `lp`(弱) | — | `case-journal-skills`(topic/identification) | **moderate** | 以「控制面板/globals」形式存在，非独立管线 stage → **half observed / half proposed** |
| 2 | 文献（检索/核验/综述） | **0/3** | `src-prisma`、`src-openalex`、`src-crossref` | `case-journal-skills`(literature-positioning) | 真实项目 **weak**；机构 **strong** | **NOT observed** in analysis repos → **proposed**（机构/工作流） |
| 3 | 数据准备 | **3/3** `niger-asp`(清除/合并) `euro-scm`(0_Data_Management) `lp`(01_data) | `src-dime-data-handbook`、`src-dime-standards` | — | **strong** | **observed common pattern** |
| 4 | 描述 / 平衡 / 校验 | **3/3** `niger-asp`(07_balance_and_attrition) `euro-scm`(3/4) `lp`(描述表) | `src-dime-data-handbook`(variable dict)、`case-ietoolkit`(iebaltab) | — | **strong** | **observed common pattern** |
| 5 | 核心估计 / 识别 | **3/3** `niger-asp`(06 regs) `euro-scm`(1_SCM) `lp`(02_simulation) | `src-fixest`、`src-reghdfe`、`src-did-r`、`src-ivreg2` 等 | `case-journal-skills`(03..06) | **strong** | **observed common pattern** |
| 6 | 稳健性 / 变体 | **2/3** `niger-asp`(MHT/HTE) `euro-scm`(placebo/leave-one-out/alt outcome) `lp`(弱) | — | `case-journal-skills`(08_robustness) | **moderate-strong** | observed but **not universal** |
| 7 | 表格 / 图生成 | **3/3** `niger-asp`(report_tables/graphs) `euro-scm`(4/5→Output) `lp`(03_export_tables) | `src-aea-style`(presentation) | `case-journal-skills`(09_tables) | **strong** | **observed common pattern** |
| 8 | 稿件整合（exhibit→section 映射） | **3/3** `niger-asp`(注释「Table SI.X/Figure X」) `euro-scm`(Text/+注释) `lp`(05_working_paper) | `src-aea-style` | `case-journal-skills`(writing-style/submission) | **strong**（映射）/ **moderate**（实际组装） | observed 为「exhibit→section 映射」；**实际写作**是工作流层 |
| 9 | 复现包 + 复现门禁 | **3/3** 全部即复现包；`niger-asp`(reviewer toggle) `lp`(QA 分支) | `src-aea-data-editor`、`src-ssde-template-readme`、`src-aea-replication-template`、`src-dime-standards`(Pillar3) | `case-journal-skills`(replication-package) | **strong** | observed 为「复现包本身」；**正式预发布复现门禁**是机构要求 |
| 10 | 审查 / referee / rebuttal | **0/3** | `src-aea-data-editor`(report/action items) | `case-journal-skills`(referee-strategy, rebuttal) | 真实项目 **weak**；机构 **strong** | **NOT observed** in analysis repos → **proposed**（机构/工作流） |

> **关键修正**：文献（#2）与 referee（#10）在真实论文分析仓库中**不出现**，只能由机构标准（PRISMA、AEA Data Editor）与工作流/模板先例（journal-skills）支撑。**不得**把它们写成「真实项目共同阶段」。同理，`setup`/`脚手架` 是强 observed（3/3）。

---

## 3. A. 真正跨多个真实项目稳定出现的 workflow backbone

基于**真实项目**（niger-asp / euro-scm / learning-poverty），稳定出现的**observed backbone**：

```
setup/脚手架（master或run_all + globals + 包安装）      R=3 strong
→ 数据准备（raw→clean→analysis data）                  R=3 strong
→ 描述/平衡/校验（描述统计、平衡表、attrition、变量字典） R=3 strong
→ 核心估计/识别（DID/SDM/SCM/DML…）                     R=3 strong
→ 稳健性/变体（placebo、leave-one-out、替代outcome、MHT） R=2 moderate-strong
→ 表格/图生成（输出按报告类型归档）                      R=3 strong
→ 复现包本身（仓库即复现包）+ reviewer/QA 可复现开关       R=3 strong
```

**一个不容忽视的细节**：真实仓库里「exhibit→section 映射」有明确注释（如 niger-asp「复现 Table SI.X」、euro-scm「Figure 1/Table A.2」），但**写作本身**不在分析仓库内；文献与 referee 也基本不出现。因此真实观察得到的 backbone **止于「复现包」**，不包含写作、文献、审稿这些稿件事务。

---

## 4. B. institutional standards 强制/推荐但真实 repo 不一定显式出现

以下阶段在**机构标准**中强制/推荐，但**真实仓库**不一定显式提供（R=0 或很弱）：

| 阶段 | 机构来源 | 为什么真实仓库常缺 |
|---|---|---|
| 文献检索 / 引用核验 / 综述 | `src-prisma`、`src-openalex`、`src-crossref` | 分析仓库只存 code+data，不含检索流程；文献属稿件事务 |
| 正式复现门禁 / DCAS README | `src-aea-data-editor`、`src-ssde-template-readme` | 真实仓库有 README，但常不满足按 DCAS 的完整结构；正式预发布复现检查由 Data Editor 执行 |
| 数据权利 / License / 保密披露 | `src-ssde-template-readme` | 真实仓库偶有 LICENSE、`case-ssde-readme` 的「权限盒」结构化披露少见 |
| 审稿 / referee / rebuttal | `src-aea-data-editor`(report/action items) | 属投稿事务，分析仓库不含 |
| 计算需求（软件/包版本+硬件+wall-clock） | `src-ssde-template-readme`、`case-aea-replication-template` | 真实仓库常见「路径需改」说明，但「硬件+运行时」完整声明较少 |

> 说明：这些是**机构标准要求存在**，但**不构成**「真实项目共同出现的 observed stage」。它们应归为「institutional + engineering」支撑，而非 observed practice。

---

## 5. C. 为完整 Economics Research Workflow 我们主动补上的工程阶段

这些是**我们为了把机构标准/内部纪律落到本仓库而主动补齐**的工程抽象（非观察所得，也非某来源逐字背书）：

| 工程阶段 / 机制 | 来源派生 | 说明 |
|---|---|---|
| `setup` 脚手架显式化 | `src-ietoolkit`(iefolder)、`case-learning-poverty`(profile/run_all)、`case-aea-replication-template`(config.do) | 把真实仓库隐式的「目录树+globals+master」变成我们 scaffold 生成的显式契约 |
| `decision gate`（识别/规格/样本） | `case-euro-scm`(Master.do 控制面板)、`case-journal-skills`(question picks tool) | 机器可读的 needs_decision/blocked 门禁 |
| `risk_level` / `verification_status` / `dispatch_allowed` / `approved_overrides` | 工程抽象 | 我们的 resolver/policy 字段，无来源逐字背书 |
| `replicability_check` / `replication_stamp` 机器验证 | `case-aea-replication-template`(findings 由代码产生)、`case-ssde-readme`(DCAS) | 我们 P4 的 builder/validator 工程 |
| `literature_search` / `literature_review` 独立 role | `src-prisma`、`case-journal-skills` | 把稿件事务的文献阶段拆成 role（机构/工作流派生，非真实仓储出现） |

---

## 6. D. 当前 roles.json 哪些确实需要调整，哪些暂时不应动

### 6.1 需要调整（有依据）

| Role / 现状 | 依据 | 建议 |
|---|---|---|
| `data` | 强 observed（3/3）+ 机构 | **保留**；可强化 `data.validation` 契约（变量字典/sample_flow/decision_log） |
| `empirical` | 强 observed（3/3）+ 工具来源 | **保留**；方法由 selected_capability 决定 |
| `review` | 机构强（AEA/SSDE）+ observed 复现包 | **拆开**：「复现门禁」（机器 gate）与「对抗性审稿」（人类判断）。但二者是否各自独立 Role 是工程选择（见 §7） |
| `visualize` | 弱（图生成本质是渲染 step，无权威「图表规范」来源） | **暂不动**（研究期）；但标示它作为独立 role 依据偏弱，未来可降为 `.presentation` capability |

### 6.2 暂时不应动（研究期 / 弱依据）

- **不要**新增独立 `replication` Role（仅工程候选，见 §7）。
- **不要**新增独立 `setup` Role（脚手架是 capability+policy，非 role）。
- **不要**新增 `literature` 相关独立 Role 之外的结构——`literature_search`/`literature_review` 保留（机构/工作流支撑），但理解它们是**engineering-level**，**非真实仓库观察所得**。
- **不要**删除 `writing` / `review` / `visualize`——本轮不实现，只做依据标注。

---

## 7. E. 推荐的 Economics Workflow v1 候选结构

### 7.1 结构（候选，engineering 设计）

以 **observed backbone 为骨架**，叠加**机构标准阶段**与**工程机制**：

```
[observed backbone]  setup → data → 描述/平衡/校验 → 估计/识别 → 表格/图 → 复现包
[institutional added]        文献检索/核验 ──(稿件事务)── 写作 ── 复现门禁 ── 审查/referee
[engineering mechanism]      decision gate / risk_status / dispatch_allowed / approved_overrides
```

### 7.2 Role / Capability / gate 三选一（复现门禁为例）

**关键**：证据强力支持「**replication 是独立责任，应有独立 gate / artifact / validation**」，但「**是否独立 Agent Role**」是**我们的工程抽象**，两种设计都成立：

| 方案 | 说明 | 改动幅度 |
|---|---|---|
| **A. 独立 `replication` Role** | 承担 README/DCAS + run_all 复现 + 复现门禁，独立派发 | 较大 |
| **B. `review` 下的强 Capability + gate** | `review` 内新增 `replication.provenance` / `replicability_check` 强 gate，复用 review 的派发 | 最小（推荐） |

> 推荐 **B（最小改动）**：复现责任在 `review` 角色内，由独立的 capability + 强 gate 承担；不对现有 `roles.json` 增加新角色。等 Phase 后有足够 evidence 再评估是否升级为独立 Role。

### 7.3 推荐 Role / Capability（候选）

- **Role（强 observed/institutional）**：`data`、`empirical`；以及 `writing`、`review`（机构/工作流）。
- **Role（机构/工作流，非真实仓储观察）**：`literature_search`、`literature_review`。
- **Capability（而非 Role）**：`environment.setup`/`project.scaffold`、`economics.data.validation`、`economics.regression.*`、`economics.causal.*`、`economics.robustness`、`economics.presentation.tables` / `economics.presentation.tables.estimates` / `economics.presentation.figures`、`economics.replication.provenance`、`economics.literature.search/.verify`。
- **gate（而非 Role）**：复现门禁（`replicability_check`）、decision gate。

> 注：`data` / `empirical` 的 role 证据最强；`setup`/`visualize`/`replication` 更多是 capability/gate 而非 role。

---

## 8. 三类来源识别总结（修正版）

- **real-project observed practice**：`case-dime-niger-asp`、`case-euro-scm`、`case-learning-poverty`（真实仓库，支撑 observed backbone：setup/data/balance/estimation/tables/复现包）。
- **institutional standard**：`src-dime-data-handbook`、`src-dime-standards`、`src-aea-data-editor`、`src-ssde-template-readme`、`src-aea-replication-template`、`src-prisma`、`src-aea-style`、以及实证工具 `src-fixest` / `src-reghdfe` / `src-did-r` 等（支撑机构标准阶段：复现门禁、DCAS、文献标准、审稿）。
- **workflow / template precedent**：`case-aea-replication-template`、`case-ssde-readme`、`case-ietoolkit`、`case-journal-skills`（支撑「某阶段可拆分/可模板化」，**不**代表真实项目出现）。
- **our engineering abstraction**：`risk_level`、`verification_status`、`dispatch_allowed`、`decision gate`、`approved_overrides`、`capability_scope`/`selected_capabilities`、role 定义本身、以及「replication 是否独立 Role」的取舍。

---

## 9. 结论

- **真正跨多个真实项目稳定出现的 observed backbone**：`setup → 数据准备 → 描述/平衡/校验 → 估计/识别 → 表格/图生成 → 复现包`（+ reviewer/QA 复现开关）。文献、referee、正式复现门禁**不属于**真实仓库观察，而是机构/工作流支撑。
- **当前 roles/lifecycle 需调整**：① `visualize` 依据偏弱（可降为 presentation capability）；② `review` 中区分「复现门禁」与「对抗性审稿」；③ 是否新增独立 `replication` Role 是**工程候选**，推荐先 `review` 内强 gate（方案 B）。
- **推荐的 Economics Workflow v1 候选结构**：observed backbone + institutional-added（文献/写作/审稿）+ engineering mechanism；Role = data / empirical / writing / review (+ literature_*)；replication/setup/visualize 以 capability+gate 承接。
- **所有「observed」结论仅引用 3 个真实仓库；机构/工作流结论用 `src-*` / `case-*`(template) 区分标注。**

> 本文件**不修改**任何现有 roles / capabilities / policies / artifacts / benchmarks；仅作为后续设计的证据基础。


