#!/usr/bin/env node
// economics.presentation.tables / economics.presentation.figures capability contract regression.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCapability } from "../core/validate_capability_schema.mjs";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tablesCap = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/presentation.tables.json"), "utf8"));
const figuresCap = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/presentation.figures.json"), "utf8"));
const index = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/index.json"), "utf8"));
const roles = JSON.parse(readFileSync(join(root, "domains/economics/roles.json"), "utf8")).roles;
const example = JSON.parse(readFileSync(join(root, "domains/economics/study_design.example.json"), "utf8"));
const benchmark = JSON.parse(readFileSync(join(root, "domains/economics/benchmarks/presentation/benchmark.presentation.json"), "utf8"));
const registry = loadRegistry(join(root, "domains/economics/capabilities"));

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
const inRegistry = (id) => Object.prototype.hasOwnProperty.call(registry, id);

// 1. both capability schemas valid
ok("1a tables capability schema valid", validateCapability(tablesCap).length === 0, validateCapability(tablesCap).join("; "));
ok("1b figures capability schema valid", validateCapability(figuresCap).length === 0, validateCapability(figuresCap).join("; "));

// 2. active registry contains both new capabilities
ok("2a registry index contains presentation.tables", Array.isArray(index.capability_files) && index.capability_files.includes("presentation.tables.json"));
ok("2b registry index contains presentation.figures", Array.isArray(index.capability_files) && index.capability_files.includes("presentation.figures.json"));

// 3. active registry no longer contains the retired aggregate
ok("3a registry index does NOT contain presentation.tables_figures", !index.capability_files.includes("presentation.tables_figures.json"));
ok("3b loaded registry does NOT have economics.presentation.tables_figures", !inRegistry("economics.presentation.tables_figures"));

// 4. local table renderer belongs only to tables
const tableImpls = tablesCap.implementations || [];
const figImpls = figuresCap.implementations || [];
ok("4a tables capability has local table renderer", tableImpls.some((i) => i.id === "presentation.local.table_renderer"));
ok("4b figures capability does NOT have local table renderer", !figImpls.some((i) => i.id === "presentation.local.table_renderer"));

// 5. table renderer remains experimental
const tableLocal = tableImpls.find((i) => i.id === "presentation.local.table_renderer");
ok("5 table renderer verification_status is experimental", !!tableLocal && tableLocal.verification_status === "experimental");

// 6. figures capability has no tested/verified local implementation
ok("6a figures has no tested/verified implementation", !figImpls.some((i) => i.verification_status === "tested" || i.verification_status === "verified"));
ok("6b figures has no script-kind local implementation", !figImpls.some((i) => i.kind === "script"));

// 7. empirical scope authorizes both via economics.presentation.*
const empirical = roles.find((r) => r.id === "empirical");
ok("7 empirical scope authorizes economics.presentation.*", (empirical.capability_scope || []).includes("economics.presentation.*"));

// 8. no visualize Role returns
ok("8 no visualize Role returns", !roles.some((r) => r.id === "visualize"));

// 9. canonical study example still does not select presentation
const selectedEmpirical = example.selected_capabilities?.empirical || [];
ok("9 study_design.example selected capabilities unchanged (no presentation)", !selectedEmpirical.some((c) => c.startsWith("economics.presentation.")) && selectedEmpirical.length === 2, `empirical=${selectedEmpirical.join(",")}`);

// 10. production resolver cannot treat figure capability as ready merely because the table renderer exists
const mkStudy = (capId) => ({ study_id: "t", domain: "economics", execution_context: { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] }, selected_capabilities: { empirical: [capId] }, decisions: {}, preconditions: {}, manual_validations: {} });
const resFig = resolveAll(mkStudy("economics.presentation.figures"), registry, {}, { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] });
const figRes = resFig.capabilities["economics.presentation.figures"];
ok("10a production resolver blocks figure capability (reference-only, hard_stop, no env)", figRes.resolution === "blocked" && figRes.reason === "no_available_implementation_hard_stop", `got=${figRes.resolution}/${figRes.reason}`);
ok("10b figure capability NOT resolved merely because table renderer exists", figRes.resolution !== "resolved");
const resTbl = resolveAll(mkStudy("economics.presentation.tables"), registry, {}, { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] });
const tblRes = resTbl.capabilities["economics.presentation.tables"];
ok("10c tables capability also blocked in production (experimental/none; no env)", tblRes.resolution === "blocked", `got=${tblRes.resolution}`);

// 11. table benchmark identifies only economics.presentation.tables
ok("11 table benchmark capability_id is economics.presentation.tables", benchmark.capability_id === "economics.presentation.tables");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
