#!/usr/bin/env node
/**
 * Contract-boundary test (no test framework).
 *
 * Scans src/ for RMF-specific import/require specifiers. Platform-native code
 * must never know RMF; the ONLY declared exceptions are:
 *   - src/rmf-proxy/**            (the RMF-compatible pass-through layer)
 *   - src/workflows/rmf-tasks.ts  (JSON payload builders for the coordinator)
 *
 * A relative import that resolves to one of the declared exception modules
 * is allowed (they ARE the boundary, and the bootstrap must mount the proxy
 * while the saga/device plugins must call the payload helpers); any other
 * specifier matching the forbidden pattern (an RMF SDK/package/module)
 * fails the build.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(root, "..", "src");

const FORBIDDEN = /rmf_|rmf-|openrmf/i;
const EXCLUDED_DIRS = [path.join(srcDir, "rmf-proxy")];
const EXCLUDED_FILES = [path.join(srcDir, "workflows", "rmf-tasks.ts")];
const ALLOWED_TARGETS = [
  path.join(srcDir, "workflows", "rmf-tasks"),
  path.join(srcDir, "rmf-proxy"),
  path.join(srcDir, "rmf-proxy", "index"),
];

const IMPORT_RE =
  /(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)|import\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (EXCLUDED_DIRS.some((d) => full === d)) continue;
      files.push(...walk(full));
    } else if (full.endsWith(".ts") && !EXCLUDED_FILES.includes(full)) {
      files.push(full);
    }
  }
  return files;
}

function isAllowedRelativeException(file, specifier) {
  if (!specifier.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(file), specifier);
  return ALLOWED_TARGETS.includes(resolved);
}

const violations = [];
for (const file of walk(srcDir)) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(IMPORT_RE)) {
    const specifier = match[1] ?? match[2] ?? match[3] ?? match[4];
    if (specifier === undefined) continue;
    if (!FORBIDDEN.test(specifier)) continue;
    if (isAllowedRelativeException(file, specifier)) continue;
    violations.push({ file: path.relative(path.join(root, ".."), file), specifier });
  }
}

if (violations.length > 0) {
  console.error("CONTRACT BOUNDARY VIOLATIONS (RMF-specific imports in platform-native code):");
  for (const v of violations) console.error(`  ${v.file} -> "${v.specifier}"`);
  process.exit(1);
}

console.log("contract-boundary: OK (no RMF-specific imports outside declared exceptions)");
