// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, '../react-frontend/public/locales');
const BASELINE_PATH = path.resolve(__dirname, '../.github/i18n-gap-baseline.json');

const SUPPORTED_LANGUAGES = ['de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar', 'ga'];

const SKIP_NAMESPACES = new Set([
  'admin.json',
  'admin_dashboard.json',
  'admin_nav.json',
  'admin.php',
  'admin_dashboard.php',
  'admin_nav.php',
  'api.php',
  'api_controllers_1.json',
  'api_controllers_2.json',
  'api_controllers_3.json',
  'super_admin.json',
]);

const NO_TRANSLATE_PATTERNS = [
  /^https?:\/\//,
  /^\{\{.*\}\}$/,
  /^[a-zA-Z0-9_]+$/,
  /^\d+$/,
  /^[A-Z_]+$/,
];

const PLACEHOLDER_OR_TAG_PATTERN = /(\{\{[^}]+\}\}|<[^>]+>|%\{[^}]+\})/g;

const NO_TRANSLATE_VALUES = new Set([
  'Authy',
  'Facebook',
  'Google',
  'Google Authenticator',
  'Microsoft Authenticator',
  'Community Caring',
  'Spitex',
  'member@example.com',
  'vs',
  // Tech-stack values on the public Features page: product names and version
  // numbers joined by '+'. There is nothing in them to translate, and a
  // translator who "translates" one has introduced an error. Added 2026-07-30
  // when correcting "React 18" to "React 19" made five locales identical to
  // English and the gap counter read that as a regression — the value had only
  // ever differed because a translator had altered a product name.
  'React 19 + TypeScript + HeroUI + Tailwind CSS 4',
  'Laravel 12 + PHP 8.2+',
  'MariaDB 10.11',
  'Meilisearch v1.7',
  'Capacitor (iOS + Android)',
  'OpenAI text-embedding-3-small',
  'Pusher WebSockets, Firebase Cloud Messaging',
  // Social network names. Brand names are not translated, and the single-word
  // ones only escaped this list because /^[a-zA-Z0-9_]+$/ already covers them —
  // the two-word and punctuated forms did not.
  'Twitter / X',
  'Google Play',
  'App Store',
  // Concrete backend identifier shown as a format example. Translating it
  // changes the value administrators must enter rather than localizing copy.
  'bern-cooperative',
  // Robots meta directives: literal values a crawler parses, not prose.
  'Noindex Nofollow',
  'Index Follow',
  // Keyboard shortcuts and realistic format examples are interface literals,
  // not English copy. Translating either makes the instruction less accurate.
  '⌘K',
  'broker@example.com',
  'A-Z',
  '⌘',
  'Project NEXUS',
  'AGPL-3.0 — Copyright © 2024–{{year}} Jasper Ford',
  'you@example.com',
  'P@ssw0rd!',
  '••••••••',
  'XXXX-XXXX',
  'e.g. Acme Corp',
  'e.g. +1 555 123 4567',
  '25–34',
  '35–44',
  '45–54',
  '55–64',
  '∞',
  'Google Gemini',
  'Gmail API',
  'GOCSPX-xxxxx',
  'noreply@example.com',
  'test@example.com',
  'user@example.com',
  'User-agent: *\nDisallow: /admin/',
  'S Gxxxxx...',
  'Smtpexamplecom...',
  'Xxxxappsgoogleusercontentcom...',
  '#',
  '/blog/my-post',
  'hour-timebank',
  'Apache/Plesk',
  'Credit Commons',
  '*',
  "/register",
  "/about",
  "OAuth 2.0",
  "Azure Blob",
  "email@example.com",
  "#{{id}}",
  "A/B",
  "Timebanking UK",
  "admin@example.org",
  "integrations@partner.example",
  "disclosure-pack.md",
  "contact@partner.example",
  "/dashboard",
  "acct_...",
  "CSV/PDF",
  "guardian@example.com",
  "Microsoft Entra ID",
  "contact@yourorg.com",
  "email1@example.com, email2@example.com",
  "contact@example.com",
  "jasper@hour-timebank.ie",
  "child@example.com",
  "Cloudflare (CDN / WAF)",
  "Komunitin (JSON:API)",
  "application.created, shift.completed, hours.logged",
  "GBP (£)",
  "USD ($)",
  "EUR (€)",
  "Stiftung für das Alter",
  "Plesk / cPanel / IIS:",
  "EUR - Euro",
  "Kubernetes:",
  "Heroku / Render / Fly.io:",
  "Pusher WebSocket",
  "AWS ECS / Fargate:",
  "[TEST]",
  "Partner API v1",
  "CHF {{value}}/h",
  "Linux / VPS",
  "page.",
  "FADP Art. 16",
  "FADP Art. 17",
  "€803,184",
  "€16.06 : €1",
  "EU (EEA)",
  "Azure VM",
]);

