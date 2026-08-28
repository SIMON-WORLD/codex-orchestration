# Economics Research Workflow — Deep Dive into Mature Real Projects

> **范围**：基于 7 个公开、高质量的**真实经济学科研项目 / 复现工作流**，拆解「真实研究项目如何运转」，并与现有 `domains/economics/roles.json` 对照。
> **配套机器可读文件**：本目录下 `workflow-cases.json`（7 条案例，含 `case_id` / `repository` / `directory_structure` / `entry_point` / `data_stages` / … / `adopt` / `not_generalize`）。本文档是对该目录的解读与跨案例综合。
> **定位**：本轮只做研究与设计建议，**不修改** 现有 roles / capabilities / policies / artifacts / benchmarks。

---

## 0. 阅读约定：三类「证据来源」

本研究严格区分三类结论来源。凡下文标注：

- **institutional standard（机构标准）**：某权威机构（AEA Data Editor / SSDE / World Bank DIME / PRISMA）公开发布的规范，可直接引用。
- **real-project observed practice（真实项目观察）**：某个已完成的真实研究项目**实际怎么做**，我们从仓库结构与脚本里读到并归纳。
- **our engineering abstraction（我们的工程抽象）**：为了落到本仓库 schema / resolver / role / policy 上，我们**自行设计**的字段、状态机或角色边界；没有外部来源逐字背书，仅由上述两类实践**派生**。

> 案例引用用 `case_id`（对应 `workflow-cases.json`）。

---

## 1. 深入拆解的真实案例（7 个）

| case_id | 项目 / 机构 | 类型 | 为什么选它 |
|---|---|---|---|
| `case-aea-replication-template` | AEA Data Editor replication template | institutional standard + 复现工作流 | 复现包运行与组装的标准模板，含通用 runner、config.do、AI 复现 skill |
| `case-dime-niger-asp` | World Bank DIME 真实已发表论文复现 | real-project observed practice | 真实多轮次影响评估；master do 编排 + reviewer 开关 + 分包安装 |
| `case-euro-scm` | Adopting the Euro (SCM, EJPE) | real-project observed practice | 真实论文复现；folder-by-function；Master.do 作为「控制面板」+ 稳健性块 |
| `case-learning-poverty` | World Bank EduAnalytics Learning Poverty | real-project observed practice + institutional | 真实世界银行项目；编号任务目录 + master run_all + Git 分支/QA 工作流 |
| `case-ssde-readme` | Social Science Data Editors Template README | institutional standard | 复现包 README 的标准结构（DCAS / 计算需求 / 数据准备与分离说明） |
| `case-ietoolkit` | World Bank DIME ietoolkit（`iefolder`） | institutional standard + 工具 | 用命令自动生成项目目录树 + master do-file，并把 master 保持更新 |
| `case-journal-skills` | Awesome-Journal-Skills（每刊 workflow skills） | real-project observed practice | 把整个稿件生命周期拆成「router + 阶段 skill」；含 one-click `00_master.do` 骨架 |

> 这些案例覆盖了：复现包标准（AEA/SSDE）、真实论文复现（niger-asp / euro-scm）、真实机构项目（LearningPoverty）、项目脚手架工具（ietoolkit）、以及期刊级工作流 skill 库（journal-skills）。

---

## 2. A. 多数成熟项目共同存在的 workflow stages

综合 7 个案例，真实经济学科研项目几乎都包含以下 **10 个阶段**：

