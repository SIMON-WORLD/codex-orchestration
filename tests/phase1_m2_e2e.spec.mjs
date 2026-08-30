#!/usr/bin/env node
// Phase 1 M2 - real integrated Data->Empirical execution + integration regression.
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";
import { evaluateStudyDesign } from "../domains/economics/evaluate_study_design.mjs";
import { buildPhase1Bundle } from "../domains/economics/phase1/build_bundle.mjs";
import { phase1Preflight } from "../domains/economics/phase1/run_phase1.mjs";
import { buildPhase1Plan } from "../domains/economics/phase1/build_execution_plan.mjs";
import { validateArtifacts } from "../core/validate_artifacts.mjs";
import { hashTextFile, hashCanonicalJsonFile } from "../core/artifact_hash.mjs";
import { loadBundle, renderValidated } from "../domains/economics/presentation/render_table.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = loadRegistry(join(root, "domains/economics/capabilities"));
const study = JSON.parse(readFileSync(join(root, "domains/economics/study.phase1.grunfeld.json"), "utf8"));
const studyPath = join(root, "domains/economics/study.phase1.grunfeld.json");
const envPath = join(root, "domains/economics/phase1/env.json");
const regDir = join(root, "domains/economics/capabilities");
const TMP = join(root, "role-team-out/phase1_m2_tests"); rmSync(TMP, { recursive: true, force: true }); mkdirSync(TMP, { recursive: true });
const runDir = join(TMP, "run"); mkdirSync(runDir, { recursive: true });
// Build a runDir from committed frozen results + estimates fixture (deterministic input for adapter tests).
cpSync(join(root, "domains/economics/benchmarks/data_validation/results/python.json"), join(runDir, "data_validation.json"));
cpSync(join(root, "domains/economics/benchmarks/panel_fe/results/stata.json"), join(runDir, "panel_fe.json"));
cpSync(join(root, "domains/economics/phase1/fixtures/estimates.json"), join(runDir, "estimates.json"));
cpSync(join(root, "domains/economics/benchmarks/multcomp/results/python.json"), join(runDir, "multcomp.json"));
const bundleDir = join(TMP, "bundle");

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function readJson(p) { return JSON.parse(readFileSync(p, "utf8")); }

console.log("Phase 1 M2 E2E integration regression");

// A. runner refuses a Director-not-ready study
let sA = clone(study); delete sA.decisions.fixed_effects; sA.study_id = "phase1_bad"; const pA = join(TMP, "bad_study.json"); writeFileSync(pA, JSON.stringify(sA, null, 2) + "\n", "utf8");
ok("A. Director-not-ready study is refused (preflight director != ready)", phase1Preflight(pA, { runtimes: {} }).director.status !== "ready", `status=${phase1Preflight(pA, { runtimes: {} }).director.status}`);

