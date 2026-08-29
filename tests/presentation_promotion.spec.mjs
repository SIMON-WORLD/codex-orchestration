#!/usr/bin/env node
// presentation.local.table_renderer promotion (experimental -> tested) resolver/admission regression.
// Proves the promotion has the intended runtime effect and does NOT broaden sibling capability scope.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAll, loadRegistry } from "../core/resolve_capabilities.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const registry = loadRegistry(join(root, "domains/economics/capabilities"));
const tablesCap = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/presentation.tables.json"), "utf8"));
const estimatesCap = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/presentation.tables.estimates.json"), "utf8"));
const figuresCap = JSON.parse(readFileSync(join(root, "domains/economics/capabilities/presentation.figures.json"), "utf8"));

let pass = 0, fail = 0;
function ok(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}${detail ? " — " + detail : ""}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
const mkStudy = (capId) => ({ study_id: "t", domain: "economics", execution_context: { mode: "production", allow_experimental: false, preferred_runtimes: [], approved_overrides: [] }, selected_capabilities: { empirical: [capId] }, decisions: {}, preconditions: {}, manual_validations: {} });
const nodeEnv = () => ({ runtime_instances: { "node.os": { runtime: "node", provider: "os", available: true, known: true, version: "24.0.0" } } });
const resolve = (capId, env, ctx) => { const s = mkStudy(capId); if (ctx) { s.execution_context.mode = ctx.mode || "production"; s.execution_context.allow_experimental = !!ctx.allow_experimental; } return resolveAll(s, registry, env || nodeEnv(), { mode: s.execution_context.mode, allow_experimental: s.execution_context.allow_experimental, preferred_runtimes: [], approved_overrides: [] }).capabilities[capId]; };

// A. Production + Node runtime available -> estimate-table resolves to the tested renderer
const a = resolve("economics.presentation.tables.estimates", nodeEnv(), { mode: "production" });
ok("A production resolves estimate-table to local renderer (tested)", a.resolution === "resolved" && a.selected_implementation?.id === "presentation.local.table_renderer" && a.verification_status === "tested", `res=${a.resolution} sel=${a.selected_implementation?.id} vs=${a.verification_status}`);

// B. generic tables capability remains reference-only / not resolved to the estimate-table renderer
const b = resolve("economics.presentation.tables", nodeEnv(), { mode: "production" });
ok("B generic tables NOT resolved to estimate-table renderer (reference-only)", b.resolution !== "resolved" && !b.selected_implementation, `res=${b.resolution} sel=${b.selected_implementation?.id}`);

// C. figures capability remains reference-only / not resolved to the estimate-table renderer
const c = resolve("economics.presentation.figures", nodeEnv(), { mode: "production" });
ok("C figures NOT resolved to estimate-table renderer (reference-only)", c.resolution !== "resolved" && !c.selected_implementation, `res=${c.resolution} sel=${c.selected_implementation?.id}`);

// D. No cross-capability bleed: tested impl only in the concrete estimate-table capability
const estImpls = estimatesCap.implementations || [];
const tablesImpls = tablesCap.implementations || [];
const figImpls = figuresCap.implementations || [];
ok("D1 tested local renderer present only in tables.estimates", estImpls.some((i) => i.id === "presentation.local.table_renderer" && i.verification_status === "tested"));
ok("D2 generic tables does not contain the local renderer", !tablesImpls.some((i) => i.id === "presentation.local.table_renderer"));
ok("D3 figures does not contain the local renderer", !figImpls.some((i) => i.id === "presentation.local.table_renderer"));

// E. existing test/development environment semantics remain unchanged (test mode still resolves; production tested resolves)
const e1 = resolve("economics.presentation.tables.estimates", nodeEnv(), { mode: "test", allow_experimental: true });
ok("E1 test mode + allow_experimental still resolves estimate-table", e1.resolution === "resolved" && e1.selected_implementation?.id === "presentation.local.table_renderer", `res=${e1.resolution}`);
const e2 = resolve("economics.presentation.tables.estimates", nodeEnv(), { mode: "production" });
ok("E2 production + tested renderer resolves (frozen medium-risk policy)", e2.resolution === "resolved" && e2.verification_status === "tested", `res=${e2.resolution} vs=${e2.verification_status}`);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
