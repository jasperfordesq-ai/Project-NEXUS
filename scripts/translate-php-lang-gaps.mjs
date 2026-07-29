// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * translate-php-lang-gaps.mjs — backfill lang/<locale>/*.php values that are
 * still verbatim English.
 *
 * scripts/translate-i18n-gaps.mjs is the equivalent for react-frontend's JSON
 * locales and hard-excludes PHP, so this is a sibling rather than a flag on it:
 * PHP lang files need a different reader (the language itself), a different
 * placeholder syntax (`:name`, not `{{name}}`), and a different writer (whole-
 * file regeneration through a serializer, not JSON.stringify).
 *
 * How the debt happened, and what stops it happening again here:
 * scripts/_fill_php_drift.mjs deep-filled English into every locale to satisfy
 * the key-set parity gate. That is why 62.3% of non-English values were
 * byte-identical English while parity was green. This script only ever writes a
 * value it has actually translated, and verifies every write.
 *
 * Three things are checked on every value, because a translation service will
 * cheerfully mangle all three:
 *
 *   1. Laravel placeholders (`:name`, `:Name`, `:NAME`) are masked before
 *      translation and restored after. The React JSON token-integrity gate does
 *      not cover PHP files, so the writer has to be its own gate.
 *   2. The placeholder multiset of the result must equal English's. A dropped or
 *      duplicated `:count` renders as literal text in a member's face. On
 *      mismatch the English is KEPT and the value is reported — a missing
 *      translation is recoverable, a broken placeholder is a visible defect.
 *   3. Every written file is re-read by PHP (`php -l`, then require) and deep-
 *      compared against the map that was intended. Regex is never used to read
 *      or verify these files.
 *
 * Usage:
 *   node scripts/translate-php-lang-gaps.mjs --google --namespace api.php
 *   node scripts/translate-php-lang-gaps.mjs --google --namespace api.php --locale de
 *   node scripts/translate-php-lang-gaps.mjs --google --namespace api.php --limit 20
 *   node scripts/translate-php-lang-gaps.mjs --list          # what is left, worst first
 *
 * Irish (ga) is skipped unless OPENAI_API_KEY is set: Google's Irish is poor
 * enough that shipping it would be a downgrade dressed as progress, which is why
 * translate-i18n-gaps.mjs special-cases it too.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LANG_DIR = path.join(ROOT, 'lang');
const DUMP_SCRIPT = path.join(ROOT, 'scripts', 'php', 'dump-lang.php');
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'php-lang-invariant-allowlist.json');
// Local run state, not a repository artefact — .local-docs-archive is gitignored
// and is where AGENTS.md puts local task output.
const CHECKPOINT_PATH = path.join(ROOT, '.local-docs-archive', 'php-lang-translate-checkpoint.json');
const SOURCE_LOCALE = 'en';

