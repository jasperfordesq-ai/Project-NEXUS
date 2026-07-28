// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Test-file TypeScript ratchet.
 *
 * THE HOLE THIS CLOSES
 * --------------------
 * tsconfig.json excludes `src/**\/*.test.ts(x)` and `src/test/` from the
 * program, and eslint.config.js ignores the same paths. Test files are
 * therefore checked by NOTHING: rename a prop, change what a hook returns, and
 * it is a compile error in application code but invisible in the tests that
 * exercise it. Thousands of such errors accumulated unseen — which is why test
 * breakage here is only ever discovered in large, painful batches.
 *
 * tsconfig.tests.json is the same compiler options over the SAME `src` tree
 * with the test exclusions lifted. This script type-checks that project and
 * holds the error count to a shrink-only baseline, so the existing debt is
 * recorded rather than fixed in one heroic pass, and NEW breakage fails CI on
 * the commit that introduces it.
 *
 * WHY THE COMPILER API AND NOT `tsc` STDOUT
 * -----------------------------------------
 * Structured diagnostics give the error code and file directly, so nothing
 * depends on parsing localized/reformatted compiler text, and the same Program
 * yields the file list the floor check needs without a second compile.
 *
 * BASELINE GRANULARITY: file × error code × count
 * ----------------------------------------------
 * NOT line numbers: any unrelated edit above an error shifts them and the gate
 * would cry wolf until people stopped believing it. NOT a bare per-file total
 * either: that lets a brand-new error class slip into an already-erroring file
 * as long as one old error was fixed in the same edit. File+code+count moves
 * freely within a file, but one more TS2345 where there were three, or any code
 * not already recorded for that file, fails.
 *
 * CEILING (regressions fail)
 *   - a file with no baseline entry reports any error
 *   - a file reports an error code not baselined for it
 *   - a baselined file+code count increases
 *   - the total error count increases
 *
 * FLOOR (going blind fails)
 *   - fewer than MIN_EXPECTED_TEST_FILES test files in the program: catches an
 *     include/exclude regression that silently drops the very files this gate
 *     exists to watch, which would otherwise read as a clean green run
 *   - a baselined file+code that no longer errors: an improvement must be
 *     locked in by regenerating, or the baseline slowly becomes fiction and
 *     re-breaking that file would pass
 *
 * CLI
 *   node scripts/check-test-types.mjs             # human report + ratchet
 *   node scripts/check-test-types.mjs --baseline  # (re)generate the baseline
 *   node scripts/check-test-types.mjs --report    # full listing, never fails
 *   node scripts/check-test-types.mjs --json      # machine JSON on stdout
 *   node scripts/check-test-types.mjs --root <dir>
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');
const BASELINE_RELATIVE_PATH = 'src/test/test-types.baseline.json';
const TSCONFIG_RELATIVE_PATH = 'tsconfig.tests.json';

/**
 * Floor guard. The suite is ~1,281 test files; if the program sees fewer than
 * this, the config stopped matching them and a green result is meaningless.
 */
export const MIN_EXPECTED_TEST_FILES = 1000;

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

export function baselinePath(root) {
  return path.join(root, BASELINE_RELATIVE_PATH);
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

/** Type-check tsconfig.tests.json and group diagnostics by file and code. */
export function scan(root = DEFAULT_ROOT) {
  const configPath = path.join(root, TSCONFIG_RELATIVE_PATH);
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing ${TSCONFIG_RELATIVE_PATH} at ${configPath}`);
  }

  const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
  if (readResult.error) {
    throw new Error(
      `Cannot read ${TSCONFIG_RELATIVE_PATH}: ${ts.flattenDiagnosticMessageText(readResult.error.messageText, ' ')}`,
    );
  }

  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, root, undefined, configPath);
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(
      `Invalid ${TSCONFIG_RELATIVE_PATH}: ${ts.flattenDiagnosticMessageText(first.messageText, ' ')}`,
    );
  }

  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const diagnostics = ts.getPreEmitDiagnostics(program);

  // Count the test files actually in the program — the floor check's input.
  let testFileCount = 0;
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    if (TEST_FILE_RE.test(sourceFile.fileName)) testFileCount += 1;
  }

  /** @type {Record<string, Record<string, number>>} */
  const offenders = {};
  /** Diagnostics with no file (bad option, missing type package) can't be attributed. */
  const globalErrors = [];
  const samples = new Map();
  let errorCount = 0;

  for (const diagnostic of diagnostics) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
    const code = `TS${diagnostic.code}`;
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');

    if (!diagnostic.file) {
      globalErrors.push({ code, message });
      continue;
    }

    const relative = toPosix(path.relative(root, diagnostic.file.fileName));
    offenders[relative] ??= {};
    offenders[relative][code] = (offenders[relative][code] ?? 0) + 1;
    errorCount += 1;

    const sampleKey = `${relative}|${code}`;
    if (!samples.has(sampleKey)) {
      const { line } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      samples.set(sampleKey, { line: line + 1, message });
    }
  }

  return {
    offenders: sortOffenders(offenders),
    globalErrors,
    samples,
    summary: {
      fileCount: Object.keys(offenders).length,
      errorCount,
      testFileCount,
    },
  };
}

function sortOffenders(offenders) {
  /** @type {Record<string, Record<string, number>>} */
  const sorted = {};
  for (const file of Object.keys(offenders).sort()) {
    const codes = offenders[file];
    /** @type {Record<string, number>} */
    const sortedCodes = {};
    for (const code of Object.keys(codes).sort()) sortedCodes[code] = codes[code];
    sorted[file] = sortedCodes;
  }
  return sorted;
}

export function loadBaseline(root = DEFAULT_ROOT) {
  const file = baselinePath(root);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Corrupt baseline at ${file}: ${error.message}`);
  }
}

