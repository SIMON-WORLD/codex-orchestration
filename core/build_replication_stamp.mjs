#!/usr/bin/env node
// Deterministic replication_stamp builder（领域无关）。
// stamp 中的统计数字只能来自 estimates.json；builder 不做任何 LLM 调用/人工输入。
// CLI: node core/build_replication_stamp.mjs --models model_registry.json --estimates estimates.json [--diagnostics diagnostics.json] --out replication_stamp.json
import { hashCanonicalJsonFile, CANONICAL_HASH_MODE } from "./artifact_hash.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function stableSort(arr) { return [...arr].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); }
function arg(name) { const i = process.argv.indexOf("--" + name); return i >= 0 ? process.argv[i + 1] : undefined; }
function read(p) { return JSON.parse(readFileSync(p, "utf8")); }

// 纯函数：同样输入（models/estimates/sourceHashes）必须得到同样输出。
export function buildReplicationStamp(models, estimates, sourceHashes) {
  const byModel = {};
  for (const m of models) byModel[m.model_id] = [];
  for (const e of estimates) (byModel[e.model_id] || (byModel[e.model_id] = [])).push(e);
  const modelsSection = stableSort(models.map((m) => m.model_id)).map((id) => {
    const m = models.find((x) => x.model_id === id);
    const esSorted = [...(byModel[id] || [])].sort((a, b) => (a.estimate_id < b.estimate_id ? -1 : a.estimate_id > b.estimate_id ? 1 : 0));
    return {
      model_id: id,
      n: m.n,
      estimate_ids: esSorted.map((e) => e.estimate_id),
      critical_estimates: esSorted.map((e) => ({ estimate_id: e.estimate_id, term: e.term, estimate: e.estimate, std_error: e.std_error })),
    };
  });
  return {
    schema_version: "1.0",
    model_count: models.length,
    estimate_count: estimates.length,
    model_ids: stableSort(models.map((m) => m.model_id)),
    estimate_ids: stableSort(estimates.map((e) => e.estimate_id)),
    models: modelsSection,
    source_hashes: sourceHashes,
    source_hash_mode: CANONICAL_HASH_MODE,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const mPath = arg("models"), ePath = arg("estimates"), dPath = arg("diagnostics"), out = arg("out");
  if (!mPath || !ePath || !out) { console.error("用法：node core/build_replication_stamp.mjs --models <m.json> --estimates <e.json> [--diagnostics <d.json>] --out <stamp.json>"); process.exit(2); }
  const models = read(mPath).models, estimates = read(ePath).estimates;
  const sourceHashes = { model_registry: hashCanonicalJsonFile(mPath), estimates: hashCanonicalJsonFile(ePath) };
  if (dPath) sourceHashes.diagnostics = hashCanonicalJsonFile(dPath);
  const stamp = buildReplicationStamp(models, estimates, sourceHashes);
  writeFileSync(out, JSON.stringify(stamp, null, 2) + "\n", "utf8");
  console.log(`written ${out}（models=${stamp.model_count} estimates=${stamp.estimate_count}）`);
}


