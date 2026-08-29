#!/usr/bin/env node
// Real-data Grunfeld estimate-table presentation benchmark (non-synthetic candidate evidence).
// Proves: source identity -> valid artifact/provenance bundle -> presentation binding -> deterministic estimate table.
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildGrunfeldBundle } from "./build_bundle.mjs";
import { loadBundle, renderValidated } from "../../../presentation/render_table.mjs";
import { renderValidated as renderFam, FAMILY_CONFIG } from "../../../presentation/render_family_table.mjs";
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
const ARTIFACT_FILE = { ESTIMATES_GRUNFELD: "estimates.json", DESCFACTS_GRUNFELD: "descriptive_facts.json", DIAGNOSTICS_GRUNFELD: "diagnostics.json", MODELREG_GRUNFELD: "model_registry.json" };
function rebuildPresentation(dir) {
  const pm = JSON.parse(readFileSync(join(dir, "presentation_manifest.json"), "utf8"));
  for (const v of pm.views) for (const s of v.source_refs) { const f = ARTIFACT_FILE[s.artifact_id]; if (f) s.source_hash = hashCanonicalJsonFile(join(dir, f)); }
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

// F. real-data family table evidence (descriptive_facts / diagnostics / model_registry)
const FAMILY_SOURCES = [
  { family: "descriptive_facts", file: "descriptive_facts.json" },
  { family: "diagnostics", file: "diagnostics.json" },
  { family: "model_registry", file: "model_registry.json" },
];
for (const fs of FAMILY_SOURCES) {
  const cfg = FAMILY_CONFIG[fs.family];
  const fr = renderFam(bundle, paths, { family: fs.family });
  ok(`F[${fs.family}] renderer succeeds`, fr.ok === true, JSON.stringify(fr.errors || []));
  const art = bundle[fs.family];
  const ids = art[cfg.list_key].map((x) => x[cfg.id_field]);
  const frows = fr.output.split("\n").filter((l) => l.startsWith("| "));
  let fid = true, fdet = "";
  for (let i = 0; i < ids.length; i++) {
    const item = art[cfg.list_key].find((x) => x[cfg.id_field] === ids[i]);
    const expected = "| " + cfg.columns.map((c) => c.fmt(item[c.key])).join(" | ") + " |";
    if (frows[i + 1] !== expected) { fid = false; fdet = `row[${i}] got=${frows[i + 1]} want=${expected}`; }
  }
  ok(`F[${fs.family}] source fidelity`, fid, fdet);
  const fr2 = renderFam(bundle, paths, { family: fs.family });
  ok(`F[${fs.family}] determinism`, fr2.ok && fr2.output === fr.output);
}

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

// G. family provenance enforcement (real-data)
const FAM_MUT = join(ROOT, "role-team-out/grunfeld_fam_mut");
const FAM_MUT_PATH = { descriptive_facts: ["facts", 0, "value"], diagnostics: ["diagnostics", 0, "value"], model_registry: ["models", 0, "clustering"] };
const FAM_MUT_VALUE = { descriptive_facts: 999, diagnostics: 777, model_registry: "cluster_firm" };
for (const fs of FAMILY_SOURCES) {
  rmSync(FAM_MUT, { recursive: true, force: true }); mkdirSync(FAM_MUT, { recursive: true }); cpSync(BUNDLE, FAM_MUT, { recursive: true });
  const cfg = FAMILY_CONFIG[fs.family];
  const fp = join(FAM_MUT, fs.file); const fo = JSON.parse(readFileSync(fp, "utf8"));
  let ptr = fo; const path = FAM_MUT_PATH[fs.family]; for (let i = 0; i < path.length - 1; i++) ptr = ptr[path[i]]; ptr[path[path.length - 1]] = FAM_MUT_VALUE[fs.family];
  writeFileSync(fp, JSON.stringify(fo, null, 2) + "\n", "utf8");
  let { bundle: fmB, paths: fmP } = loadBundle(FAM_MUT);
  ok(`G[${fs.family}] modifying source without rebuild -> render FAIL`, renderFam(fmB, fmP, { family: fs.family }).ok === false);
  rebuildStamp(FAM_MUT); rebuildArtifactManifest(FAM_MUT); rebuildPresentation(FAM_MUT);
  ({ bundle: fmB, paths: fmP } = loadBundle(FAM_MUT));
  const g2 = renderFam(fmB, fmP, { family: fs.family });
  ok(`G[${fs.family}] rebuild provenance -> render OK`, g2.ok === true, JSON.stringify(g2.errors || []));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

