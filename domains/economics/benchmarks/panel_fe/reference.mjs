#!/usr/bin/env node
// Independent panel_fe two-way FE + firm-cluster-robust reference calculator.
// Does NOT call linearmodels / fixest / reghdfe. Implements, from first principles:
//   two-way demean -> OLS slopes -> residuals -> firm-cluster sandwich -> small-sample
//   correction (canonical reghdfe/fixest convention).
// Canonical convention: cluster = firm; firm FE are nested in cluster -> excluded from K;
//   K = p (slopes) + n_years (non-nested year effects + overall constant).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { hashTextFile } from "../../../../core/artifact_hash.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..", "..");

function inv2(m) {
  const det = m[0][0]*m[1][1] - m[0][1]*m[1][0];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-15) throw new Error("singular 2x2");
  return [[m[1][1]/det, -m[0][1]/det], [-m[1][0]/det, m[0][0]/det]];
}
function groupMeanMap(vals, ids) {
  const sum = {}, cnt = {};
  for (let i=0;i<vals.length;i++){ const k=ids[i]; sum[k]=(sum[k]||0)+vals[i]; cnt[k]=(cnt[k]||0)+1; }
  const mean = {};
  for (const k of Object.keys(cnt)) mean[k] = sum[k]/cnt[k];
  return mean;
}
function demean(vals, ids, grand) {
  const mean = groupMeanMap(vals, ids);
  return vals.map((v,i)=> v - mean[ids[i]] - 0 + grand); // placeholder; overridden below
}
// two-way demean: y_it - ybar_firm_i - ybar_year_t + ybar_grand
function twoWayDemean(vals, firm, year) {
  const gf = groupMeanMap(vals, firm), gy = groupMeanMap(vals, year);
  const grand = vals.reduce((a,b)=>a+b,0)/vals.length;
  return vals.map((v,i)=> v - gf[firm[i]] - gy[year[i]] + grand);
}

export function referencePanelFe({ firm, year, y, x1, x2 }) {
  const n = firm.length;
  const yt = twoWayDemean(y, firm, year);
  const x1t = twoWayDemean(x1, firm, year);
  const x2t = twoWayDemean(x2, firm, year);
  const X = x1t.map((v,i)=>({ x1:v, x2:x2t[i], y:yt[i] }));
  // 2x2 XX, Xy
  let xx00=0,xx01=0,xx11=0, xy0=0, xy1=0;
  for (const r of X){ xx00+=r.x1*r.x1; xx01+=r.x1*r.x2; xx11+=r.x2*r.x2; xy0+=r.x1*r.y; xy1+=r.x2*r.y; }
  const invxx = inv2([[xx00,xx01],[xx01,xx11]]);
  const b0 = invxx[0][0]*xy0 + invxx[0][1]*xy1;
  const b1 = invxx[1][0]*xy0 + invxx[1][1]*xy1;
  // residuals
  const u = X.map(r => r.y - (r.x1*b0 + r.x2*b1));
  // firm-cluster sandwich
  const clusters = [...new Set(firm)];
  const G = clusters.length;
  let S00=0,S01=0,S11=0;
  for (const g of clusters){
    let s0=0,s1=0;
    for (let i=0;i<n;i++){ if (firm[i]===g){ s0 += x1t[i]*u[i]; s1 += x2t[i]*u[i]; } }
    S00+=s0*s0; S01+=s0*s1; S11+=s1*s1;
  }
  const A = [
    [invxx[0][0]*S00 + invxx[0][1]*S01, invxx[0][0]*S01 + invxx[0][1]*S11],
    [invxx[1][0]*S00 + invxx[1][1]*S01, invxx[1][0]*S01 + invxx[1][1]*S11],
  ];
  const V = [
    [A[0][0]*invxx[0][0] + A[0][1]*invxx[1][0], A[0][0]*invxx[0][1] + A[0][1]*invxx[1][1]],
    [A[1][0]*invxx[0][0] + A[1][1]*invxx[1][0], A[1][0]*invxx[0][1] + A[1][1]*invxx[1][1]],
  ];
  const se0 = Math.sqrt(Math.abs(V[0][0]));
  const se1 = Math.sqrt(Math.abs(V[1][1]));
  // canonical small-sample: K = p + n_years (nested firm FE excluded); f = G/(G-1)*(N-1)/(N-K)
  const p = 2;
  const nyears = new Set(year).size;
  const K = p + nyears;
  const f = (G/(G-1)) * ((n-1)/(n-K));
  const scale = Math.sqrt(f);
  return { beta: { x1: b0, x2: b1 }, se_raw: { x1: se0, x2: se1 }, se: { x1: se0*scale, x2: se1*scale }, n, G, K, factor: f, correction: { G_over_Gm1: G/(G-1), Nm1_over_NmK: (n-1)/(n-K) } };
}

function arg(name){ const i=process.argv.indexOf("--"+name); return i>=0?process.argv[i+1]:undefined; }
function readCsv(p){ const t=readFileSync(p,"utf8"); const lines=t.split(/\r?\n/).filter(l=>l.trim()!==""); const h=lines[0].split(",").map(s=>s.trim()); return lines.slice(1).map(l=>{ const c=l.split(",").map(s=>s.trim()); const o={}; h.forEach((k,i)=>o[k]=Number(c[i])); return o; }); }
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const csvPath = arg("csv"), yCol = arg("y")||"invest", x1Col = arg("x1")||"value", x2Col = arg("x2")||"capital", firmCol = arg("firm")||"firm", yearCol = arg("year")||"year";
  if (!csvPath) { console.error("用法：node reference.mjs --csv <file> [--y name --x1 name --x2 name --firm name --year name]"); process.exit(2); }
  const rows = readCsv(csvPath);
  const res = referencePanelFe({ firm: rows.map(r=>r[firmCol]), year: rows.map(r=>r[yearCol]), y: rows.map(r=>r[yCol]), x1: rows.map(r=>r[x1Col]), x2: rows.map(r=>r[x2Col]) });
  const out = { benchmark_id: "panel_fe_synthetic", dataset_checksum: hashTextFile(csvPath), ...res };
  if (arg("out")) writeFileSync(arg("out"), JSON.stringify(out,null,2)+"\n");
  console.log(JSON.stringify(out,null,2));
}

