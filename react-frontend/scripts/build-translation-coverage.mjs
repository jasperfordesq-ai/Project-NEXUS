// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * build-translation-coverage.mjs
 *
 * Writes public/translation-coverage.json for the Platform team panel's
 * Translations page ("Website wording"): for every supported language other
 * than English, over public/locales/<locale>/*.json against public/locales/en:
 *
 *   keys             phrases English has (a plural family counts once)
 *   missing          phrases the language does not have, or has empty
 *   same_as_english  phrases whose text is still word-for-word English
 *
 * Runs in `predev` and `prebuild`, beside copy-changelog. The output is
 * gitignored.
 *
 * 🔴 It must NEVER fail a build. Everything is wrapped: on any error it writes
 * `{ "available": false }` and exits 0, and the page then says the figures are
 * not available on this server.
 *
 * Rules (the server's TranslationCoverageService uses the same ones):
 *   - Nested objects are flattened; only string leaves are phrases.
 *   - Keys ending _zero/_one/_two/_few/_many/_other are one phrase per base
 *     key: languages legitimately have different plural forms, so a language
 *     has the phrase when it has ANY form of it.
 *   - A phrase whose every English form is empty (after trimming) is not a
 *     phrase: it is left out of `keys` and is never missing or the same as
 *     English, whatever the language has there.
 *   - "Same as English" = identical after trimming, and the English text has
 *     at least one letter once placeholders ({{x}}, {x}, :x, %s) and tags are
 *     removed. It over-counts words that are meant to be the same (names,
 *     units); the page says so.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Flatten a parsed JSON object into { 'a.b.c': 'text' } for string leaves only. */
function flatten(value, prefix, out) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;
  for (const [key, child] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') out.set(full, child);
    else if (child !== null && typeof child === 'object' && !Array.isArray(child)) flatten(child, full, out);
  }
  return out;
}

/** Group flat keys into phrases: { phraseKey: Map(fullKey -> text) }. */
function groupPhrases(flat) {
  const groups = new Map();
  for (const [key, text] of flat) {
    const base = key.replace(PLURAL_SUFFIX, '');
    if (!groups.has(base)) groups.set(base, new Map());
    groups.get(base).set(key, text);
  }
  return groups;
}

/**
 * English phrase groups with the empty ones left out: a group whose every
 * English form is empty (after trimming) is not a phrase, so it can never be
 * missing or the same as English.
 */
function englishPhrases(flat) {
  const groups = groupPhrases(flat);
  for (const [base, forms] of groups) {
    if ([...forms.values()].every((text) => text.trim() === '')) groups.delete(base);
  }
  return groups;
}

/** True when a text, with placeholders and tags removed, still has a letter. */
function hasWords(text) {
  const stripped = text
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '')
    .replace(/%[sd]/g, '')
    .replace(/<[^>]*>/g, '');
  return /\p{L}/u.test(stripped);
}

export function isSameAsEnglish(localeText, englishText) {
  if (typeof localeText !== 'string' || typeof englishText !== 'string') return false;
  const a = localeText.trim();
  const b = englishText.trim();
  return a !== '' && a === b && hasWords(b);
}

/** Read one JSON file as a flat map, or null when it is absent or unreadable. */
function readFlat(file) {
  if (!existsSync(file)) return null;
  try {
    return flatten(JSON.parse(readFileSync(file, 'utf8')), '', new Map());
  } catch {
    return null;
  }
}

/**
 * The pure count over a locales folder. English unreadable or empty ⇒
 * `{ available: false }`. A missing or broken language file counts its
 * phrases as missing.
 */
export function computeCoverage(localesDir, locales) {
  const enDir = path.join(localesDir, 'en');
  if (!existsSync(enDir)) return { available: false };

  const namespaces = readdirSync(enDir).filter((name) => name.endsWith('.json')).sort();
  const english = new Map(); // namespace -> phrase groups
  let total = 0;
  for (const file of namespaces) {
    const flat = readFlat(path.join(enDir, file));
    if (flat === null) return { available: false };
    const groups = englishPhrases(flat);
    english.set(file, groups);
    total += groups.size;
  }
  if (total === 0) return { available: false };

  const rows = locales.map((locale) => {
    let missing = 0;
    let same = 0;
    for (const [file, groups] of english) {
      const flat = readFlat(path.join(localesDir, locale, file)) ?? new Map();
      // An empty text is not a translation.
      const filled = new Map([...flat].filter(([, text]) => text.trim() !== ''));
      const localeGroups = groupPhrases(filled);
      for (const [base, forms] of groups) {
        // Any form of the phrase counts as having it (plural forms differ by language).
        if (!localeGroups.has(base)) {
          missing++;
          continue;
        }
        const shared = [...forms.keys()].filter((key) => filled.has(key));
        if (shared.length > 0 && shared.every((key) => isSameAsEnglish(filled.get(key), forms.get(key)))) same++;
      }
    }
    return { locale, keys: total, missing, same_as_english: same };
  });

  return { available: true, generated_at: new Date().toISOString(), locales: rows };
}

/** The supported languages other than English, from SUPPORTED_LOCALE_CODES in src/i18n.ts. */
export function readSupportedLocales(i18nFile) {
  const source = readFileSync(i18nFile, 'utf8');
  const match = source.match(/SUPPORTED_LOCALE_CODES\s*=\s*\[([\s\S]*?)\]/);
  if (!match) throw new Error('SUPPORTED_LOCALE_CODES not found');
  const codes = [...match[1].matchAll(/'([a-z]{2,3}(?:-[A-Za-z]{2,4})?)'/g)].map((m) => m[1]);
  if (codes.length === 0) throw new Error('SUPPORTED_LOCALE_CODES is empty');
  return codes.filter((code) => code !== 'en');
}

/** Compute and write. Never throws: any failure writes `{ available: false }`. */
export function run({ localesDir, i18nFile, outFile }) {
  let result;
  try {
    result = computeCoverage(localesDir, readSupportedLocales(i18nFile));
  } catch {
    result = { available: false };
  }
  try {
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, `${JSON.stringify(result)}\n`, 'utf8');
  } catch {
    // Nowhere to write: the page shows "not available", the build goes on.
  }
  return result;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const result = run({
      localesDir: path.join(frontendRoot, 'public', 'locales'),
      i18nFile: path.join(frontendRoot, 'src', 'i18n.ts'),
      outFile: path.join(frontendRoot, 'public', 'translation-coverage.json'),
    });
    if (result.available) {
      const missing = result.locales.reduce((sum, row) => sum + row.missing, 0);
      const same = result.locales.reduce((sum, row) => sum + row.same_as_english, 0);
      console.log(
        `build-translation-coverage: ${result.locales.length} languages, ${result.locales[0]?.keys ?? 0} phrases each; ` +
          `${missing} missing and ${same} still the same as English in total`,
      );
    } else {
      console.warn('build-translation-coverage: figures not available; wrote {"available": false}');
    }
  } catch {
    // Never fail a build.
  }
  process.exitCode = 0;
}
