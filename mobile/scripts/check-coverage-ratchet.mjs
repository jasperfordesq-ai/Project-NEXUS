// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Mobile coverage ratchet — shrink-only, per area.
 *
 * A single global percentage is a poor gate for this codebase. `app/(modals)/`
 * alone is 10,343 instrumented lines out of 16,057, so it dominates the average:
 * the native-integration seams that actually break on a phone — secure storage,
 * Pusher, Stripe, the root layout's auth/deep-link/push wiring — could all go to
 * zero while the global number moved less than two points. Per-area floors mean
 * a regression is attributed to the area that caused it.
 *
 * The ratchet only ever tightens. A baseline floor may be raised (by running
 * with `--write-baseline` after a genuine improvement) but the check fails if a
 * floor would need to be LOWERED to pass. That is the same discipline as the
 * React quarantine budget and the PHP untranslated-strings ceiling.
 *
 * 🔴 It reads `coverage/coverage-summary.json`, which only exists after a run
 * with `--coverage`. A missing or stale report is reported as UNAVAILABLE and
 * exits non-zero. It never treats "no data" as "no regression".
 *
 * Usage:
 *   npm run test:coverage && node scripts/check-coverage-ratchet.mjs
 *   node scripts/check-coverage-ratchet.mjs --write-baseline
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(HERE, '..');
const SUMMARY = path.join(MOBILE_ROOT, 'coverage', 'coverage-summary.json');
const BASELINE = path.join(MOBILE_ROOT, 'coverage-baseline.json');

const WRITE = process.argv.slice(2).includes('--write-baseline');

/**
 * Areas are ordered most-specific first; a file is attributed to the first
 * prefix it matches. Single files are named where they are risky enough to
 * deserve their own floor rather than being averaged into a directory.
 */
const AREAS = [
  'lib/api',
  'lib/context',
  'lib/hooks',
  'lib/payments',
  'lib/security',
  'lib/storage.ts',
  'lib/realtime.ts',
  'lib/notifications.ts',
  'lib/theme',
  'lib/utils',
  'lib/events',
  'lib/eventOfflineCheckinStore.ts',
  'lib',
  'app/_layout.tsx',
  'app/(auth)',
  'app/(tabs)',
  'app/(modals)',
  'app',
  'components/ui',
  'components/events',
  'components/federation',
  'components/marketplace',
  'components/comments',
  'components/reactions',
  'components/verification',
  'components',
];

function relative(absPath) {
  return path
    .relative(MOBILE_ROOT, absPath)
    .split(path.sep)
    .join('/');
}

function areaOf(rel) {
  const lower = rel.toLowerCase();
  for (const area of AREAS) {
    const a = area.toLowerCase();
    if (lower === a || lower.startsWith(`${a}/`)) return area;
  }
  return '(other)';
}

function loadSummary() {
  if (!fs.existsSync(SUMMARY)) {
    console.error('coverage ratchet: UNAVAILABLE — coverage/coverage-summary.json is missing.');
    console.error('coverage ratchet: run `npm run test:coverage` first. No data is not a pass.');
    process.exit(2);
  }
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(SUMMARY, 'utf8'));
  } catch (err) {
    console.error(`coverage ratchet: UNAVAILABLE — could not parse the coverage summary: ${err.message}`);
    process.exit(2);
  }

  const byArea = new Map();
  let files = 0;
  for (const [key, value] of Object.entries(doc)) {
    if (key === 'total') continue;
    files += 1;
    const rel = relative(key);
    const area = areaOf(rel);
    if (!byArea.has(area)) byArea.set(area, { covered: 0, total: 0, files: 0 });
    const entry = byArea.get(area);
    entry.covered += value.lines.covered;
    entry.total += value.lines.total;
    entry.files += 1;
  }

  if (files === 0) {
    console.error('coverage ratchet: UNAVAILABLE — the coverage summary contains no files.');
    process.exit(2);
  }

  const total = doc.total;
  return {
    files,
    global: {
      lines: total.lines.pct,
      statements: total.statements.pct,
      branches: total.branches.pct,
      functions: total.functions.pct,
    },
    areas: Object.fromEntries(
      [...byArea.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([area, d]) => [
        area,
        { pct: d.total === 0 ? 100 : Number(((100 * d.covered) / d.total).toFixed(2)), lines: d.total, files: d.files },
      ])
    ),
  };
}

