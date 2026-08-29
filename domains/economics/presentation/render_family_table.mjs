#!/usr/bin/env node
// 确定性 presentation TABLE renderer（Economics-domain）—— 派生视图引擎，专用于额外 artifact family。
// 从已通过 presentation provenance binding + 完整 bundle 校验的 bundle 中，按 presentation_manifest 的 table view，
// 引用指定 family 的 item_id，读取其字段并渲染 Markdown。绝不接受 renderer 命令行传入的科学数值；
// 绝不重算 estimand/统计量。source artifact 覆盖：
//   - descriptive_facts (facts[] / fact_id)
//   - diagnostics (diagnostics[] / diagnostic_id)
//   - model_registry (models[] / model_id)
// 共享 estimate-table 的 loadBundle，避免重复；不修改已 tested 的 render_table.mjs。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateArtifacts } from "../../../core/validate_artifacts.mjs";
import { CANONICAL_HASH_MODE, canonicalJson } from "../../../core/artifact_hash.mjs";
import { loadBundle } from "./render_table.mjs";

// ---- 确定性标量格式化（保持与 render_table.mjs 一致的数值规则） ----
function fmtNum(v, places = 4) { return Number.isFinite(v) ? Number(v).toFixed(places) : ""; }
function fmtInt(v) { return Number.isInteger(v) ? String(v) : String(v); }
function fmtStr(v) { return v === null || v === undefined ? "" : String(v); }
function fmtVal(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : fmtNum(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  return canonicalJson(v); // array/object -> deterministic canonical
}
function fmtArr(v) { return Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : fmtVal(x))).join(", ") : fmtVal(v); }

// ---- family 配置：精确 source artifact + 支持字段 + 稳定 ID + 列定义 ----
export const FAMILY_CONFIG = {
  descriptive_facts: {
    label: "descriptive facts",
    bundle_key: "descriptive_facts",
    artifact_type: "descriptive_facts",
    list_key: "facts",
    id_field: "fact_id",
    columns: [
      { key: "fact_id", header: "fact_id", fmt: fmtStr },
      { key: "name", header: "name", fmt: fmtStr },
      { key: "value", header: "value", fmt: fmtVal },
      { key: "unit", header: "unit", fmt: fmtStr },
      { key: "sample_id", header: "sample_id", fmt: fmtStr },
    ],
  },
  diagnostics: {
    label: "diagnostics",
    bundle_key: "diagnostics",
    artifact_type: "diagnostics",
    list_key: "diagnostics",
    id_field: "diagnostic_id",
    columns: [
      { key: "diagnostic_id", header: "diagnostic_id", fmt: fmtStr },
      { key: "name", header: "name", fmt: fmtStr },
      { key: "value", header: "value", fmt: fmtVal },
      { key: "method", header: "method", fmt: fmtStr },
      { key: "model_id", header: "model_id", fmt: fmtStr },
    ],
  },
  model_registry: {
    label: "model registry",
    bundle_key: "model_registry",
    artifact_type: "model_registry",
    list_key: "models",
    id_field: "model_id",
    columns: [
      { key: "model_id", header: "model_id", fmt: fmtStr },
      { key: "capability_id", header: "capability_id", fmt: fmtStr },
      { key: "implementation_id", header: "implementation_id", fmt: fmtStr },
      { key: "runtime", header: "runtime", fmt: fmtStr },
      { key: "sample_id", header: "sample_id", fmt: fmtStr },
      { key: "outcome", header: "outcome", fmt: fmtStr },
      { key: "specification", header: "specification", fmt: fmtStr },
      { key: "fixed_effects", header: "fixed_effects", fmt: fmtArr },
      { key: "vcov_spec", header: "vcov_spec", fmt: fmtStr },
      { key: "clustering", header: "clustering", fmt: fmtStr },
      { key: "n", header: "n", fmt: fmtInt },
    ],
  },
};

