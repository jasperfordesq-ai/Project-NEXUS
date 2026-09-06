// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Money typed on a comma keypad must not become a hundred times itself.
 *
 * The 2026-09-06 audit found `Number(value.replace(/[,\s]/g, ''))` behind the marketplace
 * offer field and the marketplace listing form: on a German, French, Spanish, Italian or
 * Portuguese keypad the decimal separator IS a comma, so a member typing `12,50` had the
 * comma deleted and sent **1250**. Nine further fields used a bare `Number()` and rejected
 * `1,5` as invalid, which merely blocked the member instead of overcharging them.
 *
 * This file guards both halves:
 *  1. `parseDecimalInput` itself reads both separators (behaviour), and
 *  2. no screen re-introduces the comma-stripping idiom (a scan, because the bug was a
 *     one-line local helper that no component test could see).
 */

import fs from 'node:fs';
import path from 'node:path';

import { parseDecimalInput } from './decimal';

const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const SEARCH_DIRS = ['app', 'components'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('decimal input', () => {
  it('reads a comma decimal as the member meant it', () => {
    expect(parseDecimalInput('12,50')).toBe(12.5);
    expect(parseDecimalInput('1,5')).toBe(1.5);
    expect(parseDecimalInput('12.50')).toBe(12.5);
  });

  it('never turns a comma decimal into a whole number a hundred times bigger', () => {
    // The exact fault: strip the comma and 12,50 is 1250.
    expect(parseDecimalInput('12,50')).not.toBe(1250);
  });

  it('no screen strips separators before parsing a typed number', () => {
    const offenders: string[] = [];
    // `Number(x.replace(/[,\s]/g, ''))` and friends: deleting the separator, then parsing.
    const STRIPPER = /(?:Number|parseFloat)\s*\(\s*[A-Za-z0-9_.[\]]+\s*\.replace\s*\(\s*\/\[[^\]]*,[^\]]*\]/;

    for (const dir of SEARCH_DIRS) {
      const root = path.join(MOBILE_ROOT, dir);
      if (!fs.existsSync(root)) continue;
      for (const file of walk(root)) {
        const src = fs.readFileSync(file, 'utf8');
        src.split('\n').forEach((line, index) => {
          if (STRIPPER.test(line)) {
            offenders.push(`${path.relative(MOBILE_ROOT, file).split(path.sep).join('/')}:${index + 1}`);
          }
        });
      }
    }

    const OK = 'no screen deletes a decimal separator before parsing';
    const actual = offenders.length === 0
      ? OK
      : [
          'These parse a typed number after deleting its separators, so a comma decimal',
          'becomes a whole number 100x larger. Use parseDecimalInput from lib/utils/decimal.ts.',
          ...offenders.map((o) => `  ${o}`),
        ].join('\n');

    expect(actual).toBe(OK);
  });
});
