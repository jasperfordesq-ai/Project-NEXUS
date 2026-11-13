// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-i18n-stubs.mjs — Detect mechanically generated translation values.
 *
 * Two stub patterns are checked:
 *
 * 1. A value with a telltale technical suffix is just its key with underscores
 *    replaced by spaces, for example `"update_btn": "Update Btn"`.
 * 2. An admin value is a humanized final key segment in every supported
 *    non-English locale, for example `stat_total_bounces_7d` becoming
 *    `"Stat Total Bounces 7d"` in all ten catalogs. Requiring agreement across
 *    every locale keeps this second check narrow while catching bulk gap-fill
 *    failures that ordinary key-drift checks cannot see.
 *
 * A small, value-pinned allowlist covers reviewed locale-invariant protocol
 * names, acronyms, schema identifiers, numeric ranges, and codes. New
 * invariants must be reviewed and added explicitly; broad acronym heuristics
 * would also hide user-facing labels such as `SAVE`.
 *
 * Uses a baseline at .github/i18n-stub-baseline.json so that existing stubs
 * don't block every commit — only regressions cause a failure. The baseline
 * count can only go down over time.
 *
 * Usage:
 *   node scripts/check-i18n-stubs.mjs              # check against baseline
 *   node scripts/check-i18n-stubs.mjs --list       # list all current stubs
 *   node scripts/check-i18n-stubs.mjs --baseline   # regenerate baseline (use after fixes)
 *
 * Exit code 0 = stub count <= baseline
 * Exit code 1 = stub count > baseline
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, '../react-frontend/public/locales');
const BASELINE_PATH = path.resolve(__dirname, '../.github/i18n-stub-baseline.json');

const TECHNICAL_SUFFIXES = [
  '_msg', '_btn', '_aria', '_lbl', '_hint', '_tooltip',
  '_placeholder', '_desc',
];

const SUPPORTED_NON_ENGLISH_LOCALES = [
  'ar', 'de', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt',
];

// Reviewed on 2026-07-14. Values are pinned as well as keys: if a supposedly
// invariant token changes case or wording, it is checked again rather than
// silently inheriting the exemption.
const REVIEWED_ADMIN_INVARIANTS = new Map([
  ['admin_advanced.json:advanced.next_public.edge_canary_edges.apache_plesk', 'Apache/Plesk'],
  ['admin_advanced.json:advanced.prerender.analytics.columns.uri', 'URI'],
  ['admin_advanced.json:advanced.prerender.analytics.columns.url', 'URL'],
  ['admin_advanced.json:advanced.prerender.inventory.columns.http', 'HTTP'],
  ['admin_advertising.json:advertising.advertiser.sme', 'SME'],
  ['admin_advertising.json:advertising.shared.columns.ctr', 'CTR'],
  ['admin_analytics.json:analytics.regional.age_groups.25_34', '25-34'],
  ['admin_analytics.json:analytics.regional.age_groups.35_44', '35-44'],
  ['admin_analytics.json:analytics.regional.age_groups.45_54', '45-54'],
  ['admin_analytics.json:analytics.regional.age_groups.55_64', '55-64'],
  ['admin_api_partners.json:api_partners.credentials_modal.client_id', 'client_id'],
  ['admin_api_partners.json:api_partners.credentials_modal.client_secret', 'client_secret'],
  ['admin_billing.json:billing.arr', 'ARR'],
  ['admin_billing.json:billing.mrr', 'MRR'],
  ['admin_blog.json:content.stripe', 'Stripe'],
  ['admin_caring_community.json:external_integrations.categories.ahv', 'AHV'],
  ['admin_caring_community.json:external_integrations.table.dsa', 'DSA'],
  ['admin_caring_community.json:pilot_scoreboard.currency.chf', 'CHF'],
  ['admin_content.json:breadcrumbs.crm', 'CRM'],
  ['admin_content.json:breadcrumbs.fadp', 'FADP'],
  ['admin_content.json:breadcrumbs.gdpr', 'GDPR'],
  ['admin_content.json:breadcrumbs.seo', 'SEO'],
  ['admin_content.json:content.stripe', 'Stripe'],
  ['admin_editor.json:content.stripe', 'Stripe'],
  ['admin_enterprise.json:enterprise.api', 'API'],
  ['admin_nav.json:breadcrumbs.crm', 'CRM'],
  ['admin_nav.json:breadcrumbs.fadp', 'FADP'],
  ['admin_nav.json:breadcrumbs.gdpr', 'GDPR'],
  ['admin_nav.json:breadcrumbs.seo', 'SEO'],
  ['admin_nav.json:crm', 'CRM'],
  ['admin_newsletters.json:newsletter_templates.category_count', '{{category}} ({{count}})'],
  ['admin_podcasts.json:podcasts_admin.readiness.rss', 'RSS'],
  ['admin_reports.json:municipal_reports.stats.csv_pdf', 'CSV/PDF'],
  ['admin_resources.json:breadcrumbs.crm', 'CRM'],
  ['admin_resources.json:breadcrumbs.fadp', 'FADP'],
  ['admin_resources.json:breadcrumbs.gdpr', 'GDPR'],
  ['admin_resources.json:breadcrumbs.seo', 'SEO'],
  ['admin_resources.json:content.stripe', 'Stripe'],
  ['admin_super.json:pilot_inquiry_admin.values.country_region', '{{country}} · {{region}}'],
  // Brand name of a phone operating system; the same word in every language.
  ['admin_system.json:system.phone_app.members.phone.android', 'Android'],
  ['super_admin.json:breadcrumbs.kiss', 'KISS'],
]);

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

