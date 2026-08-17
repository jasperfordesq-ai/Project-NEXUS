// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const englishDir = path.join(root, 'react-frontend', 'public', 'locales', 'en');
const irishDir = path.join(root, 'react-frontend', 'public', 'locales', 'ga');
const invariantManifestPath = path.join(root, 'scripts', 'irish-react-reviewed-invariants.json');

const reviewedEnglishFallbacks = new Set([
  'group_exchanges.role_provider',
  'group_exchanges.role_receiver',
  'municipality_survey.no',
  'notifications.page_meta.title',
  'notifications.undo',
  'project_announcements_admin.loading',
  'search_page.form_aria',
  'courses.discussion.post',
  'svc_notifications.sub_account.management_request',
  'svc_notifications_2.team_document.no_file_provided',
  'svc_notifications_2.ai.provider_not_configured',
  'svc_notifications_2.report_export.no_data',
  'emails_misc.subscription.renewal_reminder_body',
]);

const reviewedIrishTranslations = new Map([
  ['admin_caring_community.pilot_scoreboard.table.delta', 'Difríocht'],
  ['admin_caring_community.success_stories_admin.audience.kanton', 'Ceantar'],
  ['admin_categories.categories.color_fuchsia', 'Fiúise'],
  ['admin_categories.categories.color_indigo', 'Indeagó'],
  ['admin_gamification.challenges.col_cadence', 'Minicíocht'],
  ['admin_gamification.challenges.form_cadence', 'Minicíocht'],
  ['admin_help.articles./caring.relatedPaths.1.label', 'Cosaint'],
  ['admin_help.articles./caring/data-quality.relatedPaths.1.label', 'Cosaint'],
  ['admin_help.articles./caring/emergency-alerts.relatedPaths.0.label', 'Fo-Réigiúin'],
  ['admin_help.articles./caring/recipient-circle.relatedPaths.0.label', 'Soláthraithe'],
  ['admin_help.articles./caring/recipient-circle.relatedPaths.1.label', 'Cosaint'],
  ['admin_help.articles./caring/regional-points.relatedPaths.0.label', 'Fo-Réigiúin'],
  ['admin_help.articles./caring/sla-dashboard.relatedPaths.0.label', 'Cosaint'],
  ['admin_help.articles./caring/trust-tier.relatedPaths.1.label', 'Cosaint'],
  ['admin_system.verification.actor_type_webhook', 'Crúca gréasáin'],
  ['social.bookmarks.type_post', 'Postáil'],
]);

const discouragedTerms = [
  {
    id: 'literal impersonation',
    keys: /(?:^|\.)(?:action_)?impersonate|impersonate_/i,
    value: /aithris/i,
  },
  {
    id: 'burnout as fire',
    keys: /burnout/i,
    value: /dóiteán/i,
  },
  {
    id: 'literal read-only wording',
    keys: /./,
    value: /inléite amháin/i,
  },
  {
    id: 'federation as connection',
    keys: /federat|cross_(?:tenant|community)|partner_network/i,
    value: /cónasc/i,
  },
];

const englishProseMarkers = /\b(?:the|your|you|and|or|to|for|from|with|as|is|are|was|were|has|have|no|not|this|that|selected|request|provider|loading|search|notifications|failed|found|manage|account|subscription|action|needed|file|data|report|filters)\b/i;

function isTechnicalInvariant(value) {
  return (
    /^https?:\/\//.test(value) ||
    /^\/[A-Za-z0-9_./?=&*-]+$/.test(value) ||
    /^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(value) ||
    /^(?:API|URL|ID|JSON|CSV|PDF|NEXUS|Google|Microsoft|OpenAI|OAuth)(?:\b|$)/.test(value)
  );
}

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
    Object.entries(value).forEach(([key, item]) => {
      flatten(item, prefix ? `${prefix}.${key}` : key, output);
    });
  }
  return output;
}

const failures = [];
const invariantManifest = fs.existsSync(invariantManifestPath)
  ? JSON.parse(fs.readFileSync(invariantManifestPath, 'utf8')).invariants ?? {}
  : {};
const exactMatches = new Map();

if (!fs.existsSync(invariantManifestPath)) {
  failures.push('scripts/irish-react-reviewed-invariants.json: reviewed invariant manifest is missing');
}
const files = fs.readdirSync(englishDir).filter((file) => file.endsWith('.json')).sort();

for (const file of files) {
  const irishPath = path.join(irishDir, file);
  if (!fs.existsSync(irishPath)) continue;

  const namespace = file.replace(/\.json$/, '');
  const english = flatten(JSON.parse(fs.readFileSync(path.join(englishDir, file), 'utf8')));
  const irish = flatten(JSON.parse(fs.readFileSync(irishPath, 'utf8')));

  for (const [key, value] of irish) {
    const qualifiedKey = `${namespace}.${key}`;
    const englishValue = english.get(key);

    if (reviewedIrishTranslations.has(qualifiedKey)
      && value !== reviewedIrishTranslations.get(qualifiedKey)) {
      failures.push(`${qualifiedKey}: reviewed Irish wording changed: ${JSON.stringify(value)}`);
    }

    if (value === englishValue) {
      exactMatches.set(qualifiedKey, value);
      const invariant = invariantManifest[qualifiedKey];
      if (!invariant) {
        failures.push(`${qualifiedKey}: English-identical value has not been explicitly reviewed: ${JSON.stringify(value)}`);
      } else {
        if (invariant.value !== value) {
          failures.push(`${qualifiedKey}: invariant value changed; review the new value before updating the manifest`);
        }
        if (typeof invariant.reason !== 'string' || invariant.reason.trim() === '') {
          failures.push(`${qualifiedKey}: invariant review reason is missing`);
        }
      }
    }

    const proseWithoutQueryExamples = value.replace(/\?[a-z][a-z0-9_-]*=/gi, '');
    if (!/^https?:\/\//.test(value) && /[\p{L}]\?[\p{L}]|\?[\p{L}]{2,}/u.test(proseWithoutQueryExamples)) {
      failures.push(`${qualifiedKey}: replacement question mark inside a word: ${JSON.stringify(value)}`);
    }

    if (reviewedEnglishFallbacks.has(qualifiedKey) && value === englishValue) {
      failures.push(`${qualifiedKey}: reviewed user-facing value is still English: ${JSON.stringify(value)}`);
    }

    if (
      value === englishValue &&
      englishProseMarkers.test(value) &&
      /[a-z]{2}/.test(value) &&
      !isTechnicalInvariant(value)
    ) {
      failures.push(`${qualifiedKey}: English prose fallback: ${JSON.stringify(value)}`);
    }

    for (const term of discouragedTerms) {
      if (term.keys.test(qualifiedKey) && term.value.test(value)) {
        failures.push(`${qualifiedKey}: ${term.id}: ${JSON.stringify(value)}`);
      }
    }
  }
}

for (const [qualifiedKey, invariant] of Object.entries(invariantManifest)) {
  if (!exactMatches.has(qualifiedKey)) {
    failures.push(`${qualifiedKey}: stale invariant manifest entry for ${JSON.stringify(invariant?.value)}`);
  }
}

if (failures.length > 0) {
  console.error(`React Irish locale audit failed with ${failures.length} issue(s):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`React Irish locale audit passed: ${exactMatches.size} English-identical values are explicitly reviewed and pinned; no corruption, English fallbacks, or discouraged terminology.`);
