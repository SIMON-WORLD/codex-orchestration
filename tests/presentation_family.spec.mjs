#!/usr/bin/env node
// economics.presentation.tables.{descriptive,diagnostics,models} — capability + resolver/admission regression.
// Proves: narrow capability scope == implementation scope; each renderer resolves only to its own capability;
// generic tables / figures remain unaffected; production admission matches tested status; shared renderer is
// deterministic and fail-closed on stale provenance.
import { readFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";
import { loadBundle } from "../domains/economics/presentation/render_table.mjs";
import { renderValidated as renderFam, FAMILY_CONFIG } from "../domains/economics/presentation/render_family_table.mjs";
import { hashCanonicalJsonFile, CANONICAL_HASH_MODE } from "../core/artifact_hash.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = loadRegistry(join(root, "domains/economics/capabilities"));
const index = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/index.json"), "utf8"));
const caps = ["descriptive", "diagnostics", "models"].map((f) => JSON.parse(readFileSync(join(root, `domains/economics/capabilities/presentation.tables.${f}.json`), "utf8")));
const tablesCap = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/presentation.tables.json"), "utf8"));
const figuresCap = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/presentation.figures.json"), "utf8"));

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
const mkStudy = (capId) => ({ study_id: "t", domain: "economics", execution_context: { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] }, selected_capabilities: { empirical: [capId] }, decisions: {}, preconditions: {}, manual_validations: {} });
const nodeEnv = () => ({ runtime_instances: { "node.os": { runtime: "node", provider: "os", available: true, known: true, version: "24.0.0" } } });
const resolve = (capId) => { const s = mkStudy(capId); return resolveAll(s, registry, nodeEnv(), { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] }).capabilities[capId]; };

// A. registry / schema
ok("A1 index registers all three family capabilities", ["presentation.tables.descriptive.json", "presentation.tables.diagnostics.json", "presentation.tables.models.json"].every((f) => index.capability_files.includes(f)));
ok("A2 registry contains the three capability IDs", ["economics.presentation.tables.descriptive", "economics.presentation.tables.diagnostics", "economics.presentation.tables.models"].every((id) => registry[id]));
ok("A3 each capability is medium-risk + hard_stop", caps.every((c) => c.risk_level === "medium" && c.fallback_policy === "hard_stop"));
ok("A4 each implementation is tested (post-evidence)", caps.every((c) => c.implementations?.[0]?.verification_status === "tested"));

// B. exact implementation scope / no cross-capability bleed
const tableImpls = tablesCap.implementations || [];
const figImpls = figuresCap.implementations || [];
const allFamilyImpls = caps.flatMap((c) => (c.implementations || []).map((i) => i.id));
ok("B1 each family capability has its own unique local renderer id", caps.every((c) => c.implementations?.length === 1 && c.implementations[0].kind === "script" && c.implementations[0].runtime === "node"));
ok("B2 renderer ids are mutually distinct", new Set(allFamilyImpls).size === 3);
ok("B3 all family renderers point to the shared renderer", caps.every((c) => c.implementations[0].name === "domains/economics/presentation/render_family_table.mjs"));
ok("B4 generic tables does not contain any family renderer", !tableImpls.some((i) => allFamilyImpls.includes(i.id)));
ok("B5 figures does not contain any family renderer", !figImpls.some((i) => allFamilyImpls.includes(i.id)));

// C. resolver isolation
const CAP_RENDERER = {
  "economics.presentation.tables.descriptive": "presentation.local.descriptive_table_renderer",
  "economics.presentation.tables.diagnostics": "presentation.local.diagnostics_table_renderer",
  "economics.presentation.tables.models": "presentation.local.model_table_renderer",
};
for (const cap of caps) {
  const r = resolve(cap.id);
  const expectedId = CAP_RENDERER[cap.id];
  ok(`C[${cap.id}] production resolves to its own renderer (tested)`, r.resolution === "resolved" && r.selected_implementation?.id === expectedId && r.verification_status === "tested", `res=${r.resolution} sel=${r.selected_implementation?.id} vs=${r.verification_status}`);
}
const g = resolve("economics.presentation.tables");
ok("C generic tables not resolved to any family renderer (reference-only)", g.resolution !== "resolved" && !g.selected_implementation, `res=${g.resolution} sel=${g.selected_implementation?.id}`);
const fg = resolve("economics.presentation.figures");
ok("C figures not resolved to any family renderer (reference-only)", fg.resolution !== "resolved" && !fg.selected_implementation, `res=${fg.resolution}`);
// cross-capability bleed: selecting one family must never auto-select another family's renderer
for (const cap of caps) {
  const r = resolve(cap.id);
  const others = Object.values(CAP_RENDERER).filter((id) => id !== cap.implementations[0].id);
  ok(`C[${cap.id}] no cross-capability bleed`, r.selected_implementation?.id === cap.implementations[0].id && !others.includes(r.selected_implementation?.id));
}

// D. shared renderer determinism + fail-closed on stale provenance (fixture)
const VALID = join(root, "tests/fixtures/artifacts/valid");
const TMP = join(root, "role-team-out/family_spec");
const writeManifest = (dir, cfg, itemIds) => {
  const art = JSON.parse(readFileSync(join(dir, cfg.bundle_key + ".json"), "utf8"));
  const w = { artifact_id: "PRES_FAM_SPEC", artifact_type: "presentation_manifest", schema_version: "1.0", producer_role: "empirical", producer_task_id: "task_bench", created_at: "2026-08-29T00:00:00Z", views: [ { view_id: "V_" + cfg.artifact_type, view_type: "table", output_ref: "x.tex", source_refs: [ { artifact_id: art.artifact_id, item_ids: itemIds, source_hash: hashCanonicalJsonFile(join(dir, cfg.bundle_key + ".json")), source_hash_mode: CANONICAL_HASH_MODE } ] } ] };
  writeFileSync(join(dir, "presentation_manifest.json"), JSON.stringify(w, null, 2) + "\n", "utf8");
};
for (const [key, itemIds] of [["descriptive_facts", ["FACT_PANEL_ATTRITION_RATE"]], ["diagnostics", ["DIAG_001"]], ["model_registry", ["MODEL_001"]]]) {
  const cfg = FAMILY_CONFIG[key];
  const dir = join(TMP, key); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true }); cpSync(VALID, dir, { recursive: true });
  writeManifest(dir, cfg, itemIds);
  const { bundle, paths } = loadBundle(dir);
  const r1 = renderFam(bundle, paths, { family: key }); const r2 = renderFam(bundle, paths, { family: key });
  const item = JSON.parse(readFileSync(join(dir, cfg.bundle_key + ".json"), "utf8"))[cfg.list_key].find((x) => x[cfg.id_field] === itemIds[0]);
  const expectedRow = "| " + cfg.columns.map((c) => c.fmt(item[c.key])).join(" | ") + " |";
  ok(`D[${key}] deterministic render`, r1.ok && r2.ok && r1.output === r2.output);
  ok(`D[${key}] source fidelity`, r1.output.split("\n")[2] === expectedRow);
  // fail-closed: break source hash -> render fails (reload bundle so validator sees the stale binding)
  const pm = JSON.parse(readFileSync(join(dir, "presentation_manifest.json"), "utf8"));
  pm.views[0].source_refs[0].source_hash = "deadbeef";
  writeFileSync(join(dir, "presentation_manifest.json"), JSON.stringify(pm, null, 2) + "\n", "utf8");
  const { bundle: b2, paths: p2 } = loadBundle(dir);
  const r3 = renderFam(b2, p2, { family: key });
  ok(`D[${key}] stale source hash fails closed`, r3.ok === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
