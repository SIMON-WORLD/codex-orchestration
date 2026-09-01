#!/usr/bin/env node
// Phase 2 M2 - real multi-source bibliographic benchmark + adversarial evidence + maturity decision.
// CI-safe: all pipeline runs use the frozen NON-LIVE derived captures via the DI seam. No live network.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runLiteratureSearch, canonicalLiteratureContentHash } from "../domains/economics/literature/run_literature_search.mjs";
import { loadBenchmark, sourceFetchersForQuery, QUERIES, expectedDistinctDois, loadCapture } from "../domains/economics/benchmarks/literature/benchmark_helpers.mjs";
import { runComparator } from "../domains/economics/benchmarks/literature/comparator.mjs";
import { runAdversarialSuite } from "../domains/economics/benchmarks/literature/adversarial/run_adversarial.mjs";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }

console.log("Phase 2 M2 literature real-benchmark + adversarial evidence");

const man = loadBenchmark();

// 1. Ground-truth manifest loads + required official identities
{
  ok("GT. benchmark_id", man.benchmark_id === "lit_real_bibliographic_v1");
  ok("GT. evidence_class includes real_bibliographic + adversarial + live_transport", /real_bibliographic/.test(man.evidence_class) && /adversarial/.test(man.evidence_class) && /live_transport/.test(man.evidence_class));
  ok("GT. CASE_A Card WP DOI 10.3386/w4483", man.cases.CASE_A.identity.doi === "10.3386/w4483");
  ok("GT. CASE_A published version has NO DOI assumed", man.cases.CASE_A_PUBLI.identity.doi === null);
  ok("GT. CASE_B1 Angrist/Krueger WP DOI 10.3386/w3572", man.cases.CASE_B1.identity.doi === "10.3386/w3572");
  ok("GT. CASE_B2 QJE DOI 10.2307/2937954", man.cases.CASE_B2.identity.doi === "10.2307/2937954");
  ok("GT. B1/B2 MUST NOT be deduped invariant present", man.invariants.some((i) => /B1 and B2 MUST NOT be deduped/i.test(i)));
  ok("GT. WP vs published distinct relation present", man.relations.A_to_A_PUBLI?.must_not_dedupe === true && man.relations.B1_to_B2?.must_not_dedupe === true);
}

// 2. Deterministic replay: two identical runs -> identical canonical content hash
{
  const { request, fetchers } = sourceFetchersForQuery(man, "Q_A");
  const a = await runLiteratureSearch(request, { fetchers });
  const b = await runLiteratureSearch(request, { fetchers });
  ok("REPLAY. deterministic replay -> identical canonical hash", canonicalLiteratureContentHash(a.canonical) === canonicalLiteratureContentHash(b.canonical));
  ok("REPLAY. record IDs identical", JSON.stringify(a.canonical.candidates.map((c) => c.record_id).sort()) === JSON.stringify(b.canonical.candidates.map((c) => c.record_id).sort()));
}

// 3. Comparator: real cross-source reconciliation + WP/published-version distinction
{
  const cmp = await runComparator();
  ok("COMP. comparator PASS identity verdict", cmp.verdict !== "FAIL");
  const qa = cmp.queries.find((q) => q.query === "Q_A");
  const qb = cmp.queries.find((q) => q.query === "Q_B");
  ok("COMP. Q_A WP verified (authoritative DOI)", qa.checks.wp_doi === true);
  ok("COMP. Q_A Card authorship compatible", qa.checks.wp_card_authorship === true);
  ok("COMP. Q_A published version distinct from WP", qa.checks.published_version_distinct === true);
  ok("COMP. Q_A published version has no DOI", qa.checks.published_version_no_doi === true);
  ok("COMP. Q_A no fuzzy-title merge (exactly 2 groups)", qa.checks.no_fuzzy_merge === true);
  ok("COMP. Q_B B1 WP DOI verified", qb.checks.b1_doi === true);
  ok("COMP. Q_B B2 QJE DOI verified", qb.checks.b2_doi === true);
  ok("COMP. Q_B B1/B2 remain distinct (never merged)", qb.checks.b1_b2_distinct === true && qb.checks.b1_b2_never_merged === true);
  ok("COMP. Q_B author identity compatible", qb.checks.author_identity_compatible === true);
  ok("COMP. source-order permutation invariant (both queries)", qa.checks.source_order_invariant === true && qb.checks.source_order_invariant === true);
}

