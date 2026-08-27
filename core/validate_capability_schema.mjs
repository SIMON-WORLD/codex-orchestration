#!/usr/bin/env node
// 确定性 Capability schema 校验（不依赖外部 validator 依赖）。
// 只允许 environment_requirements 在 implementation 层；scientific_preconditions 限定 machine/manual；
// verification_status / risk_level / fallback_policy / kind 严格 enum；不允许手工 setting maturity。
import { readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const RISK = ["low", "medium", "high"];
const STATUS = ["reference", "experimental", "tested", "verified", "deprecated"];
const KIND = ["tool", "skill", "workflow", "script"];
const FALLBACK = ["allow", "recorded", "needs_decision", "hard_stop"];

function errs(cap) {
  const out = [];
  if (!cap || typeof cap !== "object") return ["capability 必须是对象"];
  if (!cap.id || typeof cap.id !== "string") out.push("id 缺失/非字符串");
  if (!cap.domain || typeof cap.domain !== "string") out.push("domain 缺失/非字符串");
  if (!cap.description || typeof cap.description !== "string") out.push("description 缺失/非字符串");
  if (!RISK.includes(cap.risk_level)) out.push(`risk_level 非法：${cap.risk_level}（应为 ${RISK.join("/")}）`);
  if (cap.environment_requirements !== undefined) out.push("capability 层不允许 environment_requirements（必须位于 implementation）");
  if (cap.maturity !== undefined) out.push("capability 层不允许手工设置 maturity（必须是派生值）");
  const meth = cap.methodology;
  if (!meth || typeof meth !== "object") out.push("methodology 缺失/非对象");
  else { if (meth.references !== undefined && (!Array.isArray(meth.references))) out.push("methodology.references 非数组"); }

  const impls = cap.implementations;
  if (!Array.isArray(impls) || impls.length === 0) out.push("implementations 缺失/为空");
  else {
    impls.forEach((i, idx) => {
      const tag = `implementations[${idx}]`;
      if (!i || typeof i !== "object") { out.push(`${tag} 非对象`); return; }
      if (!i.id || typeof i.id !== "string") out.push(`${tag}.id 缺失`);
      if (!KIND.includes(i.kind)) out.push(`${tag}.kind 非法：${i.kind}（应为 ${KIND.join("/")}）`);
      if (!i.runtime || typeof i.runtime !== "string") out.push(`${tag}.runtime 缺失`);
      if (!STATUS.includes(i.verification_status)) out.push(`${tag}.verification_status 非法：${i.verification_status}`);
      if (i.environment_requirements === undefined || typeof i.environment_requirements !== "object") out.push(`${tag}.environment_requirements 缺失/非对象`);
      const v = i.verification;
      if (!v || typeof v !== "object" || !("evidence" in v) || !("benchmark_ref" in v)) out.push(`${tag}.verification 需含 evidence + benchmark_ref`);
      if (Array.isArray(i.verification_status) || !STATUS.includes(i.verification_status)) { /* already above */ }
    });
  }

  const pre = cap.scientific_preconditions;
  if (pre !== undefined) {
    if (!Array.isArray(pre)) out.push("scientific_preconditions 非数组");
    else pre.forEach((p, idx) => {
      const tag = `scientific_preconditions[${idx}]`;
      if (!p || typeof p !== "object") { out.push(`${tag} 非对象`); return; }
      if (p.kind === "machine") {
        if (!p.field || typeof p.field !== "string") out.push(`${tag}.field 缺失`);
        if (p.required_value === undefined) out.push(`${tag}.required_value 缺失`);
        if (p.on_missing !== undefined && !["needs_decision", "blocked"].includes(p.on_missing)) out.push(`${tag}.on_missing 非法`);
        if (p.on_mismatch !== undefined && !["needs_decision", "blocked"].includes(p.on_mismatch)) out.push(`${tag}.on_mismatch 非法`);
      } else if (p.kind === "manual") {
        if (!p.label || typeof p.label !== "string") out.push(`${tag}.label 缺失`);
      } else { out.push(`${tag}.kind 非法：${p.kind}（必须 machine/manual）`); }
    });
  }
  const dr = cap.decision_requirements;
  if (dr !== undefined) { if (!Array.isArray(dr) || !dr.every((x) => typeof x === "string")) out.push("decision_requirements 必须是字符串数组"); }
  if (!FALLBACK.includes(cap.fallback_policy)) out.push(`fallback_policy 非法：${cap.fallback_policy}（应为 ${FALLBACK.join("/")}）`);
  return out;
}

function validateDir(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json").sort();
  const report = [];
  for (const f of files) {
    let cap; try { cap = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch (e) { report.push({ file: f, errors: [`JSON 解析失败：${e.message}`] }); continue; }
    const e = errs(cap);
    if (e.length) report.push({ file: f, errors: e });
  }
  return report;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const dir = process.argv.indexOf("--dir") >= 0 ? process.argv[process.argv.indexOf("--dir") + 1] : join(root, "domains", "economics", "capabilities");
  const report = validateDir(dir);
  if (report.length === 0) { console.log("OK: capability schema 全部合法"); }
  else { console.error("Capability schema 校验失败："); for (const r of report) { console.error(`  ${r.file}:`); for (const e of r.errors) console.error(`    - ${e}`); } process.exit(1); }
}

export { errs as validateCapability, validateDir };
