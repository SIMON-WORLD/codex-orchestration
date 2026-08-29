#!/usr/bin/env node
// 确定性 presentation TABLE renderer v1 回归（完整 scientific bundle 校验门禁）。
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle, renderValidated } from "../domains/economics/presentation/render_table.mjs";
import { hashCanonicalJsonFile, CANONICAL_HASH_MODE } from "../core/artifact_hash.mjs";
import { buildReplicationStamp } from "../core/build_replication_stamp.mjs";

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
function editEstimate(dir, value) {
  const p = join(dir, "estimates.json"); const o = JSON.parse(readFileSync(p, "utf8")); o.estimates[0].estimate = value; writeFileSync(p, JSON.stringify(o, null, 2) + "\n", "utf8");
}
function rebuildStamp(dir) {
  const mr = JSON.parse(readFileSync(join(dir, "model_registry.json"), "utf8"));
  const es = JSON.parse(readFileSync(join(dir, "estimates.json"), "utf8"));
  const sourceHashes = { model_registry: hashCanonicalJsonFile(join(dir, "model_registry.json")), estimates: hashCanonicalJsonFile(join(dir, "estimates.json")) };
  if (existsSync(join(dir, "diagnostics.json"))) sourceHashes.diagnostics = hashCanonicalJsonFile(join(dir, "diagnostics.json"));
  writeFileSync(join(dir, "replication_stamp.json"), JSON.stringify(buildReplicationStamp(mr.models, es.estimates, sourceHashes), null, 2) + "\n", "utf8");
}
function rebuildArtifactManifest(dir) {
  const am = JSON.parse(readFileSync(join(dir, "artifact_manifest.json"), "utf8"));
  for (const a of am.artifacts) a.sha256 = hashCanonicalJsonFile(join(dir, a.path));
  writeFileSync(join(dir, "artifact_manifest.json"), JSON.stringify(am, null, 2) + "\n", "utf8");
}

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name} ${detail || ""}`); fail++; } }
function expectFail(name, dir, contains) { const r = render(dir); const cond = r.ok === false && (contains ? r.errors.some((e) => e.includes(contains)) : true); ok(name, cond, `ok=${r.ok} errs=${JSON.stringify(r.errors)}`); }

console.log("Presentation renderer spec");

// 1 valid complete bundle renders
let d1 = join(TMP, "v1"); copyValid(d1); writeManifest(d1, estHash(d1));
const r1 = render(d1);
ok("1 valid complete bundle renders", r1.ok === true && r1.output.includes("| term | estimate | std_error | p_value | n |"), `ok=${r1.ok}`);

// 2 deterministic rerender
const r2a = render(d1), r2b = render(d1);
ok("2 deterministic rerender", r2a.ok && r2b.ok && r2a.output === r2b.output, `equal=${r2a.output === r2b.output}`);

// 3 stale presentation hash blocks (modified estimates, hash not refreshed)
let d3 = join(TMP, "v3"); copyValid(d3); writeManifest(d3, estHash(d3)); editEstimate(d3, 1.50);
expectFail("3 stale presentation hash blocks render", d3, "hash 不匹配");

// 4 nonexistent estimate_id blocks render
let d4 = join(TMP, "v4"); copyValid(d4); writeManifest(d4, estHash(d4), { itemIds: ["EST_999"] });
expectFail("4 nonexistent estimate_id blocks render", d4, "item_id EST_999 不存在");

// 5 output values originate from source artifact
const src = JSON.parse(readFileSync(join(d1, "estimates.json"), "utf8")).estimates.find((e) => e.estimate_id === "EST_001");
const expectedRow = `| ${src.term} | ${Number(src.estimate).toFixed(4)} | ${Number(src.std_error).toFixed(4)} | ${Number(src.p_value).toFixed(4)} | ${src.n} |`;
ok("5 output values originate from source artifact", r1.output.split("\n")[2] === expectedRow, `got=${r1.output.split("\n")[2]} want=${expectedRow}`);

// 6 loophole closed: valid presentation + invalid scientific bundle does NOT render
let d6 = join(TMP, "v6"); copyValid(d6); writeManifest(d6, estHash(d6)); editEstimate(d6, 1.50); writeManifest(d6, estHash(d6));
expectFail("6 valid presentation + invalid scientific bundle does NOT render (refresh-only presentation hash)", d6, "");

// 7 stale replication stamp blocks rendering (artifact_manifest + presentation current, stamp stale)
let d7 = join(TMP, "v7"); copyValid(d7); writeManifest(d7, estHash(d7)); editEstimate(d7, 1.50); writeManifest(d7, estHash(d7)); rebuildArtifactManifest(d7);
expectFail("7 stale replication stamp blocks rendering", d7, "replication_stamp");

// 8 stale artifact_manifest blocks rendering (stamp + presentation current, artifact_manifest stale)
let d8 = join(TMP, "v8"); copyValid(d8); writeManifest(d8, estHash(d8)); editEstimate(d8, 1.50); writeManifest(d8, estHash(d8)); rebuildStamp(d8);
expectFail("8 stale artifact_manifest blocks rendering", d8, "checksum 不匹配");

// 9 fully rebuilt provenance chain restores rendering
let d9 = join(TMP, "v9"); copyValid(d9); writeManifest(d9, estHash(d9));
const before = render(d9).output;
editEstimate(d9, 1.50); writeManifest(d9, estHash(d9)); rebuildStamp(d9); rebuildArtifactManifest(d9);
const after = render(d9);
ok("9 fully rebuilt provenance chain restores rendering and changes output", after.ok === true && after.output.includes("1.5000") && after.output !== before, `ok=${after.ok} changed=${after.output !== before}`);

// 10 tampered rendered output differs from regenerated canonical output
let d10 = join(TMP, "v10"); copyValid(d10); writeManifest(d10, estHash(d10));
const canonical = render(d10).output;
const tampered = canonical.replace("1.2500", "9.9999");
const fresh = render(d10).output;
ok("10 tampered output differs from deterministic rerender", canonical === fresh && tampered !== fresh, `canonicalEq=${canonical === fresh} diff=${tampered !== fresh}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