// 4. Frozen adversarial suite (section 10/12/14)
{
  const adv = await runAdversarialSuite();
  ok("ADV. adversarial suite PASS", adv.verdict === "PASS");
  const ids = adv.cases.map((c) => c.id).sort();
  const expectedIds = ["ADV_DOI_VARIANTS","ADV_SAME_TITLE_DISTINCT","ADV_DOI_TITLE_CONFLICT","ADV_AUTHOR_CONFLICT","ADV_TYPED_DATE","ADV_SOURCE_UNAVAILABLE","ADV_MALFORMED_DOI","ADV_MISSING_DOI_MULTI","ADV_MISSING_DOI_SINGLE","ADV_MULTI_SOURCE_SAME","ADV_WP_VS_PUBLISHED","ADV_INCOMPLETE","ADV_ZERO_RESULTS","ADV_ONE_SOURCE_FAIL","ADV_FUZZY_MERGE_REJECTED","ADV_ORDER_INVARIANT","ADV_MAX_RESULTS","ADV_NO_SECRET_LEAK"].sort();
  ok("ADV. all A-R frozen cases present", JSON.stringify(ids) === JSON.stringify(expectedIds));
  ok("ADV. all adversarial cases passed", adv.cases.every((c) => c.pass));
  ok("ADV. degradation matrix all passed", adv.degradation_matrix.every((c) => c.pass));
  ok("ADV. degradation matrix has 6 entries", adv.degradation_matrix.length === 6);
  // degrade matrix expected behaviors
  const bothFail = adv.degradation_matrix.find((c) => c.id === "DEG_BOTH_FAIL");
  ok("ADV. DEG_BOTH_FAIL -> no verification evidence", bothFail.pass === true && bothFail.detail.candidates === 0);
  // frozen pattern: source failure never yields a verified record
  const oneFail = adv.degradation_matrix.find((c) => c.id === "DEG_CROSSREF_FAIL");
  ok("ADV. DEG_CROSSREF_FAIL records unavailable source honestly", oneFail.pass === true && /openalex:source_unavailable/.test(oneFail.detail.statuses.join(",")));
}

// 5. Live transport evidence is truthfully distinguished (no fabricated live evidence)
{
  const live = JSON.parse(readFileSync(join(root, "domains/economics/benchmarks/literature/live/live_probe.json"), "utf8"));
  ok("LIVE. probe has 4 executions", live.executions.length === 4);
  ok("LIVE. both sources source_unavailable/transport recorded", live.executions.every((e) => e.status === "source_unavailable" && e.error_category === "transport"));
  ok("LIVE. execution metadata notes network-dependent", /network-dependent/.test(live.env.note));
  // capture files are non-live and labeled
  const crCap = loadCapture("crossref");
  const oaCap = loadCapture("openalex");
  ok("LIVE. captures explicitly non_live", crCap.capture_meta.non_live === true && oaCap.capture_meta.non_live === true);
  ok("LIVE. captures labeled NOT live transport evidence", /NOT live transport evidence/.test(crCap.capture_meta.note) && /NOT live transport evidence/.test(oaCap.capture_meta.note));
}

// 6. Maturity decision (STRICT): keep experimental, LIVE_EVIDENCE_INCOMPLETE
{
  const adv = await runAdversarialSuite();
  const live = JSON.parse(readFileSync(join(root, "domains/economics/benchmarks/literature/live/live_probe.json"), "utf8"));
  const liveBothFailed = live.executions.every((e) => e.status === "source_unavailable");
  const cap = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/literature.search.json"), "utf8"));
  const impl = cap.implementations.find((i) => i.id === "litsearch.local.sources");
  ok("MATURITY. litsearch.local.sources status reset to experimental", impl.verification_status === "experimental");
  ok("MATURITY. strict rule keeps experimental when both live sources fail", liveBothFailed && impl.verification_status === "experimental");
  ok("MATURITY. hard evidence says LIVE_EVIDENCE_INCOMPLETE", liveBothFailed);
  ok("MATURITY. no tested promotion", impl.verification_status !== "tested" && impl.verification_status !== "verified");
  // benchmark_ref present
  ok("MATURITY. benchmark_ref points to literature benchmark dir", impl.verification?.benchmark_ref === "domains/economics/benchmarks/literature/");
  // adversarial + comparator evidence is deterministic, so even without live success we do not fake promotion.
  ok("MATURITY. adversarial benchmark exists and passes independently of live", adv.verdict === "PASS");
}