// 'Café' is the native word in fr/pt/nl, not a copied English value: no locale
// file renders an English 'Café' as anything else, so a translator would leave
// it alone. Mirrors the entry in scripts/translate-i18n-gaps.mjs.
const LOCALE_IDENTITY_VALUES = new Map([
  ['es', new Set(['{{count}} total', '{{count}} ideas'])],
  ['fr', new Set([
    '{{count}} messages',
    '{{count}} total',
    '{{count}} participants',
    'Participants ({{count}})',
    '{{count}} votes',
    '{{count}} articles',
    '{{count}} article',
    'Café',
  ])],
  ['it', new Set(['{{count}} post'])],
  ['ga', new Set(['{{count}} post'])],
  ['nl', new Set(['{{count}} check-ins', '{{count}} routes', 'Café'])],
  ['pt', new Set(['Total: {{count}}', '{{count}} total', '{{count}} check-ins', 'Café'])],
]);

const UNIT_OR_FORMAT_PATTERN = /^[\s\d.,:;()+\-–—~/%×∞]*[a-zA-Z]{0,3}[\s\d.,:;()+\-–—~/%×∞]*$/u;

function flattenKeys(obj, prefix = '') {
  const result = {};

  for (const [key, value] of Object.entries(obj)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      Object.assign(result, flattenKeys(value, nextKey));
    } else {
      result[nextKey] = value;
    }
  }

  return result;
}

const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'];

function describePluralKey(key) {
  const ordinalMatch = key.match(/^(.*)_ordinal_(zero|one|two|few|many|other)$/u);
  if (ordinalMatch) return { base: ordinalMatch[1], category: ordinalMatch[2], ordinal: true };
  const cardinalMatch = key.match(/^(.*)_(zero|one|two|few|many|other)$/u);
  return cardinalMatch
    ? { base: cardinalMatch[1], category: cardinalMatch[2], ordinal: false }
    : null;
}

function isExpectedMissingPluralVariant(key, targetKeys, locale) {
  const descriptor = describePluralKey(key);
  if (!descriptor) return false;
  const prefix = descriptor.ordinal ? `${descriptor.base}_ordinal_` : `${descriptor.base}_`;
  const hasTargetFamily = targetKeys.has(descriptor.base)
    || PLURAL_CATEGORIES.some((category) => targetKeys.has(`${prefix}${category}`));
  if (!hasTargetFamily) return false;
  const supportedCategories = new Set(
    new Intl.PluralRules(locale, { type: descriptor.ordinal ? 'ordinal' : 'cardinal' })
      .resolvedOptions().pluralCategories,
  );
  return !supportedCategories.has(descriptor.category);
}

