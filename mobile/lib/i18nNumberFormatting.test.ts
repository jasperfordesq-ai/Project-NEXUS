// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 A member reading one screen must see ONE set of number conventions.
 *
 * Before the 2026-09-06 audit the wallet printed its balance through `formatDecimal`
 * ("1,5 Stunden" in German) while the stat tile two lines below interpolated the same value
 * straight into a translation and printed "+1.5h" — twenty-five call sites across wallet,
 * exchanges, goals, reviews and activity did the second thing. i18next's `alwaysFormat`
 * now routes every interpolated value through one formatter.
 *
 * What must stay true, and why each half matters:
 *  - a non-integer is formatted for the member's locale (the bug);
 *  - an INTEGER is left exactly as it was, because counts, ids and pluralisation depend on
 *    it — "1.234 members" for 1234 would be a new bug wearing the old one's clothes.
 */

jest.mock('@/lib/storage', () => ({
  storage: {
    get: jest.fn(() => Promise.resolve(null)),
    set: jest.fn(() => Promise.resolve()),
    remove: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('expo-localization', () => ({
  getLocales: () => [{ languageCode: 'en' }],
}));

import i18n, { changeLanguage } from './i18n';

describe('interpolated numbers follow the member locale', () => {
  afterEach(async () => {
    await changeLanguage('en');
  });

  it('formats a non-integer with the locale separator', async () => {
    i18n.addResource('en', 'common', 'audit.hours', '{{count}} hours');
    i18n.addResource('de', 'common', 'audit.hours', '{{count}} Stunden');

    expect(i18n.t('common:audit.hours', { count: 1.5 })).toBe('1.5 hours');

    await changeLanguage('de');
    // The whole point: a comma, not a dot, without every call site remembering to ask.
    expect(i18n.t('common:audit.hours', { count: 1.5 })).toBe('1,5 Stunden');
  });

  it('leaves an integer alone, so counts and ids are not re-punctuated', async () => {
    i18n.addResource('en', 'common', 'audit.members', '{{count}} members');
    i18n.addResource('de', 'common', 'audit.members', '{{count}} Mitglieder');

    await changeLanguage('de');
    // 1234 must NOT become "1.234": this value is a count, and the same path carries ids.
    expect(i18n.t('common:audit.members', { count: 1234 })).toBe('1234 Mitglieder');
  });

  it('passes strings through untouched', async () => {
    i18n.addResource('en', 'common', 'audit.name', 'Hello {{name}}');

    expect(i18n.t('common:audit.name', { name: 'Jasper' })).toBe('Hello Jasper');
  });
});
