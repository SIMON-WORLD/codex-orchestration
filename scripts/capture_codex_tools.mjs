#!/usr/bin/env node
// 自动捕获本机 Codex 会话中记录的真实 codex_app / plugin_management 工具清单。
// 输入: ~/.codex/sessions/**/*.jsonl、~/.codex/archived_sessions/**/*.jsonl（新->旧，最多近30天）
//       data/category_map.json (可选，工具->分类覆盖)
//       data/codex_app_tools.override.json (可选，额外补充，如 dynamic_tools 未记录但模型可见的工具)
// 输出: data/codex_app_tools.json (保持 emit_tool_inventory.mjs 读取的 schema)
// 说明: 单条会话 dynamic_tools 可能不全，因此跨多个会话取“并集”；再合并 override 得到完整集。
// 用法: node scripts/capture_codex_tools.mjs [--dry-run]
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argSet = new Set(process.argv.slice(2));
const DRY_RUN = argSet.has("--dry-run");
const MAX_FILES = 200;
const WINDOW_DAYS = 30;

const codexHome = join(homedir(), ".codex");
const scanDirs = [join(codexHome, "sessions"), join(codexHome, "archived_sessions")];

const CATEGORY_LABELS = {
  orchestration: "会话/任务编排（主导者派发核心）",
  organization: "会话组织与展示",
  automation: "定时/自动化/托管",
  misc: "应用/运行时/杂项",
};

function classify(name, categoryMap, overrideCategory) {
  if (overrideCategory && overrideCategory[name]) return overrideCategory[name];
  if (categoryMap && categoryMap[name]) return categoryMap[name];
  if (/^(create_thread|send_message_to_thread|wait_threads|read_thread|list_threads|list_archived_threads|fork_thread|handoff_thread|get_handoff_status)$/.test(name)) return "orchestration";
  if (/^(set_thread_|navigate_to_codex_page|open_in_codex|share_thread)/.test(name)) return "organization";
  if (/^automation_update$/.test(name)) return "automation";
  return "misc";
}

function collectJsonlFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function mtime(f) { try { return statSync(f).mtimeMs; } catch { return 0; } }

function readDynamicTools(file) {
  let raw;
  try { raw = readFileSync(file, "utf8"); } catch { return null; }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.includes('"type":"session_meta"')) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    const dt = j?.payload?.dynamic_tools;
    if (Array.isArray(dt)) return dt;
    return null;
  }
  return null;
}

function namespaceTools(dynamicTools, nsName) {
  const ns = dynamicTools.find((x) => x?.type === "namespace" && x?.name === nsName);
  if (!ns) return [];
  const out = [];
  for (const fn of Array.isArray(ns.tools) ? ns.tools : []) {
    if (fn?.type === "function" && typeof fn?.name === "string" && fn.name.trim()) {
      out.push({ name: fn.name, description: typeof fn?.description === "string" ? fn.description : "" });
    }
  }
  return out;
}

let candidates = [];
for (const d of scanDirs) candidates = candidates.concat(collectJsonlFiles(d));
const now = Date.now();
const cutoff = now - WINDOW_DAYS * 24 * 3600 * 1000;
candidates = candidates.filter((f) => mtime(f) >= cutoff).sort((a, b) => mtime(b) - mtime(a)).slice(0, MAX_FILES);

let categoryMap = {};
try { categoryMap = JSON.parse(readFileSync(join(root, "data", "category_map.json"), "utf8")); } catch { categoryMap = {}; }

// override：额外工具（dynamic_tools 未记录但模型可见），并携带分类
let overrides = [];
try {
  const o = JSON.parse(readFileSync(join(root, "data", "codex_app_tools.override.json"), "utf8"));
  if (Array.isArray(o)) overrides = o;
} catch { overrides = []; }
const overrideCategory = {};
for (const o of overrides) if (o?.name && o?.category) overrideCategory[o.name] = o.category;

const byName = new Map();
let sourceFiles = [];
for (const f of candidates) {
  const dt = readDynamicTools(f);
  if (!dt) continue;
  const isCodexApp = dt.some((x) => x?.type === "namespace" && x?.name === "codex_app");
  if (!isCodexApp) continue;
  for (const t of namespaceTools(dt, "codex_app")) {
    if (!byName.has(t.name)) byName.set(t.name, t);
  }
  for (const t of namespaceTools(dt, "plugin_management")) {
    if (!byName.has(t.name)) byName.set(t.name, t);
  }
  sourceFiles.push(f);
}
for (const o of overrides) {
  if (o?.name && !byName.has(o.name)) byName.set(o.name, { name: o.name, description: o.description || "" });
}

if (byName.size === 0) {
  console.error("未找到任何含 codex_app 命名空间的会话文件（近30天内），且 override 为空。");
  process.exit(1);
}

const capturedAt = new Date().toISOString().slice(0, 10);
const tools = [...byName.values()]
  .map(({ name, description }) => ({ name, category: classify(name, categoryMap, overrideCategory), description }))
  .sort((a, b) => a.name.localeCompare(b.name));

const output = {
  _meta: {
    namespace: "codex_app",
    capturedAt,
    capturedFrom: sourceFiles[0] ?? null,
    sourceCount: sourceFiles.length,
    overridesAdded: overrides.length,
    note: "本文件由 scripts/capture_codex_tools.mjs 自动生成（跨会话并集 + override）；工具变化时重跑 capture 并提交结果。",
  },
  categories: CATEGORY_LABELS,
  tools,
};

if (DRY_RUN) {
  console.log(`[dry-run] 来源会话数: ${sourceFiles.length}，override: ${overrides.length}，工具数: ${tools.length}`);
  for (const t of tools) console.log(`  ${t.category.padEnd(14)} ${t.name}`);
} else {
  const outPath = join(root, "data", "codex_app_tools.json");
  writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");
  console.log(`已写入 ${outPath}：${tools.length} 个工具（来自 ${sourceFiles.length} 个会话 + ${overrides.length} 个 override）`);
}
