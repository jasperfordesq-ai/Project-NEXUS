// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Every key the app calls with a `count` needs a singular form, in every language.
 *
 * i18next runs here with `compatibilityJSON: 'v4'` (see lib/i18n.ts), so a count of 1
 * looks up `<key>_one`. When that is missing it falls back to the bare key — which holds
 * the PLURAL wording — and the member reads "1 votes", "1 members", "1 spots left". This
 * was true of 129 keys until 2026-08-22 and was visible on the poll card on a device.
 *
 * The test is a shrink-only ratchet, in the same spirit as the coverage ratchet and the
 * quarantine budget: it fails if a NEW count-bearing key ships without a singular, and it
 * also fails if the allowed list still names a key that has since been fixed, so the list
 * cannot rot. Lower BUDGET in the same commit that fixes one.
 *
 * Deliberately NOT in scope: keys where the number is not counting a noun ("{{count}}
 * left", "All ({{count}})", "{{count}}h"). A singular there would read the same and the
 * allowed list below names them explicitly rather than hiding them behind a heuristic.
 */

import fs from 'fs';
import path from 'path';

const MOBILE_ROOT = path.resolve(__dirname, '..');
const LOCALES_DIR = path.join(MOBILE_ROOT, 'locales');
const LOCALES = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es'] as const;

/**
 * Count-bearing keys that are allowed to have no singular form, because the number is not
 * counting a noun that inflects. Shrink-only: remove an entry when a key gains a real
 * singular, and lower BUDGET by the same amount in the same commit.
 */
const ALLOWED_WITHOUT_SINGULAR = [
  'chat:limits_left_today',
  'event_templates:templates.mobile.versionAndUses',
  'event_tickets:tickets.mobile.unitsInvalidDescription',
  'event_tickets:tickets.mobile.unitsLabel',
  'events:agenda.enterprise.capacityUnlimited',
  'events:detail.moreAttendees',
  'events:detail.waitlistCount',
  'exchanges:detail.views',
  'federation:directory.messages.unreadCount',
  'gamification:shop.stockLeft',
  'gamification:showcase.selectedCount',
  'groups:detail.analytics.comparison.average',
  'groups:detail.analytics.comparison.percentile',
  'groups:detail.eventAttending',
  'groups:detail.marketplace.active',
  'groups:detail.marketplace.total',
  'home:activity.netBalance',
  'jobs:analytics.current_value',
  'jobs:analytics.stage_count',
  'jobs:kanban.active_stage_count',
  'marketplace:detail.quantity',
  'marketplace:featured.count',
  'marketplace:myListings.active',
  'marketplace:myListings.sold',
  'marketplace:publicCoupons.perMember',
  'members:hoursGivenShort',
  'members:hoursTotalShort',
  'messages:archivedCount',
  'messages:unreadCount',
  'messages:visibleCount',
  'notifications:unreadCount',
  'profile:listings',
  'settings:blockedUsers.count',
  'volunteering:hoursValue',
  'volunteering:org.walletBalance',
  'volunteering:shiftCapacity',
  'volunteering:swaps.all',
  'volunteering:swaps.received',
  'volunteering:swaps.sent',
  'wallet:hoursValue',
  'wallet:signedHours',
];

const BUDGET = 42;

type Catalogue = Record<string, string>;

function flatten(value: unknown, prefix = '', out: Catalogue = {}): Catalogue {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else if (typeof value === 'string') {
    out[prefix] = value;
  }
  return out;
}

function loadCatalogues(locale: string): Record<string, Catalogue> {
  const dir = path.join(LOCALES_DIR, locale);
  const out: Record<string, Catalogue> = {};
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    out[name.slice(0, -'.json'.length)] = flatten(
      JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')),
    );
  }
  return out;
}

function sourceFiles(): string[] {
  const skip = new Set(['node_modules', '.expo', 'android', 'ios', 'coverage', 'dist']);
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
        found.push(path.join(dir, entry.name));
      }
    }
  };
  for (const top of ['app', 'components', 'lib']) {
    const dir = path.join(MOBILE_ROOT, top);
    if (fs.existsSync(dir)) walk(dir);
  }
  return found;
}

/** `t('some.key', { count: n })` — the second argument must mention `count`. */
const COUNT_CALL = /\bt\(\s*(['"])([^'"]+)\1\s*,\s*\{([^{}]*)\}/gs;

function countBearingKeys(): string[] {
  const keys = new Set<string>();
  for (const file of sourceFiles()) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(COUNT_CALL)) {
      if (/\bcount\s*:/.test(match[3])) keys.add(match[2]);
    }
  }
  return [...keys].sort();
}

/**
 * Resolve a key to every `namespace:key` it could mean. An unprefixed key is resolved by
 * i18next against whichever namespaces the calling screen loaded, which this test cannot
 * know — so when the same key exists in more than one namespace, ALL of them are checked.
 * That is deliberately strict: it is the only way the result does not depend on an
 * arbitrary pick.
 */
function resolve(key: string, catalogues: Record<string, Catalogue>): { ns: string; bare: string }[] {
  if (key.includes(':')) {
    const [ns, bare] = key.split(':', 2);
    return catalogues[ns] && bare in catalogues[ns] ? [{ ns, bare }] : [];
  }
  return Object.keys(catalogues)
    .filter((ns) => key in catalogues[ns])
    .map((ns) => ({ ns, bare: key }));
}

describe('mobile plural forms', () => {
  const english = loadCatalogues('en');
  const keys = countBearingKeys();

  it('finds a real number of count-bearing keys, so it cannot pass by matching nothing', () => {
    expect(keys.length).toBeGreaterThan(120);
  });

  it('every count-bearing key has a singular form, or is on the shrinking allowed list', () => {
    const missing: string[] = [];
    for (const key of keys) {
      // A key with no English entry at all is a different test's problem.
      for (const { ns, bare } of resolve(key, english)) {
        if (`${bare}_one` in english[ns]) continue;
        if (!missing.includes(`${ns}:${bare}`)) missing.push(`${ns}:${bare}`);
      }
    }
    missing.sort();

    const allowed = new Set(ALLOWED_WITHOUT_SINGULAR);
    const unexpected = missing.filter((k) => !allowed.has(k));
    expect(unexpected).toEqual([]);

    // Shrink-only, both ways: an allowed entry that no longer lacks a singular has to be
    // removed, or the list quietly grants permission nobody needs any more.
    const stale = [...allowed].filter((k) => !missing.includes(k));
    expect(stale).toEqual([]);
    expect(missing.length).toBeLessThanOrEqual(BUDGET);
  });

  it('a singular that exists in English exists in every other language too', () => {
    const gaps: string[] = [];
    for (const locale of LOCALES) {
      if (locale === 'en') continue;
      const catalogues = loadCatalogues(locale);
      for (const [ns, catalogue] of Object.entries(english)) {
        for (const key of Object.keys(catalogue)) {
          if (!key.endsWith('_one')) continue;
          if (!catalogues[ns] || !(key in catalogues[ns])) gaps.push(`${locale}/${ns}:${key}`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it('a singular never loses the {{count}} placeholder', () => {
    const broken: string[] = [];
    for (const locale of LOCALES) {
      const catalogues = loadCatalogues(locale);
      for (const [ns, catalogue] of Object.entries(catalogues)) {
        for (const [key, value] of Object.entries(catalogue)) {
          if (key.endsWith('_one') && !value.includes('{{count}}')) {
            broken.push(`${locale}/${ns}:${key} = ${value}`);
          }
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
