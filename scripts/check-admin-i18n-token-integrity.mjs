// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Guard exact operational tokens embedded in translated admin copy.
 *
 * Translation drift and interpolation checks cannot tell when a translator has
 * localized a route, backend field, HTTP header, file format, or product name.
 * This check compares those deliberately invariant tokens with English across
 * every admin*.json and super_admin.json catalog.
 *
 * The token allowlists are intentionally conservative. They are based on the
 * reviewed 2026-07-14 admin locale audit; adding another invariant requires an
 * explicit review rather than a broad uppercase/snake_case heuristic that
 * would misclassify ordinary translated copy.
 *
 * Usage:
 *   node scripts/check-admin-i18n-token-integrity.mjs
 *   node scripts/check-admin-i18n-token-integrity.mjs --summary
 *
 * Exit code 0 = every required token is preserved exactly.
 * Exit code 1 = a catalog/configuration error or token mutation was found.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, '../react-frontend/public/locales');
const ENGLISH_LOCALE = 'en';
const SUPPORTED_NON_ENGLISH_LOCALES = [
  'ar', 'de', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt',
];
const SUMMARY_ONLY = process.argv.includes('--summary');

// Canonical names may be inflected in surrounding prose, but the exact token
// itself must remain present (for example "Stripe's", not a transliteration).
const PRODUCT_AND_BRAND_TOKENS = [
  'Android',
  'Apache',
  'Azure',
  'Cloudflare',
  'Firebase',
  'Google',
  'Meilisearch',
  'Microsoft',
  'NEXUS',
  'OpenAI',
  'PayPal',
  'Plesk',
  'Redis',
  'Stripe',
  'WebP',
  'cPanel',
  'cURL',
  'iDenfy',
];

// Exact wire/header/auth/method/file-format vocabulary confirmed by the audit.
const PROTOCOL_AND_FORMAT_TOKENS = [
  'Authorization',
  'Bearer',
  'HTML',
  'JSON',
  'OAuth',
  'OAuth2',
  'PDF',
  'POST',
  'RSS',
];

// Exact backend fields, enums, roles, and Schema.org identifiers confirmed by
// code or UI contract review. Keep this explicit to avoid treating every
// underscore in natural-language examples as a schema contract.
const SCHEMA_AND_ENUM_TOKENS = [
  '@type',
  'approved_hours',
  'areaServed',
  'canton_isolated_node',
  'deployment_mode',
  'first_name',
  'formal_care_offset_chf',
  'last_name',
  'map_provider',
  'municipal_roi',
  'needs_additional_support',
  'pilot_scoreboard',
  'peer_slug',
  'tenantId',
  'tenant_admin',
  'tenant_id',
];

// AdminCaringCommunityController generates the first format and the UI uses the
// second as its concrete placeholder. Translating either makes the help false.
const BACKEND_DEFAULT_FORMAT_TOKENS = [
  'bern-cooperative',
  'quarterly_YYYY_MM',
  'quarterly_2026_07',
];

// These are rate/unit suffixes, not routes. Localized equivalents were
// deliberately reviewed as valid during the audit.
const LOCALIZABLE_SLASH_TOKENS = new Set(['/yr', '/hr', '/min', '/h']);

const CATEGORY_RULES = [
  {
    category: 'product_brand_mutation',
    tokens: (english) => tokensPresentInEnglish(english, PRODUCT_AND_BRAND_TOKENS),
  },
  {
    category: 'protocol_or_format_token_mutation',
    tokens: (english) => tokensPresentInEnglish(english, PROTOCOL_AND_FORMAT_TOKENS),
  },
  {
    category: 'literal_route_mutation',
    tokens: extractLiteralRoutes,
  },
  {
    category: 'schema_identifier_mutation',
    tokens: (english) => tokensPresentInEnglish(english, SCHEMA_AND_ENUM_TOKENS),
  },
  {
    category: 'colon_placeholder_mutation',
    tokens: extractColonPlaceholders,
  },
  {
    category: 'backend_default_format_mismatch',
    tokens: (english) => tokensPresentInEnglish(english, BACKEND_DEFAULT_FORMAT_TOKENS),
  },
];

const configurationErrors = [];
const issues = [];
const englishDir = path.join(LOCALES_DIR, ENGLISH_LOCALE);
const namespaceFiles = readAdminNamespaceFiles(englishDir);
const englishCatalogs = loadCatalogs(ENGLISH_LOCALE, namespaceFiles);

