// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Fail when the committed route matrix / API ledger no longer describe the code.
 *
 * 🔴 Why this exists. The route matrix is described throughout the documentation
 * as a "live drift alarm": a Laravel accessible route that `web-uk` has not built
 * is supposed to surface here as a missing route. It was not live. Nothing
 * regenerated it, so it was only ever as current as the last time somebody
 * remembered to run it by hand — and on 2026-08-12 it was found stale, reporting
 * 721 `web-uk` routes against 722 in the code. That particular gap was harmless
 * (the extra route was `/version`). A MISSING route would have hidden exactly as
 * quietly.
 *
 * 🔴 Why this is not `git diff`. The artefacts stamp `generatedAt`, the commit
 * SHA, the working-tree dirty flag and ABSOLUTE source paths. On a CI runner all
 * four differ from whatever was committed on a developer machine, so a plain diff
 * would fail on every single run and be switched off within a week. This compares
 * the summary counts, which are the part that carries meaning, and ignores the
 * provenance and machine-specific fields by construction.
 *
 * Run AFTER regenerating both artefacts:
 *   npm run route:matrix && npm run api:ledger && node scripts/check-generated-artefacts-current.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

const ARTEFACTS = [
  {
    label: 'route matrix',
    repoPath: 'web-uk/docs/generated/accessible-route-matrix.json',
    regenerate: 'npm --prefix web-uk run route:matrix',
  },
  {
    label: 'API consumer ledger',
    repoPath: 'web-uk/docs/generated/frontend-api-consumer-ledger.json',
    regenerate: 'npm --prefix web-uk run api:ledger',
  },
];

// Fields that legitimately differ between two honest runs on different machines.
const VOLATILE_SUMMARY_KEYS = new Set(['generatedAt', 'sourceRoot', 'targetRoot']);

function comparableSummary(parsed) {
  const summary = parsed && typeof parsed.summary === 'object' && parsed.summary !== null
    ? parsed.summary
    : {};
  const out = {};
  for (const key of Object.keys(summary).sort()) {
    if (VOLATILE_SUMMARY_KEYS.has(key)) continue;
    out[key] = summary[key];
  }
  return out;
}

function committedCopy(repoPath) {
  try {
    return execFileSync('git', ['show', `HEAD:${repoPath}`], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

const problems = [];

for (const artefact of ARTEFACTS) {
  const absolute = path.join(REPO_ROOT, artefact.repoPath);
  if (!fs.existsSync(absolute)) {
    problems.push(`${artefact.repoPath} does not exist. Run \`${artefact.regenerate}\`.`);
    continue;
  }

  const fresh = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  const committedRaw = committedCopy(artefact.repoPath);
  if (committedRaw === null) {
    problems.push(`${artefact.repoPath} is not committed, so there is nothing to compare against.`);
    continue;
  }

  const freshSummary = comparableSummary(fresh);
  const committedSummary = comparableSummary(JSON.parse(committedRaw));

  for (const key of Object.keys(freshSummary)) {
    const before = JSON.stringify(committedSummary[key]);
    const after = JSON.stringify(freshSummary[key]);
    if (before !== after) {
      // familyCounts is a large object; report it as a single changed field
      // rather than dumping it, and let the diff below carry the detail.
      const detail = key === 'familyCounts' ? '(per-family counts changed)' : `${before} -> ${after}`;
      problems.push(`${artefact.label}: \`${key}\` ${detail}`);
    }
  }
}

// The alarm itself, independent of whether anything drifted: a Laravel accessible
// route that web-uk has not built must fail, even if the committed artefact
// already recorded it as missing.
const matrixPath = path.join(REPO_ROOT, 'web-uk/docs/generated/accessible-route-matrix.json');
if (fs.existsSync(matrixPath)) {
  const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
  const missing = Number(matrix?.summary?.missingRoutes ?? 0);
  if (missing > 0) {
    problems.push(
      `route matrix: ${missing} Laravel accessible route(s) have no web-uk counterpart. `
      + 'This is the drift alarm firing — see the Missing Routes table in '
      + 'web-uk/docs/generated/accessible-route-matrix.md.'
    );
  }
}

if (problems.length === 0) {
  console.log('Generated artefacts are current: summary counts match the committed copies, 0 missing routes.');
  process.exit(0);
}

console.error('Generated artefacts are NOT current.\n');
problems.forEach((problem) => console.error(`  - ${problem}`));
console.error(
  '\nRegenerate both back to back, commit the result, and correct'
  + '\nweb-uk/docs/CURRENT_WEBUK_PRODUCTION_STATUS.md to match:'
  + '\n  npm --prefix web-uk run route:matrix && npm --prefix web-uk run api:ledger'
  + '\n🔴 The artefacts are the truth. Correct the document, never the evidence.'
);
process.exit(1);