export function toBaseline(result) {
  return {
    _README:
      'GENERATED FILE — never hand-edit. Shrink-only ratchet over type errors in test files and the src/test harness, ' +
      'which tsconfig.json deliberately excludes from the app type-check. Granularity is file x error code x count. ' +
      'Regenerate with: npm run check:test-types -- --baseline (do this whenever you FIX errors, to lock the win in). ' +
      'Raising a count or adding a file/code is a REGRESSION and fails CI — fix the test instead. ' +
      'Enforced by the blocking "Test-File TypeScript Ratchet" step in .github/workflows/ci.yml.',
    offenders: result.offenders,
    totals: {
      fileCount: result.summary.fileCount,
      errorCount: result.summary.errorCount,
    },
  };
}

/** Ceiling + floor. Returns { ok, newFiles, newCodes, grownCodes, fixedCodes, totalRegressed, floorFailures }. */
export function compareToBaseline(result, baseline) {
  const newFiles = [];
  const newCodes = [];
  const grownCodes = [];
  const fixedCodes = [];
  const floorFailures = [];

  const baseOffenders = baseline?.offenders ?? {};

  for (const [file, codes] of Object.entries(result.offenders)) {
    const baseCodes = baseOffenders[file];
    if (!baseCodes) {
      newFiles.push({ file, count: Object.values(codes).reduce((a, b) => a + b, 0) });
      continue;
    }
    for (const [code, count] of Object.entries(codes)) {
      const baseCount = baseCodes[code];
      if (baseCount === undefined) {
        newCodes.push({ file, code, count });
      } else if (count > baseCount) {
        grownCodes.push({ file, code, was: baseCount, now: count });
      }
    }
  }

  for (const [file, baseCodes] of Object.entries(baseOffenders)) {
    const codes = result.offenders[file];
    for (const [code, baseCount] of Object.entries(baseCodes)) {
      const now = codes?.[code] ?? 0;
      if (now < baseCount) fixedCodes.push({ file, code, was: baseCount, now });
    }
  }

  const baseTotal = baseline?.totals?.errorCount ?? 0;
  const totalRegressed = baseline ? result.summary.errorCount > baseTotal : false;

  if (result.summary.testFileCount < MIN_EXPECTED_TEST_FILES) {
    floorFailures.push(
      `Only ${result.summary.testFileCount} test files are in the program (expected >= ${MIN_EXPECTED_TEST_FILES}). ` +
        `tsconfig.tests.json has stopped matching the test suite — this gate is checking almost nothing. ` +
        `Fix its include/exclude rather than lowering MIN_EXPECTED_TEST_FILES.`,
    );
  }

  if (result.globalErrors.length > 0) {
    floorFailures.push(
      `${result.globalErrors.length} diagnostic(s) have no source file (usually a bad compiler option or a missing ` +
        `@types package): ${result.globalErrors.slice(0, 3).map((e) => `${e.code} ${e.message}`).join(' | ')}`,
    );
  }

  const ok =
    newFiles.length === 0 &&
    newCodes.length === 0 &&
    grownCodes.length === 0 &&
    fixedCodes.length === 0 &&
    !totalRegressed &&
    floorFailures.length === 0;

  return { ok, newFiles, newCodes, grownCodes, fixedCodes, totalRegressed, floorFailures };
}

function formatSample(samples, file, code) {
  const sample = samples.get(`${file}|${code}`);
  if (!sample) return '';
  const message = sample.message.length > 140 ? `${sample.message.slice(0, 137)}...` : sample.message;
  return `\n      ${file}:${sample.line} — ${message}`;
}

