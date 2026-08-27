#!/usr/bin/env node
// 生成机器可读的执行环境快照（供 Capability Resolver/Preflight 使用）。
// 只做探测，不安装任何软件；无法检测的项标记 available:false + known:false（unknown，不猜）。
// 只记录非敏感必要字段（不记录用户名/token/路径）。
// 输出 runtime_instances（同一 runtime 可有多个实例，如 python.system / python.codex，packages 属于具体实例）；
// 另保留 runtimes/packages 旧字段用于兼容（新 resolver 优先 runtime_instances）。
// Codex harness runtime 不硬编码路径 → 由 --env-overlay 由协调者合并。
// 用法: node scripts/probe_env.mjs [--packages csdid,pyfixest] [--r-packages did,fixest] [--env-overlay ov.json] [--out env.json]
import { spawnSync } from "node:child_process";
import { writeFileSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCHEMA_VERSION = "2.0";
const PROBE_VERSION = "2.0";

function arg(name) { const i = process.argv.indexOf("--" + name); return i >= 0 ? process.argv[i + 1] : undefined; }
function hasFlag(name) { return process.argv.includes("--" + name); }
function which(name) {
  const r = spawnSync("where", [name], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (r.status === 0 && r.stdout) return r.stdout.trim().split(/\r?\n/)[0];
  const u = spawnSync("bash", ["-lc", `command -v ${name}`], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (u.status === 0 && u.stdout) return u.stdout.trim();
  return null;
}
function verOf(exe, args, re) {
  const r = spawnSync(exe, args, { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (r.status !== 0 || !r.stdout) return null;
  const m = r.stdout.match(re);
  return m ? m[1] : null;
}
function runtimeInst(name, verArgs, verRe) {
  const exe = which(name);
  if (!exe) return { installed: false };
  const v = verOf(exe, verArgs, verRe);
  return { installed: true, version: v || "unknown" };
}

// OS runtime instances（每个自带 packages）
function detectOsInstances(pyPkgs, rPkgs) {
  const instances = {};
  const nodeInfo = { runtime: "node", provider: "os", available: true, known: true, version: process.version, packages: {} };
  instances["node.system"] = nodeInfo;
  const py = runtimeInst("python", ["--version"], /Python\s+([\d.]+)/);
  if (py.installed) {
    const exe = which("python");
    const packages = {};
    for (const pkg of pyPkgs) {
      const r = spawnSync(exe, ["-c", `import importlib.metadata as m; print(m.version("${pkg}"))`], { encoding: "utf8", windowsHide: true, timeout: 5000 });
      if (r.status !== 0 || !r.stdout.trim()) packages[pkg] = { available: false, known: false, version: null };
      else packages[pkg] = { available: true, known: true, version: r.stdout.trim() };
    }
    instances["python.system"] = { runtime: "python", provider: "os", available: true, known: true, version: py.version, packages };
  }
  const py3 = runtimeInst("python3", ["--version"], /Python\s+([\d.]+)/);
  if (py3.installed && py3.version !== py.version) instances["python3.system"] = { runtime: "python3", provider: "os", available: true, known: true, version: py3.version, packages: {} };
  const rinfo = runtimeInst("Rscript", ["--version"], /R version\s+([\d.]+)/);
  if (rinfo.installed) {
    const exe = which("Rscript");
    const packages = {};
    for (const pkg of rPkgs) {
      const rr = spawnSync(exe, ["-e", `cat(as.character(packageVersion("${pkg}")))`], { encoding: "utf8", windowsHide: true, timeout: 5000 });
      if (rr.status !== 0 || !rr.stdout.trim()) packages[`r:${pkg}`] = { available: false, known: false, version: null };
      else packages[`r:${pkg}`] = { available: true, known: true, version: rr.stdout.trim() };
    }
    instances["r.system"] = { runtime: "r", provider: "os", available: true, known: true, version: rinfo.version, packages };
  }
  const st = runtimeInst("stata-mp", ["-V"], /Stata[\s\S]*?(\d+)/);
  if (st.installed) instances["stata.system"] = { runtime: "stata", provider: "os", available: true, known: true, version: st.version, packages: {} };
  return instances;
}

// resources：扫 skills/workflows，带 source（project/user/codex_system）
function scanResources() {
  const skills = {}, workflows = {};
  const roots = [
    { kind: "skill", base: join(homedir(), ".codex"), sub: "skills", source: "user" },
    { kind: "workflow", base: join(homedir(), ".codex"), sub: "workflows", source: "user" },
    { kind: "skill", base: join(homedir(), ".agents"), sub: "skills", source: "user" },
    { kind: "workflow", base: join(homedir(), ".agents"), sub: "workflows", source: "user" },
    { kind: "skill", base: root, sub: ".agents/skills", source: "project" },
    { kind: "workflow", base: root, sub: ".agents/workflows", source: "project" },
  ];
  // codex system skills
  const sysRoot = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills", ".system");
  if (existsSync(sysRoot)) {
    let entries = []; try { entries = readdirSync(sysRoot, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch {}
    for (const name of entries) if (existsSync(join(sysRoot, name, "SKILL.md"))) skills[name] = { available: true, known: true, version: null, source: "codex_system" };
  }
  for (const r of roots) {
    const p = join(r.base, r.sub);
    if (!existsSync(p)) continue;
    let entries = []; try { entries = readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    for (const name of entries) {
      const hasSkill = r.kind === "skill" ? existsSync(join(p, name, "SKILL.md")) : true;
      if (!hasSkill) continue;
      const target = r.kind === "skill" ? skills : workflows;
      if (!target[name]) target[name] = { available: true, known: true, version: null, source: r.source };
    }
  }
  return { skills, workflows };
}

// overlay 合并 + 最小校验
function validateOverlay(ov) {
  if (!ov || typeof ov !== "object") throw new Error("overlay 必须是对象");
  for (const [id, inst] of Object.entries(ov.runtime_instances || {})) {
    if (!inst || typeof inst !== "object") throw new Error(`overlay.runtime_instances.${id} 非对象`);
    if (!inst.runtime || typeof inst.runtime !== "string") throw new Error(`overlay.runtime_instances.${id}.runtime 缺失`);
    if (typeof inst.available !== "boolean") throw new Error(`overlay.runtime_instances.${id}.available 必须布尔`);
  }
  for (const kind of ["skills", "workflows"]) {
    for (const [name, entry] of Object.entries(ov.resources?.[kind] || {})) {
      if (!entry || typeof entry !== "object") throw new Error(`overlay.resources.${kind}.${name} 非对象`);
      if (typeof entry.available !== "boolean") throw new Error(`overlay.resources.${kind}.${name}.available 必须布尔`);
    }
  }
}
function mergeOverlay(env, ov) {
  if (!ov) return env;
  const out = { ...env };
  if (ov.runtime_instances) out.runtime_instances = { ...(env.runtime_instances || {}), ...ov.runtime_instances };
  if (ov.resources) {
    const res = out.resources || {};
    if (ov.resources.skills) res.skills = { ...(res.skills || {}), ...ov.resources.skills };
    if (ov.resources.workflows) res.workflows = { ...(res.workflows || {}), ...ov.resources.workflows };
    out.resources = res;
  }
  return out;
}

const pyPkgs = (arg("packages") || "").split(",").map((s) => s.trim()).filter(Boolean);
const rPkgs = (arg("r-packages") || "").split(",").map((s) => s.trim()).filter(Boolean);
const runtime_instances = detectOsInstances(pyPkgs, rPkgs);
let snapshot = {
  schema_version: SCHEMA_VERSION,
  probe_version: PROBE_VERSION,
  captured_at: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  runtime_instances,
  // 兼容旧字段：runtimes(版本) + packages(空，packages 现在按实例)
  runtimes: Object.fromEntries(Object.entries(runtime_instances).map(([id, inst]) => [inst.runtime, { available: inst.available, known: inst.known, version: inst.version }])),
  packages: {},
  resources: scanResources(),
};
const ovPath = arg("env-overlay");
if (ovPath) {
  const ov = JSON.parse(readFileSync(resolve(ovPath), "utf8"));
  validateOverlay(ov);
  snapshot = mergeOverlay(snapshot, ov);
}
if (hasFlag("out")) { writeFileSync(resolve(arg("out")), JSON.stringify(snapshot, null, 2) + "\n", "utf8"); console.log(`written ${arg("out")}`); }
else console.log(JSON.stringify(snapshot, null, 2));

