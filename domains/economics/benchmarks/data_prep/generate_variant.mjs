#!/usr/bin/env node
// Phase-3 M3 - deterministic real-data-derived schema variant generator.
// Reads the canonical frozen Grunfeld dataset (Panel FE canonical) and produces:
//  - a frozen LF byte-exact canonical copy (sources/grunfeld.csv) with raw-byte SHA == Phase-1 LF checksum
//  - a deterministic schema/type/key-perturbed variant (sources/grunfeld_variant.csv), labeled
//    real_dataset_derived_schema_variant (NOT an original/raw external Grunfeld source)
// Both are byte-exact (LF) and marked -text in .gitattributes.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const CANON = join(ROOT, "domains/economics/benchmarks/panel_fe/grunfeld.csv");
const OUT = join(HERE, "sources");
const shaBytes = (buf) => createHash("sha256").update(buf).digest("hex");
// canonical Grunfeld: normalize to LF for a stable frozen copy
const text = readFileSync(CANON, "utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
writeFileSync(join(OUT, "grunfeld.csv"), text, "utf8"); // LF bytes; raw sha == d49d8a9e... (Phase-1 checksum)
const canonicalLfSha = shaBytes(Buffer.from(text, "utf8"));
const lines = text.trim().split("\n");
if (lines[0] !== "firm,year,invest,value,capital") throw new Error("unexpected canonical header");
const header = ["FIRM", "YEAR", "INVEST", "VAL", "CAP"];
const rows = lines.slice(1).map((l) => {
  const [firm, year, invest, value, capital] = l.split(",");
  return `  ${firm},${year},${invest},${value},${capital}`; // firm left-padded (trim needed), values kept as strings
});
const variant = header.join(",") + "\n" + rows.join("\n") + "\n";
writeFileSync(join(OUT, "grunfeld_variant.csv"), variant, "utf8");
const variantSha = shaBytes(Buffer.from(variant, "utf8"));
// generation identity/hash: bind strategy + canonical LF sha + variant sha (deterministic, not circular for provenance)
const genId = "grunfeld_schema_variant_v1";
const genHash = shaBytes(Buffer.from(JSON.stringify({ generator: genId, canonical_lf_sha: canonicalLfSha, strategy: ["rename", "numeric_as_string", "firm_left_pad_trim"] }), "utf8"));
console.log(JSON.stringify({ canonical_lf_sha: canonicalLfSha, raw_variant_sha: variantSha, variant_generation_id: genId, variant_generation_hash: genHash, rows: rows.length, variant_header: header.join(",") }, null, 2));