function main() {
  const argv = process.argv.slice(2);
  const wantsJson = argv.includes('--json');
  const wantsBaseline = argv.includes('--baseline');
  const wantsReport = argv.includes('--report');
  const rootFlagIndex = argv.indexOf('--root');
  const root = rootFlagIndex >= 0 && argv[rootFlagIndex + 1] ? path.resolve(argv[rootFlagIndex + 1]) : DEFAULT_ROOT;

  let result;
  try {
    result = scan(root);
  } catch (error) {
    console.error(`check-test-types: ${error.message}`);
    process.exit(2);
    return;
  }

  const { fileCount, errorCount, testFileCount } = result.summary;

  if (wantsJson) {
    const baseline = loadBaseline(root);
    const comparison = compareToBaseline(result, baseline);
    console.log(JSON.stringify({ summary: result.summary, offenders: result.offenders, comparison }, null, 2));
    process.exit(comparison.ok ? 0 : 1);
    return;
  }

  if (wantsBaseline) {
    // A baseline written from a blind scan would enshrine "no errors anywhere".
    if (testFileCount < MIN_EXPECTED_TEST_FILES) {
      console.error(
        `check-test-types: refusing to write a baseline — only ${testFileCount} test files were in the program ` +
          `(expected >= ${MIN_EXPECTED_TEST_FILES}). Fix tsconfig.tests.json first.`,
      );
      process.exit(2);
      return;
    }
    fs.writeFileSync(baselinePath(root), `${JSON.stringify(toBaseline(result), null, 2)}\n`, 'utf8');
    console.log(
      `check-test-types: baseline written — ${errorCount} error(s) across ${fileCount} file(s), ` +
        `${testFileCount} test files checked.`,
    );
    console.log(`  ${toPosix(path.relative(root, baselinePath(root)))}`);
    process.exit(0);
    return;
  }

  if (wantsReport) {
    console.log(
      `check-test-types: ${errorCount} error(s) across ${fileCount} file(s); ${testFileCount} test files checked.\n`,
    );
    for (const [file, codes] of Object.entries(result.offenders)) {
      const total = Object.values(codes).reduce((a, b) => a + b, 0);
      console.log(`  ${file} (${total})`);
      for (const [code, count] of Object.entries(codes)) {
        console.log(`    ${code} x${count}${formatSample(result.samples, file, code)}`);
      }
    }
    process.exit(0);
    return;
  }

  const baseline = loadBaseline(root);
  if (!baseline) {
    console.error(
      `check-test-types: no baseline at ${toPosix(BASELINE_RELATIVE_PATH)}.\n` +
        `  Generate it once with: npm run check:test-types -- --baseline`,
    );
    process.exit(2);
    return;
  }

  const comparison = compareToBaseline(result, baseline);

  console.log(
    `check-test-types: ${errorCount} error(s) across ${fileCount} file(s); ` +
      `${testFileCount} test files checked (baseline: ${baseline.totals?.errorCount ?? '?'} / ` +
      `${baseline.totals?.fileCount ?? '?'}).`,
  );

  if (comparison.ok) {
    console.log('check-test-types: OK — no new type errors in test files.');
    process.exit(0);
    return;
  }

  // Floor failures mean the measurement itself is untrustworthy; say so first.
  if (comparison.floorFailures.length > 0) {
    console.error('\ncheck-test-types: THIS GATE HAS GONE BLIND');
    for (const failure of comparison.floorFailures) console.error(`  - ${failure}`);
  }

  const regressed =
    comparison.newFiles.length > 0 ||
    comparison.newCodes.length > 0 ||
    comparison.grownCodes.length > 0 ||
    comparison.totalRegressed;

  if (regressed) {
    console.error('\ncheck-test-types: NEW TYPE ERRORS — fix these, do not grow the baseline.');
    for (const { file, count } of comparison.newFiles) {
      console.error(`  NEW FILE  ${file} (${count} error(s))`);
      const codes = Object.keys(result.offenders[file] ?? {});
      for (const code of codes) console.error(`      ${code}${formatSample(result.samples, file, code)}`);
    }
    for (const { file, code, count } of comparison.newCodes) {
      console.error(`  NEW CODE  ${file} ${code} x${count}${formatSample(result.samples, file, code)}`);
    }
    for (const { file, code, was, now } of comparison.grownCodes) {
      console.error(`  INCREASE  ${file} ${code} ${was} -> ${now}${formatSample(result.samples, file, code)}`);
    }
    if (comparison.totalRegressed) {
      console.error(
        `  TOTAL     ${baseline.totals.errorCount} -> ${errorCount} errors overall.`,
      );
    }
  }

  // Reported separately and in encouraging terms: this half fires on IMPROVEMENT.
  if (comparison.fixedCodes.length > 0) {
    console.error(
      `\ncheck-test-types: ${comparison.fixedCodes.length} baselined error(s) are FIXED — lock the win in:`,
    );
    console.error('  npm run check:test-types -- --baseline');
    for (const { file, code, was, now } of comparison.fixedCodes.slice(0, 20)) {
      console.error(`  FIXED     ${file} ${code} ${was} -> ${now}`);
    }
    if (comparison.fixedCodes.length > 20) {
      console.error(`  ... and ${comparison.fixedCodes.length - 20} more`);
    }
  }

  process.exit(1);
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