const TARGET_LOCALES = ['ar', 'de', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt'];

// Google's Irish is not good enough to ship. Everything else goes through the
// same path as the React locales, which have been filled this way for months.
const OPENAI_ONLY_LOCALES = new Set(['ga']);

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
const SAMPLES = Number(argValue('--samples') ?? 30);
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

// ── Reading (PHP only, never regex) ──────────────────────────────────────────

function runPhp(scriptArgs) {
  try {
    return execFileSync('php', ['-d', 'display_errors=stderr', ...scriptArgs], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
  }

  const container = process.env.NEXUS_PHP_CONTAINER || 'nexus-php-app';
  const containerRoot = (process.env.NEXUS_PHP_CONTAINER_ROOT || '/var/www/html').replace(/\/$/u, '');
  const mapped = scriptArgs.map((arg) => (
    arg.startsWith(ROOT)
      ? `${containerRoot}/${path.relative(ROOT, arg).replaceAll('\\', '/')}`
      : arg
  ));

  return execFileSync('docker', [
    'exec', container, 'php', '-d', 'display_errors=stderr', ...mapped,
  ], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

function dumpLangTree({ nested }) {
  const extra = nested ? ['--nested'] : [];
  return JSON.parse(runPhp([DUMP_SCRIPT, LANG_DIR, ...extra]));
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) return { global: new Set(), byLocale: {} };
  const raw = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
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

// ── Placeholders ─────────────────────────────────────────────────────────────

/**
 * Laravel replacements are `:name`, and `__()` also honours `:Name` (ucfirst)
 * and `:NAME` (upper) as separate spellings. `{{name}}` is matched too: a value
 * copied over from the React locales can carry that syntax.
 *
 * The pattern is deliberately greedy about what counts as a placeholder. Masking
 * something that only looks like one (`mailto:someone`) costs a phrase that goes
 * untranslated; failing to mask a real one costs a member reading ":count" on
 * screen. The first is a shrug, the second is a bug report.
 */
const PLACEHOLDER_PATTERN = /\{\{[^}]+\}\}|:[A-Za-z_][A-Za-z0-9_]*/g;

function maskPlaceholders(text) {
  const tokens = [];
  const masked = text.replace(PLACEHOLDER_PATTERN, (match) => {
    tokens.push(match);
    // An XML-ish self-closing tag survives translation far better than a bare
    // sentinel word. The tag NAME is a single meaningless letter on purpose:
    // the first attempt used `<nexus0/>` and Google translated the name itself —
    // `<nexo0/>` in Spanish and Portuguese, `<lien0/>` in French — which failed
    // to restore and cost 207 values across three locales. They were kept as
    // English rather than shipped, which is what the multiset check below is
    // for, but a mask that gets translated is a mask that does not work.
    return `<x${tokens.length - 1}/>`;
  });
  return { masked, tokens };
}

/**
 * Restore by INDEX, tolerating a translated or re-cased tag name.
 *
 * Even a one-letter name is not safe from every engine and language, so the
 * digits are treated as the identity of the token and the name as decoration. A
 * lang value containing something that genuinely looks like `<p0/>` would be
 * mis-restored — but then the multiset check rejects the value and the English
 * is kept, so the failure mode stays safe either way.
 */
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
      results[index] = await translateOneGoogle(texts[index], targetLocale);
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

// ── Writing ──────────────────────────────────────────────────────────────────

/**
 * Serialize a JS object as a PHP array literal.
 *
 * Hardened from scripts/_fill_php_drift.mjs, which escaped `'` but not `\` — a
 * single backslash in a value would have produced a file PHP reads differently
 * from what was intended, or not at all. Non-string scalars are emitted
 * unquoted, because `String(true)` writing `'true'` would silently change a
 * boolean config value into a truthy string.
 */
function serializePhpArray(value, indent = 1) {
  const pad = '    '.repeat(indent);
  const closePad = '    '.repeat(indent - 1);
  const entries = Object.entries(value);

  if (entries.length === 0) return '[]';

  const lines = ['['];
  for (const [key, child] of entries) {
    const quotedKey = `'${String(key).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
    if (child !== null && typeof child === 'object') {
      lines.push(`${pad}${quotedKey} => ${serializePhpArray(child, indent + 1)},`);
    } else {
      lines.push(`${pad}${quotedKey} => ${serializePhpScalar(child)},`);
    }
  }
  lines.push(`${closePad}]`);

  return lines.join('\n');
}

function serializePhpScalar(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  return `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

/**
 * Everything before the top-level return — the `<?php` line and the SPDX header,
 * which is mandatory on every source file here and must survive a regeneration
 * byte for byte.
 *
 * Both array syntaxes are accepted: eleven lang files still open with
 * `return array (`, and refusing those would silently skip whole namespaces.
 *
 * The header is normalised to LF, and the body is written as LF, because the
 * alternative is worse. Converting the whole file to CRLF would also convert the
 * newlines INSIDE multi-line translation values, changing the strings themselves
 * — the round-trip check would catch it, but only by refusing every such file.
 * LF matches the other 451 lang files, and git normalises on commit anyway.
 *
 * No match is a hard error rather than a guess. A writer that cannot find where
 * the data starts must not decide for itself where to put it.
 */
function readFileHeader(file) {
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(/^([\s\S]*?)^return\s*(?:\[|array\s*\()/m);
  if (!match) {
    throw new Error(`${file}: no top-level 'return [' or 'return array (' — refusing to rewrite it`);
  }
  return match[1].replaceAll('\r\n', '\n');
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function setByPath(target, pathParts, value) {
  let cursor = target;
  for (const part of pathParts.slice(0, -1)) {
    cursor = cursor[part];
  }
  cursor[pathParts.at(-1)] = value;
}

function collectLeafPaths(node, prefix = []) {
  const leaves = [];
  for (const [key, value] of Object.entries(node)) {
    const next = [...prefix, key];
    if (value !== null && typeof value === 'object') {
      leaves.push(...collectLeafPaths(value, next));
    } else {
      leaves.push({ pathParts: next, dotted: next.join('.'), value });
    }
  }
  return leaves;
}

function getByPath(node, pathParts) {
  let cursor = node;
  for (const part of pathParts) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = cursor[part];
  }
  return cursor;
}

/**
 * Write the file, then make PHP read it back and prove it equals the map we
 * meant to write. A serializer bug that produces valid-but-different PHP is
 * exactly the failure a syntax check cannot see.
 */
function writeAndVerify(file, header, tree) {
  const contents = `${header}return ${serializePhpArray(tree)};\n`;
  fs.writeFileSync(file, contents, 'utf8');

  runPhp(['-l', file]);

  const roundTripped = JSON.parse(runPhp([
    '-r', 'echo json_encode(require $argv[1], JSON_UNESCAPED_UNICODE);', file,
  ]));

  const expected = JSON.stringify(tree);
  const actual = JSON.stringify(roundTripped);
  if (expected !== actual) {
    throw new Error(
      `${file}: round-trip mismatch — PHP read back something other than what was written. `
      + 'The file has been left in place for inspection; revert it with git checkout.'
    );
  }
}

// ── Checkpointing ────────────────────────────────────────────────────────────

function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_PATH)) return { completed: [] };
  return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, 'utf8'));
}

function saveCheckpoint(checkpoint) {
  fs.mkdirSync(path.dirname(CHECKPOINT_PATH), { recursive: true });
  fs.writeFileSync(CHECKPOINT_PATH, `${JSON.stringify(checkpoint, null, 2)}\n`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const allowlist = loadAllowlist();
const flatTree = dumpLangTree({ nested: false });

function pendingCount(localeFile) {
  const namespace = localeFile.slice(localeFile.indexOf('/') + 1);
  const locale = localeFile.slice(0, localeFile.indexOf('/'));
  const english = flatTree[`${SOURCE_LOCALE}/${namespace}`];
  if (!english) return 0;

  let count = 0;
  for (const [key, value] of Object.entries(flatTree[localeFile])) {
    if (!isTranslatableText(value)) continue;
    if (value !== english[key]) continue;
    if (isAllowlisted(allowlist, locale, value)) continue;
    count++;
  }
  return count;
}

if (LIST_ONLY) {
  const byNamespace = new Map();
  for (const localeFile of Object.keys(flatTree)) {
    const locale = localeFile.slice(0, localeFile.indexOf('/'));
    if (locale === SOURCE_LOCALE) continue;
    const namespace = localeFile.slice(localeFile.indexOf('/') + 1);
    byNamespace.set(namespace, (byNamespace.get(namespace) ?? 0) + pendingCount(localeFile));
  }

  const rows = [...byNamespace.entries()].filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  console.log(`Untranslated values: ${total} across ${rows.length} namespace(s), worst first:`);
  for (const [namespace, count] of rows) {
    console.log(`  ${String(count).padStart(6)}  ${namespace}`);
  }
  process.exit(0);
}

if (!USE_GOOGLE) {
  console.error('Pass --google. There is no other configured provider for these files.');
  console.error('  Irish (ga) additionally needs OPENAI_API_KEY, or it is skipped.');
  process.exit(1);
}

if (!NAMESPACE) {
  console.error('Pass --namespace <file.php>. Whole-tree runs are deliberately not offered:');
  console.error('  each namespace is reviewed, baselined and committed on its own.');
  console.error('  See what is outstanding with --list.');
  process.exit(1);
}

const englishNested = dumpLangTree({ nested: true })[`${SOURCE_LOCALE}/${NAMESPACE}`];
if (!englishNested) {
  console.error(`No lang/${SOURCE_LOCALE}/${NAMESPACE} — check the namespace name.`);
  process.exit(1);
}

const nestedTree = dumpLangTree({ nested: true });
const englishLeaves = collectLeafPaths(englishNested);
const locales = (LOCALE ? [LOCALE] : TARGET_LOCALES).filter((locale) => {
  if (OPENAI_ONLY_LOCALES.has(locale) && !OPENAI_KEY) {
    console.log(`Skipping ${locale}: needs OPENAI_API_KEY (Google's ${locale} is not shippable).`);
    return false;
  }
  return true;
});

const checkpoint = loadCheckpoint();
const report = { namespace: NAMESPACE, locales: {} };

for (const locale of locales) {
  const batchId = `${locale}/${NAMESPACE}`;
  if (checkpoint.completed.includes(batchId) && !LIMIT) {
    console.log(`${batchId}: already done in this run series (checkpoint) — skipping.`);
    continue;
  }

  const localeFile = path.join(LANG_DIR, locale, NAMESPACE);
  if (!fs.existsSync(localeFile)) {
    console.log(`${batchId}: no such file — skipping (parity gate owns missing namespaces).`);
    continue;
  }

  const localeNested = nestedTree[batchId];
  const outstanding = englishLeaves.filter(({ pathParts, value }) => {
    if (!isTranslatableText(value)) return false;
    if (getByPath(localeNested, pathParts) !== value) return false;
    return !isAllowlisted(allowlist, locale, value);
  });

  const work = LIMIT ? outstanding.slice(0, LIMIT) : outstanding;

  if (work.length === 0) {
    console.log(`${batchId}: nothing outstanding.`);
    continue;
  }

  console.log(`${batchId}: translating ${work.length}${LIMIT ? ` of ${outstanding.length}` : ''} value(s) at concurrency ${CONCURRENCY}…`);

  const translated = await translateAll(
    work.map(({ value }) => value),
    locale,
    (done, total) => console.log(`  ${batchId}: ${done}/${total}`),
  );

  const merged = deepClone(localeNested);
  const rejected = [];
  const samples = [];
  let written = 0;

  work.forEach(({ pathParts, dotted, value }, index) => {
    const candidate = (translated[index] ?? '').trim();

    if (!candidate) {
      rejected.push({ key: dotted, reason: 'empty response', english: value });
      return;
    }
    if (!placeholdersMatch(value, candidate)) {
      // Keeping English is the safe failure: a member can read English, but a
      // literal ":count" in a sentence is a defect they will report.
      rejected.push({ key: dotted, reason: 'placeholder mismatch', english: value, got: candidate });
      return;
    }

    setByPath(merged, pathParts, candidate);
    written++;
    if (samples.length < SAMPLES) samples.push({ key: dotted, english: value, translated: candidate });
  });

  report.locales[locale] = {
    outstanding: outstanding.length,
    attempted: work.length,
    written,
    rejected,
    samples,
  };

  console.log(`  ${batchId}: ${written} written, ${rejected.length} kept as English.`);

  if (DRY_RUN) {
    console.log(`  ${batchId}: --dry-run, not writing.`);
    continue;
  }

  writeAndVerify(localeFile, readFileHeader(localeFile), merged);
  console.log(`  ${batchId}: written and verified (php -l + require round trip).`);

  if (!LIMIT) {
    checkpoint.completed.push(batchId);
    saveCheckpoint(checkpoint);
  }
}

// ── Spot-check output ────────────────────────────────────────────────────────

console.log('');
console.log('============================================================');
console.log(`  Spot-check samples — ${NAMESPACE}`);
console.log('============================================================');
for (const [locale, result] of Object.entries(report.locales)) {
  console.log('');
  console.log(`── ${locale} — ${result.written}/${result.attempted} written`);
  for (const sample of result.samples) {
    console.log(`   ${sample.key}`);
    console.log(`     en: ${sample.english}`);
    console.log(`     ${locale}: ${sample.translated}`);
  }
  if (result.rejected.length > 0) {
    console.log(`   KEPT AS ENGLISH (${result.rejected.length}):`);
    for (const rejection of result.rejected.slice(0, 10)) {
      console.log(`     ${rejection.key} — ${rejection.reason}`);
      if (rejection.got) console.log(`       got: ${rejection.got}`);
    }
  }
}

console.log('');
console.log('Next: node scripts/check-php-lang-parity.mjs');
console.log('      node scripts/check-php-lang-untranslated.mjs --write-baseline');
