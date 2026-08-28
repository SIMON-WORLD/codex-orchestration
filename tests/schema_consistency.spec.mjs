#!/usr/bin/env node
// 轻量 schema 一致性：schema oneOf 必须 $ref 到存在且锁定 artifact_type const 的 $defs；与 deterministic validator 的 EXPECTED_TYPE 一致。
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_TYPE } from "../core/validate_artifacts.mjs";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
function schemaConsts(file) {
  const s = JSON.parse(readFileSync(join(root, "core/schemas/" + file), "utf8"));
  const out = [];
  for (const br of s.oneOf || []) {
    if (!br.$ref) { check(`${file}: oneOf branch 缺 $ref`, false); continue; }
    const defKey = br.$ref.replace("#/$defs/", "");
    const def = s.$defs?.[defKey];
    if (!def) { check(`${file}: $ref 指向不存在 $defs ${defKey}`, false); continue; }
    const t = def.properties?.artifact_type?.const;
    if (!t) { check(`${file}: $defs ${defKey} 未锁定 artifact_type const`, false); continue; }
    out.push(t);
  }
  return out;
}
const dataTypes = schemaConsts("artifact.data.schema.json");
const empTypes = schemaConsts("artifact.empirical.schema.json");
const mtType = schemaConsts("artifact.multiple_testing.schema.json");
check("data schema consts 符合期望", JSON.stringify(dataTypes.sort()) === JSON.stringify(["data_manifest","descriptive_facts","sample_flow","variable_dictionary"].sort()));
check("empirical schema consts 符合期望", JSON.stringify(empTypes.sort()) === JSON.stringify(["diagnostics","estimates","model_registry"].sort()));
check("multiple_testing schema const 符合期望", JSON.stringify(mtType.sort()) === JSON.stringify(["multiple_testing"].sort()));
check("schema consts 都在 validator EXPECTED_TYPE", [...dataTypes, ...empTypes, ...mtType].every((t) => EXPECTED_TYPE[t] === t));
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
