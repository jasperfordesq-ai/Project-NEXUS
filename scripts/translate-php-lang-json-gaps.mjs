// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * translate-php-lang-json-gaps.mjs — backfill lang/<locale>/<ns>.json values
 * that are still verbatim English.
 *
 * The JSON sibling of translate-php-lang-gaps.mjs (which is .php-only by
 * design — different reader, different writer). This catalogue is the LIVE
 * one: App\I18n\Translator makes __() read lang/<locale>/<ns>.json BEFORE the
 * .php loader, and on 2026-08-28 it held 49,223 English-identical values that
 * no gate measured — 80% of them in admin.json. The measuring gate is now
 * scripts/check-php-lang-json-untranslated.mjs; this is the shovel.
 *
 * Safety rules carried over from the .php sibling, because a translation
 * service will cheerfully mangle all of them:
 *   1. Placeholders (`{{name}}` and `:name`) are masked as `<x0/>` tags before
 *      translation and restored by INDEX after (a mask whose NAME gets
 *      translated still restores).
 *   2. The placeholder multiset of the result must equal English's. On
 *      mismatch the English is KEPT and reported — a missing translation is
 *      recoverable; a broken placeholder is a defect in a member's face.
 *   3. Values are written back into the ORIGINAL nested structure with
 *      JSON.stringify — never regex, never PowerShell (which mangles UTF-8).
 *      After writing, the file is re-read and the intended values verified.
 *
 * Irish (ga) is always skipped: Google's Irish is not approved for release;
 * Irish uses a separately reviewed workflow.
 *
 * Usage:
 *   node scripts/translate-php-lang-json-gaps.mjs --list
 *   node scripts/translate-php-lang-json-gaps.mjs --google --namespace admin.json
 *   node scripts/translate-php-lang-json-gaps.mjs --google --namespace admin.json --locale de
 *   node scripts/translate-php-lang-json-gaps.mjs --google --namespace admin.json --limit 50 --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LANG_DIR = path.join(ROOT, 'lang');
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'php-lang-invariant-allowlist.json');
const CHECKPOINT_PATH = path.join(ROOT, '.local-docs-archive', 'php-lang-json-translate-checkpoint.json');
const SOURCE_LOCALE = 'en';

// Deliberately excludes `ga` — see the header.
const TARGET_LOCALES = ['ar', 'de', 'es', 'fr', 'it', 'ja', 'nl', 'pl', 'pt'];

// ── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function argValue(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1] ?? null;
}

const USE_GOOGLE = args.includes('--google');
const LIST_ONLY = args.includes('--list');
const DRY_RUN = args.includes('--dry-run');
const NAMESPACE = argValue('--namespace');
const LOCALE = argValue('--locale');
const LIMIT = argValue('--limit') ? Number(argValue('--limit')) : null;
const CONCURRENCY = Math.min(10, Math.max(1, Number(argValue('--concurrency') ?? 5)));

// ── Placeholder protection (identical rules to the .php sibling) ─────────────

const PLACEHOLDER_PATTERN = /\{\{[^}]+\}\}|:[A-Za-z_][A-Za-z0-9_]*/g;

function maskPlaceholders(text) {
  const tokens = [];
  const masked = text.replace(PLACEHOLDER_PATTERN, (match) => {
    tokens.push(match);
    return `<x${tokens.length - 1}/>`;
  });
  return { masked, tokens };
}

function restorePlaceholders(text, tokens) {
  return text.replace(
    /<\s*[A-Za-zÀ-ɏ]{1,10}\s*(\d+)\s*\/?\s*>/g,
    (whole, index) => (tokens[Number(index)] ?? whole),
  );
}

function placeholderMultiset(text) {
  const counts = new Map();
  for (const match of text.match(PLACEHOLDER_PATTERN) ?? []) {
    counts.set(match, (counts.get(match) ?? 0) + 1);
  }
  return counts;
}

function placeholdersMatch(english, translated) {
  const left = placeholderMultiset(english);
  const right = placeholderMultiset(translated);
  if (left.size !== right.size) return false;
  for (const [token, count] of left) {
    if (right.get(token) !== count) return false;
  }
  return true;
}

// ── Translation ──────────────────────────────────────────────────────────────

