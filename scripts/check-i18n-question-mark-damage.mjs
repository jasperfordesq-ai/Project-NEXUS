// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Reject translation values whose non-ASCII characters were replaced by a
 * literal "?" on the way into the file.
 *
 * Translations written through a non-UTF-8 pipe lose every character the pipe
 * cannot encode, and each becomes "?": Arabic and Japanese values turn into
 * "????" runs, Latin-script values lose single letters ("ausgew?hlt",
 * "Activ?", "S?"), and dashes / curly quotes become "?". The result is still
 * valid UTF-8 JSON with every key present, so the integrity, parity and drift
 * checks all pass. check-i18n-json-integrity.mjs looks for classic mojibake
 * (U+FFFD, "Ã", "â€") and cannot see this.
 *
 * It happened in ordinary feature commits from May to July 2026, was repaired
 * in bulk on 2026-06-10 (52212f51c, ~1,100 strings), kept arriving, and was
 * repaired again on 2026-09-26 (0a4dfe6d7, 230 strings). This check exists so
 * that a third batch fails CI on the commit that introduces it.
 *
 * Rules, applied to every non-English string value (URLs, `?key=` query
 * fragments and {{placeholders}} removed first):
 *   1. "??" anywhere.
 *   2. "?" between two letters ("f?r", "l?e-mail"). In Japanese only between
 *      two ASCII letters ("JPEG?PNG"), because Japanese legitimately writes
 *      "削除しますか?これは…" with an ASCII question mark and no space.
 *   3. Any ASCII "?" in Arabic, which writes its question mark as "؟".
 *   4. "?" at the start of a word (" ?ffnen").
 *   5. letter + "?" + space + lowercase letter ("ju? aktywowany"): a real
 *      question is followed by a capital or by nothing.
 *   6. A one-word value ending in letter + "?" whose English has no "?"
 *      ("Activ?", "Pubblicit?", "S?").
 *   7. The English contains a dash, ellipsis or curly quote and the
 *      translation has more question marks than the English: the character
 *      became "?" and a translator then wrote the sentence as a question.
 *
 * Known blind spot: a letter lost at the end of the last word of a value with
 * more than one word ("Non activ?", "A particip?") is indistinguishable from
 * a genuine question without language knowledge, so it is not flagged.
 *
 * Usage: node scripts/check-i18n-question-mark-damage.mjs
 * Exits 1 and lists every damaged value when any is found.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dumpLangTree } from './lib/load-php-array.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Each root holds <locale>/<namespace>.json, with an English sibling in en/.
export const LOCALE_ROOTS = [
  path.join(ROOT, 'react-frontend', 'public', 'locales'),
  path.join(ROOT, 'mobile', 'locales'),
  path.join(ROOT, 'lang'),
];

const SOURCE_LOCALE = 'en';

function normalise(value) {
  return value
    .replace(/https?:\/\/\S+/gu, '')
    .replace(/\?[A-Za-z_][\w-]*=/gu, '')
    .replace(/\{\{[^}]*\}\}/gu, 'X');
}

function count(value, char) {
  return value.split(char).length - 1;
}

/**
 * Returns the list of rule names a value breaks (empty when it looks intact).
 */
