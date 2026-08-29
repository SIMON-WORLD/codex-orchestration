#!/usr/bin/env node
// 确定性 presentation TABLE renderer v1 回归。
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle, renderValidated } from "../domains/economics/presentation/render_table.mjs";
import { hashCanonicalJsonFile, CANONICAL_HASH_MODE } from "../core/artifact_hash.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VALID = join(root, "tests/fixtures/artifacts/valid");
const TMP = join(root, "role-team-out/presentation_render_tests");

function copyValid(dir) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); cpSync(VALID, dir, { recursive: true }); }
function writeManifest(dir, hash, opts = {}) {
  const w = { artifact_id: "PRESENT_TEST", artifact_type: "presentation_manifest", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_t", views: [ { view_id: "V_TEST_TABLE", view_type: "table", output_ref: "output/tables/t.tex", source_refs: [ { artifact_id: "ESTIMATES_001", item_ids: opts.itemIds || ["EST_001"], source_hash: hash, source_hash_mode: CANONICAL_HASH_MODE } ] } ] };
  writeFileSync(join(dir, "presentation_manifest.json"), JSON.stringify(w, null, 2) + "\n", "utf8");
}
function render(dir, viewId) { const { bundle, paths } = loadBundle(dir); return renderValidated(bundle, paths, { viewId }); }
function estHash(dir) { return hashCanonicalJsonFile(join(dir, "estimates.json")); }

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name} ${detail || ""}`); fail++; } }
function expectFail(name, dir, contains) { const r = render(dir); const cond = r.ok === false && (contains ? r.errors.some((e) => e.includes(contains)) : true); ok(name, cond, `ok=${r.ok} errs=${JSON.stringify(r.errors)}`); }

console.log("Presentation renderer spec");

// 1 valid estimate table renders
let d1 = join(TMP, "v1"); copyValid(d1); writeManifest(d1, estHash(d1));
const r1 = render(d1);
ok("1 valid estimate table renders", r1.ok === true && r1.output.includes("| term | estimate | std_error | p_value | n |"), `ok=${r1.ok}`);

// 2 deterministic rerender
const r2a = render(d1), r2b = render(d1);
ok("2 deterministic rerender", r2a.ok && r2b.ok && r2a.output === r2b.output, `equal=${r2a.output === r2b.output}`);

// 3 stale manifest/source hash blocks render
let d3 = join(TMP, "v3"); copyValid(d3); writeManifest(d3, estHash(d3));
{ const p = join(d3, "estimates.json"); const o = JSON.parse(readFileSync(p, "utf8")); o.estimates[0].estimate = 9.99; writeFileSync(p, JSON.stringify(o, null, 2) + "\n", "utf8"); }
expectFail("3 stale manifest/source hash blocks render", d3, "hash 不匹配");

// 4 nonexistent estimate_id blocks render
let d4 = join(TMP, "v4"); copyValid(d4); writeManifest(d4, estHash(d4), { itemIds: ["EST_999"] });
expectFail("4 nonexistent estimate_id blocks render", d4, "item_id EST_999 不存在");

// 5 output values originate from source artifact
const src = JSON.parse(readFileSync(join(d1, "estimates.json"), "utf8")).estimates.find((e) => e.estimate_id === "EST_001");
const expectedRow = `| ${src.term} | ${Number(src.estimate).toFixed(4)} | ${Number(src.std_error).toFixed(4)} | ${Number(src.p_value).toFixed(4)} | ${src.n} |`;
ok("5 output values originate from source artifact", r1.output.split("\n")[2] === expectedRow, `got=${r1.output.split("\n")[2]} want=${expectedRow}`);

// 6 changed upstream artifact + refreshed binding changes rendered output
let d6 = join(TMP, "v6"); copyValid(d6); writeManifest(d6, estHash(d6));
const before = render(d6).output;
{ const p = join(d6, "estimates.json"); const o = JSON.parse(readFileSync(p, "utf8")); o.estimates[0].estimate = 7.77; writeFileSync(p, JSON.stringify(o, null, 2) + "\n", "utf8"); }
expectFail("6 stale hash blocks after upstream change", d6, "hash 不匹配");
writeManifest(d6, estHash(d6));
const after = render(d6);
ok("6 refreshed binding renders changed output", after.ok === true && after.output.includes("7.7700") && after.output !== before, `changed=${after.output !== before}`);

// 7 tampered rendered output differs from regenerated canonical output
let d7 = join(TMP, "v7"); copyValid(d7); writeManifest(d7, estHash(d7));
const canonical = render(d7).output;
const tampered = canonical.replace("1.2500", "9.9999");
const fresh = render(d7).output;
ok("7 tampered output differs from deterministic rerender", canonical === fresh && tampered !== fresh, `canonicalEq=${canonical === fresh} diff=${tampered !== fresh}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
