#!/usr/bin/env node
// Data Validation Pack v1 Stata runner wrapper (base Stata) - parameterized, fresh-output gated.
// Deletes stale raw; requires this run to BOTH succeed AND produce a fresh raw.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..", "..");
const DO = join(here, "run_stata.do");
const DV = join(root, "domains/economics/benchmarks/data_validation");
const DEFAULT_RULES = join(DV, "rules.json");
function arg(name, def){ const i=process.argv.indexOf("--"+name); return i>=0?process.argv[i+1]:def; }

export function requireFreshStataOutput(procStatusOk, rawExistsAfter) {
  if (procStatusOk !== true || rawExistsAfter !== true) {
    throw new Error(`Stata fresh-run gate failed (procStatusOk=${procStatusOk}, rawExistsAfter=${rawExistsAfter})`);
  }
}
function kv(rawText) {
  const o = {};
  for (const line of rawText.split(/\r?\n/)) { const m = line.match(/^([^=]+)=(.+)$/); if (m) o[m[1].trim()] = m[2].trim(); }
  return o;
}
const num = (o, k) => { const x = Number(o[k]); return Number.isFinite(x) ? x : null; };
export function buildStataValidationFromRaw(rawText, rules, benchmarkId = "grunfeld_data_validation_v1") {
  const o = kv(rawText);
  const n = num(o, "n");
  if (n === null) throw new Error("Stata raw incomplete: missing n");
  const st = (id, name, status, value) => ({ check_id: id, name, status, value });
  const expected_n = parseInt(o.expected_n, 10);
  const checks = [
    st("DV_ROWCOUNT", "observation count matches expected", o.DV_ROWCOUNT, { observed: n, expected: expected_n }),
    st("DV_VAR_PRESENT", "required variables present", o.DV_VAR_PRESENT, { missing: (o.missing_vars || "").trim() ? o.missing_vars.trim().split(/\s+/) : [] }),
    st("DV_VAR_TYPE", "declared variable types match", o.DV_VAR_TYPE, { mismatches: (o.type_mismatches || "").trim() ? o.type_mismatches.trim().split(/\s+/) : [] }),
    st("DV_KEY_UNIQUE", "declared key unique", o.DV_KEY_UNIQUE, { key: rules.unit_key, n, n_unique: num(o, "n_unique"), duplicate_count: num(o, "dup_count") }),
    st("DV_MISSINGNESS", "selected-variable missingness within expectation", o.DV_MISSINGNESS, { missing_vars: (o.missing_vars || "").trim() ? o.missing_vars.trim().split(/\s+/) : [] }),
    st("DV_SAMPLE_FLOW", "sample-flow arithmetic consistent", o.DV_SAMPLE_FLOW, { final_n: n, expected: expected_n }),
    st("DV_MERGE_CARDINALITY", "merge cardinality", o.DV_MERGE_CARDINALITY || "not_applicable", { reason: "single frozen dataset; no merge declared" }),
  ];
  const fail = Number(o.summary_fail || 0), pass = Number(o.summary_pass || 0);
  return {
    implementation_id: "data.val.stata",
    runtime_version: o.stata_version || "Stata 19.5",
    package_version: "base Stata",
    benchmark_id: benchmarkId,
    capability_id: "economics.data.validation",
    dataset_checksum: rules.dataset_checksum,
    dataset_path: "grunfeld.csv",
    rules: { rules_id: rules.rules_id, unit_key: rules.unit_key, expected_n },
    n,
    checks,
    summary: { pass, fail, not_applicable: 1 },
    facts: { observation_count: n },
    no_auto_repair: true,
    note: "Read-only base-Stata structural validation. Does NOT delete rows, impute, recode, or repair data.",
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const csv = arg("csv", join(root, "domains/economics/benchmarks/panel_fe/grunfeld.csv"));
  const raw = arg("raw", join(DV, "results/stata_raw.txt"));
  const out = arg("out", join(DV, "results/stata.json"));
  const rulesPath = arg("rules", DEFAULT_RULES);
  const benchId = arg("benchmark-id", "grunfeld_data_validation_v1");
  const exe = process.env.STATA_EXE || "D:\\Software\\Stata\\StataNow19\\StataMP-64.exe";
  try { unlinkSync(raw); } catch {}
  const r = spawnSync(exe, ["/e", "do", DO, csv, raw], { encoding: "utf8", timeout: 120000, windowsHide: true });
  requireFreshStataOutput(r.status === 0, existsSync(raw));
  const rules = JSON.parse(readFileSync(rulesPath, "utf8"));
  const result = buildStataValidationFromRaw(readFileSync(raw, "utf8"), rules, benchId);
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(result, null, 2));
}
