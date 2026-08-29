#!/usr/bin/env node
// economics.presentation.tables / .tables.estimates / .figures capability contract regression.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCapability } from "../core/validate_capability_schema.mjs";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tablesCap = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/presentation.tables.json"), "utf8"));
const estimatesCap = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/presentation.tables.estimates.json"), "utf8"));
const figuresCap = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/presentation.figures.json"), "utf8"));
const index = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/index.json"), "utf8"));
const roles = JSON.parse(readFileSync(join(root, "domains/economics/roles.json"), "utf8")).roles;
const example = JSON.parse(readFileSync(join(root, "domains/economics/study_design.example.json"), "utf8"));
const benchmark = JSON.parse(readFileSync(join(root, "domains/economics/benchmarks/presentation/benchmark.presentation.json"), "utf8"));
const registry = loadRegistry(join(root, "domains/economics/capabilities"));

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
const inRegistry = (id) => Object.prototype.hasOwnProperty.call(registry, id);
const mkStudy = (capId) => ({ study_id: "t", domain: "economics", execution_context: { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] }, selected_capabilities: { empirical: [capId] }, decisions: {}, preconditions: {}, manual_validations: {} });
const nodeEnv = () => ({ runtime_instances: { "node.os": { runtime: "node", provider: "os", available: true, known: true, version: "24.0.0" } } });

// 1. three capability schemas valid
ok("1a tables schema valid", validateCapability(tablesCap).length === 0, validateCapability(tablesCap).join("; "));
ok("1b tables.estimates schema valid", validateCapability(estimatesCap).length === 0, validateCapability(estimatesCap).join("; "));
ok("1c figures schema valid", validateCapability(figuresCap).length === 0, validateCapability(figuresCap).join("; "));

// 2. active registry contains all three
ok("2a registry index contains presentation.tables", index.capability_files.includes("presentation.tables.json"));
ok("2b registry index contains presentation.tables.estimates", index.capability_files.includes("presentation.tables.estimates.json"));
ok("2c registry index contains presentation.figures", index.capability_files.includes("presentation.figures.json"));
ok("2d loaded registry has tables", inRegistry("economics.presentation.tables"));
ok("2e loaded registry has tables.estimates", inRegistry("economics.presentation.tables.estimates"));
ok("2f loaded registry has figures", inRegistry("economics.presentation.figures"));
ok("2g aggregate tables_figures absent", !inRegistry("economics.presentation.tables_figures"));

// 3. broad tables capability reference-only
const tablesImpls = tablesCap.implementations || [];
ok("3 broad tables is reference-only", tablesImpls.length > 0 && tablesImpls.every((i) => i.verification_status === "reference"), `statuses=${tablesImpls.map((i) => i.verification_status).join(",")}`);

// 4. local table renderer belongs only to tables.estimates
const estImpls = estimatesCap.implementations || [];
const figImpls = figuresCap.implementations || [];
ok("4a tables.estimates has local table renderer", estImpls.some((i) => i.id === "presentation.local.table_renderer"));
ok("4b broad tables does NOT have local table renderer", !tablesImpls.some((i) => i.id === "presentation.local.table_renderer"));
ok("4c figures does NOT have local table renderer", !figImpls.some((i) => i.id === "presentation.local.table_renderer"));

// 5. estimate-table implementation remains experimental
const estLocal = estImpls.find((i) => i.id === "presentation.local.table_renderer");
ok("5 estimate-table renderer verification_status is experimental", !!estLocal && estLocal.verification_status === "experimental");

// 6. benchmark binds only to tables.estimates
ok("6 benchmark capability_id is economics.presentation.tables.estimates", benchmark.capability_id === "economics.presentation.tables.estimates");

// 7. figure capability remains isolated (reference-only, no local renderer)
ok("7a figures has no script local implementation", !figImpls.some((i) => i.kind === "script"));
ok("7b figures has no tested/verified implementation", !figImpls.some((i) => i.verification_status === "tested" || i.verification_status === "verified"));

// 8. broad generic tables cannot become production-ready solely because estimate renderer exists
const resTbl = resolveAll(mkStudy("economics.presentation.tables"), registry, nodeEnv(), { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] });
const tblRes = resTbl.capabilities["economics.presentation.tables"];
ok("8a broad tables NOT resolved in production (reference-only, no workflow resource) even with node env", tblRes.resolution !== "resolved" && tblRes.resolution === "blocked", `got=${tblRes.resolution}`);

// 9. estimate-table capability can independently resolve (its own impl/env/status)
const resEst = resolveAll(mkStudy("economics.presentation.tables.estimates"), registry, nodeEnv(), { mode: "test", allow_experimental: true, preferred_runtimes: [], approved_overrides: [] });
const estRes = resEst.capabilities["economics.presentation.tables.estimates"];
ok("9 estimate-table capability independently resolves (test + experimental + node env)", estRes.resolution === "resolved" && estRes.selected_implementation?.id === "presentation.local.table_renderer", `got=${estRes.resolution} sel=${estRes.selected_implementation?.id}`);

// 10. empirical scope authorizes all three
const empirical = roles.find((r) => r.id === "empirical");
ok("10 empirical scope authorizes economics.presentation.*", (empirical.capability_scope || []).includes("economics.presentation.*"));

// 11. no visualize Role
ok("11 no visualize Role returns", !roles.some((r) => r.id === "visualize"));

// 12. canonical study example remains unchanged (no presentation)
const selEmp = example.selected_capabilities?.empirical || [];
ok("12 study_design.example unchanged (no presentation)", !selEmp.some((c) => c.startsWith("economics.presentation.")) && selEmp.length === 2, `empirical=${selEmp.join(",")}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
