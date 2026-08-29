# RFC-WORKFLOW-V1 — Economics Research Workflow (Domain Pack v1)

> **Status**: Draft for review. **Scope**: Define the target architecture for the `domains/economics` Domain Pack, built on the completed upstream source map (`references/source-map.md`) and workflow deep-dive (`references/workflow-deep-dive.md`).
> **Grounding**: Every architectural recommendation is tagged with one of four provenance classes:
> - **E1 = institutional standard** (authoritative institution; `src-*`)
> - **E2 = real-project observed practice** (actual real repositories; `case-*` with `evidence_class=real_project_observed`)
> - **E3 = workflow/template precedent** (reusable workflow/template; `case-*` with `evidence_class=workflow_template` / `institutional_standard`)
> - **E4 = our engineering abstraction** (design decision derived from the above, not verbatim from a source)
>
> Real-project observed evidence is limited to **3** repos: `case-dime-niger-asp`, `case-euro-scm`, `case-learning-poverty`.

> **RFC path**: `domains/economics/RFC-WORKFLOW-V1.md` (this file). Canonical Director identifier: `economics_director`.

---

## 0. Abstract

This RFC fixes the v1 target architecture for the economics domain pack. It makes explicit design decisions for the **research lifecycle**, **Role set**, **Capability model**, an **Economics Research Director**, the **artifact DAG**, **decision gates**, the **workflow execution model**, the **migration delta** vs the current repository, and a **build order**. It does **not** implement any of it.

Two structural decisions are made up-front because they shape everything else:

- **`visualize` becomes a Capability, not a Role** (a presentation capability), because real projects render tables/figures as a numbered step in the analysis pipeline, not as an independent agent with its own authority (see §2.3, §3).
- **Replication stays a Capability + strong gate under `review`**, **not** a new Role (evidence-based; see §2.4, §6). This is an **E4** engineering choice but rests on strong **E1** institutional support and **E2** observed practice that replication is a responsibility with its own artifact/validation.
- **`economics_director` is a domain-level scientific controller, NOT a worker Role.** It is not added to `roles.json`. See §4.

---

## 1. Research Lifecycle

The full Economics Research Workflow is an **11-stage lifecycle** (stages 0–10). Each stage is labelled **observed practice (E2)**, **institutional requirement (E1)**, or **engineering abstraction (E4)**. "Observed" only means it appears in the 3 real repositories.