async function translateOneGoogle(text, targetLocale, attempt = 1) {
  const { masked, tokens } = maskPlaceholders(text);

  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'en');
  url.searchParams.set('tl', targetLocale);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', masked);

  const response = await fetch(url);
  if (!response.ok) {
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
      return translateOneGoogle(text, targetLocale, attempt + 1);
    }
    throw new Error(`Google Translate ${response.status} for ${targetLocale}: ${await response.text()}`);
  }

  const data = await response.json();
  const joined = Array.isArray(data?.[0])
    ? data[0].map((part) => part?.[0] ?? '').join('')
    : '';

  return restorePlaceholders(joined, tokens);
}

async function translateAll(texts, targetLocale, onProgress) {
  const results = new Array(texts.length);
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < texts.length) {
      const index = next++;
      try {
        results[index] = await translateOneGoogle(texts[index], targetLocale);
      } catch (error) {
        // One refused value must not sink the other few thousand: keep its
        // English (null → "kept" downstream, reported not hidden) and move on.
        console.error(`  [kept-english] ${targetLocale}: ${String(error.message).slice(0, 120)}`);
        results[index] = null;
      }
      done++;
      if (done % 100 === 0) onProgress?.(done, texts.length);
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(CONCURRENCY, texts.length) },
    () => worker(),
  ));

  return results;
}

// ── Reading / writing ────────────────────────────────────────────────────────

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return { global: new Set(), byLocale: {} };
  const raw = readJson(ALLOWLIST_PATH);
  const byLocale = {};
  for (const [locale, values] of Object.entries(raw.byLocale ?? {})) {
    byLocale[locale] = new Set(values);
  }
  return { global: new Set(raw.global ?? []), byLocale };
}

function isAllowlisted(allowlist, locale, value) {
  return allowlist.global.has(value) || Boolean(allowlist.byLocale[locale]?.has(value));
}

function isTranslatableText(value) {
  return typeof value === 'string' && /\p{L}/u.test(value);
}

/** Collect [pathArray, value] leaf pairs from a nested object. */
function collectLeaves(node, prefix = [], out = []) {
  for (const [key, value] of Object.entries(node)) {
    const p = prefix.concat(key);
    if (value !== null && typeof value === 'object') {
      collectLeaves(value, p, out);
    } else {
      out.push([p, value]);
    }
  }
  return out;
}

function getByPath(node, pathParts) {
  let current = node;
  for (const part of pathParts) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
}

function setByPath(node, pathParts, value) {
  let current = node;
  for (let i = 0; i < pathParts.length - 1; i++) {
    current = current[pathParts[i]];
  }
  current[pathParts[pathParts.length - 1]] = value;
}

/** Write, then re-read and verify every intended value landed byte-exact. */
function writeAndVerify(file, tree, intended) {
  fs.writeFileSync(file, JSON.stringify(tree, null, 2) + '\n', 'utf8');
  const reread = readJson(file);
  for (const [pathParts, value] of intended) {
    const actual = getByPath(reread, pathParts);
    if (actual !== value) {
      throw new Error(`${file}: verification failed at ${pathParts.join('.')} — wrote ${JSON.stringify(value)}, read back ${JSON.stringify(actual)}`);
    }
  }
}

// ── Checkpoint ───────────────────────────────────────────────────────────────

function loadCheckpoint() {
  try {
    return readJson(CHECKPOINT_PATH);
  } catch {
    return {};
  }
}

function saveCheckpoint(checkpoint) {
  fs.mkdirSync(path.dirname(CHECKPOINT_PATH), { recursive: true });
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2) + '\n', 'utf8');
}

// ── Main ─────────────────────────────────────────────────────────────────────

const allowlist = loadAllowlist();

const namespaces = fs.readdirSync(path.join(LANG_DIR, SOURCE_LOCALE))
  .filter((f) => f.endsWith('.json'))
  .sort();

if (LIST_ONLY) {
  const rows = [];
  for (const ns of namespaces) {
    const english = collectLeaves(readJson(path.join(LANG_DIR, SOURCE_LOCALE, ns)));
    for (const locale of TARGET_LOCALES) {
      const file = path.join(LANG_DIR, locale, ns);
      if (!fs.existsSync(file)) continue;
      const localized = readJson(file);
      let pending = 0;
      for (const [pathParts, value] of english) {
        if (!isTranslatableText(value)) continue;
        const current = getByPath(localized, pathParts);
        if (current !== value) continue;
        if (isAllowlisted(allowlist, locale, value)) continue;
        pending++;
      }
      if (pending > 0) rows.push({ file: `${locale}/${ns}`, pending });
    }
  }
  rows.sort((a, b) => b.pending - a.pending);
  for (const row of rows.slice(0, 40)) {
    console.log(`${String(row.pending).padStart(6)}  ${row.file}`);
  }
  console.log(`Total pending: ${rows.reduce((sum, r) => sum + r.pending, 0)} across ${rows.length} locale files`);
  process.exit(0);
}

