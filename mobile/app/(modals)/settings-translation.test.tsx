// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import SettingsTranslationScreen from './settings-translation';
import { getUserPreferences, saveUserPreferences } from '@/lib/api/settings';
import { changeLanguage } from '@/lib/i18n';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { back: jest.fn(), canGoBack: jest.fn(() => false), replace: jest.fn(), push: jest.fn() },
}));

const mockSettingsTranslationT = (key: string) => {
  const map: Record<string, string> = {
    'translation.title': 'Translation preferences',
    'translation.badge': 'Language tools',
    'translation.subtitle': 'Choose how multilingual content appears.',
    'translation.feedTitle': 'Feed ordering',
    'translation.latestFeed': 'Show latest activity first',
    'translation.latestFeedHint': 'Prefer chronological activity.',
    'translation.autoTitle': 'Automatic translation',
    'translation.autoTranslate': 'Auto-translate posts and listings',
    'translation.autoTranslateHint': 'Translated content is shown automatically.',
    'translation.targetLocale': 'Translate into',
    'translation.save': 'Save preferences',
    'translation.saving': 'Saving preferences...',
    'translation.saved': 'Preferences saved',
    'translation.savedBody': 'Your preferences have been updated.',
    'translation.loadError': 'Could not load translation preferences.',
    'translation.saveError': 'Could not save translation preferences.',
    'translation.locales.en': 'English',
    'translation.locales.ga': 'Irish',
    'translation.locales.de': 'German',
    'translation.locales.fr': 'French',
    'translation.locales.it': 'Italian',
    'translation.locales.pt': 'Portuguese',
    'translation.locales.es': 'Spanish',
    'common:buttons.back': 'Back',
    // Read by <SourceRepositoryLink /> from the 'common' namespace.
    attribution: 'AGPL attribution',
    'sourceRepo.builtOn': 'Built on Project NEXUS by Jasper Ford',
    'sourceRepo.accessibilityLabel': 'Opens the source code repository on GitHub.',
    'common:errors.generic': 'Error',
  };
  return map[key] ?? key;
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: mockSettingsTranslationT,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 1 } }) }));

jest.mock('@/lib/api/settings', () => ({
  getUserPreferences: jest.fn(),
  saveUserPreferences: jest.fn(),
}));

jest.mock('@/lib/i18n', () => ({
  SUPPORTED_LANGUAGES: ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es'],
  changeLanguage: jest.fn(),
}));

jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

const mockGetUserPreferences = getUserPreferences as jest.MockedFunction<typeof getUserPreferences>;
const mockSaveUserPreferences = saveUserPreferences as jest.MockedFunction<typeof saveUserPreferences>;
const mockChangeLanguage = changeLanguage as jest.MockedFunction<typeof changeLanguage>;

beforeEach(() => {
  jest.clearAllMocks();
  mockChangeLanguage.mockResolvedValue(undefined);
});

