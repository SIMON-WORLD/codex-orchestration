#!/usr/bin/env node
// 生成机器可读的执行环境快照（供 Capability Resolver/Preflight 使用）。
// 只做探测，不安装任何软件；无法检测的项标记 available:false + known:false（unknown，不猜）。
// 只记录非敏感必要字段（不记录用户名/token/路径）。
// 用法: node scripts/probe_env.mjs [--packages csdid,pyfixest] [--r-packages did,fixest] [--out capabilities.env.json]
import { spawnSync } from "node:child_process";
import { writeFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SCHEMA_VERSION = "1.0";
const PROBE_VERSION = "1.1";

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
function runtimeInfo(name, verArgs, verRe) {
  const exe = which(name);
  if (!exe) return { available: false, known: false, version: null };
  const v = verOf(exe, verArgs, verRe);
  return { available: true, known: true, version: v || "unknown" };
}

// 保守扫描已安装的 codex skill / workflow（只记名字，不记路径）
function scanResources() {
  const skills = {};
  const workflows = {};
  const roots = {
    skills: [join(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills"), join(homedir(), ".agents", "skills"), join(root, ".agents", "skills")],
    workflows: [join(process.env.CODEX_HOME || join(homedir(), ".codex"), "workflows"), join(homedir(), ".agents", "workflows"), join(root, ".agents", "workflows")],
  };
  for (const r of roots.skills) {
    if (!existsSync(r)) continue;
    let entries = []; try { entries = readdirSync(r, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    for (const name of entries) if (existsSync(join(r, name, "SKILL.md"))) skills[name] = { available: true, known: true, version: null, source: "codex_skills" };
  }
  for (const r of roots.workflows) {
    if (!existsSync(r)) continue;
    let entries = []; try { entries = readdirSync(r, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { continue; }
    for (const name of entries) workflows[name] = { available: true, known: true, version: null, source: "codex_workflows" };
  }
  return { skills, workflows };
}

const runtimes = {
  node: { available: true, known: true, version: process.version },
  python: runtimeInfo("python", ["--version"], /Python\s+([\d.]+)/),
  python3: runtimeInfo("python3", ["--version"], /Python\s+([\d.]+)/),
  r: runtimeInfo("Rscript", ["--version"], /R version\s+([\d.]+)/),
  stata: runtimeInfo("stata-mp", ["-V"], /Stata[\s\S]*?(\d+)/),
};

const pyPkgs = (arg("packages") || "").split(",").map((s) => s.trim()).filter(Boolean);
const packages = {};
const pyExe = which("python");
for (const pkg of pyPkgs) {
  if (!pyExe) { packages[pkg] = { available: false, known: false, version: null }; continue; }
  const r = spawnSync(pyExe, ["-c", `import importlib.metadata as m; print(m.version("${pkg}"))`], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (r.status !== 0 || !r.stdout.trim()) packages[pkg] = { available: false, known: false, version: null };
  else packages[pkg] = { available: true, known: true, version: r.stdout.trim() };
}
const rPkgs = (arg("r-packages") || "").split(",").map((s) => s.trim()).filter(Boolean);
const rExe = which("Rscript");
for (const pkg of rPkgs) {
  if (!rExe) { packages[`r:${pkg}`] = { available: false, known: false, version: null }; continue; }
  const r = spawnSync(rExe, ["-e", `cat(as.character(packageVersion("${pkg}")))`], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (r.status !== 0 || !r.stdout.trim()) packages[`r:${pkg}`] = { available: false, known: false, version: null };
  else packages[`r:${pkg}`] = { available: true, known: true, version: r.stdout.trim() };
}

const snapshot = {
  schema_version: SCHEMA_VERSION,
  probe_version: PROBE_VERSION,
  captured_at: new Date().toISOString(),
  platform: process.platform,
  arch: process.arch,
  runtimes,
  resources: scanResources(),
  packages,
};
if (hasFlag("out")) { writeFileSync(join(root, arg("out")), JSON.stringify(snapshot, null, 2) + "\n", "utf8"); console.log(`written ${arg("out")}`); }
else console.log(JSON.stringify(snapshot, null, 2));