| # | Stage | Label(s) | Evidence (case-* / src-*) |
|---|---|---|---|
| 0 | **Project Setup / Scaffold** | E2 (observed) + E1 + E4 | **E2**: all 3 repos — `case-dime-niger-asp`(`01_PROGRAMS`+globals+`00_master_ner.do`), `case-euro-scm`(`Paths.do`+`Master.do`), `case-learning-poverty`(`profile`+`run_all`). **E1**: `src-dime-data-handbook`, `src-dime-standards`. **E3**: `case-ietoolkit`(`iefolder`), `case-journal-skills`(`00_master.do`). **E4**: our `core/scaffold_role_team.mjs`. |
| 1 | **Study Design / Research Question** | E4 + E2 | **E2**: `case-euro-scm`(`Master.do` control panel), `case-dime-niger-asp`(spec in master comments). **E3**: `case-journal-skills`(`aejmac-topic-selection`, `aejmac-identification`). **E4**: `study_design` + decision gate (the Director's contract). |
| 2 | **Literature** (search / verify / review) | E1 + E4 | **E1**: `src-prisma`, `src-openalex`, `src-crossref`. **E3**: `case-journal-skills`(`aejmac-literature-positioning`). **E4**: our search/review roles. **Not observed**: 0/3 real repos. |
| 3 | **Data Preparation** | E2 + E1 | **E2**: `case-euro-scm`(`0_Data_Management_Annual`), `case-dime-niger-asp`(cleaning/merge), `case-learning-poverty`(`01_data`). **E1**: `src-dime-data-handbook`, `src-dime-standards`. |
| 4 | **Description / Balance / Validation** | E2 + E1 | **E2**: `case-dime-niger-asp`(`07_balance_and_attrition`), `case-euro-scm`(`3/4_*`), `case-learning-poverty`(descriptive tables). **E1**: `src-dime-data-handbook`(variable dictionary). **E3**: `case-ietoolkit`(`iebaltab`). |
| 5 | **Core Estimation / Identification** | E2 + E1 | **E2**: `case-dime-niger-asp`(`06 regs`), `case-euro-scm`(`1_SCM`), `case-learning-poverty`(`02_simulation`). **E1 (tools)**: `src-fixest`, `src-reghdfe`, `src-did-r`, `src-csdid-stata`, `src-ivreg2`, `src-rdrobust`, `src-linearmodels`, `src-pyfixest`, `src-statsmodels`. |
| 6 | **Robustness / Diagnostics** | E2 (2/3) + E1 | **E2**: `case-dime-niger-asp`(MHT/HTE), `case-euro-scm`(in-time placebo/leave-one-out/alt outcome). **E3**: `case-journal-skills`(`08_robustness`). **E1**: `src-honestdid`(sensitivity). |
| 7 | **Presentation** (tables / figures) | E2 + E1 | **E2**: `case-dime-niger-asp`(`report_tables/graphs`), `case-euro-scm`(`4/5_*`→`Output`), `case-learning-poverty`(`03_export_tables`). **E1**: `src-aea-style`(presentation). **E3**: `case-journal-skills`(`09_tables`). |
| 8 | **Manuscript / Writing** | E4 + E1 + E3 | **E2**: `case-euro-scm`(`Text/` + comments naming figures), `case-dime-niger-asp`(comments "Table SI.X/Figure X"). **E1**: `src-aea-style`. **E3**: `case-journal-skills`(`aejmac-writing-style`, `aejmac-submission`). **E4**: claim-traceability / evidence ledger. |
| 9 | **Replication Package + Gate** | E1 + E2 | **E1**: `src-aea-data-editor`(DCAP/pre-publication check), `src-ssde-template-readme`, `case-aea-replication-template`. **E2**: all 3 repos are themselves replication packages; `case-dime-niger-asp`(reviewer toggle/`hpc_switch`), `case-learning-poverty`(QA branch). |
| 10 | **Review / Revision** | E1 + E3 | **E1**: `src-aea-data-editor`(report/action items). **E3**: `case-journal-skills`(`aejmac-referee-strategy`, `aejmac-rebuttal`). **Not observed**: 0/3 real repos. |

**Lifecycle decision**: The **observed** backbone (stages 0,3,4,5,7,9) is what real projects demonstrably do. Stages 1,2,8,10 are pushed by **institutional** standards and **engineering** needs (design, literature, writing, review). The lifecycle is therefore a **superset**: observed backbone + institutional-added + engineering-added. This matches `references/workflow-deep-dive.md` §9.

---

## 2. Role Model

### 2.1 v1 worker Role set (decision)

The **worker Role set = 6 roles**: `literature_search`, `literature_review`, `data`, `empirical`, `writing`, `review`.

- **Kept** (strong E2/E1): `data`, `empirical`.
- **Kept** (E1/E3, engineering-level, **not** observed in real repos): `literature_search`, `literature_review`, `writing`, `review`.
- **Demoted**: `visualize` → **presentation capability** (no longer a Role).

> **`economics_director` is NOT a worker Role.** It is a separate **domain-level scientific controller** whose contract is `study_design`. It is **not** in `roles.json` and is **not** dispatched as a worker. See §4.

### 2.2 Per-Role specification (worker roles only)

| Role | Responsibility | Authority / human decisions | Inputs | Outputs | Capability scope | Dispatch boundary |
|---|---|---|---|---|---|---|
| **literature_search** | Multi-source retrieval, dedupe, screening, citation-metadata verification. | `keyword_strings`; never fabricate citations. | research_question (or Director `search_scope`). | `literature_search_log`. | `economics.literature.*`. | Dispatch after design; no downstream dependency. |
| **literature_review** | Synthesize a structured, cited review; tag evidence grading. | `organizing_framework`; no invented claims. | research_question, `literature_search_log`. | `literature_review`. | `economics.literature.*` (review/verify). | Depends on `literature_search`. |
| **data** | Build/clean/validate/document the analysis dataset. | `validation_rules`; **escalate** unit_of_analysis, treatment_definition, sample_exclusion, material_variable_definition_changes. | research_question, `study_design`. | `data_manifest`, `variable_dictionary`, `sample_flow`, `descriptive_facts`, `decision_log`, `data_summary` (presentation layer). | `economics.data.*`. | Depends on `study_design`; feeds `empirical`. |
| **empirical** | Execute the approved design; run diagnostics; produce structured outputs; render tables/figures via the presentation capability. | **escalate** identification_strategy, treatment_definition, clustering_level, sample_exclusion, material_specification_changes. | research_question, `study_design`, `data_summary`, `decision_log`, `data_manifest`. | `model_registry`, `estimates`, `diagnostics`, `empirical_results`, `tables/figures` (via `economics.presentation.*`). | `economics.regression.*`, `economics.causal.*`, `economics.stat.*`, `economics.presentation.*`. | Depends on `data`; feeds `writing`. |
| **writing** | Assemble manuscript per output profile; keep every claim traceable (evidence ledger). | `section_order`; no invented results/citations. | research_question, `literature_review`, `data_summary`, `empirical_results`, `tables/figures`. | `manuscript` (+ claim ledger). | `economics.writing.*` (style/presentation). | Depends on `literature_*`, `data`, `empirical`. |
| **review** | (a) adversarial review (human judgment); (b) **replication gate** (machine robustness). | `review_priority`; no rubber-stamping. | `manuscript`, upstream artifacts. | `review_report`, `replicability_check`, `replication_stamp` (deterministic). | `economics.stat.*`, `economics.replication.*`. | Depends on `writing`; emits gate results. |

**Upstream/downstream (worker chain)**: `literature_*` ∥ `data` → `empirical` → `writing` → `review`. The **Economics Research Director** sits **above** this worker chain (§4); it is a domain-level scientific controller, not a worker role, and is not part of the dispatch chain.

### 2.3 Decision: `visualize` → presentation Capability

**Decision**: `visualize` is **removed** as a Role and becomes an `economics.presentation.tables` and `economics.presentation.figures` **Capabilities**.

Rationale:
- **E2**: real projects do not run a separate "visualize agent". `case-euro-scm` renders figures in `5_Graphs_Annual`; `case-journal-skills` `00_master.do` ends with `09_tables.do`; `case-dime-niger-asp` writes `report_tables/graphs`. Figure/tables are a **deterministic render step** driven by the analysis artifacts.
- **E4**: rendering is mechanical; it should be strictly artifact-consuming and carry a strong rule (no causal inference from a figure). That rule is more naturally a **capability policy** than an agent's discretionary authority.

`economics.presentation.tables` / `economics.presentation.figures` are invoked inside the `empirical`→`writing` handoff (in the analysis pipeline), and `writing` consumes the rendered tables/figures.

### 2.4 Decision: replication = Capability + gate under `review` (not a new Role)

**Decision**: Keep replication as a **Capability + strong gate under `review`**; do **not** add a `replication` Role in v1.

Rationale:
- **E1** (strong): `src-aea-data-editor` mandates a pre-publication reproducibility check and a DCAS README (`src-ssde-template-readme`). This is a **responsibility with its own artifact/validation** — not necessarily a separate agent.
- **E2**: all 3 real repos *are* replication packages; `case-dime-niger-asp` has a reviewer switch, `case-learning-poverty` has a QA branch — but none uses a distinct "replication agent".
- **E4** (the choice): whether to have an independent Agent Role is **our** engineering decision. Two viable designs:
  - **A. Independent `replication` Role**: heavier change, separate dispatch.
  - **B. `review`-inner Capability + gate (recommended)**: `review` owns `economics.replication.provenance` / `replicability_check`; a strong machine gate; minimal change. **Recommended.**

So `review` is split internally into two responsibilities: **adversarial review** (human) and **replication gate** (machine). Both live under the `review` Role; the gate is enforced by capability + validator, not by a new agent.

---

## 3. Capability Model

Role and Capability are kept **separate**: Roles carry responsibility/authority and dispatch; Capabilities are the unit of method/verification, resolved by `core/resolve_capabilities.mjs` against the environment and policy.

| Capability family | Capability IDs (v1 scope) | Evidence |
|---|---|---|
| literature | `economics.literature.search`, `economics.literature.verify` (citation cross-check) | **E1** `src-prisma`/`src-openalex`/`src-crossref`; **E3** `case-journal-skills`. |
| data | `economics.data.validation` (+ future `.harmonize`, `.construct`) | **E2** all 3 repos; **E1** `src-dime-data-handbook`, `src-dime-standards`. |
| regression | `economics.regression.panel_fe` (+ future `.ols`, `.fe_interacted`) | **E1** `src-fixest`/`src-reghdfe`/`src-linearmodels`/`src-pyfixest`; **E2** `case-euro-scm`, `case-dime-niger-asp`. |
| causal inference | `economics.causal.did.twfe`, `economics.causal.did.staggered`, `economics.causal.iv` (+ future `.rd`, `.scm`) | **E1** `src-did-r`/`src-csdid-stata`/`src-ivreg2`/`src-rdrobust`/`src-honestdid`; **E2** `case-euro-scm`(SCM). |
| robustness / statistical testing | `economics.stat.testing.multcomp`, `economics.robustness.*` | **E1** `src-statsmodels`; **E2** `case-dime-niger-asp`(MHT), `case-euro-scm`(placebo). |
| presentation (tables) | `economics.presentation.tables` | **E2** all 3 repos (render step); **E1** `src-aea-style`. |
| presentation (figures) | `economics.presentation.figures` | **E2** all 3 repos (render step); **E1** `src-aea-style`. |
| replication / provenance | `economics.replication.provenance`, `economics.replication.stamp` | **E1** `src-aea-data-editor`, `src-ssde-template-readme`, `case-aea-replication-template`; **E2** all 3 repos. |

**Separation rule**: Roles *select* capabilities; Capabilities are *verified* (reference/experimental/tested/verified) and *resolved* to an implementation. Capabilities never decide the scientific question; Roles never invent method semantics — they invoke a resolved capability.

---

## 4. Economics Research Director vs Core Coordinator

The Domain Pack needs a **scientific decision owner** distinct from the domain-agnostic **Core Coordinator**. The Director is a **domain-level scientific controller**, **not** a worker Role.

| | **Core Coordinator** (domain-agnostic) | **Economics Research Director** (domain scientific controller) |
|---|---|---|
| Owns | Orchestration mechanics: plan/DAG, dispatch, env probe, resolver execution, artifact checks, thread creation. | Scientific decisions: research design, identification/specification, sample decisions, estimator/capability selection, robustness requirements, interpretation/review routing. |
| Scope | Any domain. | `domains/economics`. |
| Uses | `core/scaffold_role_team.mjs`, `core/resolve_capabilities.mjs`, `core/validate_artifacts.mjs`, `core/build_replication_stamp.mjs`. | `study_design` (the contract), `selected_capabilities`, decision gates. |
| Never decides | Identification, estimator choice, sample meaning. | Orchestration mechanics (does not dispatch/run code). **Decides before dispatch; cannot improvise.** |
| Output | Enforced plan; DAG; blocked/needs_decision/ready. | `study_design` with `decisions`, `preconditions`, `manual_validations`, `execution_context`. |

**Boundary**: The Director produces a `study_design` (its **only contract**) that the Coordinator then executes. If any scientific decision is not fixed (e.g. identification strategy, clustering level, treatment definition, sample exclusion, robustness set), the Director **must** surface `needs_decision` — the Coordinator and workers **must not** infer it. The Director is **not added to `roles.json`**; it is a domain-level controller represented by the `study_design` schema.

---

## 5. Artifact DAG

The canonical single-source-of-truth handoff (machine-readable artifacts are truth; rendered tables/figures are views).

```
study_design
  → literature evidence (literature_search_log, literature_review)
  → data_manifest / variable_dictionary / sample_flow / descriptive_facts / decision_log
  → model_registry
  → estimates / diagnostics
  → tables / figures   (RENDERED VIEWS of model_registry/estimates/diagnostics)
  → manuscript claims  (claim_ledger; each claim references an artifact)
  → replication package (README/DCAS + run_all + replication_stamp)
  → review / revision gate
```

**Single-source-of-truth rules**:
- `data_manifest` / `variable_dictionary` / `sample_flow` / `descriptive_facts` are the only machine truth for the **data side**; `data_summary` is the presentation layer only.
- `model_registry` / `estimates` / `diagnostics` are the only machine truth for the **empirical side**; `empirical_results` is the presentation layer only.
- `replication_stamp` is **deterministically built** from `model_registry`/`estimates`/`diagnostics` by `core/build_replication_stamp.mjs` (P4). It is **never hand-written** by a worker/LLM.
- `tables/figures` are **derived views**; they must reference the artifact they render and be regenerable. A figure/table carrying a number that is not in `estimates`/`diagnostics` is a **FAIL** on `core/validate_artifacts.mjs`.
- `manuscript claims` reference artifacts via a claim ledger; a claim with no artifact backing is flagged.

This directly addresses the historical Issue #5 root cause ("same number hand-written in two places"): the only source of a statistic is the analysis artifact, and the stamp/figures are derived.

---

## 6. Decision Gates

These scientific points **must** stop at `needs_decision` (Director / user) rather than letting any Agent improvise. Source: current `roles.json` `must_escalate` fields + `study_design.example.json` `decisions`/`manual_validations`.

| Gate | Field(s) | Owner | Why (evidence) |
|---|---|---|---|
| Research design / identification strategy | `identification_strategy` | Director | **E2** `case-euro-scm` Master.do control panel; **E1** scientific validity. |
| Treatment definition | `treatment_definition` | Director / data | **E2** `case-dime-niger-asp` treatment; **E1** DIME data design. |
| Sample exclusion | `sample_exclusion` | Director / data | **E2** `case-euro-scm`(Luxembourg exclusion), `case-dime-niger-asp`(consent/attrition). |
| Clustering / inference level | `clustering_level` | Director / empirical | **E1** `src-fixest`/`src-reghdfe` cluster SE; **E2** panel benchmarks. |
| Estimator / capability selection | `estimator_choice`, `selected_capabilities` | Director | **E1** capability registry; **E2** method-by-design. |
| Comparison-group support (DID) | `design.comparison_group` | Director | **E1** `src-did-r`, `src-honestdid`; blocked/needs_decision on mismatch. |
| Treatment-timing / staggered design | `design.treatment_timing` | Director | **E1** `src-csdid-stata`; preconditions. |
| Robustness set | which placebo/leave-one-out/alt-outcome | Director | **E2** `case-euro-scm` robustness blocks. |
| Instrument relevance / exclusion | `instrument_relevance_strong`, `instrument_exclusion_argued` | Director | **E1** `src-ivreg2` weak-instrument diagnostics; manual validation. |
| Interpretation / review routing | how results are framed & which review path | Director | **E1** `src-aea-data-editor`; **E3** `case-journal-skills` referee strategy. |
| Data rights / restricted data / licensing | rights/license | Director / user | **E1** `src-ssde-template-readme` (rights, license, confidentiality). |

**Semantics** (mirrors `core/resolve_capabilities.mjs`):
- **`needs_decision`** — an **unresolved scientific choice** (identification strategy, clustering level, treatment definition, sample exclusion, robustness set, instrument exclusion argument not yet settled). Agent must not improvise; the Director/user must decide.
- **`blocked`** — a **failed machine-enforceable admission or precondition**. Two cases:
  1. **High-risk + production** with **no verified eligible implementation** → **`blocked`**. Director approval / override **must NOT** bypass `verified_only` admission; the Director may only de-scope to a verified capability, never admit a `tested`/`experimental` implementation for high-risk production.
  2. A machine-checkable precondition violation (e.g. `design.comparison_group` unsatisfied for staggered DID, or version/environment requirement unsatisfied) → **`blocked`**.
- `needs_decision` is **not** used for failed admission; it is reserved for unresolved science. `blocked` is **not** a "choose to override" path either.

---

## 7. Workflow Execution Model

How a real study moves through the system:

```
Coordinator (core, domain-agnostic)
  → Economics Research Director (domain-level scientific controller; contract = study_design)
  → worker Roles (responsible units)
  → Capabilities (method/verification, resolved to an implementation)
  → Implementations (any runtime: Stata/R/Python)  — chosen by resolver from env snapshot + policy
  → Artifacts (single source of truth)
  → gates / review (needs_decision | blocked | ready → dispatch_allowed → review)
```

**Concrete end-to-end example — "staggered firm mandate" panel:**

1. **Coordinator** gets `research_question` = "effect of a staggered firm mandate on output". It is domain-agnostic; it routes to the economics pack.
2. **Economics Research Director** produces `study_design`: `selected_capabilities = { economics.regression.panel_fe, economics.causal.did.staggered, economics.stat.testing.multcomp }`; `decisions = { treatment_definition: firm mandate post (staggered), clustering_level: firm, sample_exclusion: age 16-65/employed/drop key missing, estimator_choice: cs, control_set: industry x time, fixed_effects: worker+time, family_definition: m1-m6a, correction_method: holm }`; `preconditions = { design.panel: unit_time, design.treatment_timing: staggered, design.comparison_group: never_or_not_yet_treated }`; `execution_context = { mode: production, allow_experimental: false, preferred_runtimes: [stata,r,python] }`.
3. **Core Coordinator** runs **preflight** (env probe + resolver). It inspects `runtime_instances` / resources; checks each `selected_capability` for machine-enforceable admission:
   - `panel_fe` is **high-risk** and `execution_context.mode = production` → admission requires a **`verified`** eligible implementation. The registry only has `tested` (fixest/reghdfe) and `experimental` (linearmodels) for this capability. **No `verified` eligible implementation → `blocked`** (strict v1.3 policy). The Director's approval / override **cannot** make a `tested`/`experimental` implementation admissible for high-risk production; it can only **de-scope** the design to a capability that has a `verified` implementation, or the study is blocked.
4. **Preflight result**: because `panel_fe` is `blocked` (failed machine-enforceable admission), the Coordinator does **not** dispatch an `empirical` run against an experimental linearmodels implementation. This is a **`blocked`**, not a `needs_decision` (the scientific choices are already fixed in `study_design`; the blocking cause is the missing `verified` implementation). The Director may revise the design (e.g. restrict to a `verified` capability), which re-runs preflight.
5. Once the design resolves to allowed capability set, the Coordinator dispatches the **worker Roles**:
   - `literature_search` → `literature_search_log`; `literature_review` → `literature_review`.
   - `data` → `data_manifest`/`variable_dictionary`/`sample_flow`/`descriptive_facts`/`decision_log` (escalating sample_exclusion/treatment_definition if UOS shifts; those are `needs_decision`).
   - `empirical` → resolves `panel_fe`/`did.staggered` implementations via `core/resolve_capabilities.mjs` (picks runtime by env + policy + verification status); produces `model_registry`/`estimates`/`diagnostics`; invokes `economics.presentation.tables` / `economics.presentation.figures` to render tables/figures.
   - `writing` → `manuscript` + claim ledger (each claim references an artifact).
   - `review` → adversarial review (human) **and** **replication gate**: runs `core/build_replication_stamp.mjs` from the artifacts (deterministic), then `core/validate_artifacts.mjs`. A mismatch (e.g. a figure number not in `estimates`, or a hand-edited stamp) → **machine FAIL**.
6. **Gates/review**: if the replication gate PASSes and the Director accepts interpretation/routing, the Coordinator may create threads / route to submission; otherwise the study returns to the Director for revision.

This shows the clean separation: **Director owns science; Coordinator owns mechanics; Roles/Implementations/Artifacts carry it; gates prevent improvisation.**

---

## 8. Delta from Current Repository (migration plan)

No migration is implemented in this task. The plan is:

### 8.1 Stays unchanged
- **Core stays domain-agnostic.** `core/` modules (`scaffold_role_team.mjs`, `resolve_capabilities.mjs`, `build_replication_stamp.mjs`, `validate_artifacts.mjs`, `validate_capability_schema.mjs`, `validate_role_scope.mjs`, `artifact_hash.mjs`, `multiple_testing_contract.mjs`) are **domain-agnostic** today. This is a *boundary* statement, not a freeze: **generic orchestration / validation mechanisms may be extended**, but any such extension must remain domain-agnostic.
  - **Any future table/figure artifact validation added to Core must be generic reference/provenance validation** (e.g. "this rendered figure references artifact id X"), **not** Economics-specific presentation logic.
  - **Economics-specific scientific semantics (specification, identification, sample meaning, estimator selection, presentation rules) must remain under `domains/economics`**, never in Core.
- Capability registry files (7 existing) — **unchanged**; new ones are additive.
- `data/`, `docs/03`, `capture/emit`, `docs/06` (referenced by tests).
- Legacy v1.2 path (`templates/role-team/roles.research.json`, `meta.toolchain`/`meta.journal` compat mapping) — **kept**.

### 8.2 Modified
- `domains/economics/roles.json`: **do NOT add `economics_director`**. Instead: remove/re-scope `visualize` (→ presentation capability, no Role); split `review` responsibility into `adversarial_review` + `replication_gate` (both under `review`); add `economics.presentation.*` to `empirical` capability_scope; give `literature_review` a `capability_scope` of `economics.literature.*`.
- `domains/economics/study_design.example.json`: add `economics_director` (or `director`) routing fields; keep `execution_context`/`selected_capabilities`/`decisions`/`preconditions`/`manual_validations`.

### 8.3 Added
- New capability files: `economics.literature.verify`, `economics.robustness.honestdid` (or `.sensitivity`), `economics.presentation.tables`, `economics.presentation.figures`, `economics.replication.provenance`, `economics.replication.stamp` (if not already present); registration in `capabilities/index.json`.
- A **`study_design.schema.json`** under `domains/economics/` — this is the **Director's contract** (NOT a `roles.json` entry). The Director is a domain-level controller, not a worker Role.
- `domains/economics/RFC-WORKFLOW-V1.md` (this file, the current RFC).

### 8.4 Deprecated (tentative / future)
- `visualize` role in `roles.json` (→ presentation capability). Marked deprecated, not removed in this task.
- Legacy `meta.toolchain` / `meta.journal` as *canonical* fields (already compat-mapped to `execution_context`/`output_profile`); keep only in the legacy path.
- (Future, post-P7-benchmarks) any capability still `experimental` that should be promoted/demoted — **not** part of this RFC.

---

## 9. Build Order (next-phase implementation sequence)

1. **Director contract / schema**: Add `domains/economics/study_design.schema.json` (the Director's contract); add a controller note to the SKILL / docs. **Do NOT add `economics_director` to `roles.json`** (it is not a worker Role). *(E4)*
2. **Worker Role/schema update**: update `roles.json` (re-scope `visualize`, split `review`, add `economics.presentation.*` to `empirical`), update `validate_role_scope.mjs` expectations. *(E4)*
3. **Capability additions**: `economics.literature.verify`, `economics.robustness.*`, `economics.presentation.tables`, `economics.presentation.figures`, `economics.replication.provenance`; register in `index.json`; update `schema.spec.mjs`. *(E1/E2)*
4. **Director preflight hook**: Wire the Director's `study_design` into the resolver/preflight path so unresolved scientific choices surface `needs_decision`, and machine-enforceable admission failures surface `blocked` (no verified implementation for high-risk production, precondition mismatch). *(E4)*
5. **Presentational capability + artifact binding**: Implement `economics.presentation.tables` (table renderer) and `economics.presentation.figures` (reference-only) so they consume only `model_registry`/`estimates`/`diagnostics`/`data_manifest`; extend the **generic** `validate_artifacts.mjs` for artifact-reference/provenance checks (figure/table ↔ artifact id), keeping it domain-agnostic. *(E4 + E1)*
6. **Replication gate in `review`**: Add `economics.replication.provenance`; confirm `replication_stamp` is built deterministically and validated. *(E1)*
7. **Role/capability tests + docs**: Update `role_scope.spec.mjs`, `resolver.spec.mjs`, `docs_consistency.spec.mjs`, `skills/codex-role-team/SKILL.md` (Director boundary, presentation capability, review split, blocked/needs_decision). *(E4)*
8. **Compatibility + regression**: Keep v1.2 legacy path green; add fixtures for Director gate (unresolved scientific choice → `needs_decision`; high-risk production no-verified → `blocked`; precondition mismatch → `blocked`), presentation-capability artifact binding, replication gate FAIL. *(E4)*

> **Ordering rationale**: Director contract/schema first (stabilize the scientific-control boundary), then worker roles, then capabilities, then the preflight gate (so scientific decisions and admission are enforced before dispatch), then presentation + replication gates (the machine-truth enforcement), then tests/docs/compat.

---

## 10. Provenance summary of every material recommendation

- **Institutional standard (E1)**: research lifecycle stages 2/9/10, DCAS README, pre-publication replication check, data/variable-dictionary discipline, presentation style, causal method benchmarks (`src-fixest`/`reghdfe`/`did`/`ivreg2`/`rdrobust`/`honestdid`).
- **Real-project observed (E2)**: lifecycle stages 0/3/4/5/7/9 (setup, data, balance/validation, estimation, tables/figures, replication package); `visualize` as a render step not a role; Master.do control-panel approach.
- **Workflow/template precedent (E3)**: journal-skills stage decomposition + `00_master.do`; AEA/SSDE/ietoolkit templates; literature-positioning/referee/rebuttal as a workflow split.
- **Our engineering abstraction (E4)**: `economics_director` as a **domain-level scientific controller (not a worker Role)**; `visualize`→capability; `replication` as capability+gate under `review` (not a new Role); strict `blocked` (no verified → high-risk production admission failure) vs `needs_decision` (unresolved science); `risk_level`/`verification_status`/`dispatch_allowed`; the lifecycle *superset* framing; Core domain-agnostic boundary.

---

*This RFC is a design proposal; it makes no code changes. After review, it becomes the basis for the implementation sequence in §9.*

