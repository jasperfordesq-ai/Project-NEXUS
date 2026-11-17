// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A count written into a sentence on a Platform team page is shown the way
 * the reader's language writes numbers ("12,345", not "12345").
 *
 * The pages pass the count as a number, because i18next needs a number to
 * choose the plural form. The wording asks i18next's own number formatter for
 * it with `{{count, number}}`. This test loads the real wording files, so a
 * locale that goes back to a bare `{{count}}` fails here.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';

const localesRoot = resolve(__dirname, '../../public/locales');
const locales = readdirSync(localesRoot).filter((name) => {
  try {
    readFileSync(resolve(localesRoot, name, 'platform_team.json'));
    return true;
  } catch {
    return false;
  }
});

function load(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(localesRoot, locale, 'platform_team.json'), 'utf8')) as Record<
    string,
    unknown
  >;
}

function flatten(object: Record<string, unknown>, prefix = '', out: Map<string, string> = new Map()) {
  for (const [key, value] of Object.entries(object)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object') flatten(value as Record<string, unknown>, dotted, out);
    else if (typeof value === 'string') out.set(dotted, value);
  }
  return out;
}

async function translator(locale: string) {
  const i18n = createInstance();
  await i18n.init({
    lng: locale,
    fallbackLng: 'en',
    ns: ['platform_team'],
    defaultNS: 'platform_team',
    resources: { [locale]: { platform_team: load(locale) }, en: { platform_team: load('en') } },
    interpolation: { escapeValue: false },
  });
  return i18n;
}

describe('numbers written into Platform team sentences', () => {
  it('has the eleven locales to check', () => {
    expect(locales.sort()).toEqual(['ar', 'de', 'en', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt']);
  });

  it.each([
    ['legal_documents.all_accepted', '12,345'],
    ['search_rebuild.last.done', '13,579'],
    ['phone_app.versions.sign_ins', '9,876'],
    ['failed_jobs.count', '4,321'],
  ])('writes %s with a thousands separator in English', async (key, expected) => {
    const i18n = await translator('en');
    const count = Number(expected.replace(/,/g, ''));
    expect(i18n.t(key, { count, time: '10:00' })).toContain(expected);
  });

  it('never writes a bare {{count}} in a Platform team sentence, in any locale', () => {
    const bare: string[] = [];
    for (const locale of locales) {
      for (const [key, value] of flatten(load(locale))) {
        if (/\{\{\s*count\s*\}\}/.test(value)) bare.push(`${locale}: ${key}`);
      }
    }
    expect(bare).toEqual([]);
  });

  it('formats in the reader’s language (German uses a full stop)', async () => {
    const i18n = await translator('de');
    expect(i18n.t('failed_jobs.count', { count: 4321 })).toContain('4.321');
  });
});
