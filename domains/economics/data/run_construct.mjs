#!/usr/bin/env node
// Economics construct v1 - Node runner (Domain-level). Delegates the actual pandas construction to
// construct_pandas.py (data.construct.python.pandas) and returns the machine-readable result.
// Used to generate frozen benchmark evidence locally. CI tests use the committed evidence + the
// deterministic Node plan validator (validate_construct_plan.mjs), NOT a live python subprocess.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateConstructPlan, canonicalConstructPlanHash } from "./validate_construct_plan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const PY = join(ROOT, "role-team-out/p7-venv/Scripts/python.exe");
const CONSTRUCT_PY = join(HERE, "construct_pandas.py");
function arg(name, def) { const i = process.argv.indexOf("--" + name); return i >= 0 ? process.argv[i + 1] : def; }
function resolvePath(p) { return isAbsolute(p) ? p : join(ROOT, p); }
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

export function runConstruct(planPath, opts = {}) {
  const plan = readJson(resolvePath(planPath));
  const errs = validateConstructPlan(plan);
  if (errs.length > 0) throw new Error("invalid construct plan: " + errs.join("; "));
  const planHash = canonicalConstructPlanHash(plan);
  const planAbs = resolvePath(planPath);
  const srcDir = join(dirname(planAbs), "sources");
  const inDir = opts.inDir || (existsSync(srcDir) ? srcDir : dirname(planAbs));
  const outDir = opts.outDir || join(ROOT, "role-team-out/phase3_construct_run");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, plan.output.file);
  const logPath = join(outDir, "construct_execution_log.json");
  const py = opts.python || (existsSync(PY) ? PY : (existsSync("python") ? "python" : "python3"));
  const res = spawnSync(py, [CONSTRUCT_PY, resolvePath(planPath), inDir, outPath, logPath], { encoding: "utf8", timeout: 120000, windowsHide: true });
  let log = null; try { log = readJson(logPath); } catch {}
  if (res.status !== 0) return { ok: false, error: (res.stderr || res.stdout || "python failed").slice(0, 500), plan: { plan_id: plan.plan_id, plan_hash: planHash }, execution_log: log };
  return { ok: log.overall === "completed", plan: { plan_id: plan.plan_id, plan_hash: planHash }, execution_log: log, output: { path: outPath, sha256: log.output_sha256 } };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const planPath = arg("plan", "domains/economics/benchmarks/data_construct/plan.json");
  const outDir = arg("out-dir", join(ROOT, "role-team-out/phase3_construct_run"));
  const out = runConstruct(planPath, { outDir });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}