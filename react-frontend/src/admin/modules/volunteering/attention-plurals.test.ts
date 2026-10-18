// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The Overview's "Needs your attention" counts are plural strings. i18next
 * falls back to the ENGLISH form when a locale lacks one of its own plural
 * categories, so a Polish admin with 5 applications waiting would read
 * "5 applications waiting" unless `_few` and `_many` exist. Polish, Irish
 * and Arabic have more categories than one/other; this pins them.
 */
const KEYS = ['applications', 'hours', 'expenses', 'projects', 'organisations', 'swaps'];

const CATEGORIES: Record<string, string[]> = {
  pl: ['one', 'few', 'many', 'other'],
  ga: ['one', 'two', 'few', 'many', 'other'],
  ar: ['zero', 'one', 'two', 'few', 'many', 'other'],
};

function volunteeringStrings(locale: string): Record<string, string> {
  return (JSON.parse(readFileSync(`public/locales/${locale}/admin_volunteering.json`, 'utf8')) as { volunteering: Record<string, string> }).volunteering;
}

describe('attention count strings carry every plural category of their locale', () => {
  for (const [locale, categories] of Object.entries(CATEGORIES)) {
    it(`${locale} has ${categories.join('/')} for all six counts`, () => {
      const strings = volunteeringStrings(locale);
      const english = volunteeringStrings('en');
      for (const key of KEYS) {
        for (const category of categories) {
          const id = `attention_${key}_${category}`;
          expect(strings[id], `${locale}: ${id}`).toBeTypeOf('string');
          expect(strings[id], `${locale}: ${id} is still English`).not.toBe(english[`attention_${key}_other`]);
        }
      }
    });
  }
});
