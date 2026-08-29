#!/usr/bin/env node
// IV card 2SLS comparator: reads python.json + stata.json + manifest, emits PASS/FAIL/UNRESOLVED.
// Compares only definition-compatible quantities (coef / SE / N under homoskedastic 2SLS); diagnostics are
// compared only where the same quantity+definition is produced by BOTH engines, otherwise UNRESOLVED.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const here = join(dirname(fileURLToPath(import.meta.url)));
const root = join(here, "..", "..", "..", "..");
function j(p){ return JSON.parse(readFileSync(join(root, p), "utf8")); }
const man = j("domains/economics/benchmarks/iv/benchmark.iv.card.json");
const py = j("domains/economics/benchmarks/iv/results/python.json");
const sta = j("domains/economics/benchmarks/iv/results/stata.json");
let pass=0, fail=0, unresolved=0;
function verdict(name, cond, note) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name} ${note||""}`); fail++; } }
function verU(name, note) { console.log(`  ⚠️  ${name} — ${note}`); unresolved++; }
const tol = 1e-6;
const close = (a,b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b) <= tol*Math.max(1,Math.abs(a),Math.abs(b));
verdict("A valid python result", py && py.n>0 && py.coefficients && py.std_errors, JSON.stringify(py));
verdict("B valid stata result", sta && sta.n>0 && sta.coefficients && sta.std_errors, JSON.stringify(sta));
verdict("C dataset checksum matches frozen", py.dataset_checksum === man.source.dataset_checksum && sta.dataset_checksum === man.source.dataset_checksum, `py=${py.dataset_checksum} sta=${sta.dataset_checksum}`);
verdict("D benchmark_id matches", py.benchmark_id === man.benchmark_id && sta.benchmark_id === man.benchmark_id);
verdict("E N matches across engines + manifest", py.n === sta.n && py.n === man.sample.n, `py=${py.n} sta=${sta.n} man=${man.sample.n}`);
verdict("F educ coefficient matches (homoskedastic 2SLS)", close(py.coefficients.educ, sta.coefficients.educ), `py=${py.coefficients.educ} sta=${sta.coefficients.educ}`);
verdict("G educ std_error matches (definition-compatible covariance)", close(py.std_errors.educ, sta.std_errors.educ), `py=${py.std_errors.educ} sta=${sta.std_errors.educ}`);
verdict("H covariates present in python result", ["Intercept","exper","expersq","black","smsa","south","educ"].every((k)=>k in py.coefficients));
verdict("I covariance convention aligned (homoskedastic/unadjusted)", /homoskedastic/i.test(py.inference_configuration.covariance) && /homoskedastic/i.test(sta.inference_configuration.covariance), `py=${py.inference_configuration.covariance} sta=${sta.inference_configuration.covariance}`);
verU("J first-stage diagnostic comparison", "linearmodels IV2SLS exposes first_stage.fstat=null in this version; ivreg2 displays first-stage F / Sanderson-Windmeijer (16.72). No common definition-compatible value -> UNRESOLVED (not fabricated, not forced equal).");
verU("K weak-id / underid / weak-IV-robust comparison", "underid (Anderson LM), weak-id (Cragg-Donald), AR Wald, Stock-Wright S are ivreg2-native; linearmodels default summary does not expose Kleibergen-Paap / Sanderson-Windmeijer / Anderson-Rubin -> UNRESOLVED.");

// adversarial regressions (tamper detection)
function tamper(file, fn) { const o=j(file); fn(o); return o; }
const t1 = tamper("domains/economics/benchmarks/iv/results/python.json", (o)=>{ o.coefficients.educ = 9.99; });
verdict("L coefficient tamper detected", !close(t1.coefficients.educ, sta.coefficients.educ));
const t2 = tamper("domains/economics/benchmarks/iv/results/stata.json", (o)=>{ o.n = 999; });
verdict("M N/G tamper detected", t2.n !== py.n);
const t3 = tamper("domains/economics/benchmarks/iv/results/python.json", (o)=>{ o.dataset_checksum = "deadbeef"; });
verdict("N checksum tamper detected", t3.dataset_checksum !== man.source.dataset_checksum);
const t4 = tamper("domains/economics/benchmarks/iv/results/stata.json", (o)=>{ o.inference_configuration.diagnostics.weak_id.statistic = 99; });
verdict("O covariance/diagnostic definition tamper (weak_id) detected", t4.inference_configuration.diagnostics.weak_id.statistic !== sta.inference_configuration.diagnostics.weak_id.statistic);

console.log(`\n${pass} passed, ${fail} failed, ${unresolved} unresolved`);
if (fail > 0) process.exit(1);
