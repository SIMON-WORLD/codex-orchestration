#!/usr/bin/env node
// 生成机器可读的执行环境快照（供 Capability Resolver/Preflight 使用）。
// 只做探测，不安装任何软件；无法检测的项标记 available:false + known:false（unknown，不猜）。
// 用法: node scripts/probe_env.mjs [--packages csdid,pyfixest,linearmodels] [--r-packages did,fixest] [--out capabilities.env.json]
import { spawnSync } from "node:child_process";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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
  if (!exe) return { available: false, known: false, version: null, path: null };
  const v = verOf(exe, verArgs, verRe);
  // 探测不到版本也算已找到（available），版本记 unknown
  return { available: true, known: true, version: v || "unknown", path: exe };
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
for (const pkg of pyPkgs) {
  const exe = which("python");
  if (!exe) { packages[pkg] = { available: false, known: false, version: null }; continue; }
  const r = spawnSync(exe, ["-c", `import importlib.metadata as m; print(m.version("${pkg}"))`], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (r.status !== 0 || !r.stdout.trim()) packages[pkg] = { available: false, known: false, version: null };
  else packages[pkg] = { available: true, known: true, version: r.stdout.trim() };
}
const rPkgs = (arg("r-packages") || "").split(",").map((s) => s.trim()).filter(Boolean);
for (const pkg of rPkgs) {
  const exe = which("Rscript");
  if (!exe) { packages[`r:${pkg}`] = { available: false, known: false, version: null }; continue; }
  const r = spawnSync(exe, ["-e", `cat(as.character(packageVersion("${pkg}")))`], { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (r.status !== 0 || !r.stdout.trim()) packages[`r:${pkg}`] = { available: false, known: false, version: null };
  else packages[`r:${pkg}`] = { available: true, known: true, version: r.stdout.trim() };
}

const snapshot = { capturedAt: new Date().toISOString(), runtimes, packages };
if (hasFlag("out")) { writeFileSync(join(root, arg("out")), JSON.stringify(snapshot, null, 2) + "\n", "utf8"); console.log(`written ${arg("out")}`); }
else console.log(JSON.stringify(snapshot, null, 2));
