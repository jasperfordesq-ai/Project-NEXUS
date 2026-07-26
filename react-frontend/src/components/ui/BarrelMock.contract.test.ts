// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 DO NOT MOVE THIS FILE.
 *
 * It lives in `src/components/ui/` on purpose: `npm run test:ui-contracts` runs
 * that whole directory and is a BLOCKING step in the `react-build` job of
 * .github/workflows/ci.yml. Relocating it to `src/test/` would silently stop it
 * running — `src/test/` is in no CI selection at all, which is exactly how the
 * dead-barrel-mock defect went unnoticed across ~1,230 ungated test files (see
 * src/test/mount-guard-convention.test.ts and src/test/heroui-visual-contract.test.ts,
 * both of which sit in no CI selection today). `tsc --noEmit` excludes every
 * `.test.ts(x)` file and ESLint ignores them, so RUNNING this is the only gate.
 *
 * WHAT IT ENFORCES
 * ----------------
 * A shrink-only ratchet over "dead barrel-mock overrides": a test that mocks
 * '@/components/ui' or '@/contexts' and overrides an export, while the module
 * under test imports that same symbol from its DIRECT submodule path. Vitest's
 * registry is keyed per-specifier, so the override never applies and the real
 * module loads — the hook throws for want of a provider, the stub's data-testids
 * never appear, or the real HeroUI component exposes a different ARIA role.
 *
 * Baseline: src/test/dead-barrel-mocks.baseline.json (generated, shrink-only).
 * Regenerate after remediation: npm run audit:dead-mocks -- --baseline
 *
 * IT HAS A CEILING **AND** A FLOOR. The ceiling (no new offenders, count never
 * rises) catches regressions. The floor — every audited barrel resolved, >1,000
 * test files walked, no baselined offender silently vanishing — catches the
 * scanner itself going blind, which otherwise passes all four ceiling
 * assertions on a zero-row scan and is indistinguishable from a clean repo.
 * Renaming `src/components/ui/index.ts` alone reproduces that.
 *
 * NOTE: `test:ui-contracts` runs with NEXUS_FAIL_ON_UNEXPECTED_CONSOLE=1, so
 * this file must never console.log/warn/error. All diagnostics go through
 * assertion messages.
 */

// @ts-expect-error -- plain .mjs tooling script, intentionally untyped. This
// file is excluded from tsconfig.json, so nothing here is typechecked anyway.
import * as audit from '../../../scripts/audit-dead-mocks.mjs';
import { beforeAll, describe, expect, it } from 'vitest';

interface DeadMockRow {
  barrel: string;
  deadKey: string;
  depth: number;
  directPath: string;
  importedName: string;
  importingModule: string;
  riskClass: 'R1' | 'R2' | 'R3';
  testFile: string;
}

interface ScanResult {
  auditedBarrelCount: number;
  correctlyHandledCount: number;
  deepRows: DeadMockRow[];
  maxDepth: number;
  rows: DeadMockRow[];
  summary: { byBarrel: Record<string, number>; offenderFileCount: number; rowCount: number };
  testFileCount: number;
  unresolvedBarrels: string[];
}

/**
 * The repo has ~1,280 test files. Anything near zero means `scan()` was pointed
 * at the wrong root or `collectTestFiles` swallowed a readdir failure — not that
 * the repo got clean.
 */
const MIN_EXPECTED_TEST_FILES = 1000;

let result: ScanResult;
let baseline: { totals?: { rowCount?: number } } | undefined;
let baselineFile: string;