| 阶段 | 证据案例 | 说明 |
|---|---|---|
| 0. **项目脚手架 / 环境** | `case-ietoolkit`（iefolder）、`case-aea-replication-template`（config.do / devcontainer）、`case-learning-poverty`（profile + run_all）、`case-journal-skills`（00_master.do 的 root/raw/clean 全局量 + 依赖安装块） | 生成目录树、设置全局路径、声明软件/包依赖、固定 seed/version |
| 1. **问题与设计** | `case-journal-skills`（aejmac-topic-selection、aejmac-identification）、`case-euro-scm`（Master.do 里的 outcome/covariates/donor 控制面板） | 定研究问题、识别策略、关键设定 |
| 2. **文献** | `case-journal-skills`（aejmac-literature-positioning） | 检索、定位贡献、写文献段（在分析仓库中较少见，主要出现在稿件工作流） |
| 3. **数据准备** | `case-euro-scm`（0_Data_Management）、`case-niger-asp`（数据清理/合并）、`case-learning-poverty`（01_data）、`case-dime-standards` | raw → clean → analysis data；变量构造 |
| 4. **描述 / 平衡 / 检验** | `case-niger-asp`（07_balance_and_attrition）、`case-journal-skills`（02_descriptive）、`case-ietoolkit`（iebaltab） | 描述统计、平衡表、attrition、变量字典 |
| 5. **核心估计 / 识别** | `case-euro-scm`（1_SCM）、`case-journal-skills`（03_did/04_iv/05_rdd/06_dml）、`case-niger-asp`（06 regs） | SCM / DID / IV / RDD / DML 等估计 |
| 6. **稳健性 / 变体** | `case-euro-scm`（in-time placebo、leave-one-out、alternative outcome）、`case-journal-skills`（08_robustness）、`case-niger-asp`（MHT/HTE） | 参数化重跑，placebo / leave-one-out / 替代 outcome |
| 7. **表格 / 图生成** | `case-euro-scm`（4_ComparisonTables、5_Graphs）、`case-journal-skills`（09_tables）、`case-niger-asp`（report_tables/graphs/stats） | 由估计输出渲染最终表格与图；按报告类型分目录 |
| 8. **稿件整合** | `case-journal-skills`（aejmac-writing-style、aejmac-submission）、`case-euro-scm`（Text/ 目录）、`case-niger-asp`（注释「复现 Table SI.X / Figure X」） | 明确哪张表/图进入哪一节；写作与投稿 |
| 9. **复现包 + 复现门禁** | `case-aea-replication-template`（REPLICATION.md）、`case-ssde-readme`（DCAS/计算需求）、`case-learning-poverty`（QA 分支） | 组装 README + run_all + 存缴；预发布复现检查 |
| 10. **审查 / 审稿** | `case-journal-skills`（aejmac-referee-strategy、aejmac-rebuttal）、`case-aea-replication-template`（Action Items） | 对抗性审稿、回复信 |

> 结论：**单一入口（master/run_all）+ 编号分阶段脚本 + 按函数分目录 + 输出按报告类型归档** 是 cross-case 最稳定的共同模式。

---

## 3. B. 常见 artifact handoff

跨案例一致的**机器可读产物交接链**：

```
raw data ──(data stage)──▶ analysis dataset (data/clean)
   └─(变量字典/数据说明)──▶ 变量字典 / data dictionary
analysis dataset ──(estimation)──▶ 估计输出（系数/SE/N，e.g., .dta/.rdata/JSON）
   └─(diagnostics)──▶ 平衡表 / attrition / MHT / placebos
估计输出 ──(aggregation)──▶ 汇总对象（doppelganger/聚合表）
   └─(render)──▶ tables / figures（output/tables, output/figures）
tables + figures ──(manuscript)──▶ 稿件（Text/）
稿件 + code + data ──(replication)──▶ 复现包（README + run_all + 存缴）
   └─(reproducibility gate)──▶ 复现检查报告 / REPLICATION.md / 计算需求
```

- **`case-euro-scm`**：`0_Data_Management -> estimate -> 2_Aggregation -> 4_ComparisonTables -> 5_Graphs`，`Output/{Figures,Tables}`，`Text/` 承接收稿。
- **`case-niger-asp`**：`Output/NER/{report_tables, report_graphs, report_stats}`；脚本注释指明每张表/图。
- **`case-learning-poverty`**：`01_data -> 02_simulation -> 03_export_tables -> 05_working_paper`，每任务 `0xx_run.do`。
- **`case-ssde-readme`**：把「数据来源 / 计算需求 / 数据准备与分析步骤」作为 README 法定章节。

> 关键：**「机器事实」是估计输出与数据说明；「表格/图」是它们的渲染视图，不应成为第二套事实来源**——这与我们 P4 的 `model_registry → estimates → replication_stamp` 精神一致。

---

## 4. C. 常见 human decision points

真实项目中**必须由人判断**的点（`case_id` 标注）：

