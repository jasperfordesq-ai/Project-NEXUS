// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Guards the shape of the reporting fix.
 *
 * 🔴 Why a source scan rather than a behavioural test. The defect being prevented is
 * "this diagnostic goes nowhere" — and code that reports to a disabled service behaves
 * identically to code that reports to a live one. Nothing observable distinguishes them,
 * which is exactly how 13 report sites came to be aimed at a service with no DSN in any
 * of the six build profiles, for months, with a green test suite throughout.
 *
 * Same approach as `app/modalDeclarations.test.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const REPORTER = path.join('lib', 'observability', 'report.ts');

/** Non-test source files below a directory. */
function sourceFilesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) found.push(full);
    }
  };
  walk(dir);
  return found;
}

/** Comments removed, so a scan cannot match the very name it documents. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function appSourceFiles(): string[] {
  return [
    ...sourceFilesUnder(path.join(MOBILE_ROOT, 'lib')),
    ...sourceFilesUnder(path.join(MOBILE_ROOT, 'components')),
    ...sourceFilesUnder(path.join(MOBILE_ROOT, 'app')),
  ];
}

describe('reporting wiring', () => {
  it('reads a realistic number of files, so a green result is not an empty search', () => {
    expect(appSourceFiles().length).toBeGreaterThan(200);
  });

  it('🔴 nothing reports to Sentry directly except the reporter itself', () => {
    // Every direct call is a diagnostic that disappears while Sentry has no DSN. The
    // reporter sends to Sentry AND to our own server, so routing through it is the
    // difference between a report and a wish.
    const offenders = appSourceFiles()
      .filter((file) => path.relative(MOBILE_ROOT, file) !== REPORTER)
      .filter((file) =>
        /Sentry\.(captureException|captureMessage)\s*\(/.test(stripComments(fs.readFileSync(file, 'utf8')))
      )
      .map((file) => path.relative(MOBILE_ROOT, file));

    expect(offenders).toEqual([]);
  });

  it('🔴 the crash boundary reports through the reporter', () => {
    // The single most important report the app makes. It went to Sentry alone.
    const source = stripComments(
      fs.readFileSync(path.join(MOBILE_ROOT, 'components', 'ErrorBoundary.tsx'), 'utf8')
    );

    expect(source).toMatch(/reportException\s*\(/);
  });

  it('🔴 the unhandled-link report does not carry a whole url', () => {
    // It used to send `${link}` verbatim, and one of the links this app handles is a
    // password reset — whose token is IN the url. safeLinkSummary keeps origin plus the
    // first path segment and drops the query entirely.
    const source = stripComments(
      fs.readFileSync(path.join(MOBILE_ROOT, 'lib', 'utils', 'navigateToLink.ts'), 'utf8')
    );

    expect(source).toMatch(/safeLinkSummary\s*\(\s*link\s*\)/);
    expect(source).not.toMatch(/Unhandled link: \$\{link\}/);
  });

  it('🔴 storage reports through the import-free sink, not the reporter', () => {
    // A static reporter import here dragged Sentry and expo-constants into every module
    // that touches storage and broke 10 tests; a dynamic import fired nothing at all
    // under Jest. The sink is the third answer and the working one.
    const source = stripComments(
      fs.readFileSync(path.join(MOBILE_ROOT, 'lib', 'storage.ts'), 'utf8')
    );

    expect(source).toMatch(/reportToSink|reportStorageFailure/);
    expect(source).not.toMatch(/from '@\/lib\/observability\/report'/);
    expect(source).not.toMatch(/await import\(/);
  });

  it('🔴 no dynamic import is used for reporting anywhere', () => {
    // Jest cannot execute a native dynamic import without --experimental-vm-modules, so
    // any reporting behind one is untestable AND silently dead in every test — which
    // produced two false green results in one hour before this rule existed.
    const offenders = appSourceFiles()
      .filter((file) =>
        /await import\(\s*['"]@\/lib\/observability/.test(stripComments(fs.readFileSync(file, 'utf8')))
      )
      .map((file) => path.relative(MOBILE_ROOT, file));

    expect(offenders).toEqual([]);
  });
});