if (!USE_GOOGLE) {
  console.error('Nothing to do: pass --google to translate, or --list to see what is left.');
  process.exit(1);
}
if (!NAMESPACE) {
  console.error('Pass --namespace <file.json> (e.g. --namespace admin.json). One namespace per run keeps failures inspectable.');
  process.exit(1);
}
if (!namespaces.includes(NAMESPACE)) {
  console.error(`Unknown namespace ${NAMESPACE}. Available: ${namespaces.join(', ')}`);
  process.exit(1);
}

const checkpoint = loadCheckpoint();
const locales = LOCALE ? [LOCALE] : TARGET_LOCALES;

for (const locale of locales) {
  if (locale === 'ga') {
    console.log('ga: skipped — Irish uses the separately reviewed workflow, never Google.');
    continue;
  }
  if (!TARGET_LOCALES.includes(locale)) {
    console.error(`Unsupported locale ${locale}. Supported: ${TARGET_LOCALES.join(', ')}`);
    process.exit(1);
  }

  const checkpointKey = `${locale}/${NAMESPACE}`;
  if (checkpoint[checkpointKey]?.done && !LIMIT) {
    console.log(`${checkpointKey}: already done per checkpoint — clear ${path.relative(ROOT, CHECKPOINT_PATH)} to redo.`);
    continue;
  }

  const englishTree = readJson(path.join(LANG_DIR, SOURCE_LOCALE, NAMESPACE));
  const file = path.join(LANG_DIR, locale, NAMESPACE);
  if (!fs.existsSync(file)) {
    console.log(`${checkpointKey}: file missing — parity problem, skipping (run the parity tooling first).`);
    continue;
  }

  const localizedTree = readJson(file);
  const pending = [];
  for (const [pathParts, value] of collectLeaves(englishTree)) {
    if (!isTranslatableText(value)) continue;
    const current = getByPath(localizedTree, pathParts);
    if (current !== value) continue; // absent (parity's problem) or already translated
    if (isAllowlisted(allowlist, locale, value)) continue;
    pending.push([pathParts, value]);
  }

  const batch = LIMIT ? pending.slice(0, LIMIT) : pending;
  if (batch.length === 0) {
    console.log(`${checkpointKey}: nothing pending.`);
    checkpoint[checkpointKey] = { done: true, at: new Date().toISOString() };
    saveCheckpoint(checkpoint);
    continue;
  }

  console.log(`${checkpointKey}: translating ${batch.length} value(s)...`);
  const translations = await translateAll(
    batch.map(([, value]) => value),
    locale,
    (done, total) => console.log(`  ${checkpointKey}: ${done}/${total}`),
  );

  const intended = [];
  let kept = 0;
  for (let i = 0; i < batch.length; i++) {
    const [pathParts, english] = batch[i];
    if (translations[i] === null) {
      kept++;
      continue;
    }
    const translated = (translations[i] ?? '').trim();

    // Keep English rather than ship a broken value: empty result, unchanged
    // result, or a placeholder multiset that no longer matches.
    if (translated === '' || translated === english || !placeholdersMatch(english, translated)) {
      kept++;
      continue;
    }

    setByPath(localizedTree, pathParts, translated);
    intended.push([pathParts, translated]);
  }

  if (DRY_RUN) {
    console.log(`${checkpointKey}: DRY RUN — would write ${intended.length}, keep ${kept} as English.`);
    for (const [pathParts, value] of intended.slice(0, 10)) {
      console.log(`  ${pathParts.join('.')} = ${JSON.stringify(value)}`);
    }
    continue;
  }

  writeAndVerify(file, localizedTree, intended);
  console.log(`${checkpointKey}: wrote ${intended.length} translation(s), kept ${kept} as English (reported, not hidden).`);

  if (!LIMIT && kept === 0) {
    checkpoint[checkpointKey] = { done: true, at: new Date().toISOString() };
    saveCheckpoint(checkpoint);
  }
}

console.log('Done. Re-run the gates: node scripts/check-php-lang-json-untranslated.mjs && node scripts/check-i18n-json-integrity.mjs');