1. **规格设定**：选 outcome / covariates / treatment 日期 / donor pool / 模型形式。`case-euro-scm`（Master.do 控制面板）、`case-journal-skills`（「let the question pick the tool」）。
2. **是否有 master 文件**：存在就用作者自己的入口，不存在才自己建；分开脚手架与作者代码。`case-aea-replication-template`。
3. **受限数据接入**：是否有 confidential / restricted data，如何接入、是否公开代码子集。`case-aea-replication-template`、`case-learning-poverty`。
4. **reviewer vs 全量运行**：是否用 reviewer 开关降采样/降 bootstrap 重复数。`case-niger-asp`（`reviewer`、`hpc_switch` 5 vs 3000）。
5. **稳健性变体**：跑哪些 placebo / leave-one-out / 替代 outcome。`case-euro-scm`、`case-journal-skills`。
6. **样本排除**：如 euro-scm 的 Luxembourg、niger-asp 的 consent/attrition。`case-euro-scm`、`case-niger-asp`。
7. **方法分支**：实证 vs 理论（定量）分支。`case-journal-skills`（aejmac-identification vs aejmac-theory-model）。
8. **权限 / 许可 / 保密**：数据再分发权、license、confidentiality。`case-ssde-readme`。
9. **解释 / ad-hoc 计算**：euro-scm 的 Figure 4 / Table A.4 是「ad-hoc computations」。`case-euro-scm`。
10. **稿件事务**：期刊风格、投稿系统、R&R 回复。`case-journal-skills`。

> 结论：**科学规格（identify/spec/sample）、数据权限、是否跑全量** 是真实项目中无法完全程序化的点；这些恰好对应我们 resolver 的 `needs_decision / decision gate`。

---

## 5. D. 哪些阶段适合独立 Role

依据「是否承担独立责任 + 是否被打断/被授权 + 是否有稳定输入输出」判断，**证据充分可作为 Role**：

| Role | 证据 | 理由 |
|---|---|---|
| `data` | `case-euro-scm`(0_Data_Management)、`case-niger-asp`(data)、`case-learning-poverty`(01_data)、`case-ietoolkit`、`case-ssde-readme`(variable dictionary) | 数据获取/清洗/校验/文档是清晰职责，且常需授权（样本排除、变量构造、attrition）。Niger-asp 与 LearningPoverty 都是独立数据阶段。 |
| `empirical` | `case-euro-scm`(1..2)、`case-journal-skills`(03..08)、`case-niger-asp`(06 regs) | 估计 + 诊断 + 稳健性，典型独立职责。 |
| `replication` / `review` | `case-aea-replication-template`(复现运行)、`case-ssde-readme`(README/DCAS)、`case-learning-poverty`(QA 分支)、`case-journal-skills`(aejmac-replication-package) | **跨案例最强的「复现门禁」阶段**，应作为一级职责（不只是 review 的角色内细节）。 |
| `writing` | `case-journal-skills`(aejmac-writing-style、aejmac-submission)、`case-euro-scm`(Text/) | 稿件整合 + 风格，是独立阶段。 |
| `literature_search/review` | `case-journal-skills`(aejmac-literature-positioning) + PRISMA/OpenAlex/Crossref | 检索/定位/核验是独立阶段（主要出现在稿件工作流，非分析仓库）。 |

> **关键发现**：真实项目把「**复现包/复现门禁**」作为一级职责（AEA Data Editor 预发布检查、SSDE README、LearningPoverty QA 分支）。我们当前把它**折叠进 `review` 角色**相对薄弱，建议在 v1 中将其**提升为独立 Role 或至少独立 Capability + 强 gate**。

---

## 6. E. 哪些只是 Capability，不应做 Role

以下在真实项目中只是**可被参数化/可切换的步骤**，不应做成独立 Role（`case_id` 标注）：

| 议题 | 证据 | 为什么是 Capability 而非 Role |
|---|---|---|
| 具体方法实现（SCM / DID / IV / RDD / DML / panel FE） | `case-euro-scm`(1_SCM)、`case-journal-skills`(03_did/04_iv/05_rdd/06_dml)、`case-niger-asp`(06 regs) | 由 `empirical` role 通过 globals/参数切换；属于方法 Capability。 |
| 稳健性 / placebo / leave-one-out | `case-euro-scm`(robustness blocks)、`case-journal-skills`(08_robustness) | 参数化重跑估计管线，属 Capability。 |
| 表格 / 图渲染 | `case-euro-scm`(4/5/9)、`case-journal-skills`(09_tables)、`case-niger-asp`(report_tables/graphs) | 由估计输出驱动的渲染步骤，属 Capability（`.presentation` / `.render`）。 |
| 包安装 / 环境准备 | `case-niger-asp`(01_PROGRAMS)、`case-journal-skills`(ssc install block)、`case-aea-replication-template`(config.do) | 机械性环境 provisioning，属 Capability / policy。 |
| 项目脚手架 | `case-ietoolkit`(iefolder)、`case-learning-poverty`(profile/run_all) | 可程序化生成目录树 + master，属 Capability（`environment.setup`）。 |
| 摘要/写作风格细节 | `case-journal-skills`(aejmac-writing-style) | 是 writing role 的 Capability/policy，不单独立 role。 |

