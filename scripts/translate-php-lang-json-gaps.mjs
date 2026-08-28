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
 *   node scripts/translate-php-lang-json-gaps.mjs --harvest            # reuse approved React translations
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
const HARVEST_MODE = args.includes('--harvest');
const EXPORT_MODE = args.includes('--export');
const IMPORT_MODE = args.includes('--import');
const NAMESPACE = argValue('--namespace');
const LOCALE = argValue('--locale');
const LIMIT = argValue('--limit') ? Number(argValue('--limit')) : null;
const OUT_PATH = argValue('--out');
const IN_PATH = argValue('--in');
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

// ── Export / import: let a capable translator (a person, or an LLM agent)
// supply the translations while THIS script keeps every safety rule.
//
// The Google leg below is rate-limited into uselessness at catalogue scale and
// its quality is mediocre. The export/import pair is the supported path for
// bulk work: `--export` hands out a batch as flat JSON, the translator fills in
// `translation` for each item, `--import` validates and writes. Import
// re-checks that each key STILL holds the exact English it was exported with,
// so a stale or hand-edited batch can never clobber newer work.

/** Pending items for one locale+namespace, as {key (dotted), en}. */
function pendingItemsFor(locale, namespace, allowlistRef) {
  const englishTree = readJson(path.join(LANG_DIR, SOURCE_LOCALE, namespace));
  const file = path.join(LANG_DIR, locale, namespace);
  if (!fs.existsSync(file)) return { file, localizedTree: null, items: [] };

  const localizedTree = readJson(file);
  const items = [];
  for (const [pathParts, value] of collectLeaves(englishTree)) {
    if (!isTranslatableText(value)) continue;
    if (getByPath(localizedTree, pathParts) !== value) continue;
    if (isAllowlisted(allowlistRef, locale, value)) continue;
    // key is the literal path ARRAY: some real keys contain dots
    // (admin_help.articles./caring.relatedPaths.1.label), so a dotted string
    // cannot be split back unambiguously. display_key is for humans only.
    items.push({ key: pathParts, display_key: pathParts.join('.'), en: value });
  }
  return { file, localizedTree, items };
}

// ── Harvest: reuse translations the platform has already approved ───────────
//
// react-frontend/public/locales is the SAME product's translation catalogue and
// is in good health (2.2% English-identical vs this catalogue's 63.6%). Many
// namespaces exist in both trees with identical key paths AND identical English
// source strings — admin_nav, admin_dashboard, emails_misc, svc_notifications_2,
// api_controllers_3, civic_digest. Where the key matches, the English matches
// byte for byte, and the React locale holds a real translation, that translation
// is strictly better than anything a machine translator would produce: it is the
// reviewed string members and admins already see.
//
// Conditions are deliberately strict — same namespace filename, same dotted key
// path, byte-identical English on both sides, a React value that is neither
// empty nor still English, and a placeholder multiset that matches. Anything
// short of that is left pending for a real translator.

const REACT_LOCALES_DIR = path.join(ROOT, 'react-frontend', 'public', 'locales');

if (HARVEST_MODE) {
  const localesToDo = LOCALE ? [LOCALE] : [...TARGET_LOCALES, 'ga'];
  const namespacesToDo = NAMESPACE ? [NAMESPACE] : namespaces;

  let written = 0;
  let skippedPlaceholder = 0;
  const perFile = [];

  for (const locale of localesToDo) {
    for (const ns of namespacesToDo) {
      const langFile = path.join(LANG_DIR, locale, ns);
      const reactEnFile = path.join(REACT_LOCALES_DIR, SOURCE_LOCALE, ns);
      const reactLocFile = path.join(REACT_LOCALES_DIR, locale, ns);
      if (!fs.existsSync(langFile) || !fs.existsSync(reactEnFile) || !fs.existsSync(reactLocFile)) continue;

      const englishTree = readJson(path.join(LANG_DIR, SOURCE_LOCALE, ns));
      const localizedTree = readJson(langFile);
      const reactEn = readJson(reactEnFile);
      const reactLoc = readJson(reactLocFile);

      const intended = [];
      for (const [pathParts, english] of collectLeaves(englishTree)) {
        if (!isTranslatableText(english)) continue;
        if (getByPath(localizedTree, pathParts) !== english) continue;
        if (isAllowlisted(allowlist, locale, english)) continue;

        // The React side must describe the SAME string: same key path, same
        // English source.
        if (getByPath(reactEn, pathParts) !== english) continue;
        const candidate = getByPath(reactLoc, pathParts);
        if (typeof candidate !== 'string') continue;
        if (candidate.trim() === '' || candidate === english) continue;
        if (!isTranslatableText(candidate)) continue;
        if (!placeholdersMatch(english, candidate)) { skippedPlaceholder++; continue; }

        setByPath(localizedTree, pathParts, candidate);
        intended.push([pathParts, candidate]);
      }

      if (intended.length === 0) continue;
      if (!DRY_RUN) writeAndVerify(langFile, localizedTree, intended);
      written += intended.length;
      perFile.push(`${locale}/${ns}: ${intended.length}`);
    }
  }

  for (const line of perFile.sort()) console.log('  ' + line);
  console.log(`${DRY_RUN ? 'DRY RUN — would harvest' : 'Harvested'} ${written} approved translation(s) from react-frontend locales.`);
  if (skippedPlaceholder > 0) {
    console.log(`${skippedPlaceholder} candidate(s) skipped: placeholder multiset did not match.`);
  }
  console.log('Now run: node scripts/check-php-lang-json-untranslated.mjs && node scripts/check-i18n-json-integrity.mjs');
  process.exit(0);
}

