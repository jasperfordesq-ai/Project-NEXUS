// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Regression tests: the language a user picks in Settings must survive an
 * app restart. Before this fix, changeLanguage() never persisted and nothing
 * re-applied the choice at boot, so the app reverted to the device locale.
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

import i18n, { changeLanguage, loadLanguage, restoreSavedLanguage, SUPPORTED_LANGUAGES } from './i18n';

import { STORAGE_KEYS } from '@/lib/constants';
import { storage } from '@/lib/storage';

const mockStorageGet = storage.get as jest.Mock;
const mockStorageSet = storage.set as jest.Mock;

describe('i18n language persistence', () => {
  afterEach(async () => {
    // Reset back to English so test order doesn't matter
    await changeLanguage('en');
    jest.clearAllMocks();
  });

  it('persists the chosen language to storage', async () => {
    await changeLanguage('de');

    expect(mockStorageSet).toHaveBeenCalledWith(STORAGE_KEYS.LANGUAGE, 'de');
    expect(i18n.language).toBe('de');
  });

  it('restoreSavedLanguage applies a previously saved language at boot', async () => {
    mockStorageGet.mockResolvedValueOnce('fr');

    await restoreSavedLanguage();

    expect(mockStorageGet).toHaveBeenCalledWith(STORAGE_KEYS.LANGUAGE);
    expect(i18n.language).toBe('fr');
  });

  it('restoreSavedLanguage ignores unsupported saved values', async () => {
    mockStorageGet.mockResolvedValueOnce('xx');

    await restoreSavedLanguage();

    expect(i18n.language).toBe('en');
  });

  it('supports the expected language set', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(expect.arrayContaining(['en', 'ga', 'de', 'fr', 'it', 'pt', 'es']));
  });

  it.each(['en', 'ga', 'de', 'fr', 'it', 'pt', 'es'])(
    'registers the event enterprise bundles for %s',
    (language) => {
      loadLanguage(language);

      expect(i18n.hasResourceBundle(language, 'event_templates')).toBe(true);
      expect(i18n.hasResourceBundle(language, 'event_tickets')).toBe(true);
      expect(i18n.hasResourceBundle(language, 'event_communications')).toBe(true);
      expect(i18n.hasResourceBundle(language, 'event_recurrence_blueprints')).toBe(true);
    },
  );
});