> 结论：**方法、稳健性、渲染、环境、脚手架** 都是 Capability；**data / empirical / replication(review) / writing** 才是 Role。

---

## 7. F. 当前 `domains/economics/roles.json` 与真实 workflow 的差异

当前 roles：`literature_search, literature_review, data, empirical, visualize, writing, review`。

| 差异点 | 真实表现 | 建议 |
|---|---|---|
| 缺少「复现包/复现门禁」一级职责 | AEA/SSDE/LearningPoverty 都把复现包 + 预发布检查作为明确阶段 | 在 `review` 内提升为独立 Capability + 强 gate，或新增 `replication` role |
| 缺少「项目脚手架/环境」 | iefolder、LearningPoverty profile/run_all、AEA config.do、journal-skills 00_master.do | 作为 `environment` Capability + policy，不单独立 role |
| `visualize` 角色依据偏弱 | 图生成只是 `09_tables.do` 渲染步骤；无权威「图表规范」来源 | 可保留 role 但必须**严格只消费上游 artifacts**（当前已如此），或降级为 `.presentation` Capability |
| `data` / `empirical` 依据充分 | 所有真实项目都有独立数据与估计阶段 | 保持，按 evidence 强化 `data.validation` / 诊断 |
| `review` 范围过宽 | 「对抗性审稿」与「复现检查」应分开 | 复现检查是机器 gate；对抗性审稿是人类判断 |
| `writing` 依据中等 | journal-skills 支持风格/整合；claim-traceability 属工程抽象 | 保持 role，但 style 层与科学层分离 |

---

## 8. G. 当前七阶段 lifecycle 是否需要调整

上一版 source-map 给出的 7 阶段生命周期（问题设计/文献/数据/实证/呈现/写作投稿/审查复现）总体成立，但依据 deep-dive 建议**做两处调整**：

1. **在开头增加「Phase 0 项目脚手架/环境」**（`case-ietoolkit`、`case-learning-poverty`、`case-aea-replication-template`、`case-journal-skills`）。因为真实项目几乎都先有「目录树 + 全局路径 + 依赖 + seed/version 固定」这一层，它是后续可复现性的地基。
2. **把「复现包 + 复现门禁」从「审查与复现」中提升为独立阶段**（`case-ssde-readme`、`case-aea-replication-template`、`case-learning-poverty`）。它不是「审稿人看稿」，而是**发布前必须通过的机器/结构化复现检查**。

调整后的推荐生命周期（9 阶段）：

```
0 setup/脚手架        (globals + folder tree + env + seed/version)        [capability + policy]
1 问题与设计           (question + identification + selected_capabilities) [decision gate]
2 文献                 (search/review/citation verify)                     [role: literature_*]
3 数据                 (acquire/clean/validate/document)                   [role: data]
4 实证                 (estimation + diagnostics)                         [role: empirical]
5 呈现                 (tables/figures render, strict from artifacts)      [capability, weak role]
6 写作与投稿           (manuscript assembly + style)                       [role: writing]
7 复现包 + 复现门禁     (README/DCAS + run_all + deposit + reproducibility check) [role: replication/review]
8 审查 / 审稿          (adversarial reviewer + response)                   [role: review]
```

> 说明：`呈现` 可保留为弱 role 或降级为 capability；`复现门禁` 建议独立，以匹配 AEA/SSDE 真实实践。

---

## 9. H. 推荐的 Economics Research Workflow v1 架构

### 9.1 Role（证据支撑排序）

| Role | 支撑 | 主要职责 |
|---|---|---|
| `data` | strong | 数据获取/清洗/校验/文档；产出 `data_manifest`/`variable_dictionary`/`sample_flow`/`descriptive_facts`/`decision_log` |
| `empirical` | strong | 估计 + 诊断；产出 `model_registry`/`estimates`/`diagnostics`；方法由 selected_capability 决定 |
| `replication`（或 `review` 下的强 Capability） | strong | 复现包组装（README/DCAS）+ run_all 复现 + 预发布复现门禁 |
| `writing` | medium | 稿件整合 + 风格；claim-traceability 属工程抽象 |
| `literature_search` / `literature_review` | medium | 检索/筛选/核验/综述（journal-skills + PRISMA） |
| `review` | medium | 对抗性审稿（人类判断）+ 复现检查（机器 gate 分离） |
| `visualize`（weak，可降级为 Capability） | weak | 图/表渲染，严格消费上游 artifacts |

