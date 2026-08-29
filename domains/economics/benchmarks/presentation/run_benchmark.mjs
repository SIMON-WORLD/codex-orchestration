#!/usr/bin/env node
// 确定性 presentation table renderer 基准：演示 scientific artifact -> presentation binding -> deterministic output。
// Case C 验证“刷新仅 presentation hash 仍失败”，只有重建 stamp + artifact_manifest + presentation hash 才恢复渲染。
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle, renderValidated } from "../../presentation/render_table.mjs";
import { hashCanonicalJsonFile, CANONICAL_HASH_MODE } from "../../../../core/artifact_hash.mjs";
import { buildReplicationStamp } from "../../../../core/build_replication_stamp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const VALID = join(root, "tests/fixtures/artifacts/valid");
const TMP = join(root, "role-team-out/presentation_bench");

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name} ${detail || ""}`); fail++; } }
function copyValid(dir) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); cpSync(VALID, dir, { recursive: true }); }
function writeManifest(dir, hash) {
  const w = { artifact_id: "PRESENT_BENCH", artifact_type: "presentation_manifest", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_bench", views: [ { view_id: "V_BENCH_TABLE", view_type: "table", output_ref: "output/tables/bench_table.tex", source_refs: [ { artifact_id: "ESTIMATES_001", item_ids: ["EST_001"], source_hash: hash, source_hash_mode: CANONICAL_HASH_MODE } ] } ] };
  writeFileSync(join(dir, "presentation_manifest.json"), JSON.stringify(w, null, 2) + "\n", "utf8");
}
function render(dir) { const { bundle, paths } = loadBundle(dir); return renderValidated(bundle, paths, {}); }
function manifestHash(dir) { return hashCanonicalJsonFile(join(dir, "estimates.json")); }
function rebuildStamp(dir) {
  const mr = JSON.parse(readFileSync(join(dir, "model_registry.json"), "utf8"));
  const es = JSON.parse(readFileSync(join(dir, "estimates.json"), "utf8"));
  const sourceHashes = { model_registry: hashCanonicalJsonFile(join(dir, "model_registry.json")), estimates: hashCanonicalJsonFile(join(dir, "estimates.json")) };
  sourceHashes.diagnostics = hashCanonicalJsonFile(join(dir, "diagnostics.json"));
  const stamp = buildReplicationStamp(mr.models, es.estimates, sourceHashes);
  writeFileSync(join(dir, "replication_stamp.json"), JSON.stringify(stamp, null, 2) + "\n", "utf8");
}
function rebuildArtifactManifest(dir) {
  const am = JSON.parse(readFileSync(join(dir, "artifact_manifest.json"), "utf8"));
  for (const a of am.artifacts) a.sha256 = hashCanonicalJsonFile(join(dir, a.path));
  writeFileSync(join(dir, "artifact_manifest.json"), JSON.stringify(am, null, 2) + "\n", "utf8");
}

console.log("Presentation table renderer benchmark");

// A. determinism
const dA = join(TMP, "a"); copyValid(dA); writeManifest(dA, manifestHash(dA));
const a1 = render(dA), a2 = render(dA);
ok("A determinism (render twice -> identical output)", a1.ok && a2.ok && a1.output === a2.output, `ok=${a1.ok}/${a2.ok} equal=${a1.output === a2.output}`);

// B. source fidelity (values pulled from the source artifact, not hard-coded)
const est = JSON.parse(readFileSync(join(dA, "estimates.json"), "utf8")).estimates.find((e) => e.estimate_id === "EST_001");
const expectedRow = `| ${est.term} | ${Number(est.estimate).toFixed(4)} | ${Number(est.std_error).toFixed(4)} | ${Number(est.p_value).toFixed(4)} | ${est.n} |`;
ok("B source fidelity (rendered row equals referenced artifact values)", a1.output.split("\n")[2] === expectedRow, `got=${a1.output.split("\n")[2]} want=${expectedRow}`);

// C. upstream change propagation (full provenance chain)
const dC = join(TMP, "c"); copyValid(dC); writeManifest(dC, manifestHash(dC));
const c0 = render(dC); ok("C initial render works", c0.ok === true, `ok=${c0.ok}`);
{ const p = join(dC, "estimates.json"); const o = JSON.parse(readFileSync(p, "utf8")); o.estimates[0].estimate = 1.50; writeFileSync(p, JSON.stringify(o, null, 2) + "\n", "utf8"); }
const cOld = render(dC);
ok("C-A old presentation binding fails after upstream change", cOld.ok === false, `ok=${cOld.ok} errs=${JSON.stringify(cOld.errors)}`);
writeManifest(dC, manifestHash(dC));
const cMid = render(dC);
ok("C-B refreshing ONLY presentation hash still fails (scientific bundle provenance stale)", cMid.ok === false, `ok=${cMid.ok} errs=${JSON.stringify(cMid.errors)}`);
rebuildStamp(dC); rebuildArtifactManifest(dC); writeManifest(dC, manifestHash(dC));
const cNew = render(dC);
ok("C-C rebuilt provenance chain renders and output changes with upstream", cNew.ok === true && cNew.output.includes("1.5000") && cNew.output !== c0.output, `ok=${cNew.ok} changed=${cNew.output !== c0.output}`);

// D. manual rendered-output tampering
const dD = join(TMP, "d"); copyValid(dD); writeManifest(dD, manifestHash(dD));
const canonical = render(dD).output;
const tampered = canonical.replace("1.2500", "9.9999");
const fresh = render(dD).output;
ok("D tampered output differs from deterministic rerender", canonical === fresh && tampered !== fresh, `canonicalEq=${canonical === fresh} tamperedDiff=${tampered !== fresh}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

