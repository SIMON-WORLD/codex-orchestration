#!/usr/bin/env node
// economics.presentation.tables_figures capability contract regression.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateCapability } from "../core/validate_capability_schema.mjs";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cap = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/presentation.tables_figures.json"), "utf8"));
const index = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/index.json"), "utf8"));
const roles = JSON.parse(readFileSync(join(root, "domains/economics/roles.json"), "utf8")).roles;
const example = JSON.parse(readFileSync(join(root, "domains/economics/study_design.example.json"), "utf8"));
const registry = loadRegistry(join(root, "domains/economics/capabilities"));

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }

// 1. capability schema is valid
const schemaErrs = validateCapability(cap);
ok("1 capability schema is valid", schemaErrs.length === 0, schemaErrs.join("; "));

// 2. registry index contains the capability
ok("2 registry index contains economics.presentation.tables_figures", Array.isArray(index.capability_files) && index.capability_files.includes("presentation.tables_figures.json"));

// 3. empirical scope authorizes economics.presentation.*
const empirical = roles.find((r) => r.id === "empirical");
ok("3 empirical scope authorizes economics.presentation.*", (empirical.capability_scope || []).includes("economics.presentation.*"));

// 4. writing does not gain presentation/scientific execution scope
const writing = roles.find((r) => r.id === "writing");
ok("4 writing has no presentation/scientific execution scope", (writing.capability_scope || []).every((s) => !s.startsWith("economics.presentation.") && !s.startsWith("economics.regression.") && !s.startsWith("economics.causal.") && !s.startsWith("economics.stat.")), `scope=${(writing.capability_scope || []).join(",")}`);

// 5. no visualize Role returns
ok("5 no visualize Role returns", !roles.some((r) => r.id === "visualize"));

// 6. presentation implementation is only reference (not tested/verified)
const impls = cap.implementations || [];
ok("6 presentation implementations are reference only", impls.length > 0 && impls.every((i) => i.verification_status === "reference"), `statuses=${impls.map((i) => i.verification_status).join(",")}`);
ok("6b no tested/verified presentation implementation", !impls.some((i) => i.verification_status === "tested" || i.verification_status === "verified"));

// 7. current study_design.example.json unchanged in selected capabilities (no presentation)
const selectedEmpirical = example.selected_capabilities?.empirical || [];
ok("7 study_design.example selected capabilities unchanged (no presentation)", !selectedEmpirical.includes("economics.presentation.tables_figures") && selectedEmpirical.length === 2, `empirical=${selectedEmpirical.join(",")}`);

// 8. production resolver cannot silently treat reference-only medium-risk capability as production-ready
const study = { study_id: "t", domain: "economics", execution_context: { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] }, selected_capabilities: { empirical: ["economics.presentation.tables_figures"] }, decisions: {}, preconditions: {}, manual_validations: {} };
const res = resolveAll(study, registry, {}, { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] });
const capRes = res.capabilities["economics.presentation.tables_figures"];
ok("8 production resolver does not silently mark reference-only medium capability production-ready", capRes.resolution !== "resolved" && capRes.resolution === "needs_decision", `got=${capRes.resolution}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
