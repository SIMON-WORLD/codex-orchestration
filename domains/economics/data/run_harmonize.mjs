#!/usr/bin/env node
// Economics harmonize v1 - Node runner (Domain-level). Delegates the actual pandas transformation to
// the Python implementation (data.harmonize.python.pandas) and returns the machine-readable result.
// Used to generate frozen benchmark evidence locally. CI tests use the committed evidence + the
// deterministic Node plan validator (validate_harmonize_plan.mjs), NOT a live python subprocess.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateHarmonizePlan, canonicalHarmonizePlanHash } from "./validate_harmonize_plan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const PY = join(ROOT, "role-team-out/p7-venv/Scripts/python.exe");
const HARMONIZE_PY = join(HERE, "harmonize_pandas.py");

function arg(name, def) { const i = process.argv.indexOf("--" + name); return i >= 0 ? process.argv[i + 1] : def; }
function resolvePath(p) { return isAbsolute(p) ? p : join(ROOT, p); }
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

export function runHarmonize(planPath, opts = {}) {
  const plan = readJson(resolvePath(planPath));
  const errs = validateHarmonizePlan(plan);
  if (errs.length > 0) throw new Error("invalid harmonize plan: " + errs.join("; "));
  const planHash = canonicalHarmonizePlanHash(plan);
  const planAbs = resolvePath(planPath);
  const srcDir = join(dirname(planAbs), "sources");
  const inDir = opts.inDir || (existsSync(srcDir) ? srcDir : dirname(planAbs));
  const outDir = opts.outDir || join(ROOT, "role-team-out/phase3_harmonize_run");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, plan.output.file);
  const logPath = join(outDir, "harmonize_execution_log.json");
  const py = opts.python || (existsSync(PY) ? PY : (existsSync("python") ? "python" : "python3"));
  const res = spawnSync(py, [HARMONIZE_PY, resolvePath(planPath), inDir, outPath, logPath], { encoding: "utf8", timeout: 120000, windowsHide: true });
  if (res.status !== 0) {
    // return structured failure from the log if written, else include stderr
    let log = null; try { log = readJson(logPath); } catch {}
    return { ok: false, error: (res.stderr || res.stdout || "python failed").slice(0, 600), plan: { plan_id: plan.plan_id, plan_hash: planHash }, execution_log: log };
  }
  const log = readJson(logPath);
  const outSha = log.output_sha256;
  return { ok: log.overall === "completed", plan: { plan_id: plan.plan_id, plan_hash: planHash }, execution_log: log, output: { path: outPath, sha256: outSha } };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const planPath = arg("plan", "domains/economics/benchmarks/data_harmonize/plan.json");
  const outDir = arg("out-dir", join(ROOT, "role-team-out/phase3_harmonize_run"));
  const out = runHarmonize(planPath, { outDir });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.ok ? 0 : 1);
}