function normalizeKeyHumanization(value) {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isTechnicalSuffixStub(flatKey, value) {
  if (typeof value !== 'string') return false;
  const leaf = flatKey.split('.').pop();
  if (!leaf) return false;

  const hasTechSuffix = TECHNICAL_SUFFIXES.some((suffix) => leaf.endsWith(suffix));
  if (!hasTechSuffix) return false;

  const keyAsWords = leaf.replace(/_/g, ' ').toLowerCase();
  const valNormalized = value.toLowerCase().replace(/\s+/g, ' ').trim();
  return valNormalized === keyAsWords;
}

function isAdminLocaleFile(file) {
  return file.startsWith('admin') && file.endsWith('.json')
    || file === 'super_admin.json';
}

function readFlatLocaleFile(locale, file) {
  const filePath = path.join(LOCALES_DIR, locale, file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing required locale catalog: ${locale}/${file}`);
  }
  return flattenKeys(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function collectUniversalAdminStubs() {
  const catalogLocales = fs.readdirSync(LOCALES_DIR).filter((dir) => {
    return dir !== 'en' && fs.statSync(path.join(LOCALES_DIR, dir)).isDirectory();
  });
  for (const locale of SUPPORTED_NON_ENGLISH_LOCALES) {
    const localeDir = path.join(LOCALES_DIR, locale);
    if (!fs.existsSync(localeDir)) {
      throw new Error(`Missing supported locale directory: ${locale}`);
    }
  }
  const unreviewedLocales = catalogLocales.filter(
    (locale) => !SUPPORTED_NON_ENGLISH_LOCALES.includes(locale),
  );
  if (unreviewedLocales.length > 0) {
    throw new Error(
      `Update the universal-stub locale set for: ${unreviewedLocales.join(', ')}`,
    );
  }

  const files = fs.readdirSync(path.join(LOCALES_DIR, 'en'))
    .filter(isAdminLocaleFile)
    .sort();
  const stubs = [];
  const reviewedInvariantCandidates = new Set();

  for (const file of files) {
    const catalogs = new Map(
      SUPPORTED_NON_ENGLISH_LOCALES.map((locale) => [
        locale,
        readFlatLocaleFile(locale, file),
      ]),
    );
    const firstCatalog = catalogs.get(SUPPORTED_NON_ENGLISH_LOCALES[0]);

    for (const key of Object.keys(firstCatalog)) {
      const leaf = key.split('.').pop();
      if (!leaf) continue;

      const values = SUPPORTED_NON_ENGLISH_LOCALES.map(
        (locale) => catalogs.get(locale)[key],
      );
      if (!values.every((value) => typeof value === 'string' && value.length > 2)) {
        continue;
      }

      const normalizedLeaf = normalizeKeyHumanization(leaf);
      if (!normalizedLeaf || !values.every(
        (value) => normalizeKeyHumanization(value) === normalizedLeaf,
      )) {
        continue;
      }

      const invariantKey = `${file}:${key}`;
      const invariantValue = REVIEWED_ADMIN_INVARIANTS.get(invariantKey);
      if (invariantValue !== undefined) reviewedInvariantCandidates.add(invariantKey);
      if (invariantValue !== undefined && values.every((value) => value === invariantValue)) {
        continue;
      }

      stubs.push({
        kind: 'universal-admin',
        file,
        key,
        value: values[0],
        locales: SUPPORTED_NON_ENGLISH_LOCALES,
      });
    }
  }

  const staleInvariantReviews = [...REVIEWED_ADMIN_INVARIANTS.keys()].filter(
    (key) => !reviewedInvariantCandidates.has(key),
  );
  if (staleInvariantReviews.length > 0) {
    throw new Error(
      'Remove or re-review stale admin stub invariants:\n'
      + staleInvariantReviews.map((key) => `  ${key}`).join('\n'),
    );
  }

  return stubs;
}

function collectTechnicalSuffixStubs(universalAdminStubs) {
  const stubs = [];
  const universalKeys = new Set(
    universalAdminStubs.map(({ file, key }) => `${file}:${key}`),
  );
  const langs = fs.readdirSync(LOCALES_DIR).filter((dir) => {
    return fs.statSync(path.join(LOCALES_DIR, dir)).isDirectory();
  });

  for (const lang of langs) {
    const langDir = path.join(LOCALES_DIR, lang);
    const files = fs.readdirSync(langDir).filter((file) => file.endsWith('.json'));
    for (const file of files) {
      const data = JSON.parse(fs.readFileSync(path.join(langDir, file), 'utf8'));
      const flat = flattenKeys(data);
      for (const [key, value] of Object.entries(flat)) {
        if (universalKeys.has(`${file}:${key}`)) continue;
        if (isTechnicalSuffixStub(key, value)) {
          stubs.push({ kind: 'technical-suffix', lang, file, key, value });
        }
      }
    }
  }
  return stubs;
}

function collectStubs() {
  const universalAdminStubs = collectUniversalAdminStubs();
  const technicalSuffixStubs = collectTechnicalSuffixStubs(universalAdminStubs);
  return [...universalAdminStubs, ...technicalSuffixStubs];
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { count: 0 };
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

const args = process.argv.slice(2);
const listMode = args.includes('--list');
const baselineMode = args.includes('--baseline');

const stubs = collectStubs();
const universalCount = stubs.filter(({ kind }) => kind === 'universal-admin').length;
const suffixCount = stubs.length - universalCount;

if (baselineMode) {
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(
    BASELINE_PATH,
    JSON.stringify({
      count: stubs.length,
      universal_admin_count: universalCount,
      technical_suffix_count: suffixCount,
      updated: new Date().toISOString(),
    }, null, 2) + '\n',
  );
  console.log(`Baseline written: ${stubs.length} stubs`);
  process.exit(0);
}

if (listMode) {
  for (const stub of stubs) {
    if (stub.kind === 'universal-admin') {
      console.log(
        `  [all non-en] ${stub.file}  ${stub.key} = ${JSON.stringify(stub.value)}`,
      );
    } else {
      console.log(
        `  ${stub.lang}/${stub.file}  ${stub.key} = ${JSON.stringify(stub.value)}`,
      );
    }
  }
  console.log('');
}

const baseline = loadBaseline();
console.log('============================================================');
console.log('  i18n Stub Value Check');
console.log('============================================================');
console.log(`  Current stubs:          ${stubs.length}`);
console.log(`    Universal admin:      ${universalCount}`);
console.log(`    Technical-suffix:     ${suffixCount}`);
console.log(`  Baseline:               ${baseline.count}`);

if (stubs.length > baseline.count) {
  console.error('');
  console.error(`  ✗ FAIL: ${stubs.length - baseline.count} NEW stub(s) introduced.`);
  console.error('');
  console.error('  A stub is either a value generated from a technical key name,');
  console.error('  or the same final-key humanization copied into every supported');
  console.error('  non-English admin catalog. Replace it with meaningful localized copy.');
  console.error('');
  console.error('  Run with --list to see all current stubs.');
  console.error('  After fixing, run with --baseline to update the baseline.');
  process.exit(1);
}

if (stubs.length < baseline.count) {
  console.log('');
  console.log(`  ✓ ${baseline.count - stubs.length} stub(s) fixed — run with --baseline to lock it in.`);
}

console.log('  ✓ No stub regression.');
process.exit(0);
