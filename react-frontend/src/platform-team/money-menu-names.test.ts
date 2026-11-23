// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A menu entry and the page it opens are called the same thing, in every
 * language.
 *
 * Until 23 Nov 2026 the Money menu said "Billing Control", "Revenue Dashboard"
 * and "Plans & Pricing" while the pages were titled "Billing control",
 * "Revenue" and "Plans" — and in other languages the two had been translated
 * separately and had drifted further (Arabic titled Revenue "profit"). A person
 * who clicks one name and lands on another has to wonder whether it is the
 * right page.
 *
 * The menu and the title live in different files, so nothing but this test
 * keeps them together.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const LOCALES = ['en', 'ar', 'de', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt'] as const;
const ROOT = path.resolve(__dirname, '../../public/locales');

type Json = Record<string, unknown>;

function read(locale: string, file: string): Json {
  return JSON.parse(fs.readFileSync(path.join(ROOT, locale, file), 'utf8')) as Json;
}

function at(json: Json, keys: string[]): unknown {
  return keys.reduce<unknown>((value, key) => (value as Json | undefined)?.[key], json);
}

/** [what it is, menu file, menu key, title file, title key] */
const PAIRS: Array<[string, string, string[], string, string[]]> = [
  ['Billing control', 'super_admin.json', ['nav', 'billing_control'], 'admin_billing.json', ['billing', 'control_title']],
  ['Revenue', 'super_admin.json', ['nav', 'revenue_dashboard'], 'admin_billing.json', ['billing', 'revenue_title']],
  ['Automatic checks', 'platform_team.json', ['nav', 'automatic_checks'], 'admin_billing.json', ['automation', 'title']],
  ['Plans and prices', 'admin_nav.json', ['plans_pricing'], 'admin_content.json', ['content', 'plans_admin_title']],
];

describe('the Money menu names its pages by their own titles', () => {
  it.each(PAIRS)('%s', (name, menuFile, menuKey, titleFile, titleKey) => {
    for (const locale of LOCALES) {
      const menu = at(read(locale, menuFile), menuKey);
      const title = at(read(locale, titleFile), titleKey);

      expect(typeof menu, `${locale}: ${menuFile} ${menuKey.join('.')}`).toBe('string');
      expect(menu, `${locale}: the menu entry and the page title for "${name}" differ`).toBe(title);
    }
  });

  it('says them in sentence case in English', () => {
    expect(at(read('en', 'super_admin.json'), ['nav', 'billing_control'])).toBe('Billing control');
    expect(at(read('en', 'super_admin.json'), ['nav', 'revenue_dashboard'])).toBe('Revenue');
    expect(at(read('en', 'admin_nav.json'), ['plans_pricing'])).toBe('Plans and prices');
  });

  it('does not call the regional analytics product "subscriptions", beside the billing pages', () => {
    const label = String(at(read('en', 'platform_team.json'), ['nav', 'regional_analytics_subscriptions']));

    expect(label).toBe('Regional analytics customers');
    expect(label.toLowerCase()).not.toContain('subscription');
  });
});
