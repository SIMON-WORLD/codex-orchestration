#!/usr/bin/env node
// Phase-1 E2E execution runner (Domain-level, NOT Core).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveAll, loadRegistry } from "../../../core/resolve_capabilities.mjs";
import { evaluateStudyDesign } from "../evaluate_study_design.mjs";
import { buildPhase1Bundle } from "./build_bundle.mjs";
import { loadBundle as loadBundleFn, renderValidated as renderEstimates } from "../presentation/render_table.mjs";
import { renderValidated as renderFamily } from "../presentation/render_family_table.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
function arg(name, def) { const i = process.argv.indexOf("--" + name); return i >= 0 ? process.argv[i + 1] : def; }
const STUDY = arg("study", "domains/economics/study.phase1.grunfeld.json");
const OUT_DIR = arg("out-dir", "role-team-out/phase1_run");
const STAGE = arg("stage", "all");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
function resolveStudyPath(p) { return isAbsolute(p) ? p : join(root, p); }
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const sha256File = (p) => sha256(readFileSync(p, "utf8"));
const FROZEN_CHECKSUM = "d49d8a9e1721bd70fa2d74ff7a0955654b5704b89bc03e95f4aec3d686084adb";

function probeEnv() {
  const r = { node: { available: false, known: true, version: null }, python: { available: false, known: true, version: null }, r: { available: false, known: true, version: null }, stata: { available: false, known: true, version: null } };
  let o = spawnSync("node", ["--version"], { encoding: "utf8" });
  if (o.status === 0) r.node = { available: true, known: true, version: (o.stdout || "").trim().replace(/^v/, "") };
  const py = join(root, "role-team-out/p7-venv/Scripts/python.exe");
  o = spawnSync(py, ["-c", "import sys,pandas,statsmodels,scipy,numpy;print(sys.version.split()[0]);print('pandas',pandas.__version__);print('statsmodels',statsmodels.__version__);print('scipy',scipy.__version__);print('numpy',numpy.__version__)"], { encoding: "utf8" });
  if (o.status === 0) { const L = (o.stdout || "").trim().split(/\r?\n/); r.python = { available: true, known: true, version: L[0], packages: { pandas: { available: true, known: true, version: (L[1] || "").split(" ")[1] }, statsmodels: { available: true, known: true, version: (L[2] || "").split(" ")[1] }, scipy: { available: true, known: true, version: (L[3] || "").split(" ")[1] }, numpy: { available: true, known: true, version: (L[4] || "").split(" ")[1] } } }; }
  const rbin = "D:/Software/R/R-4.5.2/bin/Rscript.exe";
  o = spawnSync(rbin, ["--vanilla", "-e", "cat(as.character(getRversion()))"], { encoding: "utf8" });
  if (o.status === 0) r.r = { available: true, known: true, version: (o.stdout || "").trim().split(/\r?\n/).pop() };
  const stata = "D:\\Software\\Stata\\StataNow19\\StataMP-64.exe";
  const sto = join(OUT_DIR, "probe_stata.do"); writeFileSync(sto, 'di "V=" c(version)\ncap which reghdfe\nif _rc==0 di "rg=INSTALLED" else di "rg=NOT"\n', "utf8");
  const logPath = join(root, "probe_stata.log");
  try { spawnSync(stata, ["/e", "do", sto], { encoding: "utf8", windowsHide: true }); } catch {}
  let stataLine = null, reghdfeOk = false;
  try { const log = readFileSync(logPath, "utf8"); const m = log.match(/^V=(\S+)/m); if (m && /^\d/.test(m[1])) stataLine = m[1]; if (log.includes("rg=INSTALLED")) reghdfeOk = true; } catch {}
  r.stata = { available: stataLine !== null, known: true, version: stataLine, packages: { reghdfe: { available: reghdfeOk, known: true, version: null } } };
  return { runtimes: r };
}
function runCmd(cmd, args) { const o = spawnSync(cmd, args, { encoding: "utf8", timeout: 180000, windowsHide: true }); if (o.status !== 0) throw new Error(`command failed ${cmd}: ${(o.stderr || o.stdout || "").slice(0, 600)}`); return (o.stdout || ""); }
function resolveCaps(study, envObj) { const registry = loadRegistry(join(root, "domains/economics/capabilities")); const ctx = { mode: study.execution_context.mode, allow_experimental: !!study.execution_context.allow_experimental, preferred_runtimes: study.execution_context.preferred_runtimes || [], approved_overrides: study.execution_context.approved_overrides || [] }; return resolveAll(study, registry, envObj, ctx); }

