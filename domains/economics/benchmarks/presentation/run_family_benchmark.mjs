#!/usr/bin/env node
// 确定性 presentation table renderer 基准 —— 额外 artifact family（descriptive_facts / diagnostics / model_registry）。
// 演示 scientific artifact -> presentation binding -> deterministic output；验证 determinism / source fidelity /
// provenance enforcement（fail-closed + full rebuild）/ explicit scope / stale item_id。
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBundle } from "../../presentation/render_table.mjs";
import { renderValidated, FAMILY_CONFIG } from "../../presentation/render_family_table.mjs";
import { hashCanonicalJsonFile, CANONICAL_HASH_MODE } from "../../../../core/artifact_hash.mjs";
import { buildReplicationStamp } from "../../../../core/build_replication_stamp.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const VALID = join(root, "tests/fixtures/artifacts/valid");
const TMP = join(root, "role-team-out/family_bench");

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name} ${detail || ""}`); fail++; } }
function copyValid(dir) { rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); cpSync(VALID, dir, { recursive: true }); }
function readArtifact(dir, cfg) { return JSON.parse(readFileSync(join(dir, cfg.bundle_key + ".json"), "utf8")); }
function writeManifest(dir, cfg, itemIds) {
  const artifactId = readArtifact(dir, cfg).artifact_id;
  const w = { artifact_id: "PRES_FAM_BENCH", artifact_type: "presentation_manifest", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_bench", created_at: "2026-08-29T00:00:00Z", views: [ { view_id: "V_FAM_" + cfg.artifact_type, view_type: "table", output_ref: "output/tables/fam_" + cfg.artifact_type + ".tex", source_refs: [ { artifact_id: artifactId, item_ids: itemIds, source_hash: hashCanonicalJsonFile(join(dir, cfg.bundle_key + ".json")), source_hash_mode: CANONICAL_HASH_MODE } ] } ] };
  writeFileSync(join(dir, "presentation_manifest.json"), JSON.stringify(w, null, 2) + "\n", "utf8");
}
function render(dir, family) { const { bundle, paths } = loadBundle(dir); return renderValidated(bundle, paths, { family }); }
function rebuildStamp(dir) {
  const mr = JSON.parse(readFileSync(join(dir, "model_registry.json"), "utf8"));
  const es = JSON.parse(readFileSync(join(dir, "estimates.json"), "utf8"));
  const sourceHashes = { model_registry: hashCanonicalJsonFile(join(dir, "model_registry.json")), estimates: hashCanonicalJsonFile(join(dir, "estimates.json")), diagnostics: hashCanonicalJsonFile(join(dir, "diagnostics.json")) };
  writeFileSync(join(dir, "replication_stamp.json"), JSON.stringify(buildReplicationStamp(mr.models, es.estimates, sourceHashes), null, 2) + "\n", "utf8");
}
function rebuildArtifactManifest(dir) {
  const am = JSON.parse(readFileSync(join(dir, "artifact_manifest.json"), "utf8"));
  for (const a of am.artifacts) a.sha256 = hashCanonicalJsonFile(join(dir, a.path));
  writeFileSync(join(dir, "artifact_manifest.json"), JSON.stringify(am, null, 2) + "\n", "utf8");
}
function rebuildPresentationHash(dir, cfg) {
  const pm = JSON.parse(readFileSync(join(dir, "presentation_manifest.json"), "utf8"));
  const artifactId = readArtifact(dir, cfg).artifact_id;
  for (const v of pm.views) for (const s of v.source_refs) if (s.artifact_id === artifactId) s.source_hash = hashCanonicalJsonFile(join(dir, cfg.bundle_key + ".json"));
  writeFileSync(join(dir, "presentation_manifest.json"), JSON.stringify(pm, null, 2) + "\n", "utf8");
}
function setDeep(obj, path, value) { let ptr = obj; for (let i = 0; i < path.length - 1; i++) ptr = ptr[path[i]]; ptr[path[path.length - 1]] = value; return obj; }

const FAMILIES = [
  { key: "descriptive_facts", file: "descriptive_facts.json", itemIds: ["FACT_PANEL_ATTRITION_RATE"], mut: ["facts", 0, "value"], mutValue: 0.99 },
  { key: "diagnostics", file: "diagnostics.json", itemIds: ["DIAG_001"], mut: ["diagnostics", 0, "value"], mutValue: "suspicious" },
  { key: "model_registry", file: "model_registry.json", itemIds: ["MODEL_001"], mut: ["models", 0, "clustering"], mutValue: "unit201" },
];

console.log("Presentation family table renderer benchmark");

for (const fam of FAMILIES) {
  const cfg = FAMILY_CONFIG[fam.key];
  const label = fam.key;
  const d = join(TMP, fam.key); copyValid(d); writeManifest(d, cfg, fam.itemIds);
  const a1 = render(d, fam.key), a2 = render(d, fam.key);
  ok(`[${label}] A determinism (render twice -> identical)`, a1.ok && a2.ok && a1.output === a2.output, `ok=${a1.ok}/${a2.ok} equal=${a1.output === a2.output}`);

  const art = readArtifact(d, cfg);
  const item = art[cfg.list_key].find((x) => x[cfg.id_field] === fam.itemIds[0]);
  const expectedRow = "| " + cfg.columns.map((c) => c.fmt(item[c.key])).join(" | ") + " |";
  ok(`[${label}] B source fidelity (rendered row equals referenced artifact values)`, a1.output.split("\n")[2] === expectedRow, `got=${a1.output.split("\n")[2]} want=${expectedRow}`);

  // C. provenance enforcement: mutate source artifact -> render fails closed
  let m = JSON.parse(readFileSync(join(d, fam.file), "utf8"));
  setDeep(m, fam.mut, fam.mutValue);
  writeFileSync(join(d, fam.file), JSON.stringify(m, null, 2) + "\n", "utf8");
  const cOld = render(d, fam.key);
  ok(`[${label}] C modify source without rebuilding provenance -> render FAIL`, cOld.ok === false, `ok=${cOld.ok} errs=${JSON.stringify(cOld.errors)}`);

  // C2. rebuild full provenance chain -> render succeeds and reflects the change
  rebuildStamp(d); rebuildArtifactManifest(d); rebuildPresentationHash(d, cfg);
  const cNew = render(d, fam.key);
  const newItem = JSON.parse(readFileSync(join(d, fam.file), "utf8"))[cfg.list_key].find((x) => x[cfg.id_field] === fam.itemIds[0]);
  const newExpected = "| " + cfg.columns.map((c) => c.fmt(newItem[c.key])).join(" | ") + " |";
  ok(`[${label}] C2 rebuild full provenance -> render OK and reflects changed source`, cNew.ok === true && cNew.output.split("\n")[2] === newExpected, `ok=${cNew.ok} row=${cNew.output.split("\n")[2]} want=${newExpected}`);

  // D. invalid item_id -> render fails
  const d2 = join(TMP, fam.key + "_badid"); copyValid(d2); writeManifest(d2, cfg, ["NOPE_ID_" + fam.key]);
  const bad = render(d2, fam.key);
  ok(`[${label}] D nonexistent ${cfg.id_field} blocks render`, bad.ok === false, `ok=${bad.ok}`);

  // E. explicit scope: view referencing a different artifact must not be silently used
  const d3 = join(TMP, fam.key + "_scope"); copyValid(d3);
  const estArtId = JSON.parse(readFileSync(join(d3, "estimates.json"), "utf8")).artifact_id;
  const w = { artifact_id: "PRES_FAM_SCOPE", artifact_type: "presentation_manifest", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_bench", created_at: "2026-08-29T00:00:00Z", views: [ { view_id: "V_SCOPE", view_type: "table", output_ref: "x.tex", source_refs: [ { artifact_id: estArtId, item_ids: ["EST_001"], source_hash: hashCanonicalJsonFile(join(d3, "estimates.json")), source_hash_mode: CANONICAL_HASH_MODE } ] } ] };
  writeFileSync(join(d3, "presentation_manifest.json"), JSON.stringify(w, null, 2) + "\n", "utf8");
  const scope = render(d3, fam.key);
  ok(`[${label}] E no ${cfg.artifact_type} view -> render FAIL (no cross-family bleed)`, scope.ok === false, `ok=${scope.ok}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
