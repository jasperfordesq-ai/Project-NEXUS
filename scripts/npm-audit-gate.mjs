// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * npm-audit-gate — blocking production-dependency audit with a reviewed
 * exception list (the npm-audit equivalent of .trivyignore).
 *
 * Runs `npm audit --omit=dev --audit-level=high --json` for one tree and
 * fails on any HIGH/CRITICAL advisory that is not listed in
 * .npm-audit-exceptions.json for that tree. Exceptions must carry a reason
 * and an added date; review them quarterly alongside .trivyignore.
 *
 * Usage:
 *   node scripts/npm-audit-gate.mjs                       # root tree
 *   node scripts/npm-audit-gate.mjs --prefix react-frontend
 *   node scripts/npm-audit-gate.mjs --prefix mobile --package-lock-only
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const prefixIdx = args.indexOf('--prefix');
const prefix = prefixIdx >= 0 ? args[prefixIdx + 1] : '.';
const packageLockOnly = args.includes('--package-lock-only');

const BLOCKING_SEVERITIES = new Set(['high', 'critical']);

function loadExceptions() {
  try {
    const raw = JSON.parse(readFileSync(path.join(repoRoot, '.npm-audit-exceptions.json'), 'utf8'));
    return (raw.exceptions ?? []).filter((e) => e.id && (e.scope === prefix || e.scope === '*'));
  } catch {
    return [];
  }
}

function runAudit() {
  const npmArgs = ['audit', '--omit=dev', '--json'];
  if (packageLockOnly) npmArgs.push('--package-lock-only');
  // On Windows npm is npm.cmd, which needs a shell; pass one static string so
  // Node doesn't warn about unescaped args (DEP0190). All args are literals.
  const useShell = process.platform === 'win32';
  try {
    const out = useShell
      ? execFileSync(['npm', ...npmArgs].join(' '), {
          cwd: path.join(repoRoot, prefix),
          encoding: 'utf8',
          shell: true,
          maxBuffer: 64 * 1024 * 1024,
        })
      : execFileSync('npm', npmArgs, {
          cwd: path.join(repoRoot, prefix),
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        });
    return JSON.parse(out);
  } catch (err) {
    // npm audit exits 1 when it finds vulnerabilities — the JSON is on stdout.
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout);
      } catch {
        /* fall through */
      }
    }
    console.error(`npm-audit-gate: npm audit itself failed for ${prefix}: ${err.message}`);
    process.exit(2);
  }
}

function ghsaOf(via) {
  const m = /github\.com\/advisories\/(GHSA-[a-z0-9-]+)/i.exec(via.url ?? '');
  return m ? m[1] : String(via.source ?? '');
}

const exceptions = loadExceptions();
const report = runAudit();
const vulns = report.vulnerabilities ?? {};

const blockers = [];
const excepted = [];
for (const [pkg, info] of Object.entries(vulns)) {
  for (const via of info.via ?? []) {
    if (typeof via !== 'object') continue; // transitive chain entry, not an advisory
    if (!BLOCKING_SEVERITIES.has(via.severity)) continue;
    const id = ghsaOf(via);
    const exception = exceptions.find((e) => e.id === id);
    const line = `${pkg} ${info.range ?? ''} — ${via.severity.toUpperCase()} ${id}: ${via.title}`;
    if (exception) {
      excepted.push(`${line}\n    excepted (${exception.added}): ${exception.reason}`);
    } else {
      blockers.push(line);
    }
  }
}

const label = prefix === '.' ? 'root' : prefix;
if (excepted.length) {
  console.log(`npm-audit-gate [${label}]: ${excepted.length} excepted advisor${excepted.length === 1 ? 'y' : 'ies'} (review quarterly):`);
  for (const e of excepted) console.log(`  ${e}`);
}
if (blockers.length) {
  console.error(`npm-audit-gate [${label}]: BLOCKING — ${blockers.length} unexcepted high/critical advisor${blockers.length === 1 ? 'y' : 'ies'}:`);
  for (const b of blockers) console.error(`  ${b}`);
  console.error('Fix the dependency, or add a justified entry to .npm-audit-exceptions.json (reason + added date, scoped to this tree).');
  process.exit(1);
}
console.log(`npm-audit-gate [${label}]: OK (no unexcepted high/critical production advisories)`);