for (const locale of SUPPORTED_NON_ENGLISH_LOCALES) {
  const localizedCatalogs = loadCatalogs(locale, namespaceFiles);

  for (const file of namespaceFiles) {
    const englishValues = flattenStrings(englishCatalogs.get(file));
    const localizedValues = flattenStrings(localizedCatalogs.get(file));

    for (const [key, english] of englishValues) {
      const localized = localizedValues.get(key);
      if (localized === undefined) {
        // Missing keys belong to check-i18n-drift. Keeping that concern there
        // avoids duplicate diagnostics while this check focuses on values that
        // exist but have had an operational token translated or removed.
        continue;
      }

      for (const rule of CATEGORY_RULES) {
        const expectedTokens = rule.tokens(english);
        if (expectedTokens.length === 0) {
          continue;
        }

        const missingTokens = expectedTokens.filter((token) => !localized.includes(token));
        if (missingTokens.length > 0) {
          issues.push({
            category: rule.category,
            locale,
            file,
            key,
            missingTokens,
          });
        }
      }

      if (
        /(^|\.)[^.]*peer_slug(?:_|$)/iu.test(key)
        && !key.endsWith('peer_slug_placeholder')
        && !localized.toLocaleLowerCase('en').includes('slug')
      ) {
        issues.push({
          category: 'technical_slug_term_mutation',
          locale,
          file,
          key,
          missingTokens: ['slug'],
        });
      }
    }
  }
}

printResult();
process.exitCode = configurationErrors.length > 0 || issues.length > 0 ? 1 : 0;

function readAdminNamespaceFiles(directory) {
  if (!fs.existsSync(directory)) {
    throw new Error(`English locale directory does not exist: ${directory}`);
  }

  return fs.readdirSync(directory)
    .filter((file) => (/^admin.*\.json$/u.test(file) || file === 'super_admin.json'))
    .sort();
}

function loadCatalogs(locale, files) {
  const catalogs = new Map();

  for (const file of files) {
    const filePath = path.join(LOCALES_DIR, locale, file);
    if (!fs.existsSync(filePath)) {
      configurationErrors.push(`${locale}/${file} is missing`);
      catalogs.set(file, {});
      continue;
    }

    try {
      catalogs.set(file, JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (error) {
      configurationErrors.push(
        `${locale}/${file} is invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      catalogs.set(file, {});
    }
  }

  return catalogs;
}

function flattenStrings(value, prefix = '', result = new Map()) {
  if (typeof value === 'string') {
    result.set(prefix, value);
    return result;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      flattenStrings(item, prefix ? `${prefix}.${index}` : String(index), result);
    });
    return result;
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flattenStrings(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }

  return result;
}

function tokensPresentInEnglish(english, tokens) {
  return tokens.filter((token) => english.includes(token));
}

function extractLiteralRoutes(english) {
  // A route begins at the start of the value or after whitespace/punctuation.
  // This avoids harvesting slash fragments from https://example.org/path.
  const routePattern = /(^|[\s([{"'`,;])((?:\/[A-Za-z0-9.*_~-]+)+\/?)/gu;
  const routes = new Set();

  for (const match of english.matchAll(routePattern)) {
    const route = match[2];
    if (!LOCALIZABLE_SLASH_TOKENS.has(route)) {
      routes.add(route);
    }
  }

  return [...routes];
}

function extractColonPlaceholders(english) {
  const placeholderPattern = /(^|[\s([{"'`,;])(:[A-Za-z][A-Za-z0-9_]*)\b/gu;
  return [...new Set([...english.matchAll(placeholderPattern)].map((match) => match[2]))];
}

function printResult() {
  console.log('============================================================');
  console.log('  Admin i18n Functional Token Integrity');
  console.log('============================================================');
  console.log(`  Namespace files: ${namespaceFiles.length}`);
  console.log(`  Non-English locales: ${SUPPORTED_NON_ENGLISH_LOCALES.length}`);

  if (!SUMMARY_ONLY) {
    for (const error of configurationErrors) {
      console.log(`[CONFIG] ${error}`);
    }

    for (const issue of issues) {
      console.log(
        `[TOKEN] ${issue.locale}/${issue.file}:${issue.key} `
        + `(${issue.category}) missing ${issue.missingTokens.map((token) => JSON.stringify(token)).join(', ')}`,
      );
    }
  }

  const missingTokenCount = issues.reduce((sum, issue) => sum + issue.missingTokens.length, 0);
  console.log(`  Configuration errors: ${configurationErrors.length}`);
  console.log(`  Affected locale values: ${issues.length}`);
  console.log(`  Missing exact tokens: ${missingTokenCount}`);

  if (configurationErrors.length === 0 && issues.length === 0) {
    console.log('  PASS: Admin operational tokens are preserved in every locale.');
  } else {
    console.log('  FAIL: Restore each exact token while translating the surrounding prose.');
  }
}