export function verifyDataAccepted(outDir) {
  const accPath = join(outDir, "data_acceptance.json");
  let acc; try { acc = readJson(accPath); } catch { throw new Error("Empirical gating: no accepted Data-acceptance record"); }
  if (acc.accepted !== true) throw new Error("Empirical gating: Data stage not accepted (accepted!=true)");
  if (acc.study_id !== "phase1_grunfeld_e2e_v1") throw new Error("Empirical gating: study/run identity mismatch");
  if (acc.dataset_checksum !== FROZEN_CHECKSUM) throw new Error("Empirical gating: frozen dataset checksum mismatch");
  const dvPath = join(outDir, "data_validation.json"); let dv;
  try { dv = readJson(dvPath); } catch { throw new Error("Empirical gating: fresh data result missing"); }
  if (dv.dataset_checksum !== acc.dataset_checksum) throw new Error("Empirical gating: data result checksum != acceptance record");
  if (sha256File(dvPath) !== acc.data_result_sha256) throw new Error("Empirical gating: data result hash != acceptance record (result mutated)");
  if (dv.summary.fail > 0) throw new Error("Empirical gating: fresh data validation reports failures");
  const rulesPath = join(root, "domains/economics/benchmarks/data_validation/rules.json");
  if (acc.rules_sha256 && sha256File(rulesPath) !== acc.rules_sha256) throw new Error("Empirical gating: rules/metadata mutated after Data acceptance");
  return true;
}