if (EXPORT_MODE) {
  if (!NAMESPACE || !LOCALE) {
    console.error('--export requires --namespace <file.json> and --locale <code>.');
    process.exit(1);
  }
  if (LOCALE === 'ga') {
    console.error('ga is excluded: Irish uses the separately reviewed workflow.');
    process.exit(1);
  }
  const { items } = pendingItemsFor(LOCALE, NAMESPACE, allowlist);
  const batch = LIMIT ? items.slice(0, LIMIT) : items;
  const payload = {
    _instructions: [
      'Fill in a "translation" field for every item. Do not add, remove or reorder items.',
      'Do not change "key" or "en" — import verifies them and refuses mismatches.',
      'Placeholders ({{name}} and :name) must appear in the translation exactly as in "en",',
      'the same number of times. Import rejects any item where they do not match.',
      'Leave "translation" empty (or omit it) for anything that should stay English;',
      'those stay counted as untranslated rather than being silently accepted.',
    ],
    locale: LOCALE,
    namespace: NAMESPACE,
    exported_pending_total: items.length,
    items: batch,
  };
  const out = OUT_PATH ?? path.join(ROOT, '.local-docs-archive', `lang-batch-${LOCALE}-${NAMESPACE}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`Exported ${batch.length} of ${items.length} pending item(s) to ${out}`);
  process.exit(0);
}

if (IMPORT_MODE) {
  if (!IN_PATH) {
    console.error('--import requires --in <batch.json> (a file produced by --export, with translations filled in).');
    process.exit(1);
  }
  const payload = readJson(IN_PATH);
  const locale = payload.locale;
  const namespace = payload.namespace;
  if (!locale || !namespace) {
    console.error('Batch file must carry "locale" and "namespace" (as exported).');
    process.exit(1);
  }
  if (locale === 'ga') {
    console.error('ga is excluded: Irish uses the separately reviewed workflow.');
    process.exit(1);
  }

  const file = path.join(LANG_DIR, locale, namespace);
  const localizedTree = readJson(file);
  const englishTree = readJson(path.join(LANG_DIR, SOURCE_LOCALE, namespace));

  const intended = [];
  const rejected = [];
  let skippedEmpty = 0;

  for (const item of payload.items ?? []) {
    const pathParts = Array.isArray(item.key) ? item.key.map(String) : null;
    if (!pathParts) {
      rejected.push({ key: item.display_key ?? 'unknown', why: 'key must be the exported path array' });
      continue;
    }
    const translation = typeof item.translation === 'string' ? item.translation.trim() : '';
    const english = item.en;

    if (translation === '' || translation === english) {
      skippedEmpty++;
      continue;
    }
    // The exported English must still be the live English AND still be what
    // the locale file holds — otherwise this batch is stale and writing it
    // would silently revert someone else's work.
    if (getByPath(englishTree, pathParts) !== english) {
      rejected.push({ key: item.display_key ?? item.key, why: 'English source changed since export' });
      continue;
    }
    if (getByPath(localizedTree, pathParts) !== english) {
      rejected.push({ key: item.display_key ?? item.key, why: 'locale value already changed since export' });
      continue;
    }
    if (!placeholdersMatch(english, translation)) {
      rejected.push({ key: item.display_key ?? item.key, why: 'placeholder mismatch' });
      continue;
    }

    setByPath(localizedTree, pathParts, translation);
    intended.push([pathParts, translation]);
  }

  if (DRY_RUN) {
    console.log(`DRY RUN ${locale}/${namespace}: would write ${intended.length}, skip ${skippedEmpty} empty, reject ${rejected.length}.`);
  } else {
    writeAndVerify(file, localizedTree, intended);
    console.log(`${locale}/${namespace}: wrote ${intended.length} translation(s); ${skippedEmpty} left English; ${rejected.length} rejected.`);
  }

  for (const r of rejected.slice(0, 20)) {
    console.error(`  REJECTED ${r.key}: ${r.why}`);
  }
  if (rejected.length > 20) console.error(`  ... and ${rejected.length - 20} more`);

  console.log('Now run: node scripts/check-php-lang-json-untranslated.mjs && node scripts/check-i18n-json-integrity.mjs');
  // Rejections are reported, not fatal: the accepted values are already
  // verified on disk, and a rejected item simply stays untranslated.
  process.exit(0);
}

if (!USE_GOOGLE) {
  console.error('Nothing to do. Modes: --list | --harvest | --export | --import | --google (rate-limited, small batches only).');
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