beforeAll(() => {
  result = audit.scan() as ScanResult;
  const loaded = audit.loadBaseline() as {
    baseline?: { totals?: { rowCount?: number } };
    file: string;
  };
  baseline = loaded.baseline;
  // Report it repo-relative with forward slashes — this runs on Windows too.
  baselineFile = loaded.file.replace(/\\/g, '/').replace(/^.*?\/react-frontend\//, '');
}, 120_000);

describe('barrel-mock override contract', () => {
  it('has a committed baseline to ratchet against', () => {
    expect(
      baseline,
      `Missing generated baseline at ${baselineFile}. Create it with: ` +
        'npm run audit:dead-mocks -- --baseline',
    ).toBeTruthy();
  });

  it('introduces no barrel mock whose override the module under test bypasses', () => {
    const comparison = audit.compareToBaseline(result, baseline) as {
      newOffenders: DeadMockRow[];
    };

    const messages = comparison.newOffenders.map(
      (row) =>
        `${row.testFile}\n` +
        `      vi.mock('${row.barrel}') overrides '${row.deadKey}' [${row.riskClass}], but ` +
        `${row.importingModule} (depth ${row.depth}) imports '${row.importedName}' from ` +
        `'${row.directPath}' — the override is DEAD there.\n` +
        `      FIX: add vi.mock('${row.directPath}', …) to the test, or change ` +
        `${row.importingModule} to import '${row.importedName}' from '${row.barrel}'.`,
    );

    expect(
      messages,
      messages.length === 0
        ? ''
        : `${messages.length} new dead barrel-mock override(s):\n\n  ${messages.join('\n\n  ')}\n\n` +
          'This gate is shrink-only. Fix the test (or the import) — do not regenerate ' +
          `the baseline to absorb a new offender (${baselineFile}).`,
    ).toEqual([]);
  });

  it('never raises the dead-override count above the baseline', () => {
    const allowed = baseline?.totals?.rowCount ?? Number.POSITIVE_INFINITY;

    expect(
      result.summary.rowCount,
      `Dead barrel-mock overrides rose from ${allowed} to ${result.summary.rowCount} ` +
        `(${result.summary.offenderFileCount} test files, enforced depth <= ${result.maxDepth}). ` +
        'The baseline is shrink-only: run `npm run audit:dead-mocks` to see every row, ' +
        'fix the new one, and only regenerate the baseline when the number goes DOWN.',
    ).toBeLessThanOrEqual(allowed);
  });

  /**
   * FLOOR — without these, a scanner that returns nothing satisfies every
   * assertion above (0 new offenders, 0 <= baseline, empty unactionable filter)
   * and this BLOCKING step goes green next to a committed 539-row baseline.
   * Renaming/moving `src/components/ui/index.ts` alone did exactly that: rows
   * dropped to 0 while testFileCount stayed correct.
   */
  it('is not scanning blind: every audited barrel resolved and the tree was walked', () => {
    expect(
      result.unresolvedBarrels,
      'An audited barrel index could not be resolved, so its rows are not being ' +
        'scanned at all. Fix AUDITED_BARRELS (or the barrel path) in ' +
        'scripts/audit-dead-mocks.mjs — do NOT regenerate the baseline while this is non-empty.',
    ).toEqual([]);

    expect(
      result.auditedBarrelCount,
      `Only ${result.auditedBarrelCount} of ${audit.AUDITED_BARRELS.length} audited barrels were ` +
        'scanned. testFileCount cannot see this vector — the tests still exist, the barrel does not.',
    ).toBe(audit.AUDITED_BARRELS.length);

    expect(
      result.testFileCount,
      `Only ${result.testFileCount} test files were discovered (expected > ${MIN_EXPECTED_TEST_FILES}). ` +
        'The scanner is looking at the wrong root, or directory traversal failed silently.',
    ).toBeGreaterThan(MIN_EXPECTED_TEST_FILES);
  });

  it('still finds rows for every barrel the baseline knows about', () => {
    const baselinedBarrels = [
      ...new Set(
        Object.values((baseline as { offenders?: Record<string, Record<string, string[]>> })?.offenders ?? {}).flatMap(
          (barrels) => Object.keys(barrels),
        ),
      ),
    ].sort();

    // Nothing to check before the first baseline exists.
    if (baselinedBarrels.length === 0) return;

    expect(
      baselinedBarrels.filter((barrel) => !(result.summary.byBarrel[barrel] > 0)),
      'The baseline records offenders for these barrels but this scan found none. ' +
        'That is a blind scanner far more often than a fully-remediated barrel — verify ' +
        'with `npm run audit:dead-mocks` before regenerating the baseline.',
    ).toEqual([]);
  });

  it('accounts for every baselined offender: none silently disappeared', () => {
    // The ceiling (rowCount <= baseline) catches regressions. This is the floor:
    // rows that vanish are either a real fix — regenerate the baseline and lock
    // the win in, exactly as the CLI advises — or the scanner going quiet.
    const comparison = audit.compareToBaseline(result, baseline) as { fixedKeys: string[] };

    expect(
      comparison.fixedKeys,
      `${comparison.fixedKeys.length} baselined offender(s) are no longer reported. If you ` +
        'fixed them (or deleted the test), regenerate the baseline: ' +
        `npm run audit:dead-mocks -- --baseline (${baselineFile}). If you did NOT, the scanner ` +
        'has gone blind — investigate before touching the baseline.',
    ).toEqual([]);
  });

  it('keeps every baselined row resolvable to a concrete direct path to mock', () => {
    // A row with no actionable direct path would make failures un-fixable; this
    // guards the scanner's own output quality, not the repo's test hygiene.
    const unactionable = result.rows.filter(
      (row) => !row.directPath?.startsWith('@/') || !row.importedName || !row.testFile,
    );

    expect(
      unactionable.map((row) => `${row.testFile} -> ${row.barrel}#${row.deadKey}`),
      'Every offender must name the exact direct path the author should mock instead.',
    ).toEqual([]);
  });
});