export async function runPhase1(stage = STAGE, outDir = OUT_DIR) {
  mkdirSync(outDir, { recursive: true });
  const study = readJson(resolveStudyPath(STUDY));
  const directive = evaluateStudyDesign(study, loadRegistry(join(root, "domains/economics/capabilities")));
  if (directive.status !== "ready") throw new Error("Director not ready: " + JSON.stringify(directive.unresolved_decisions));
  const envObj = probeEnv(); writeFileSync(join(outDir, "env.real.json"), JSON.stringify(envObj, null, 2) + "\n", "utf8");
  const preflight = resolveCaps(study, envObj);
  if (preflight.overall !== "ready") throw new Error("controlled preflight not ready: " + JSON.stringify(preflight.capabilities));

  if (stage === "data" || stage === "all") {
    runCmd("node", [join(root, "domains/economics/benchmarks/data_validation/runners/run_stata.mjs"), "--csv", join(root, "domains/economics/benchmarks/panel_fe/grunfeld.csv"), "--raw", join(outDir, "data_stata_raw.txt"), "--out", join(outDir, "data_validation.json"), "--manifest", join(root, "domains/economics/benchmarks/panel_fe/benchmark.grunfeld.json"), "--benchmark-id", "phase1_data_validation"]);
    const dv = readJson(join(outDir, "data_validation.json")); if (dv.summary.fail > 0) throw new Error("fresh data-validation reports failures: " + JSON.stringify(dv.summary));
    const rulesPath = join(root, "domains/economics/benchmarks/data_validation/rules.json");
    const acc = { study_id: study.study_id, run_id: sha256(study.study_id + "|" + dv.dataset_checksum + "|" + dv.implementation_id).slice(0, 16), dataset_checksum: dv.dataset_checksum, data_implementation_id: dv.implementation_id, data_result_sha256: sha256File(join(outDir, "data_validation.json")), validation_summary: dv.summary, rules_id: readJson(rulesPath).rules_id, rules_sha256: sha256File(rulesPath), accepted: true, timestamp: null };
    writeFileSync(join(outDir, "data_acceptance.json"), JSON.stringify(acc, null, 2) + "\n", "utf8");
  }
  if (stage === "empirical" || stage === "all") {
    verifyDataAccepted(outDir);
    runCmd("node", [join(root, "domains/economics/benchmarks/panel_fe/runners/run_stata.mjs"), "--csv", join(root, "domains/economics/benchmarks/panel_fe/grunfeld.csv"), "--raw", join(outDir, "panel_raw.txt"), "--out", join(outDir, "panel_fe.json"), "--manifest", join(root, "domains/economics/benchmarks/panel_fe/benchmark.grunfeld.json"), "--benchmark-id", "phase1_panel_fe"]);
    runCmd("D:/Software/R/R-4.5.2/bin/Rscript.exe", ["--vanilla", join(root, "domains/economics/benchmarks/multcomp/runners/run_r.R"), "--stata", join(outDir, "panel_fe.json"), "--manifest", join(root, "domains/economics/benchmarks/panel_fe/benchmark.grunfeld.json"), "--out", join(outDir, "multcomp.json")]);
    runCmd("D:/Software/R/R-4.5.2/bin/Rscript.exe", ["--vanilla", join(root, "domains/economics/phase1/frame_estimates.R"), "--panel", join(outDir, "panel_fe.json"), "--mt", join(outDir, "multcomp.json"), "--out", join(outDir, "estimates.json")]);
    buildPhase1Bundle(join(outDir, "bundle"), outDir);
    const { bundle, paths } = loadBundleFn(join(outDir, "bundle"));
    mkdirSync(join(outDir, "output/tables"), { recursive: true });
    const re = renderEstimates(bundle, paths, {}); if (!re.ok) throw new Error("estimates render failed: " + JSON.stringify(re.errors)); writeFileSync(join(outDir, "output/tables/grunfeld_estimates.md"), re.output, "utf8");
    for (const fam of ["descriptive_facts", "diagnostics", "model_registry"]) { const f = renderFamily(bundle, paths, { family: fam }); if (!f.ok) throw new Error(fam + " render failed: " + JSON.stringify(f.errors)); writeFileSync(join(outDir, "output/tables/grunfeld_" + fam + ".md"), f.output, "utf8"); }
    const pf = readJson(join(outDir, "panel_fe.json")); const mc = readJson(join(outDir, "multcomp.json")); const est = readJson(join(outDir, "estimates.json"));
    const impls = {}; for (const [c, r] of Object.entries(preflight.capabilities)) impls[c] = r.selected_implementation?.id || null;
    const rec = { study_id: study.study_id, run_mode: study.execution_context.mode, env_probe: { node: envObj.runtimes.node.version, python: envObj.runtimes.python.version, r: envObj.runtimes.r.version, stata: envObj.runtimes.stata.version, stata_reghdfe: envObj.runtimes.stata.packages?.reghdfe?.available }, director: directive.status, selected_capabilities: study.selected_capabilities, resolved_implementations: impls, role_stages: { data: "accepted", empirical: "completed" }, source_dataset_checksum: pf.dataset_checksum, data_acceptance: readJson(join(outDir, "data_acceptance.json")).accepted, empirical_results: { panel_fe: { implementation_id: pf.implementation_id, n: pf.n, coefficients: pf.coefficients, std_errors: pf.std_errors }, multcomp: { implementation_id: mc.implementation_id, holm: mc.adjusted.holm }, estimates: { implementation_id: est.implementation_id } }, bundle_validation: "valid", presentation_outputs: ["grunfeld_estimates.md","grunfeld_descriptive_facts.md","grunfeld_diagnostics.md","grunfeld_model_registry.md"].map((f) => ({ file: f, sha256: sha256File(join(outDir, "output/tables/" + f)) })), fresh_vs_frozen: "definition_compatible", overall: "completed" };
    writeFileSync(join(outDir, "execution_record.json"), JSON.stringify(rec, null, 2) + "\n", "utf8");
  }
  return { outDir, stage };
}

export function phase1Preflight(studyPath = STUDY, envOverride = null) {
  const study = readJson(resolveStudyPath(studyPath));
  const registry = loadRegistry(join(root, "domains/economics/capabilities"));
  const directive = evaluateStudyDesign(study, registry);
  const envObj = envOverride || probeEnv();
  const preflight = resolveCaps(study, envObj);
  return { study, director: directive, preflight, envObj };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) { const info = await runPhase1(STAGE, OUT_DIR); console.log(JSON.stringify({ outDir: OUT_DIR, stage: STAGE, ok: true }, null, 2)); }
