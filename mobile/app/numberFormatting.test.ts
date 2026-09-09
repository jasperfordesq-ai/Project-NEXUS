// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Numbers on screen are formatted for the member's language, not built by hand.
 *
 * 🔴 `toFixed` always produces a full stop. The app ships in seven languages and four of
 * them — French, German, Italian, Spanish — write a decimal comma, so a rating rendered
 * with `toFixed(1)` read "4.5" to a member whose every other number on the same screen read
 * "4,5". Small, but it is the kind of thing that makes an app feel translated rather than
 * built for you. Audit 2026-09-09, item 17.
 *
 * 🔴 The audit also flagged `volunteering.tsx` for "building EUR 12.50 by hand". Reading it
 * showed that line is the CATCH arm behind an `Intl.NumberFormat` call — a deterministic
 * fallback for an environment without Intl, which is the same pattern `lib/utils/decimal.ts`
 * uses deliberately. Left alone, and recorded so it is not re-reported.
 */

import fs from 'fs';
import path from 'path';

const MOBILE_ROOT = path.join(__dirname, '..');
const SEARCH_DIRS = ['app', 'components'];

/**
 * Where `toFixed` is still correct.
 *
 * Every entry is either a fallback behind an Intl call, or a value that is not shown to a
 * member as a number in their language.
 */
const TO_FIXED_ALLOWED: Record<string, string> = {
  'lib/utils/decimal.ts': 'The Intl fallback itself. This IS the deterministic path.',
  'app/(modals)/volunteering.tsx': 'The catch arm behind Intl.NumberFormat, for an environment without Intl.',
};

function sourceFiles(dir: string): { relative: string; source: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [{
      relative: path.relative(MOBILE_ROOT, full).split(path.sep).join('/'),
      source: fs.readFileSync(full, 'utf8'),
    }];
  });
}

const files = [
  ...SEARCH_DIRS.flatMap((dir) => sourceFiles(path.join(MOBILE_ROOT, dir))),
  ...sourceFiles(path.join(MOBILE_ROOT, 'lib')),
];

describe('numbers shown to members', () => {
  it('finds the files it is meant to police', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('nothing formats a decimal with toFixed unless it is a documented fallback', () => {
    const offenders = files
      .filter(({ source }) => /\.toFixed\s*\(/.test(source))
      .map(({ relative }) => relative)
      .filter((relative) => !(relative in TO_FIXED_ALLOWED));

    expect(offenders).toEqual([]);
  });

  it('carries no allowlist entry for a file that no longer uses toFixed', () => {
    const byPath = new Map(files.map((file) => [file.relative, file]));
    const stale = Object.keys(TO_FIXED_ALLOWED).filter((relative) => {
      const file = byPath.get(relative);
      return !file || !/\.toFixed\s*\(/.test(file.source);
    });

    expect(stale).toEqual([]);
  });

  it('the shared formatter follows the member language, not the device region', () => {
    const source = fs.readFileSync(path.join(MOBILE_ROOT, 'lib/utils/decimal.ts'), 'utf8');
    expect(source).toContain('Intl.NumberFormat(dateLocale()');
  });
});
