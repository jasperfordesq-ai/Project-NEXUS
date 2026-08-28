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
 *
 * 🔴 The first fix took the region from the DEVICE, which left a member whose phone is set to
 * the United States still reading American dates — invisible to anyone testing on an Irish
 * handset. Since 2026-08-28 the region comes from the community, the same source the web app
 * uses, so the two clients agree. These tests assert the RENDERED DATE, not the locale tag,
 * so they still fail if the resolution strategy is rewritten again.
 */

let mockLanguage = 'en';
jest.mock('i18next', () => ({
  get language() {
    return mockLanguage;
  },
}));

import { dateLocale } from './dateLocale';
import { resetRegion, setRegion } from './regionStore';

const AUGUST_17 = new Date('2026-08-17T10:00:00Z');

beforeEach(() => {
  mockLanguage = 'en';
  resetRegion();
});

describe('dateLocale', () => {
  it('adds the community region to a bare language', () => {
    expect(dateLocale()).toBe('en-IE');
  });

  it('produces day-first dates, not American ones', () => {
    // The assertion that actually matters — the tag is only a means to this end.
    expect(AUGUST_17.toLocaleDateString(dateLocale())).toBe('17/8/2026');
    expect(AUGUST_17.toLocaleDateString('en')).toBe('8/17/2026');
  });

  it('follows the community when it is not the platform default', () => {
    setRegion('GB');
    expect(dateLocale()).toBe('en-GB');
    expect(AUGUST_17.toLocaleDateString(dateLocale())).toBe('17/08/2026');
  });

  it('ignores the device region entirely', () => {
    // A member on a US-configured phone reads their own community's dates.
    // There is no device input to this function any more; this asserts the
    // outcome that used to depend on one.
    setRegion('IE');
    expect(dateLocale()).toBe('en-IE');
    expect(AUGUST_17.toLocaleDateString(dateLocale())).toBe('17/8/2026');
  });

  it('keeps the language the member chose, with the community region', () => {
    mockLanguage = 'es';
    expect(dateLocale()).toBe('es-IE');
  });

  it('leaves a tag that already has a region alone', () => {
    mockLanguage = 'pt-BR';
    setRegion('IE');
    expect(dateLocale()).toBe('pt-BR');
  });

  it('still answers when the language is unset', () => {
    mockLanguage = '';
    expect(dateLocale()).toBe('en-IE');
  });

  it('ignores a malformed region rather than dropping it', () => {
    // An offline cold start or a bad tenant setting must not push formatting
    // back to a device default.
    setRegion('not-a-region');
    expect(dateLocale()).toBe('en-IE');
    setRegion(undefined);
    expect(dateLocale()).toBe('en-IE');
  });

  it('accepts a lowercase region and normalises it', () => {
    setRegion('gb');
    expect(dateLocale()).toBe('en-GB');
  });
});
