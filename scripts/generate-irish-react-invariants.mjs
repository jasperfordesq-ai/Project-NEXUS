// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const englishDirectory = path.join(repositoryRoot, 'react-frontend', 'public', 'locales', 'en');
const irishDirectory = path.join(repositoryRoot, 'react-frontend', 'public', 'locales', 'ga');
const outputPath = path.join(repositoryRoot, 'scripts', 'irish-react-reviewed-invariants.json');

const peopleAndOrganisations = new Set([
  'Alice', 'Elaine', 'Jasper Ford', 'Jane', 'Monica', 'Project NEXUS', 'Timebanking UK',
]);

const brandsAndPlatforms = new Set([
  'Android', 'Apache/Plesk', 'Authy', 'Azure Blob', 'Azure VM', 'Chrome', 'Cloudflare (CDN / WAF)',
  'Credit Commons', 'DeepL', 'Edge', 'Facebook', 'Firefox', 'Gmail API', 'Google Authenticator',
  'Google Gemini', 'HeroUI', 'iDenfy', 'Jumio', 'Laravel', 'Mac', 'MariaDB', 'Meilisearch',
  'Microsoft Entra ID', 'NexusScore', 'Onfido', 'OpenAI', 'Pusher', 'React', 'Redis', 'Safari',
  'Sentry', 'Stripe', 'Tailwind CSS', 'Twitter', 'TypeScript', 'Veriff', 'Windows', 'YouTube', 'Youtube',
]);

const acceptedSharedTerms = new Set([
  'Ad hoc', 'Club', 'Cron', 'FADP Art. 16', 'FADP Art. 17', 'KISS', 'Noindex Nofollow',
  'Port', 'Pro', 'Sans', 'Serif', 'Verein',
]);

function flatten(value, prefix = '', output = new Map()) {
  if (typeof value === 'string') {
    output.set(prefix, value);
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, `${prefix}.${index}`, output));
    return output;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, output);
    }
  }
  return output;
}

function reviewReason(key, value) {
  if (peopleAndOrganisations.has(value) || /(?:^|\.)(?:name|author|organisation)(?:_|\.|$)/i.test(key)) {
    return 'person-or-organisation-name';
  }
  if (brandsAndPlatforms.has(value)) return 'brand-product-or-platform-name';
  if (/^https?:\/\//.test(value)
    || /^\/?[A-Za-z0-9_.?=&/-]+$/.test(value) && value.includes('/')
    || /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/.test(value)) {
    return 'functional-address-route-or-example';
  }
  const withoutPlaceholders = value
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '');
  if (!/[\p{L}]/u.test(withoutPlaceholders) || /^[\d.,+%€£$:/()\s–—-]+$/u.test(withoutPlaceholders)) {
    return 'placeholder-number-or-display-format';
  }
  if (/^(?:esc|Enter|Tab|⌘|⌘K)$/i.test(value)) return 'keyboard-or-control-label';
  if (acceptedSharedTerms.has(value)) return 'accepted-shared-technical-term';
  if (/^(?:[A-Z][A-Z0-9+./_-]*)(?:\s+[A-Z0-9+./_-]+)*$/.test(value)) {
    return 'protocol-acronym-or-identifier';
  }
  return 'reviewed-locale-invariant';
}

const invariants = {};
const files = fs.readdirSync(englishDirectory).filter((file) => file.endsWith('.json')).sort();

for (const file of files) {
  const namespace = file.replace(/\.json$/, '');
  const english = flatten(JSON.parse(fs.readFileSync(path.join(englishDirectory, file), 'utf8')));
  const irish = flatten(JSON.parse(fs.readFileSync(path.join(irishDirectory, file), 'utf8')));

  for (const [key, englishValue] of english) {
    if (irish.get(key) !== englishValue) continue;
    const qualifiedKey = `${namespace}.${key}`;
    invariants[qualifiedKey] = {
      value: englishValue,
      reason: reviewReason(qualifiedKey, englishValue),
    };
  }
}

const manifest = {
  _meta: {
    purpose: 'Every React Irish value intentionally identical to English, reviewed and pinned by key and value.',
    reviewed: '2026-08-17',
    update: 'Run this generator only after semantic review; the audit rejects unexpected or stale entries.',
  },
  invariants,
};

if (!process.argv.includes('--write')) {
  console.log(`${Object.keys(invariants).length} reviewed invariant entries would be written to ${outputPath}`);
  console.log('Re-run with --write after semantic review.');
  process.exit(0);
}

fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${Object.keys(invariants).length} reviewed invariant entries to ${outputPath}`);