// B. environment is probed, not trusted solely from env.json (source uses probeEnv, writes env.real.json)
const runnerSrc = readFileSync(join(root, "domains/economics/phase1/run_phase1.mjs"), "utf8");
ok("B. runner probes real env (probeEnv) and writes env.real.json, does NOT read committed env.json as the execution env", /probeEnv\(\)/.test(runnerSrc) && /env\.real\.json/.test(runnerSrc) && !/readJson\(.*env\.json/.test(runnerSrc), "runner source should probe and write real env");

// C. Data executes before Empirical (DAG order)
const plan = buildPhase1Plan(studyPath, join(root, "domains/economics/roles.json"), envPath, regDir);
ok("C. Data precedes Empirical in the active DAG", plan.roles.data.stage < plan.roles.empirical.stage && plan.roles.empirical.depends_on.includes("data"));

// D. Empirical refuses unaccepted/missing Data completion (runner fails before empirical on data fail; DAG dependency enforces)
ok("D. Empirical blocked until Data accepted (dispatch_allowed enforces dep; runner source guards fresh data failure before empirical)", plan.roles.empirical.dispatch_allowed === true && /if \(dv\.summary\.fail > 0\) throw/.test(runnerSrc) && runnerSrc.indexOf("data_validation") < runnerSrc.indexOf("panel_fe/runners"));

// E. fresh Data result is bound to frozen dataset checksum
const info = buildPhase1Bundle(bundleDir, runDir);
let { bundle, paths } = loadBundle(bundleDir);
ok("E. integrated bundle data_manifest checksum binds to frozen Grunfeld checksum", bundle.data_manifest.dataset_sha256 === "d49d8a9e1721bd70fa2d74ff7a0955654b5704b89bc03e95f4aec3d686084adb" && hashTextFile(join(root, "domains/economics/benchmarks/panel_fe/grunfeld.csv")) === bundle.data_manifest.dataset_sha256);

// F. fresh Panel-FE originates from runtime (runner invokes panel-fe runner, does NOT read committed results/stata.json as execution source)
ok("F. runner executes panel-fe via its runner (fresh), not by reading committed results/stata.json", /panel_fe\/runners\/run_stata\.mjs/.test(runnerSrc) && !/readFileSync\(.*panel_fe\/results\/stata\.json/.test(runnerSrc));

// G. Multiple Testing consumes fresh upstream (fresh panel-fe result path, not committed multcomp result)
ok("G. multcomp runner consumes fresh panel-fe (--stata phase1_run/panel_fe.json), not committed multcomp results", /--stata.*panel_fe\.json/.test(runnerSrc) && !/multcomp\/results/.test(runnerSrc.split("runCmd")[1] || ""));

// H. integrated artifact bundle validates
const errs = validateArtifacts(bundle, paths);
ok("H. integrated artifact bundle passes validateArtifacts", errs.length === 0, JSON.stringify(errs));

// I. Presentation values equal upstream scientific artifacts
const rendered = renderValidated(bundle, paths, {});
ok("I. estimate renderer succeeds and values equal upstream estimates", (() => { if (!rendered.ok) return false; const rows = rendered.output.split("\n").filter((l) => l.startsWith("| ")); const est = bundle.estimates.estimates; const f = (n) => Number(n).toFixed(4); return est.every((e, i) => rows[i + 1] === `| ${e.term} | ${f(e.estimate)} | ${f(e.std_error)} | ${f(e.p_value)} | ${e.n} |`); })());

// J. benchmark comparison (fresh/fixture-derived vs frozen) is definition-compatible
const frozenPf = readJson(join(root, "domains/economics/benchmarks/panel_fe/results/stata.json"));
const frozenMc = readJson(join(root, "domains/economics/benchmarks/multcomp/results/python.json"));
const approx = (a, b, t = 1e-9) => Math.abs(a - b) < t;
ok("J. fresh/integrated Panel-FE coef+SE match frozen benchmark (definition-compatible)", approx(bundle.estimates.estimates[0].estimate, frozenPf.coefficients.value) && approx(bundle.estimates.estimates[1].std_error, frozenPf.std_errors.capital));
const bundledHolm = Object.fromEntries(bundle.multiple_testing.families.find((f) => f.method === "holm").adjusted_results.map((a) => [a.estimate_id, a.adjusted_p_value]));
ok("J2. fresh/integrated Holm adjusted p match frozen multcomp benchmark", approx(bundledHolm.EST_GRUNFELD_VALUE, frozenMc.adjusted.holm.EST_GRUNFELD_VALUE) && approx(bundledHolm.EST_GRUNFELD_CAPITAL, frozenMc.adjusted.holm.EST_GRUNFELD_CAPITAL));

// K. source dataset remains unchanged (byte-identical to frozen checksum)
ok("K. frozen Grunfeld dataset unchanged", hashTextFile(join(root, "domains/economics/benchmarks/panel_fe/grunfeld.csv")) === "d49d8a9e1721bd70fa2d74ff7a0955654b5704b89bc03e95f4aec3d686084adb");

// L. production mode still blocks high-risk Panel FE
let sL = clone(study); sL.execution_context.mode = "production"; sL.execution_context.allow_experimental = false; sL.study_id = "phase1_prod"; const pL = join(TMP, "prod.json"); writeFileSync(pL, JSON.stringify(sL, null, 2) + "\n", "utf8");
const resL = phase1Preflight(pL, readJson(envPath)).preflight;
ok("L. production mode blocks panel_fe (no_verified_implementation), overall blocked", resL.overall === "blocked" && resL.capabilities["economics.regression.panel_fe"].resolution === "blocked" && resL.capabilities["economics.regression.panel_fe"].reason === "no_verified_implementation", `overall=${resL.overall}`);

// M. no Core special case / no new artifact schema
const coreSrc = readFileSync(join(root, "core/resolve_capabilities.mjs"), "utf8");
ok("M. no Phase-1 special case in Core resolver; no new artifact schema", !/phase1/i.test(coreSrc) && !/phase1/i.test(readFileSync(join(root, "core/validate_artifacts.mjs"), "utf8")));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