export function findDamage(value, englishValue, locale) {
  // "؟" too: in Arabic a curly quote that became "?" was then "translated" to
  // the Arabic question mark ("يمسح ؟{{title}}؟؟").
  if (typeof value !== 'string' || !/[?؟]/u.test(value)) return [];
  const text = normalise(value);
  const english = typeof englishValue === 'string' ? normalise(englishValue) : '';
  const reasons = [];

  if (/\?\?/u.test(text)) reasons.push('double question mark');

  const between = locale === 'ja' ? /[A-Za-z]\?[A-Za-z]/u : /\p{L}\?\p{L}/u;
  if (between.test(text)) reasons.push('question mark inside a word');

  // Only in Arabic text: an untranslated English sentence asking a question is
  // not damage. A code token the English also writes with "?" (an optional
  // parameter such as "note?") is carried over verbatim, so it is ignored too.
  if (locale === 'ar' && /\p{Script=Arabic}/u.test(text)) {
    const tokens = text.match(/[A-Za-z_]+\?/gu) || [];
    const stripped = tokens.filter((token) => english.includes(token))
      .reduce((acc, token) => acc.split(token).join(''), text);
    if (stripped.includes('?')) reasons.push('ASCII question mark in Arabic');
  }

  // Japanese confirmations are sometimes split into a prefix ending in "か"
  // and a suffix starting "?これにより…", so there only a Latin letter after
  // the "?" counts.
  const wordStart = locale === 'ja' ? /(^|[\s(「"'])\?[A-Za-z]/u : /(^|[\s(«"„“'])\?\p{L}/u;
  if (wordStart.test(text)) reasons.push('question mark at start of a word');

  if (/\p{L}\? \p{Ll}/u.test(text)) reasons.push('question mark mid-sentence');

  if (/^\p{L}+\?$/u.test(text.trim()) && !english.includes('?')) {
    reasons.push('single word ending in a lost letter');
  }

  if (/[—–…‘’“”]/u.test(english)) {
    const translated = count(text, '?') + count(text, '؟');
    if (translated > count(english, '?')) reasons.push('dash or quote turned into a question mark');
  }

  return reasons;
}

function flatten(node, prefix, out) {
  if (typeof node === 'string') {
    out.set(prefix, node);
  } else if (node && typeof node === 'object') {
    for (const [key, child] of Object.entries(node)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  }
  return out;
}

function readFlat(file) {
  return flatten(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/u, '')), '', new Map());
}

export function scanRoot(root) {
  const issues = [];
  const sourceDir = path.join(root, SOURCE_LOCALE);
  if (!fs.existsSync(sourceDir)) return issues;

  const locales = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== SOURCE_LOCALE)
    .map((entry) => entry.name);

  for (const locale of locales) {
    const localeDir = path.join(root, locale);
    for (const name of fs.readdirSync(localeDir)) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(localeDir, name);
      const englishFile = path.join(sourceDir, name);
      const english = fs.existsSync(englishFile) ? readFlat(englishFile) : new Map();
      for (const [key, value] of readFlat(file)) {
        const reasons = findDamage(value, english.get(key), locale);
        if (reasons.length) issues.push({ file, key, value, reasons });
      }
    }
  }
  return issues;
}

/**
 * lang/<locale>/<ns>.php catalogues. Laravel serves these whenever there is no
 * JSON file for the namespace (lang/*\/api.php, for one), so they reach members
 * as API error messages and are scanned like the JSON files. Reading PHP goes
 * through the shared one-process loader, which falls back to the Docker
 * container on a host without PHP.
 */
export function scanPhpLang(tree) {
  const issues = [];
  for (const [id, catalogue] of Object.entries(tree)) {
    const [locale, name] = id.split('/');
    if (locale === SOURCE_LOCALE) continue;
    const english = flatten(tree[`${SOURCE_LOCALE}/${name}`] ?? {}, '', new Map());
    for (const [key, value] of flatten(catalogue, '', new Map())) {
      const reasons = findDamage(value, english.get(key), locale);
      if (reasons.length) issues.push({ file: path.join(ROOT, 'lang', locale, name), key, value, reasons });
    }
  }
  return issues;
}

function main() {
  const issues = LOCALE_ROOTS.flatMap(scanRoot);
  try {
    issues.push(...scanPhpLang(dumpLangTree({ root: ROOT })));
  } catch (error) {
    // Unavailable is never a pass: report it and exit 2, as preflight expects.
    console.error(`UNAVAILABLE: could not read lang/*.php (${error instanceof Error ? error.message.split('\n')[0] : error}).`);
    if (issues.length === 0) return 2;
  }
  if (issues.length === 0) {
    console.log('PASS: no translation values with characters replaced by "?".');
    return 0;
  }
  console.error(`FAIL: ${issues.length} translation value(s) look like characters were replaced by "?".`);
  console.error('Rewrite each by hand against the English source (see AGENTS.md, i18n section).\n');
  for (const issue of issues) {
    const shown = issue.value.length > 120 ? `${issue.value.slice(0, 117)}...` : issue.value;
    console.error(`  ${path.relative(ROOT, issue.file)}  ${issue.key}`);
    console.error(`    ${JSON.stringify(shown)}  [${issue.reasons.join('; ')}]`);
  }
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
