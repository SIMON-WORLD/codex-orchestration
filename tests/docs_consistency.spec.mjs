#!/usr/bin/env node
// docs consistency regression（P6）：确保“文档与真实实现一致”。
// 重点是：strict v1.3 为默认科研路径、legacy_v1_2 明确定位为 compat，
// 且不宣称 high-risk 已 verified。
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
function check(name, cond, detail) { if (cond) { console.log(`  ✅ ${name}`); pass++; } else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; } }
const read = (p) => readFileSync(join(root, p), "utf8");
const README = read("README.md");
const DOC06 = read("docs/06-role-team.md");

const idx = DOC06.indexOf("## Legacy v1.2 Compatibility");
const strict = idx >= 0 ? DOC06.slice(0, idx) : DOC06;

// A. README quickstart 指向 strict v1.3 角色包
check("README quickstart 指向 domains/economics/roles.json", README.includes("domains/economics/roles.json"));
// B. README 明确 legacy_v1_2 + not production-verified
check("README 明确 legacy_v1_2 compatibility", README.includes("legacy_v1_2") && README.includes("not production-verified"));
// C. README 不宣称 high-risk 已验证（真实 registry 无 verified）
{
  const dir = join(root, "domains/economics/capabilities");
  let anyVerified = false, highVerified = false, totalImpl = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json") || f === "index.json") continue;
    const c = JSON.parse(readFileSync(join(dir, f), "utf8"));
    for (const i of c.implementations || []) {
      totalImpl++;
      if (i.verification_status === "verified") anyVerified = true;
      if (i.verification_status === "verified" && c.risk_level === "high") highVerified = true;
    }
  }
  check("真实 registry 无 verified implementation（文档不虚标）", !anyVerified, `implementations=${totalImpl}`);
  check("无 verified high-risk capability", !highVerified);
}
// D–G. docs/06 strict 主体包含关键概念
check("docs/06 strict 含 selected_capabilities", strict.includes("selected_capabilities"));
check("docs/06 strict 含 capability_scope", strict.includes("capability_scope"));
check("docs/06 strict 含 dispatch_allowed", strict.includes("dispatch_allowed"));
check("docs/06 strict 含 resolved / needs_decision / blocked", strict.includes("resolved") && strict.includes("needs_decision") && strict.includes("blocked"));
check("docs/06 strict 不含 methodology.steps 静默回退", !strict.includes("methodology.steps"));
check("docs/06 strict 不含“已验证”声明", !strict.includes("已验证"));
// H. 关键引用路径存在
const paths = ["core/scaffold_role_team.mjs", "domains/economics/roles.json", "domains/economics/study_design.example.json", "domains/economics/capabilities/index.json"];
check("关键引用路径存在", paths.every((p) => existsSync(join(root, p))));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
