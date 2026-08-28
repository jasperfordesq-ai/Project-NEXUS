#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Ban month-first date formats and bare-locale Carbon calls in PHP.
 *
 * Two regressions this catches, both of which shipped to real recipients:
 *
 *  1. A literal month-first pattern — date('M j, Y') → "Aug 17, 2026". PHP's
 *     date() has no locale, so this reads American to every recipient in
 *     Ireland and the UK no matter which language the email is rendered in.
 *
 *  2. ->locale(app()->getLocale()) — passes a BARE language code. Carbon
 *     resolves bare 'en' to US English, and because it is set explicitly at the
 *     call site it also overrides any ambient Carbon::setLocale. This is why
 *     "translate the month names" fixed the language but left the field order
 *     American.
 *
 * The fix in both cases is Carbon's localised tokens plus the region-aware
 * helper: ->locale(\App\I18n\FormattingLocale::carbon())->isoFormat('ll').
 * Localised tokens ('ll', 'LL', 'lll', 'LLLL', 'L', 'LT') put the fields in the
 * reader's own order; a literal pattern like 'D MMM YYYY' does not.
 *
 * Machine formats (Y-m-d, ICS, RSS) are untouched — they must not be localised.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOTS = ['app'];
const EXEMPTION_MARKER = 'date-format-exempt:';

const BANNED = [
  {
    id: 'american-date-pattern',
    // Month-name-first orders: 'M j, Y' / 'F j, Y' / 'M d, Y' / 'l, F j' …
    pattern: /'(?:[lD],\s*)?(?:M{1,4}|F)\s+[jdn](?:,\s*Y(?:y)?)?(?:,?\s+g:i\s*[aA])?'/g,
    hint: "month-first date pattern — use Carbon isoFormat('ll'/'LL'/'lll') with FormattingLocale::carbon()",
  },
  {
    id: 'american-numeric-date',
    pattern: /'[mn]\/[jd]\/[Yy]'/g,
    hint: "American numeric order — use Carbon isoFormat('L') with FormattingLocale::carbon()",
  },
  {
    id: 'bare-carbon-locale',
    pattern: /->locale\(\s*(?:\(string\)\s*)?app\(\)->getLocale\(\)\s*\)/g,
    hint: 'bare language code — use ->locale(\\App\\I18n\\FormattingLocale::carbon())',
  },
];

function collectPhpFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectPhpFiles(entryPath, files);
    } else if (entry.name.endsWith('.php')) {
      files.push(entryPath);
    }
  }
  return files;
}

const violations = [];
let scanned = 0;

for (const scanRoot of SCAN_ROOTS) {
  const absoluteRoot = path.join(ROOT, scanRoot);
  if (!fs.existsSync(absoluteRoot)) continue;

  for (const filePath of collectPhpFiles(absoluteRoot)) {
    scanned += 1;
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);

    lines.forEach((line, index) => {
      // Comments discuss these patterns to explain why they were removed;
      // matching prose would make the fix trip its own gate.
      if (/^\s*(?:\/\/|\*|\/\*|#)/.test(line)) return;
      if (line.includes(EXEMPTION_MARKER)) return;
      // An explanation on the line above also exempts, so a genuine machine
      // format can say why without cramming it onto the code line.
      if ((lines[index - 1] ?? '').includes(EXEMPTION_MARKER)) return;

      for (const rule of BANNED) {
        rule.pattern.lastIndex = 0;
        const match = rule.pattern.exec(line);
        if (match) {
          violations.push({
            file: path.relative(ROOT, filePath).split(path.sep).join('/'),
            hint: rule.hint,
            line: index + 1,
            match: match[0],
          });
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error(
    `American date formatting detected (${violations.length} ` +
    `${violations.length === 1 ? 'occurrence' : 'occurrences'}):`,
  );
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line}  ${violation.match}`);
    console.error(`      ${violation.hint}`);
  }
  console.error('');
  console.error(
    'Members are in Ireland and the UK. If a format is genuinely machine-readable ' +
    `and must not be localised, mark it with a "${EXEMPTION_MARKER} <reason>" comment.`,
  );
  process.exit(1);
}

console.log(`No American date formats found (${scanned} PHP files scanned).`);
