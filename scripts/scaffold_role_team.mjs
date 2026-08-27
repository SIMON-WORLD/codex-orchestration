#!/usr/bin/env node
// v1.2 兼容入口：委托给 core/scaffold_role_team.mjs。
// 规则：
// 1) 仅当检测到 v1.2 legacy 领域字段（meta.journal / meta.toolchain / meta.output_profile）并因此自动路由 --domain economics 时，
//    才添加 compatibility_mode=legacy_v1_2 + legacy_warning；纯通用 roles.json 不会被误标。
// 2) 无论是否兼容路径，都把 v1.2 的 meta.journal 翻译成通用的 --output-profile，保证老 CLI 行为不变。
// 3) 显式 --domain 走 v1.3 严格路径，不自动打 legacy 标记。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "core", "scaffold_role_team.mjs");
const argv = process.argv.slice(2);

// 注意：此处的入参不带前导 "--"（函数内部会拼 "--"）。
function arg(name) { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : undefined; }
function has(name) { return argv.includes("--" + name); }

const explicitDomain = has("domain");
let meta = null;
const rolesFile = arg("roles");
if (rolesFile) {
  try { meta = (JSON.parse(readFileSync(rolesFile, "utf8")) || {}).meta || {}; } catch (e) { /* 交给 core 报错 */ }
}

const hasLegacyField = meta && (meta.journal !== undefined || meta.toolchain !== undefined || meta.output_profile !== undefined);
let autoRouted = false;

// 未显式 --domain 且检测到 legacy 领域字段 → 自动路由 economics
if (!explicitDomain && hasLegacyField) {
  argv.push("--domain", "economics");
  autoRouted = true;
}

// 把 v1.2 的 meta.journal 翻译成通用的 --output-profile（老 CLI 行为不变）
if (meta && meta.journal !== undefined && arg("output-profile") === undefined) {
  argv.push("--output-profile", String(meta.journal));
}

// 只有"自动路由到 economics"才标记为 v1.2 兼容；纯通用不标
if (autoRouted) {
  if (!has("compat-mode")) argv.push("--compat-mode");
  if (arg("legacy-warning") === undefined) {
    argv.push("--legacy-warning", "v1.2 compatibility mode: not production-verified; use --domain economics for strict v1.3 policy");
  }
}

const res = spawnSync(process.execPath, [core, ...argv], { stdio: "inherit" });
process.exit(res.status === null ? 1 : res.status);
