#!/usr/bin/env node
// 确定性 presentation TABLE renderer v1（Economics-domain）。
// 只渲染「派生视图」：从一个已通过 presentation provenance binding 校验的 bundle 中，
// 按 presentation_manifest 的 table view 引用 estimates 的 estimate_id，读其字段并渲染 Markdown。
// 绝不接受 renderer 命令行/配置直接传入的科学数值；绝不重算 estimand/统计量。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateArtifacts } from "../../../core/validate_artifacts.mjs";
import { CANONICAL_HASH_MODE } from "../../../core/artifact_hash.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const FILES = ["data_manifest.json","variable_dictionary.json","sample_flow.json","descriptive_facts.json","model_registry.json","estimates.json","diagnostics.json","replication_stamp.json","artifact_manifest.json","multiple_testing.json","presentation_manifest.json"];

export function loadBundle(dir) {
  const bundle = {}, paths = {};
  for (const name of FILES) {
    const full = join(dir, name);
    let obj = null; try { obj = JSON.parse(readFileSync(full, "utf8")); } catch {}
    const key = name.replace(".json", "");
    bundle[key] = obj;
    if (obj) paths[key] = full;
  }
  return { bundle, paths };
}

// 确定性格式化规则：numeric -> toFixed(4)（estimate/std_error/p_value），n 保持整数原样。
function fmtNum(v, places = 4) { return Number.isFinite(v) ? Number(v).toFixed(places) : String(v); }
function fmtInt(v) { return Number.isInteger(v) ? String(v) : String(v); }

export function renderTableMarkdown(rows) {
  const header = "| term | estimate | std_error | p_value | n |";
  const sep = "|---|---|---|---|---|";
  const lines = [header, sep];
  for (const r of rows) lines.push(`| ${r.term} | ${fmtNum(r.estimate)} | ${fmtNum(r.std_error)} | ${fmtNum(r.p_value)} | ${fmtInt(r.n)} |`);
  return lines.join("\n") + "\n";
}

// 从 presentation_manifest 的 table view 收集 estimates 行（仅支持 estimates + 显式 estimate_id）。
export function collectTableEstimateRows(bundle, viewId) {
  const pm = bundle.presentation_manifest;
  if (!pm) throw new Error("presentation_manifest 缺失");
  if (!Array.isArray(pm.views)) throw new Error("presentation_manifest.views 非数组");
  const view = viewId ? pm.views.find((v) => v.view_id === viewId) : pm.views.find((v) => v.view_type === "table");
  if (!view) throw new Error(viewId ? `view ${viewId} 不存在` : "没有 table view");
  if (view.view_type !== "table") throw new Error(`view ${view.view_id} 不是 table`);
  if (!Array.isArray(view.source_refs) || view.source_refs.length === 0) throw new Error(`view ${view.view_id} source_refs 为空`);
  const estArtifactId = bundle.estimates?.artifact_id;
  const estimateIds = [];
  for (const ref of view.source_refs) {
    if (ref.artifact_id === estArtifactId) {
      if (!Array.isArray(ref.item_ids) || ref.item_ids.length === 0) throw new Error(`estimates source_ref 需要 item_ids (${ref.artifact_id})`);
      for (const id of ref.item_ids) estimateIds.push(id);
    }
  }
  if (estimateIds.length === 0) throw new Error("没有 estimates 来源");
  const estRows = bundle.estimates?.estimates || [];
  const map = new Map(estRows.map((e) => [e.estimate_id, e]));
  const rows = [];
  for (const id of estimateIds) {
    const e = map.get(id);
    if (!e) throw new Error(`estimate_id ${id} 不存在`);
    rows.push({ term: e.term, estimate: e.estimate, std_error: e.std_error, p_value: e.p_value, n: e.n });
  }
  return { view, rows };
}

// Provenance gate：复用 core 的 presentation 校验（结构 + source_refs + item_id + canonical hash）。
export function renderValidated(bundle, paths, opts = {}) {
  const errs = validateArtifacts(bundle, paths);
  if (errs.length) return { ok: false, errors: errs };
  try {
    const { rows } = collectTableEstimateRows(bundle, opts.viewId);
    return { ok: true, output: renderTableMarkdown(rows) };
  } catch (e) {
    return { ok: false, errors: [e.message] };
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const arg = (n) => { const i = process.argv.indexOf("--" + n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const bundleDir = arg("bundle");
  if (!bundleDir) { console.error("用法：node domains/economics/presentation/render_table.mjs --bundle <dir> [--view <id>] [--out <path>]"); process.exit(2); }
  const dir = isAbsolute(bundleDir) ? bundleDir : join(process.cwd(), bundleDir);
  const { bundle, paths } = loadBundle(dir);
  const res = renderValidated(bundle, paths, { viewId: arg("view") });
  if (!res.ok) { console.error("render FAIL：" + res.errors.join("; ")); process.exit(1); }
  const out = arg("out");
  if (out) writeFileSync(isAbsolute(out) ? out : join(process.cwd(), out), res.output, "utf8");
  else process.stdout.write(res.output);
}

export { CANONICAL_HASH_MODE };

