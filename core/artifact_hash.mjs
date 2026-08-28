#!/usr/bin/env node
// 领域无关的 canonical-JSON SHA-256 utility。
// 同一 JSON 语义（忽略 CRLF/LF、缩进、空白、对象 key 顺序）必须得到相同 hash；真实 value 改变则 hash 不同。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("canonicalJson: non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return "[" + value.map((v) => canonicalJson(v)).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  }
  throw new Error("canonicalJson: unsupported type " + typeof value);
}

export const CANONICAL_HASH_MODE = "canonical_json_sha256_v1";
export function hashCanonicalJsonObject(obj) {
  return createHash("sha256").update(canonicalJson(obj), "utf8").digest("hex");
}
export function hashCanonicalJsonFile(path) {
  const obj = JSON.parse(readFileSync(path, "utf8"));
  return hashCanonicalJsonObject(obj);
}
export function hashRawFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
export const CANONICAL_TEXT_HASH_MODE = "text_file_sha256_lf";
export function normalizeLf(text) {
  return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
export function hashTextFile(path) {
  return createHash("sha256").update(normalizeLf(readFileSync(path, "utf8")), "utf8").digest("hex");
}
