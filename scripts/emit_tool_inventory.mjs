#!/usr/bin/env node
// 生成 docs/03-tool-reference.md
// 输入: data/codex_app_tools.json (工具定义快照) + data/tool_notes.yaml (人工用法说明)
// 输出: docs/03-tool-reference.md
// 用法: node scripts/emit_tool_inventory.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readJson(rel) {
  const p = join(root, rel);
  return JSON.parse(readFileSync(p, "utf8"));
}

// 解析 tool_notes.yaml 的受限子集：
//   工具名:
//     when: ...
//     example: ...
function parseNotes(yaml) {
  const notes = {};
  let cur = null;
  for (const raw of yaml.split(/\r?\n/)) {
    const line = raw.replace(/\t/g, "  ");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (!line.startsWith(" ") && line.endsWith(":")) {
      cur = line.slice(0, -1).trim();
      notes[cur] = {};
      continue;
    }
    const m = line.match(/^(\s+)(when|example):\s*(.*)$/);
    if (m && cur) notes[cur][m[2]] = m[3].trim().replace(/^["']|["']$/g, "");
  }
  return notes;
}

const meta = readJson("data/codex_app_tools.json");
const categoryLabels = meta.categories || {};
const notes = parseNotes(readFileSync(join(root, "data/tool_notes.yaml"), "utf8"));
const tools = meta.tools || [];

// 校验每个工具条目结构：缺少 name / category 会静默产出错表，直接报错。
for (const t of tools) {
  if (typeof t?.name !== "string" || !t.name.trim()) {
    throw new Error(`工具条目缺少有效的 name：${JSON.stringify(t)}`);
  }
  if (typeof t?.category !== "string" || !t.category.trim()) {
    throw new Error(`工具 "${t.name}" 缺少有效的 category：${JSON.stringify(t)}`);
  }
}
if (tools.length === 0) {
  console.warn("警告：tools 为空数组，将生成空的工具参考。");
}

const byCat = {};
for (const t of tools) (byCat[t.category] ??= []).push(t);

let out = [];
out.push("# codex_app 工具参考");
out.push("");
out.push(`> 本文由 \`scripts/emit_tool_inventory.mjs\` 自动生成（快照时间 ${meta._meta?.capturedAt ?? "未知"}）。工具变化时更新 \`data/codex_app_tools.json\` 与 \`data/tool_notes.yaml\` 后重跑脚本，勿手改本文。`);
out.push("");
out.push("## 分类");
out.push("");
for (const [key, label] of Object.entries(categoryLabels)) {
  const items = byCat[key] || [];
  out.push(`- **${label}**（${items.length}）：${items.map((t) => `\`${t.name}\``).join("、")}`);
}
out.push("");

const catOrder = Object.keys(categoryLabels);
for (const cat of catOrder) {
  const items = byCat[cat];
  if (!items?.length) continue;
  out.push(`## ${categoryLabels[cat]}`);
  out.push("");
  out.push("| 工具 | 作用 | 何时用 | 示例 |");
  out.push("|---|---|---|---|");
  for (const t of items) {
    const n = notes[t.name] || {};
    const esc = (s) => (s || "").replace(/\|/g, "\\|");
    out.push(`| \`${t.name}\` | ${esc(t.description)} | ${esc(n.when || "")} | ${n.example ? "`" + esc(n.example) + "`" : ""} |`);
  }
  out.push("");
}

// 写回生成文件（换行统一为 LF，配合 .gitattributes 保证 Windows 下重新生成后工作区干净）
writeFileSync(join(root, "docs/03-tool-reference.md"), out.join("\n") + "\n", "utf8");
console.log(`生成 docs/03-tool-reference.md：${out.length} 行，${tools.length} 个工具`);
