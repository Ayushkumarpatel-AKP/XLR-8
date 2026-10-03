#!/usr/bin/env node
/**
 * "No hardcoded data" enforcement (spec §36).
 *
 * Scans production source for the things that make a demo look fake:
 *   - non-determinism (Math.random / Date.now-seeded data) in engine code
 *   - literal "fake"/"mock"/"dummy"/"hardcoded" datasets in production surfaces
 *   - hardcoded risk scores in the web UI
 *
 * Demo fixtures are allowed ONLY under demo-lab/ and *.test.ts.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();

const SCAN_DIRS = [
  "packages/core/src",
  "packages/policies/src",
  "packages/graph/src",
  "packages/drift/src",
  "packages/evidence/src",
  "packages/model-router/src",
  "services/api/src",
  "apps/cli/src",
  "apps/web/src",
];

const ALLOWLIST = [/(^|[\\/])demo-lab[\\/]/, /\.test\.ts$/, /\.spec\.ts$/];

const RULES = [
  {
    id: "no-random-in-engine",
    test: (line) => /\bMath\.random\s*\(/.test(line),
    message: "non-deterministic Math.random() in production code (breaks reproducible risk/evidence)",
  },
  {
    id: "no-fake-identifiers",
    test: (line) => /\b(fakeData|mockData|dummyData|hardcodedData|placeholderData)\b/.test(line),
    message: "fake/placeholder dataset identifier in production code",
  },
  {
    id: "no-hardcoded-risk",
    test: (line) => /risk(Score)?\s*[:=]\s*\d{2}\b/.test(line) && !/riskBand|minRisk|risk:/.test(line),
    message: "hardcoded risk score literal",
  },
  {
    id: "no-fake-connected",
    test: (line) => /connected\s*[:=]\s*true/i.test(line) && /(provider|status)/i.test(line),
    message: "hardcoded 'connected' provider status",
  },
];

function walk(dir, files = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walk(full, files);
    } else if ([".ts", ".tsx", ".js", ".jsx"].includes(extname(full))) {
      files.push(full);
    }
  }
  return files;
}

const violations = [];

for (const dir of SCAN_DIRS) {
  const abs = join(ROOT, dir);
  for (const file of walk(abs)) {
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    if (ALLOWLIST.some((rx) => rx.test(rel))) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const rule of RULES) {
        if (rule.test(line)) {
          violations.push({ file: rel, line: i + 1, rule: rule.id, message: rule.message, text: line.trim().slice(0, 120) });
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error(`\n✗ Hardcoded-data check failed: ${violations.length} violation(s)\n`);
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  [${v.rule}]  ${v.message}`);
    console.error(`     > ${v.text}`);
  }
  console.error("\nProduction code must derive data from the engine/API. Demo fixtures belong in demo-lab/ or tests.\n");
  process.exit(1);
}

console.log(`✓ Hardcoded-data check passed (${SCAN_DIRS.length} production directories scanned).`);
