// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Ratchet for the 2026-08 i18n formatting audit. It asserts the SPECIFIC
 * anti-patterns that audit removed from route view-models stay dead:
 *
 *   - hardcoded English 'am'/'pm' ternaries (Intl owns the day period)
 *   - `hour12: true` (the locale decides its own clock)
 *   - `${...}%` template literals (Intl percent style owns digits AND sign)
 *   - `.toFixed(...)` (hardcodes the '.' decimal separator)
 *   - hardcoded Intl locale strings (only request-intl-locale.js/localization
 *     may decide the locale)
 *   - `.join(', ')` for display lists (English comma glue; use
 *     src/lib/list-format.js — form-input round-trip values are the exception)
 *
 * A targeted allowlist names the surviving occurrences that are either
 * machine-format (not user-facing) or tracked debt in files owned by other
 * in-flight work. Fixing one means DELETING its entry — an entry that no
 * longer matches fails, so the list can only shrink.
 */

const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src');
const routesDir = path.join(srcDir, 'routes');

const FILES = [
  ...fs.readdirSync(routesDir).filter((name) => name.endsWith('.js')).map((name) => `routes/${name}`),
  'server.js'
];

// file (relative to src/) -> array of substrings, each of which must still
// occur in that file, and each occurrence of the rule's pattern must sit on a
// line matched by one of them.
const ALLOWLIST = {
  percentLiteral: {
    // Fallback branch used only outside a request context; the request path
    // goes through Intl percent style.
    'routes/matches.js': ["(value) => `${value}%`"]
  },
  toFixed: {
    'routes/events.js': [
      // Machine format: map coordinate serialisation, never rendered as text.
      "Number(value).toFixed(6).replace(/0+$/, '').replace(/\\.$/, '')"
    ]
  },
  hardcodedIntlLocale: {
    // IANA-timezone validity probe — output is discarded, locale irrelevant.
    'routes/events.js': ["new Intl.DateTimeFormat('en', { timeZone: timezone })"]
  },
  joinCommaSpace: {
    // Form-input round-trip values that are re-parsed on submit (split on ','):
    // converting these to Intl.ListFormat would corrupt the machine format.
    'routes/groups.js': ["tagsText: groupTags(raw.tags).join(', ')"],
    'routes/ideation.js': ["tagsText: challenge.tags.join(', ')"],
    'routes/listings.js': ["base.skill_tags.join(', ')"],
    // Tracked debt: instructor grading view of a learner's raw quiz answers.
    'routes/courses.js': ["value.map((item) => answerToText(item)).filter(Boolean).join(', ')"]
  }
};

const RULES = [
  { name: 'amPmTernary', pattern: /\?\s*'am'\s*:\s*'pm'|\?\s*'pm'\s*:\s*'am'|<\s*12\s*\?\s*'am'/ },
  { name: 'hour12True', pattern: /hour12:\s*true/ },
  // `%` must not be a percent-encoded URL byte (`${lat}%2C${lng}`), so a hex
  // pair after the sign is excluded.
  { name: 'percentLiteral', pattern: /\$\{[^}`]*\}%(?![0-9A-Fa-f]{2})/ },
  { name: 'toFixed', pattern: /\.toFixed\(\d+\)/ },
  { name: 'hardcodedIntlLocale', pattern: /Intl\.[A-Za-z]+\(\s*'[a-zA-Z][a-zA-Z-]*'/ },
  { name: 'joinCommaSpace', pattern: /\.join\(',\s'\)/ }
];

// Strip line comments so prose that MENTIONS an anti-pattern cannot trip the
// scan (several fixes document the pattern they removed). Keeps `https://`.
function stripLineComments(line) {
  return line.replace(/(^|[^:'"\\])\/\/.*$/, '$1');
}

function scan(file) {
  const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
  const lines = content.split(/\r?\n/);
  const hits = [];
  lines.forEach((raw, index) => {
    const line = stripLineComments(raw);
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        hits.push({ rule: rule.name, file, line: index + 1, text: raw.trim() });
      }
    }
  });
  return hits;
}

describe('route view-model localization ratchet', () => {
  const allHits = FILES.flatMap(scan);

  it('keeps the fixed anti-patterns out of route view-models', () => {
    const offenders = allHits.filter((hit) => {
      const allowed = (ALLOWLIST[hit.rule] || {})[hit.file] || [];
      return !allowed.some((snippet) => hit.text.includes(snippet));
    });

    // Every entry here is a user-facing string being formatted in English by
    // hand. Use Intl with getRequestIntlLocale() (numbers, dates, percent,
    // units, currency) or src/lib/list-format.js (lists) instead.
    expect(offenders).toEqual([]);
  });

  it('has no stale allowlist entries (the list only shrinks)', () => {
    const stale = [];
    for (const [rule, files] of Object.entries(ALLOWLIST)) {
      for (const [file, snippets] of Object.entries(files)) {
        const content = fs.readFileSync(path.join(srcDir, file), 'utf8');
        for (const snippet of snippets) {
          if (!content.includes(snippet)) {
            stale.push(`${rule}: ${file} :: ${snippet}`);
          }
        }
      }
    }
    expect(stale).toEqual([]);
  });
});