### 9.2 Capability（证据支撑）

| Capability | 证据 |
|---|---|
| `environment.setup` / `project.scaffold` | `case-ietoolkit`、`case-learning-poverty`、`case-aea-replication-template` |
| `economics.data.validation` | `case-dime-standards`、`case-ssde-readme`、`case-ietoolkit` |
| `economics.regression.panel_fe` / `economics.causal.did/iv/rdd` / `economics.causal.scm` | `case-euro-scm`(SCM)、`case-journal-skills`(did/iv/rdd)、`case-niger-asp`(regs) |
| `economics.stat.multcomp` / `economics.robustness` | `case-niger-asp`(MHT/HTE)、`case-journal-skills`(08_robustness)、`case-euro-scm`(placebo) |
| `economics.presentation.tables_figures` | `case-euro-scm`(4/5)、`case-journal-skills`(09_tables)、`case-niger-asp`(report_*) |
| `economics.replication.provenance` | `case-ssde-readme`(DCAS)、`case-aea-replication-template`(REPLICATION.md) |
| `economics.literature.search` / `.verify` | `case-journal-skills`(literature-positioning)、OpenAlex/Crossref |

### 9.3 关键设计原则

1. **单一入口 master/run_all**，编号分阶段脚本（`case-euro-scm`、`case-journal-skills`、`case-learning-poverty`）。
2. **文件夹按函数分**，输出按报告类型归档（`case-euro-scm` `Text/Data/Code/Output`；`case-niger-asp` `report_tables/graphs/stats`）。
3. **规格集中在「控制面板」**（Master.do globals / study design），科学规格是 human decision / decision gate（`case-euro-scm`、`case-journal-skills`）。
4. **复现包 + 复现门禁是独立强 gate**：README/DCAS、run_all、软件版本+硬件+运行时、seed/缓存/降规模开关（`case-ssde-readme`、`case-aea-replication-template`、`case-learning-poverty`）。
5. **reviewer / 降规模运行模式**用于快速复现检查（`case-niger-asp` `reviewer`/`hpc_switch`、`case-journal-skills` reduced-scale switch）。
6. **replication_stamp 由确定性 builder 生成，不由 LLM 手写**（承接 P4；与 `case-aea-replication-template`「findings 由代码产生」一致）。

---

## 10. 三类来源识别总结

- **institutional standard**：AEA Data & Code Availability Policy（`case-aea-replication-template`、`case-journal-skills`）、SSDE Template README（`case-ssde-readme`）、DIME Research Standards / Data Handbook（`case-ietoolkit`、`case-dime-niger-asp`）。
- **real-project observed practice**：`case-dime-niger-asp`（reviewer toggle、report_* 输出）、`case-euro-scm`（Master.do 控制面板 + 稳健性块 + ad-hoc 计算）、`case-learning-poverty`（编号任务 + QA 分支 + 贡献约定）、`case-journal-skills`（router + 阶段 skill + 00_master.do）。
- **our engineering abstraction**：`risk_level`（low/medium/high）、`verification_status`（reference/experimental/tested/verified）、`dispatch_allowed`、`decision gate`、`approved_overrides`、`capability_scope`/`selected_capabilities`、role 定义本身。这些没有来源逐字背书，是对上述实践的工程化落地。

---

## 11. 结论

- **真实经济学科研项目最稳定的共同模式**：单一入口 master/run_all + 编号分阶段脚本 + 按函数分目录 + 输出按报告类型归档 + 独立复现门禁。
- **当前 roles/lifecycle 需要调整**：① 增加 `setup`（脚手架/环境）阶段；② 把「复现包 + 复现门禁」从 review 中提升为一级职责；③ `visualize` 依据偏弱，建议作为 `.presentation` capability（或严格限制的弱 role）。
- **推荐的 Economics Workflow v1**：`setup → 设计 → 文献 → 数据 → 实证 → 呈现 → 写作投稿 → 复现包/复现门禁 → 审查`；Role = data / empirical / replication(review) / writing / literature_*；Capability = 方法/稳健性/渲染/环境/复现 provenance/文献验证。
- **所有推荐均引用至少一个真实案例**，并区分 institutional standard / real-project observed practice / our engineering abstraction。

> 本文件**不修改**任何现有 roles / capabilities / policies / artifacts / benchmarks；仅作为后续设计的证据基础。