function writeBaseline(measured) {
  const baseline = {
    note:
      'Shrink-only coverage floors for the Expo client, by area. Raise a floor only ' +
      'after a real improvement; never lower one to make a red check green. Regenerate ' +
      'with `node scripts/check-coverage-ratchet.mjs --write-baseline` after running ' +
      '`npm run test:coverage`.',
    measured_on_files: measured.files,
    global_floor: {
      lines: floorOf(measured.global.lines),
      statements: floorOf(measured.global.statements),
      branches: floorOf(measured.global.branches),
      functions: floorOf(measured.global.functions),
    },
    area_floors: Object.fromEntries(
      Object.entries(measured.areas).map(([area, d]) => [area, { lines_pct: floorOf(d.pct), instrumented_lines: d.lines }])
    ),
  };
  fs.writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(`coverage ratchet: wrote baseline for ${Object.keys(baseline.area_floors).length} areas to coverage-baseline.json`);
}

/**
 * Floors sit slightly under the measured value. Instrumented-line counts shift
 * by a line or two with unrelated edits, so an exact-equality floor produces
 * failures that teach people to re-baseline reflexively — which is how a ratchet
 * stops meaning anything. 0.5pc of slack absorbs noise without hiding a real slide.
 */
function floorOf(pct) {
  return Number(Math.max(0, pct - 0.5).toFixed(2));
}

function main() {
  const measured = loadSummary();

  if (WRITE) {
    writeBaseline(measured);
    return;
  }

  if (!fs.existsSync(BASELINE)) {
    console.error('coverage ratchet: no coverage-baseline.json — create one with --write-baseline.');
    process.exit(2);
  }

  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const failures = [];
  const improvements = [];

  for (const [metric, floor] of Object.entries(baseline.global_floor || {})) {
    const actual = measured.global[metric];
    if (actual + 1e-9 < floor) failures.push(`global ${metric}: ${actual.toFixed(2)}% is below the floor of ${floor}%`);
  }

  for (const [area, spec] of Object.entries(baseline.area_floors || {})) {
    const actual = measured.areas[area];
    if (!actual) {
      // An area that vanished is usually a rename, not a win. Say so rather than
      // silently dropping its floor.
      failures.push(`area ${area}: present in the baseline but absent from the coverage report (renamed or deleted?)`);
      continue;
    }
    if (actual.pct + 1e-9 < spec.lines_pct) {
      failures.push(
        `area ${area}: lines ${actual.pct.toFixed(2)}% is below the floor of ${spec.lines_pct}% ` +
          `(${actual.files} files, ${actual.lines} instrumented lines)`
      );
    } else if (actual.pct > spec.lines_pct + 5) {
      improvements.push(`area ${area}: ${actual.pct.toFixed(2)}% vs floor ${spec.lines_pct}% — raise the floor`);
    }
  }

  const newAreas = Object.keys(measured.areas).filter((a) => !(baseline.area_floors || {})[a]);

  console.log(
    `coverage ratchet: global lines ${measured.global.lines.toFixed(2)}%, ` +
      `statements ${measured.global.statements.toFixed(2)}%, ` +
      `branches ${measured.global.branches.toFixed(2)}%, ` +
      `functions ${measured.global.functions.toFixed(2)}% over ${measured.files} files`
  );

  for (const a of newAreas) {
    console.log(`coverage ratchet: NEW area ${a} at ${measured.areas[a].pct.toFixed(2)}% — add a floor with --write-baseline`);
  }
  for (const i of improvements) console.log(`coverage ratchet: improved — ${i}`);

  if (failures.length) {
    console.error('');
    for (const f of failures) console.error(`coverage ratchet: REGRESSION ${f}`);
    console.error('');
    console.error('coverage ratchet: coverage went backwards. Add tests for what you changed.');
    console.error('coverage ratchet: do NOT lower a floor to make this pass.');
    process.exit(1);
  }

  console.log('coverage ratchet: OK — every area is at or above its floor.');
}

main();