// 7. Resolver / risk regression: no Core special case, runtime != live source availability
{
  const registry = loadRegistry(null, "domains/economics/capabilities");
  const cap = registry["economics.literature.search"];
  ok("REG. capability exists", Boolean(cap));
  ok("REG. economics.literature.search remains low risk", cap.risk_level === "low");
  ok("REG. search_scope required in decision_requirements", Array.isArray(cap.decision_requirements) && cap.decision_requirements.includes("search_scope"));
  ok("REG. fallback policy recorded", cap.fallback_policy === "recorded");

  const mkStudy = (decisions = {}) => ({
    study_id: "m2", domain: "economics",
    execution_context: { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] },
    selected_capabilities: { literature_search: ["economics.literature.search"] },
    decisions, preconditions: {}, manual_validations: {},
  });
  const ctx = { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] };
  const envNode = { runtimes: { node: { available: true, known: true, version: "24" } }, packages: {} };
  const envNoNode = { runtimes: { node: { available: false, known: false, version: null } }, packages: {} };

  // node available -> low risk resolves to litsearch.local.sources (experimental)
  const rNode = resolveAll(mkStudy({ search_scope: "m2" }), registry, envNode, ctx).capabilities["economics.literature.search"];
  ok("REG. node available -> low risk resolved", rNode.resolution === "resolved", `got=${rNode.resolution}`);
  ok("REG. selects litsearch.local.sources", rNode.selected_implementation?.id === "litsearch.local.sources", `got=${rNode.selected_implementation?.id}`);
  ok("REG. selected verification_status = experimental", rNode.verification_status === "experimental");

  // search_scope missing -> needs_decision (decision_missing)
  const rMissing = resolveAll(mkStudy({}), registry, envNode, ctx).capabilities["economics.literature.search"];
  ok("REG. search_scope missing -> needs_decision/decision_missing", rMissing.resolution === "needs_decision" && rMissing.reason === "decision_missing", `got=${rMissing.resolution}/${rMissing.reason}`);

  // no node runtime -> low risk fallback recorded (not blocked)
  const rFall = resolveAll(mkStudy({ search_scope: "m2" }), registry, envNoNode, ctx).capabilities["economics.literature.search"];
  ok("REG. no node runtime -> fallback_recorded (low risk)", rFall.resolution === "resolved" && rFall.fallback_recorded === true, `got=${rFall.resolution}/${rFall.reason}`);

  // runtime availability is NOT live source availability: resolver resolves even though live_probe shows both sources unavailable.
  const live = JSON.parse(readFileSync(join(root, "domains/economics/benchmarks/literature/live/live_probe.json"), "utf8"));
  const bothLiveDown = live.executions.every((e) => e.status === "source_unavailable");
  ok("REG. live sources are down", bothLiveDown);
  ok("REG. resolver still resolves on runtime env (not conflated with live source availability)", bothLiveDown && rNode.resolution === "resolved");

  // no Core special-case: no core .mjs file hardcodes economics.literature / litsearch as a special rule.
  const coreFiles = readdirSync(join(root, "core")).filter((f) => f.endsWith(".mjs"));
  const coreHits = [];
  for (const f of coreFiles) {
    const raw = readFileSync(join(root, "core", f), "utf8");
    const txt = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    if (/economics\.literature|litsearch|literature\.search/.test(txt)) coreHits.push(f);
  }
  ok("REG. no Core special-case for literature capability", coreHits.length === 0, `hits=${coreHits.join(",")}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
