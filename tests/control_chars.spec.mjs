#!/usr/bin/env node
// Regression guard: no unexpected C0 control characters (0x00-0x1F, excluding TAB/LF/CR)
// in tracked contract JSON / Markdown. Catches raw control bytes AND JSON-escape-induced
// control chars (e.g. \u001b) inside parsed string values.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function c0InText(t) { const out = []; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); if (c < 0x20 && c !== 0x09 && c !== 0x0A && c !== 0x0D) out.push({ at: i, hex: "0x" + c.toString(16) }); } return out; }
function c0InJsonStrings(o, path) { const out = []; (function walk(v, p) { if (typeof v === "string") { for (let i = 0; i < v.length; i++) { const c = v.charCodeAt(i); if (c < 0x20 && c !== 0x09 && c !== 0x0A && c !== 0x0D) out.push({ at: p + "." + i, hex: "0x" + c.toString(16) }); } } else if (Array.isArray(v)) { v.forEach((x, k) => walk(x, p + "[" + k + "]")); } else if (v && typeof v === "object") { for (const [k, u] of Object.entries(v)) walk(u, p + "." + k); } })(o, path || ""); return out; }

const files = execSync("git -C \"" + root + "\" ls-files").toString().split("\n").filter(Boolean).filter((p) => p.endsWith(".json") || p.endsWith(".md"));
let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log("  ✅ " + name); pass++; } else { console.log("  ❌ " + name + (detail ? " — " + detail : "")); fail++; } }

let issues = [];
for (const f of files) {
  const abs = join(root, f);
  let txt; try { txt = readFileSync(abs, "utf8"); } catch { continue; }
  const raw = c0InText(txt);
  if (raw.length) issues.push({ file: f, kind: "raw", hits: raw.slice(0, 5) });
  if (f.endsWith(".json")) { try { const obj = JSON.parse(txt); const jsonEsc = c0InJsonStrings(obj); if (jsonEsc.length) issues.push({ file: f, kind: "json_string", hits: jsonEsc.slice(0, 5) }); } catch { /* invalid JSON handled elsewhere */ } }
}
ok("no C0 control chars (raw or parsed) in tracked JSON/MD", issues.length === 0, JSON.stringify(issues));
if (fail > 0) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }
console.log(`\n${pass} passed, ${fail} failed`);
