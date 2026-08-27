#!/usr/bin/env node
// v1.2 兼容入口：委托给 core/scaffold_role_team.mjs。
// 当使用 v1.2 风格的预设（roles 文件含 meta.journal / meta.toolchain）且未显式指定 --domain 时，
// 自动路由到 --domain economics，从而复现 v1.2 的 journal / toolchain 注入；
// 同时记录 compatibility_mode=legacy_v1_2 + legacy_warning，绝不冒充 production-verified。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(root, "core", "scaffold_role_team.mjs");
const argv = process.argv.slice(2);

// 注意：这里 arg/has 的入参不要带前导 "--"（函数内部会拼 "--"）。
function arg(name) { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : undefined; }
function has(name) { return argv.includes("--" + name); }

// 是否由用户显式指定 --domain（区分 v1.3 新路径 vs v1.2 兼容路径）
const explicitDomain = has("domain");

// 若未显式给 --domain，但 roles 文件是带领域字段的预设，则默认 economics（仅为复现 v1.2 的 journal/toolchain 注入）
if (!explicitDomain) {
  const rolesFile = arg("roles");
  if (rolesFile) {
    try {
      const raw = JSON.parse(readFileSync(rolesFile, "utf8"));
      const meta = raw?.meta || {};
      if (meta.journal !== undefined || meta.toolchain !== undefined || meta.output_profile !== undefined) {
        argv.push("--domain", "economics");
      }
    } catch (e) {
      // 解析失败交给 core 去报错
    }
  }
}

// v1.2 兼容路径 = "用户未显式指定 --domain"；显式 --domain 走 v1.3 严格路径，不标 compat
if (!explicitDomain) {
  if (!has("compat-mode")) argv.push("--compat-mode");
  if (arg("legacy-warning") === undefined) {
    argv.push("--legacy-warning", "v1.2 compatibility mode: not production-verified; use --domain economics for strict v1.3 policy");
  }
}

const res = spawnSync(process.execPath, [core, ...argv], { stdio: "inherit" });
process.exit(res.status === null ? 1 : res.status);