// 确定性 Markdown 表：header / separator / rows（列顺序固定，值只来自 source artifact）。
export function renderFamilyMarkdown(rows, cfg) {
  const header = "| " + cfg.columns.map((c) => c.header).join(" | ") + " |";
  const sep = "|" + cfg.columns.map(() => "---").join("|") + "|";
  const lines = [header, sep];
  for (const r of rows) lines.push("| " + cfg.columns.map((c) => c.fmt(r[c.key])).join(" | ") + " |");
  return lines.join("\n") + "\n";
}

function pickView(pm, cfg, viewId, artifactId) {
  if (!pm || !Array.isArray(pm.views)) throw new Error("presentation_manifest.views 非数组");
  const referenced = (v) => v.view_type === "table" && Array.isArray(v.source_refs) && v.source_refs.some((r) => r.artifact_id === artifactId);
  if (viewId) {
    const v = pm.views.find((x) => x.view_id === viewId);
    if (!v) throw new Error(`view ${viewId} 不存在`);
    if (v.view_type !== "table") throw new Error(`view ${viewId} 不是 table`);
    return v;
  }
  const v = pm.views.find(referenced);
  if (!v) throw new Error(`没有引用 ${cfg.artifact_type} 的 table view`);
  return v;
}

// 从 presentation_manifest 的 table view 收集指定 family 的行（仅支持该 family + 显式 item_ids）。
export function collectFamilyRows(bundle, familyKey, viewId) {
  const cfg = FAMILY_CONFIG[familyKey];
  if (!cfg) throw new Error(`unknown family ${familyKey}`);
  const pm = bundle.presentation_manifest;
  const artifactId = bundle[cfg.bundle_key]?.artifact_id;
  const view = pickView(pm, cfg, viewId, artifactId);
  const ids = [];
  for (const ref of view.source_refs || []) {
    if (ref.artifact_id === artifactId) {
      if (!Array.isArray(ref.item_ids) || ref.item_ids.length === 0) throw new Error(`${cfg.artifact_type} source_ref 需要 item_ids (${ref.artifact_id})`);
      for (const id of ref.item_ids) ids.push(id);
    }
  }
  if (ids.length === 0) throw new Error(`没有 ${cfg.artifact_type} 来源`);
  const items = bundle[cfg.bundle_key]?.[cfg.list_key] || [];
  const map = new Map(items.map((it) => [it[cfg.id_field], it]));
  const rows = [];
  for (const id of ids) {
    const item = map.get(id);
    if (!item) throw new Error(`${cfg.id_field} ${id} 不存在`);
    rows.push(item);
  }
  return { view, rows };
}

// Provenance gate：复用 core 完整 bundle 校验（结构 + source_refs + item_id + canonical hash + stamp + manifest）。
export function renderValidated(bundle, paths, opts = {}) {
  const errs = validateArtifacts(bundle, paths);
  if (errs.length) return { ok: false, errors: errs };
  try {
    const cfg = FAMILY_CONFIG[opts.family];
    if (!cfg) return { ok: false, errors: [`unknown family ${opts.family}`] };
    const { rows } = collectFamilyRows(bundle, opts.family, opts.viewId);
    return { ok: true, output: renderFamilyMarkdown(rows, cfg) };
  } catch (e) {
    return { ok: false, errors: [e.message] };
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const arg = (n) => { const i = process.argv.indexOf("--" + n); return i >= 0 ? process.argv[i + 1] : undefined; };
  const bundleDir = arg("bundle");
  const family = arg("family");
  if (!bundleDir || !family) { console.error("用法：node domains/economics/presentation/render_family_table.mjs --bundle <dir> --family <descriptive_facts|diagnostics|model_registry> [--view <id>] [--out <path>]"); process.exit(2); }
  const dir = isAbsolute(bundleDir) ? bundleDir : join(process.cwd(), bundleDir);
  const { bundle, paths } = loadBundle(dir);
  const res = renderValidated(bundle, paths, { family, viewId: arg("view") });
  if (!res.ok) { console.error("render FAIL：" + res.errors.join("; ")); process.exit(1); }
  const out = arg("out");
  if (out) writeFileSync(isAbsolute(out) ? out : join(process.cwd(), out), res.output, "utf8");
  else process.stdout.write(res.output);
}

export { CANONICAL_HASH_MODE };
