// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Every English-speaking member was reading American dates.
 *
 * `dateLocale()` deliberately follows the language chosen in Settings rather than the device,
 * so that switching the app to Spanish gives Spanish dates. But a bare language code carries
 * no region, and `Intl` then falls back to the language's default one — which for English is
 * the United States. Measured on 2026-08-25: `'en'` renders 17 August 2026 as **8/17/2026**.
 *
 * Found on a listing card while capturing store screenshots. It is the kind of thing that
 * survives for years precisely because it looks like a date.
 */

const mockGetLocales = jest.fn();
jest.mock('expo-localization', () => ({ getLocales: () => mockGetLocales() }));

let mockLanguage = 'en';
jest.mock('i18next', () => ({
  get language() {
    return mockLanguage;
  },
}));

import { dateLocale } from './dateLocale';

beforeEach(() => {
  mockLanguage = 'en';
  mockGetLocales.mockReturnValue([{ languageCode: 'en', regionCode: 'IE' }]);
});

describe('dateLocale', () => {
  it('adds the device region to a bare language', () => {
    expect(dateLocale()).toBe('en-IE');
  });

  it('produces day-first dates for an Irish device, not American ones', () => {
    // The assertion that actually matters — the tag is only a means to this end.
    const august17 = new Date('2026-08-17T10:00:00Z');
    expect(august17.toLocaleDateString(dateLocale())).toBe('17/8/2026');
    expect(august17.toLocaleDateString('en')).toBe('8/17/2026');
  });

  it('keeps the language the member chose, with the region they are in', () => {
    mockLanguage = 'es';
    expect(dateLocale()).toBe('es-IE');
  });

  it('leaves a tag that already has a region alone', () => {
    mockLanguage = 'pt-BR';
    mockGetLocales.mockReturnValue([{ languageCode: 'en', regionCode: 'IE' }]);
    expect(dateLocale()).toBe('pt-BR');
  });

  it('falls back to the bare language when the device reports no region', () => {
    mockGetLocales.mockReturnValue([{ languageCode: 'en', regionCode: null }]);
    expect(dateLocale()).toBe('en');
  });

  it('survives a device that reports no locales at all', () => {
    mockGetLocales.mockReturnValue([]);
    expect(dateLocale()).toBe('en');
  });

  it('still answers when the language is unset', () => {
    mockLanguage = '';
    expect(dateLocale()).toBe('en-IE');
  });
});
