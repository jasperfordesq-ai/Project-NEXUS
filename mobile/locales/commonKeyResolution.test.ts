// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every `t('common:…')` literal in the app must resolve to a real key.
 *
 * 🔴 What this catches, found by looking at screens on 2026-08-19: fifteen places
 * called `t('common:cancel')` or `t('common:retry')` when the real keys are
 * `buttons.cancel` / `buttons.retry`, and four more called `t('common:unknown')` and
 * `t('common:close')` which did not exist at all. i18next has no missing-key error at
 * runtime — it renders the key itself — so those buttons displayed the literal text
 * "common:cancel" to members. Five of them were the Cancel button in a confirmation
 * dialog and five were the Retry button on an error screen: the two places a member is
 * already stuck and least able to guess what the control does.
 *
 * Nothing caught it. The locale files were 100% complete in all seven languages, so
 * every completeness and parity check passed — the keys existed, the CALLERS named
 * them wrongly. That is the gap this test closes, and it is why the assertion runs
 * over source literals rather than over the catalogues.
 *
 * Scope note: only `common:` is checked, and only single-quoted literals. Namespaced
 * keys resolved through variables (`t(dynamicKey)`) cannot be verified statically, and
 * other namespaces are covered by their own `locales/*-content.test.ts` suites.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..');
const SEARCH_DIRS = ['app', 'components'];

/** Keys i18next itself resolves, or that are supplied at call time. */
const BUILT_IN_PREFIXES = ['$'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.')) walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

function resolveKey(doc: unknown, dottedKey: string): unknown {
  return dottedKey
    .split('.')
    .reduce<unknown>((node, part) => (
      node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
    ), doc);
}

interface Unresolved {
  file: string;
  line: number;
  key: string;
}

function findUnresolved(): Unresolved[] {
  const english = JSON.parse(
    fs.readFileSync(path.join(MOBILE_ROOT, 'locales', 'en', 'common.json'), 'utf8')
  ) as Record<string, unknown>;

  const unresolved: Unresolved[] = [];

  for (const dir of SEARCH_DIRS) {
    const root = path.join(MOBILE_ROOT, dir);
    if (!fs.existsSync(root)) continue;

    for (const file of walk(root)) {
      const source = fs.readFileSync(file, 'utf8');

      for (const match of source.matchAll(/'common:([A-Za-z0-9_.\-]+)'/g)) {
        const key = match[1]!;
        if (BUILT_IN_PREFIXES.some((p) => key.startsWith(p))) continue;

        const value = resolveKey(english, key);
        // A key must resolve to a STRING. Landing on an object means the caller named
        // a section (`common:buttons`) rather than a key inside it, which renders the
        // literal just as visibly.
        if (typeof value !== 'string') {
          unresolved.push({
            file: path.relative(MOBILE_ROOT, file).split(path.sep).join('/'),
            line: source.slice(0, match.index).split('\n').length,
            key,
          });
        }
      }
    }
  }

  return unresolved;
}

describe("t('common:…') keys used in the app", () => {
  it('all resolve to a string in locales/en/common.json', () => {
    const unresolved = findUnresolved();

    const OK = 'every common: key used in the app resolves';
    const actual = unresolved.length === 0
      ? OK
      : [
          'These call sites name a key that does not resolve to a string in',
          'locales/en/common.json. i18next renders the key itself, so a member sees',
          'text like "common:cancel" on the button:',
          ...unresolved.map((u) => `  ${u.file}:${u.line}  t('common:${u.key}')`),
        ].join('\n');

    expect(actual).toBe(OK);
  });

  it('finds a real number of keys, so it cannot pass by matching nothing', () => {
    // Guards against a regex that silently stops matching after a refactor: a passing
    // result then means "checked nothing", which is worse than a failure.
    const source = fs.readFileSync(
      path.join(MOBILE_ROOT, 'app', '(modals)', 'goals.tsx'), 'utf8'
    );
    expect(source).toMatch(/'common:buttons\.cancel'/);

    let matches = 0;
    for (const dir of SEARCH_DIRS) {
      for (const file of walk(path.join(MOBILE_ROOT, dir))) {
        matches += [...fs.readFileSync(file, 'utf8').matchAll(/'common:[A-Za-z0-9_.\-]+'/g)].length;
      }
    }
    expect(matches).toBeGreaterThan(100);
  });

  it('would flag the exact keys that shipped broken', () => {
    // Proves the resolver's judgement on the real defects rather than trusting that
    // the sweep above is looking at the right thing.
    const english = JSON.parse(
      fs.readFileSync(path.join(MOBILE_ROOT, 'locales', 'en', 'common.json'), 'utf8')
    ) as Record<string, unknown>;

    // The wrong spellings that shipped:
    expect(typeof resolveKey(english, 'cancel')).not.toBe('string');
    expect(typeof resolveKey(english, 'retry')).not.toBe('string');
    // Naming a whole section must also be treated as unresolved:
    expect(typeof resolveKey(english, 'buttons')).not.toBe('string');
    // The corrected spellings, and the two keys that were missing entirely:
    expect(typeof resolveKey(english, 'buttons.cancel')).toBe('string');
    expect(typeof resolveKey(english, 'buttons.retry')).toBe('string');
    expect(typeof resolveKey(english, 'unknown')).toBe('string');
    expect(typeof resolveKey(english, 'close')).toBe('string');
  });
});