describe('SettingsTranslationScreen', () => {
  it('does not replace a newer recovered preference with an older retry response', async () => {
    mockGetUserPreferences.mockRejectedValueOnce(new Error('Unavailable'));
    const screen = render(<SettingsTranslationScreen />);
    await screen.findByTestId('translation-settings-error');
    let resolveOlder!: (value: Awaited<ReturnType<typeof getUserPreferences>>) => void;
    mockGetUserPreferences.mockImplementationOnce(() => new Promise(resolve => { resolveOlder = resolve; }))
      .mockResolvedValueOnce({ translation: { auto_translate_ugc: true, auto_translate_target_locale: 'ga' } });
    const retry = screen.getByText('common:buttons.retry');
    act(() => { fireEvent.press(retry); fireEvent.press(retry); });
    await screen.findByText('Save preferences');
    await act(async () => resolveOlder({ translation: { auto_translate_ugc: false, auto_translate_target_locale: 'en' } }));
    fireEvent.press(screen.getByText('Save preferences'));
    await waitFor(() => expect(mockSaveUserPreferences).toHaveBeenCalledWith(expect.objectContaining({
      translation: { auto_translate_ugc: true, auto_translate_target_locale: 'ga' },
    })));
  });

  it('blocks default-value saves after a failed load and recovers the saved target on retry', async () => {
    mockGetUserPreferences.mockRejectedValueOnce(new Error('Unavailable'));
    const screen = render(<SettingsTranslationScreen />);
    await screen.findByTestId('translation-settings-error');
    expect(screen.queryByText('Save preferences')).toBeNull();
    expect(mockSaveUserPreferences).not.toHaveBeenCalled();
    mockGetUserPreferences.mockResolvedValueOnce({
      feed: { prefers_chronological: true },
      translation: { auto_translate_ugc: true, auto_translate_target_locale: 'ga' },
    });
    fireEvent.press(screen.getByText('common:buttons.retry'));
    await screen.findByText('Save preferences');
    expect(screen.queryByTestId('translation-settings-error')).toBeNull();
    fireEvent.press(screen.getByText('Save preferences'));
    await waitFor(() => expect(mockSaveUserPreferences).toHaveBeenCalledWith({
      feed: { prefers_chronological: true },
      translation: { auto_translate_ugc: true, auto_translate_target_locale: 'ga' },
    }));
  });

  it('retains the chosen target after a failed save and retries the same preferences', async () => {
    mockGetUserPreferences.mockResolvedValue({
      feed: { prefers_chronological: false },
      translation: { auto_translate_ugc: true, auto_translate_target_locale: 'en' },
    });
    mockSaveUserPreferences.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({});
    const screen = render(<SettingsTranslationScreen />);
    await screen.findByText('Save preferences');
    fireEvent.press(screen.getByText('Irish'));
    fireEvent.press(screen.getByText('Save preferences'));
    await screen.findByText('Save preferences');
    expect(mockSaveUserPreferences).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByText('Save preferences'));
    await waitFor(() => expect(mockSaveUserPreferences).toHaveBeenCalledTimes(2));
    expect(mockSaveUserPreferences.mock.calls[1][0]).toEqual(mockSaveUserPreferences.mock.calls[0][0]);
    expect(mockSaveUserPreferences.mock.calls[1][0].translation?.auto_translate_target_locale).toBe('ga');
  });

  it('renders saved translation preferences from the API', async () => {
    mockGetUserPreferences.mockResolvedValue({
      feed: { prefers_chronological: true },
      translation: { auto_translate_ugc: true, auto_translate_target_locale: 'ga' },
    });

    const { getByText } = render(<SettingsTranslationScreen />);

    await waitFor(() => expect(getByText('Feed ordering')).toBeTruthy());
    expect(getByText('Automatic translation')).toBeTruthy();
    expect(getByText('Irish')).toBeTruthy();
    expect(getByText('Save preferences')).toBeTruthy();
  });

  it('ignores a retained save callback after leaving the screen', async () => {
    mockGetUserPreferences.mockResolvedValue({
      feed: { prefers_chronological: false },
      translation: { auto_translate_ugc: true, auto_translate_target_locale: 'en' },
    });
    const screen = render(<SettingsTranslationScreen />);
    let control = await screen.findByText('Save preferences');
    while (typeof control.props.onPress !== 'function' && control.parent) control = control.parent;
    const save = control.props.onPress;
    expect(save).toEqual(expect.any(Function));
    screen.unmount();
    await act(async () => save());
    expect(mockSaveUserPreferences).not.toHaveBeenCalled();
  });

  it('saves feed and translation preferences', async () => {
    mockGetUserPreferences.mockResolvedValue({
      feed: { prefers_chronological: false },
      translation: { auto_translate_ugc: true, auto_translate_target_locale: 'en' },
    });
    mockSaveUserPreferences.mockResolvedValue({});

    const { getByText } = render(<SettingsTranslationScreen />);
    await waitFor(() => expect(getByText('Save preferences')).toBeTruthy());

    await act(async () => {
      fireEvent.press(getByText('Irish'));
    });
    await act(async () => {
      fireEvent.press(getByText('Save preferences'));
    });

    await waitFor(() => expect(mockSaveUserPreferences).toHaveBeenCalledWith({
      feed: { prefers_chronological: false },
      translation: {
        auto_translate_ugc: true,
        auto_translate_target_locale: 'ga',
      },
    }));
    // The translation target is not the interface language (audit 2026-09-07, B/F-16).
    expect(mockChangeLanguage).not.toHaveBeenCalled();
  });

  it('starts only one save for rapid repeated taps', async () => {
    let release!: () => void;
    mockGetUserPreferences.mockResolvedValue({
      feed: { prefers_chronological: false },
      translation: { auto_translate_ugc: true, auto_translate_target_locale: 'en' },
    });
    mockSaveUserPreferences.mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve({}); }));

    const { getByText } = render(<SettingsTranslationScreen />);
    await waitFor(() => expect(getByText('Save preferences')).toBeTruthy());
    const saveButton = getByText('Save preferences');
    fireEvent.press(saveButton);
    fireEvent.press(saveButton);

    expect(mockSaveUserPreferences).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(mockSaveUserPreferences).toHaveBeenCalledTimes(1));
  });
});
