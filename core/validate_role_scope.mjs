#!/usr/bin/env node
// Role ↔ Capability scope 校验（最小 deterministic，不复杂权限引擎）。
// Role.capability_scope 表示允许范围；selected_capabilities 必须属于 role scope。
import { readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function matchesScope(capId, pattern) {
  if (!pattern) return false;
  if (pattern.endsWith(".*")) return String(capId).startsWith(pattern.slice(0, -1)); // 如 economics.literature.
  return capId === pattern;
}
function inScope(capId, scope) {
  return (scope || []).some((p) => matchesScope(capId, p));
}

function validateRoles(roles) {
  const errs = [];
  if (!Array.isArray(roles)) return ["roles 必须是数组"];
  roles.forEach((r, i) => {
    const tag = `roles[${i}]`;
    if (!r || typeof r !== "object") { errs.push(`${tag} 非对象`); return; }
    if (!r.id || typeof r.id !== "string") errs.push(`${tag}.id 缺失`);
    if (!r.name || typeof r.name !== "string") errs.push(`${tag}.name 缺失`);
    if (!Array.isArray(r.responsibility) || !r.responsibility.length) errs.push(`${tag}.responsibility 缺失/为空`);
    if (!r.authority || typeof r.authority !== "object") errs.push(`${tag}.authority 缺失/非对象`);
    else {
      if (r.authority.may_decide !== undefined && !Array.isArray(r.authority.may_decide)) errs.push(`${tag}.authority.may_decide 非数组`);
      if (r.authority.must_escalate !== undefined && !Array.isArray(r.authority.must_escalate)) errs.push(`${tag}.authority.must_escalate 非数组`);
    }
    if (!Array.isArray(r.capability_scope)) errs.push(`${tag}.capability_scope 缺失/非数组`);
    for (const k of ["inputs", "outputs", "depends_on", "escalation_rules"]) {
      if (r[k] !== undefined && !Array.isArray(r[k])) errs.push(`${tag}.${k} 非数组`);
    }
    if (r.prompt !== undefined) errs.push(`${tag}.prompt 属于 v1.2；v1.3 role 不应含 prompt`);
    for (const k of ["methodology", "toolchain", "journal", "policy"]) {
      if (r[k] !== undefined) errs.push(`${tag}.${k} 属于 v1.2，已在 v1.3 role 中移除`);
    }
  });
  return errs;
}

function validateSelectedCapabilities(study, roles, registry) {
  const errs = [];
  const byId = new Map((roles || []).map((r) => [r.id, r]));
  const selected = study?.selected_capabilities || {};
  for (const [roleId, capIds] of Object.entries(selected)) {
    const role = byId.get(roleId);
    if (!role) { errs.push(`unknown role in selected_capabilities: ${roleId}`); continue; }
    if (!Array.isArray(capIds)) { errs.push(`selected_capabilities.${roleId} 必须是数组`); continue; }
    if (capIds.length === 0) continue;
    if ((role.capability_scope || []).length === 0) { errs.push(`capability_scope 为空但 selected capability: ${roleId} -> ${capIds.join(",")}`); continue; }
    for (const capId of capIds) {
      if (registry && !registry[capId]) { errs.push(`unknown capability: ${capId}`); continue; }
      if (!inScope(capId, role.capability_scope)) { errs.push(`capability ${capId} 不属于 role ${roleId} 的 capability_scope`); }
    }
  }
  return errs;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const rolesFile = (() => { const i = process.argv.indexOf("--roles"); return i >= 0 ? process.argv[i + 1] : join(root, "domains", "economics", "roles.json"); })();
  const roles = JSON.parse(readFileSync(rolesFile, "utf8"));
  const errs = validateRoles(roles.roles);
  if (errs.length) { console.error("Role schema 校验失败：" + errs.join("\n  - ")); process.exit(1); }
  console.log("OK: domains/economics/roles.json role schema 合法");
}

export { matchesScope, inScope, validateRoles, validateSelectedCapabilities };
