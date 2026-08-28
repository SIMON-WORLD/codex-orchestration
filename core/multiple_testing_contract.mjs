#!/usr/bin/env node
// Minimal multiple-testing family contract（领域无关）。只验证 family membership completeness，
// 不实现统计方法正确性（Holm 数值正确性属 capability benchmark / P7）。
// 规则：estimate 若声明 multiple_testing_family_ids=[F]，则该 estimate_id 必须出现在 F.member_estimate_ids，
//       且 F.adjusted_results 覆盖全部 member；member 必须存在且不重复。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function validateMultipleTesting(estimates, mt) {
  const errs = [];
  if (!mt || Array.isArray(mt)) { errs.push("multiple_testing: 必须是对象"); return errs; }
  if (mt.artifact_type !== "multiple_testing") errs.push(`multiple_testing: artifact_type 应为 multiple_testing，实际 ${mt.artifact_type}`);
  for (const f of mt.families || []) {
    if (!f || !f.family_id) { errs.push("multiple_testing: family 缺 family_id"); continue; }
    const id = f.family_id;
    const seen = new Set();
    for (const eid of f.member_estimate_ids || []) {
      if (seen.has(eid)) errs.push(`multiple_testing: ${id} 重复 member ${eid}`);
      seen.add(eid);
      if (!estimates.some((e) => e.estimate_id === eid)) errs.push(`multiple_testing: ${id} member ${eid} 未知 estimate`);
    }
    const adjustIds = (f.adjusted_results || []).map((a) => a.estimate_id);
    for (const eid of f.member_estimate_ids || []) if (!adjustIds.includes(eid)) errs.push(`multiple_testing: ${id} adjusted_results 未覆盖 member ${eid}`);
  }
  const famMap = new Map((mt.families || []).map((f) => [f.family_id, f]));
  for (const e of estimates) {
    for (const fid of e.multiple_testing_family_ids || []) {
      const f = famMap.get(fid);
      if (!f) { errs.push(`multiple_testing: estimate ${e.estimate_id} 引用未知 family ${fid}`); continue; }
      if (!(f.member_estimate_ids || []).includes(e.estimate_id)) errs.push(`multiple_testing: estimate ${e.estimate_id} 声明 ${fid} 但不在 member_estimate_ids（family 漏规格）`);
      if (!(f.adjusted_results || []).some((a) => a.estimate_id === e.estimate_id)) errs.push(`multiple_testing: estimate ${e.estimate_id} 声明 ${fid} 但 adjusted_results 未覆盖`);
    }
  }
  return errs;
}
