#!/usr/bin/env node
// Real-data Grunfeld estimate-table presentation benchmark (non-synthetic candidate evidence).
// Proves: source identity -> valid artifact/provenance bundle -> presentation binding -> deterministic estimate table.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGrunfeldBundle } from "./build_bundle.mjs";
import { loadBundle, renderValidated } from "../../../presentation/render_table.mjs";
import { validateArtifacts } from "../../../../../core/validate_artifacts.mjs";
import { hashCanonicalJsonFile, hashTextFile, CANONICAL_HASH_MODE } from "../../../../../core/artifact_hash.mjs";
import { buildReplicationStamp } from "../../../../../core/build_replication_stamp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..", "..");
const PANEL_FE = join(ROOT, "domains/economics/benchmarks/panel_fe");
const FROZEN_MANIFEST = JSON.parse(readFileSync(join(PANEL_FE, "benchmark.grunfeld.json"), "utf8"));
const FROZEN_CHECKSUM = FROZEN_MANIFEST.dataset.checksum;
const BUNDLE = join(ROOT, "role-team-out/grunfeld_pres_bundle");
const MUT = join(ROOT, "role-team-out/grunfeld_pres_mut");

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name} ${detail || ""}`); fail++; } }
function fmt(v, places = 4) { return Number(v).toFixed(places); }
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
function rebuildPresentation(dir) {
  const pm = JSON.parse(readFileSync(join(dir, "presentation_manifest.json"), "utf8"));
  for (const v of pm.views) for (const s of v.source_refs) if (s.artifact_id === "ESTIMATES_GRUNFELD") s.source_hash = hashCanonicalJsonFile(join(dir, "estimates.json"));
  writeFileSync(join(dir, "presentation_manifest.json"), JSON.stringify(pm, null, 2) + "\n", "utf8");
}

console.log("Real-data Grunfeld estimate-table presentation benchmark");

const info = buildGrunfeldBundle(BUNDLE);
let { bundle, paths } = loadBundle(BUNDLE);

// A. source identity
ok("A1. dataset checksum matches frozen panel-FE checksum", bundle.data_manifest.dataset_sha256 === FROZEN_CHECKSUM, `got=${bundle.data_manifest.dataset_sha256}`);
ok("A2. recomputed grunfeld.csv checksum matches frozen", hashTextFile(join(PANEL_FE, "grunfeld.csv")) === FROZEN_CHECKSUM);

// B. artifact validity
const bErrs = validateArtifacts(bundle, paths);
ok("B. generated bundle passes full validateArtifacts", bErrs.length === 0, JSON.stringify(bErrs));

// C. source fidelity (values obtained programmatically from the estimates artifact, not golden)
const estArtifact = bundle.estimates.estimates;
const rendered = renderValidated(bundle, paths, {});
ok("C0. renderer succeeds", rendered.ok === true, JSON.stringify(rendered.errors || []));
const rows = rendered.output.split("\n").filter((l) => l.startsWith("| "));
let fidelity = true, detail = "";
for (let i = 0; i < estArtifact.length && fidelity; i++) {
  const e = estArtifact[i];
  const expected = `| ${e.term} | ${fmt(e.estimate)} | ${fmt(e.std_error)} | ${fmt(e.p_value)} | ${e.n} |`;
  if (rows[i + 1] !== expected) { fidelity = false; detail = `row[${i}] got=${rows[i + 1]} want=${expected}`; }
}
ok("C. rendered term/estimate/std_error/p_value/n match the estimates artifact", fidelity, detail);

// D. determinism
const r2 = renderValidated(bundle, paths, {});
ok("D. two renders from same real-data bundle are byte-identical", r2.ok && r2.output === rendered.output);

// E. provenance enforcement
rmSync(MUT, { recursive: true, force: true }); mkdirSync(MUT, { recursive: true }); cpSync(BUNDLE, MUT, { recursive: true });
const estPath = join(MUT, "estimates.json"); const eo = JSON.parse(readFileSync(estPath, "utf8")); eo.estimates[0].estimate = 0.12; writeFileSync(estPath, JSON.stringify(eo, null, 2) + "\n", "utf8");
let { bundle: mb, paths: mp } = loadBundle(MUT);
ok("E1. modifying scientific artifact without rebuilding dependent provenance fails validation", validateArtifacts(mb, mp).length > 0, JSON.stringify(validateArtifacts(mb, mp)));
ok("E2. renderer fails before provenance rebuild", renderValidated(mb, mp, {}).ok === false);
rebuildStamp(MUT); rebuildArtifactManifest(MUT); rebuildPresentation(MUT);
({ bundle: mb, paths: mp } = loadBundle(MUT));
ok("E3. rebuilt dependent provenance restores validation", validateArtifacts(mb, mp).length === 0, JSON.stringify(validateArtifacts(mb, mp)));
ok("E4. rebuilt provenance renders changed output", renderValidated(mb, mp, {}).ok === true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

