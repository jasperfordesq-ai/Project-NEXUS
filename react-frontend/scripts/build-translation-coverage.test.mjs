// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Run with: node --test scripts/build-translation-coverage.test.mjs
//
// Every test builds a tiny locales folder in a temporary directory: no real
// count is pinned here, because the real wording changes every day.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeCoverage,
  isSameAsEnglish,
  readSupportedLocales,
  run,
} from './build-translation-coverage.mjs';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'nexus-tc-'));
  const write = (locale, ns, data) => {
    mkdirSync(path.join(dir, locale), { recursive: true });
    writeFileSync(path.join(dir, locale, `${ns}.json`), typeof data === 'string' ? data : JSON.stringify(data));
  };
  // English: 6 phrases (the plural pair is one).
  write('en', 'common', {
    hello: 'Hello {{name}}',
    nav: { home: 'Home', brand: 'Project NEXUS' },
    count_only: '{{count}}',
    items_one: 'One item',
    items_other: '{{count}} items',
  });
  write('en', 'admin', { save: 'Save' });
  return { dir, write, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('counts phrases, missing ones and ones still the same as English', () => {
  const { dir, write, cleanup } = fixture();
  try {
    write('de', 'common', {
      hello: 'Hallo {{name}}',
      nav: { home: ' Home ', brand: 'Project NEXUS' },
      count_only: '{{count}}',
      items_other: '{{count}} Elemente',
    });
    // `admin` has no German file at all.
    const result = computeCoverage(dir, ['de', 'ja']);

    assert.equal(result.available, true);
    assert.equal(typeof result.generated_at, 'string');
    assert.deepEqual(result.locales[0], { locale: 'de', keys: 6, missing: 1, same_as_english: 2 });
  } finally {
    cleanup();
  }
});

test('a missing language folder counts every phrase as missing', () => {
  const { dir, cleanup } = fixture();
  try {
    const result = computeCoverage(dir, ['ja']);
    assert.deepEqual(result.locales, [{ locale: 'ja', keys: 6, missing: 6, same_as_english: 0 }]);
  } finally {
    cleanup();
  }
});

test('a broken language file does not throw: its phrases count as missing', () => {
  const { dir, write, cleanup } = fixture();
  try {
    write('fr', 'common', '{ this is not json');
    write('fr', 'admin', { save: '' });
    const result = computeCoverage(dir, ['fr']);
    assert.deepEqual(result.locales, [{ locale: 'fr', keys: 6, missing: 6, same_as_english: 0 }]);
  } finally {
    cleanup();
  }
});

test('a phrase whose English text is empty is not a phrase: never counted, never missing', () => {
  const { dir, write, cleanup } = fixture();
  try {
    // Three English-empty phrases beside one real one (and a plural family whose every form is empty).
    write('en', 'extra', {
      notes: { a: '', b: '   ' },
      blank_one: '',
      blank_other: ' ',
      real: 'Real words',
    });
    // German: empty where English is empty, text where English is empty, and the real one left empty.
    write('de', 'extra', { notes: { a: '', b: 'Etwas' }, real: '' });
    // Spanish: the real phrase translated, nothing where English is empty.
    write('es', 'extra', { real: 'Palabras reales' });
    const result = computeCoverage(dir, ['de', 'es']);
    // 6 from the fixture + `extra.real` = 7: the English-empty ones are left out entirely.
    // German has no `common` or `admin` file (6 missing) and `extra.real` empty (1 more).
    assert.deepEqual(result.locales[0], { locale: 'de', keys: 7, missing: 7, same_as_english: 0 });
    // Spanish: only the fixture's 6 are missing; English-empty phrases never are.
    assert.deepEqual(result.locales[1], { locale: 'es', keys: 7, missing: 6, same_as_english: 0 });
  } finally {
    cleanup();
  }
});

test('without readable English it is not available', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nexus-tc-'));
  try {
    assert.deepEqual(computeCoverage(dir, ['de']), { available: false });
    mkdirSync(path.join(dir, 'en'));
    writeFileSync(path.join(dir, 'en', 'common.json'), '{ broken');
    assert.deepEqual(computeCoverage(dir, ['de']), { available: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('"same as English" ignores placeholders, empty values and values with no letters', () => {
  assert.equal(isSameAsEnglish('Home', 'Home'), true);
  assert.equal(isSameAsEnglish('  Home', 'Home  '), true);
  assert.equal(isSameAsEnglish('{{count}}', '{{count}}'), false);
  assert.equal(isSameAsEnglish('{{a}} / {{b}}', '{{a}} / {{b}}'), false);
  assert.equal(isSameAsEnglish('', ''), false);
  assert.equal(isSameAsEnglish('100%', '100%'), false);
  assert.equal(isSameAsEnglish('Home', 'Accueil'), false);
});

test('reads the supported languages from src/i18n.ts, English last out', () => {
  const locales = readSupportedLocales(path.join(frontendRoot, 'src', 'i18n.ts'));
  assert.ok(locales.length >= 2);
  assert.ok(!locales.includes('en'));
  assert.ok(locales.includes('de'));
});

test('never fails: on any error it writes {"available": false}', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nexus-tc-'));
  try {
    const out = path.join(dir, 'translation-coverage.json');
    // An i18n.ts that does not exist: the build must still go on.
    const result = run({ localesDir: path.join(dir, 'nope'), i18nFile: path.join(dir, 'nope.ts'), outFile: out });
    assert.deepEqual(result, { available: false });
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { available: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writes the result for a working fixture', () => {
  const { dir, write, cleanup } = fixture();
  try {
    write('de', 'common', { hello: 'Hallo' });
    const i18nFile = path.join(dir, 'i18n.ts');
    writeFileSync(i18nFile, "export const SUPPORTED_LOCALE_CODES = [\n  'de',\n  'en',\n] as const;\n");
    const out = path.join(dir, 'out.json');
    run({ localesDir: dir, i18nFile, outFile: out });
    const written = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(written.available, true);
    assert.deepEqual(written.locales, [{ locale: 'de', keys: 6, missing: 5, same_as_english: 0 }]);
  } finally {
    cleanup();
  }
});
