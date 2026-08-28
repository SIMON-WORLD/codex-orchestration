#!/usr/bin/env node
// 领域专属（economics）Issue #5 regression fixture 的 panel_attrition 确定性生成器。
// 该算法表述“从 source 正确计算 panel_attrition”，属 Economics benchmark，不属于通用 Core。
// 禁止 LLM/手填结果；同一输入必须得到同一输出。Core 不读取此文件，也不认识 panel_attrition。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split(",").map((c) => c.trim());
    const o = {}; header.forEach((h, i) => (o[h] = cells[i]));
    return o;
  });
}
export function computeDescriptiveFacts(rows) {
  const n = rows.length;
  const attr = rows.filter((r) => Number(r.panel_attrition) === 1).length;
  const share = n === 0 ? 0 : attr / n;
  const ref = "domains/economics/benchmarks/issue5/compute_panel_attrition_facts.mjs";
  return {
    artifact_id: "DESC_FACTS_ISSUE5",
    artifact_type: "descriptive_facts",
    schema_version: "1.0",
    producer_role: "data",
    producer_task_id: "task_issue5",
    created_at: "fixed",
    inputs: ["DATA_MANIFEST_ISSUE5"],
    code_ref: ref,
    facts: [
      { fact_id: "FACT_PANEL_ATTRITION_RATE", name: "panel_attrition_rate", value: share, unit: "share", sample_id: "DATASET_ISSUE5", source_data_ref: "panel.csv", computation_ref: ref },
      { fact_id: "FACT_PANEL_ATTRITION_COUNT", name: "panel_attrition_count", value: attr, unit: "count", sample_id: "DATASET_ISSUE5", source_data_ref: "panel.csv", computation_ref: ref },
    ],
  };
}
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const csv = (() => { const i = process.argv.indexOf("--csv"); return i >= 0 ? process.argv[i + 1] : undefined; })();
  const out = (() => { const i = process.argv.indexOf("--out"); return i >= 0 ? process.argv[i + 1] : undefined; })();
  if (!csv || !out) { console.error("用法：node domains/economics/benchmarks/issue5/compute_panel_attrition_facts.mjs --csv panel.csv --out descriptive_facts.json"); process.exit(2); }
  const rows = parseCsv(readFileSync(csv, "utf8"));
  const facts = computeDescriptiveFacts(rows);
  writeFileSync(out, JSON.stringify(facts, null, 2) + "\n", "utf8");
  console.log(`written ${out}: n=${rows.length} share=${facts.facts[0].value}`);
}