function shouldSkipValue(value, locale) {
  if (typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (NO_TRANSLATE_VALUES.has(trimmed)) return true;
  if (LOCALE_IDENTITY_VALUES.get(locale)?.has(trimmed)) return true;
  if (NO_TRANSLATE_PATTERNS.some((pattern) => pattern.test(trimmed))) return true;

  const withoutPlaceholders = trimmed.replace(PLACEHOLDER_OR_TAG_PATTERN, '').trim();
  if (!withoutPlaceholders) return true;
  return UNIT_OR_FORMAT_PATTERN.test(withoutPlaceholders);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function buildSnapshot() {
  const enDir = path.join(LOCALES_DIR, 'en');
  const enFiles = fs.readdirSync(enDir).filter((file) => file.endsWith('.json')).sort();
  const files = {};
  const gapKeys = {};
  let totalGaps = 0;

  for (const lang of SUPPORTED_LANGUAGES) {
    const langDir = path.join(LOCALES_DIR, lang);

    for (const file of enFiles) {
      if (SKIP_NAMESPACES.has(file)) continue;

      const enPath = path.join(enDir, file);
      const langPath = path.join(langDir, file);
      const enData = readJson(enPath);
      const langData = fs.existsSync(langPath) ? readJson(langPath) : {};
      const enFlat = flattenKeys(enData);
      const langFlat = flattenKeys(langData);
      const langKeys = new Set(Object.keys(langFlat));

      let gapCount = 0;
      const currentFileGapKeys = [];

      for (const [key, enValue] of Object.entries(enFlat)) {
        if (typeof enValue !== 'string') continue;
        if (shouldSkipValue(enValue, lang)) continue;

        const langValue = langFlat[key];
        if (
          (langValue === undefined && !isExpectedMissingPluralVariant(key, langKeys, lang))
          || langValue === enValue
        ) {
          gapCount += 1;
          currentFileGapKeys.push(key);
        }
      }

      if (gapCount > 0) {
        const fileKey = `${lang}/${file}`;
        files[fileKey] = gapCount;
        gapKeys[fileKey] = currentFileGapKeys;
        totalGaps += gapCount;
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    source: 'scripts/check-i18n-gap-regression.mjs',
    localesDir: 'react-frontend/public/locales',
    languages: SUPPORTED_LANGUAGES,
    totalGaps,
    files,
    gapKeys,
  };
}

function compareAgainstBaseline(current, baseline) {
  const regressions = [];
  const baselineFiles = baseline.files ?? {};
  const allFiles = new Set([...Object.keys(baselineFiles), ...Object.keys(current.files)]);

  for (const file of allFiles) {
    const baselineCount = baselineFiles[file] ?? 0;
    const currentCount = current.files[file] ?? 0;

    if (currentCount > baselineCount) {
      regressions.push({
        file,
        baseline: baselineCount,
        current: currentCount,
        delta: currentCount - baselineCount,
      });
    }
  }

  regressions.sort((a, b) => b.delta - a.delta || a.file.localeCompare(b.file));
  return regressions;
}

const args = process.argv.slice(2);
const shouldWriteBaseline = args.includes('--write-baseline');
const showDetails = args.includes('--details');
const showKeys = args.includes('--keys');
const currentSnapshot = buildSnapshot();

if (showDetails) {
  for (const [file, count] of Object.entries(currentSnapshot.files)) {
    console.log(`${file}: ${count}`);
  }
  console.log('');
}

if (showKeys) {
  for (const [file, keys] of Object.entries(currentSnapshot.gapKeys)) {
    for (const key of keys) console.log(`${file}: ${key}`);
  }
  console.log('');
}

if (shouldWriteBaseline) {
  const { gapKeys: _gapKeys, ...baselineSnapshot } = currentSnapshot;
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(baselineSnapshot, null, 2)}\n`);
  console.log('✅ Wrote i18n gap baseline.');
  console.log(`   File: ${path.relative(path.resolve(__dirname, '..'), BASELINE_PATH)}`);
  console.log(`   Total non-admin gaps: ${currentSnapshot.totalGaps}`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.error('❌ Missing .github/i18n-gap-baseline.json');
  console.error('   Run: node scripts/check-i18n-gap-regression.mjs --write-baseline');
  process.exit(1);
}

const baselineSnapshot = readJson(BASELINE_PATH);
const regressions = compareAgainstBaseline(currentSnapshot, baselineSnapshot);

if (regressions.length === 0) {
  const improvement = baselineSnapshot.totalGaps - currentSnapshot.totalGaps;
  console.log(`✅ Non-admin i18n gap count did not regress (${currentSnapshot.totalGaps} current vs ${baselineSnapshot.totalGaps} baseline)`);
  if (improvement > 0) {
    console.log(`   Improvement: ${improvement} fewer untranslated or English-fallback strings.`);
  }
  process.exit(0);
}

console.error('❌ Non-admin i18n gap regression detected.');
console.error(`   Current total: ${currentSnapshot.totalGaps}`);
console.error(`   Baseline total: ${baselineSnapshot.totalGaps}`);
console.error('');
console.error('Files that regressed:');

for (const regression of regressions.slice(0, 25)) {
  console.error(`   ${regression.file}: ${regression.baseline} → ${regression.current} (+${regression.delta})`);
}

if (regressions.length > 25) {
  console.error(`   ...and ${regressions.length - 25} more file(s)`);
}

console.error('');
console.error('If this increase is intentional, review the locale changes and refresh the baseline:');
console.error('   node scripts/check-i18n-gap-regression.mjs --write-baseline');
process.exit(1);
