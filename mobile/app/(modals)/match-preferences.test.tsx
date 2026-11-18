// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockUpdatePreferences = jest.fn();
const mockShowToast = jest.fn();

jest.mock('heroui-native', () => {
  const actual = jest.requireActual('heroui-native');
  const { View } = require('react-native');
  // Carries the limits the screen gives each slider, so a test can read them.
  const Slider = ({ children, accessibilityLabel, minValue, maxValue, value }: {
    children: React.ReactNode;
    accessibilityLabel?: string;
    minValue?: number;
    maxValue?: number;
    value?: number;
  }) => (
    <View accessibilityLabel={accessibilityLabel} accessibilityValue={{ min: minValue, max: maxValue, now: value }}>
      {children}
    </View>
  );
  Slider.Track = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Slider.Fill = () => <View />;
  Slider.Thumb = () => <View />;
  return { ...actual, Slider };
});

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

// Records whether the screen believes it holds unsaved changes — which is what decides
// whether Back asks "Discard your changes?".
const mockUnsavedGuard = jest.fn();
jest.mock('@/lib/hooks/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: (options: { isDirty: boolean }) => mockUnsavedGuard(options),
}));

jest.mock('@/lib/api/matches', () => ({
  getMatchPreferences: jest.fn(),
  updateMatchPreferences: (...args: unknown[]) => mockUpdatePreferences(...args),
}));

jest.mock('@/lib/api/exchanges', () => ({
  getExchangeCategories: jest.fn(),
}));

jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast }),
}));

jest.mock('@/components/ui/Toggle', () => {
  const { Text } = require('react-native');
  return function MockToggle({ value, onValueChange, accessibilityLabel }: {
    value: boolean;
    onValueChange: (value: boolean) => void;
    accessibilityLabel: string;
  }) {
    return (
      <Text accessibilityLabel={accessibilityLabel} onPress={() => onValueChange(!value)}>
        {value ? 'on' : 'off'}
      </Text>
    );
  };
});

jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return function MockAppTopBar({ title }: { title: string }) {
    return <Text>{title}</Text>;
  };
});

jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#6366f1' }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111827',
    textSecondary: '#4b5563',
    border: '#e5e7eb',
    surface: '#ffffff',
    success: '#22c55e',
    warning: '#f59e0b',
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const values: Record<string, string> = {
        'common:back': 'Back',
        'common:buttons.retry': 'Retry',
        'matchPreferences.heading': 'Match Preferences',
        'matchPreferences.subtitle': 'Control how matching works.',
        'matchPreferences.load_failed': 'Could not load match preferences',
        'matchPreferences.save': 'Save preferences',
        'matchPreferences.save_success': 'Match preferences saved',
        'matchPreferences.save_failed': 'Could not save match preferences',
        'matchPreferences.pause.title': 'Pause matching',
        'matchPreferences.thresholds.title': 'Distance and quality',
        'matchPreferences.thresholds.distance_label': 'Maximum distance',
        'matchPreferences.thresholds.distance_value': `${String(opts?.value)} km`,
        'matchPreferences.thresholds.quality_label': 'Minimum match quality',
        'matchPreferences.thresholds.quality_value': `${String(opts?.value)}%`,
        'matchPreferences.categories.title': 'Category interests',
        'matchPreferences.categories.description': 'Choose categories.',
        'matchPreferences.categories.empty': 'No categories available.',
        'matchPreferences.notifications.title': 'Notifications',
        'matchPreferences.notifications.frequency_label': 'Digest frequency',
        'matchPreferences.notifications.daily': 'Daily',
        'matchPreferences.notifications.fortnightly': 'Fortnightly',
        'matchPreferences.notifications.monthly': 'Monthly',
        'matchPreferences.notifications.never': 'Never',
        'matchPreferences.notifications.hot_matches': 'Hot match alerts',
        'matchPreferences.notifications.mutual_matches': 'Mutual match alerts',
      };
      return values[key] ?? key;
    },
  }),
}));

import MatchPreferencesScreen from './match-preferences';

const preferences = {
  max_distance_km: 25,
  min_match_score: 50,
  notification_frequency: 'monthly' as const,
  notify_hot_matches: true,
  notify_mutual_matches: true,
  matching_paused: false,
  categories: [],
  availability: [],
  max_distance_limit_km: 50,
};

/** Whether the screen last told the unsaved-changes guard that the form is dirty. */
function lastDirty(): boolean {
  const calls = mockUnsavedGuard.mock.calls;
  return (calls[calls.length - 1][0] as { isDirty: boolean }).isDirty;
}

describe('MatchPreferencesScreen', () => {
  const refresh = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdatePreferences.mockResolvedValue({ ...preferences, matching_paused: true });
    mockUseApi.mockReturnValue({
      data: { preferences, categories: [{ id: 4, name: 'Gardening' }] },
      isLoading: false,
      error: null,
      refresh,
    });
  });

  it('loads the stored values instead of editable defaults', () => {
    const { getAllByText, getByText } = render(<MatchPreferencesScreen />);

    expect(getAllByText('Match Preferences').length).toBeGreaterThan(0);
    expect(getByText('25 km')).toBeTruthy();
    expect(getByText('50%')).toBeTruthy();
    expect(getByText('Gardening')).toBeTruthy();
  });

  it('saves the member changes and shows visible success feedback', async () => {
    const { getByLabelText, getByText } = render(<MatchPreferencesScreen />);

    fireEvent.press(getByLabelText('Pause matching'));
    fireEvent.press(getByText('Save preferences'));

    await waitFor(() => expect(mockUpdatePreferences).toHaveBeenCalledWith({
      ...preferences,
      matching_paused: true,
    }));
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }));
  });

  it('does not ask to discard changes after they have been saved', async () => {
    // Regression: "dirty" was measured against the values the screen opened with, which a
    // save never updated — so after a successful save, Back still asked "Discard your
    // changes?" about changes that had just been kept.
    const { getByLabelText, getByText } = render(<MatchPreferencesScreen />);
    expect(lastDirty()).toBe(false);

    fireEvent.press(getByLabelText('Pause matching'));
    expect(lastDirty()).toBe(true);

    fireEvent.press(getByText('Save preferences'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' })));

    await waitFor(() => expect(lastDirty()).toBe(false));
  });

  it('is dirty again when the member changes something after saving', async () => {
    const { getByLabelText, getByText } = render(<MatchPreferencesScreen />);

    fireEvent.press(getByLabelText('Pause matching'));
    fireEvent.press(getByText('Save preferences'));
    await waitFor(() => expect(lastDirty()).toBe(false));

    fireEvent.press(getByLabelText('Pause matching'));
    expect(lastDirty()).toBe(true);
  });

  it("stops the distance slider at the community's own limit", () => {
    // The server brings anything beyond the limit back to it, so a slider that ran to
    // 100 km let a member "choose" a distance that was then quietly cut.
    const { getByLabelText } = render(<MatchPreferencesScreen />);

    expect(getByLabelText('Maximum distance').props.accessibilityValue).toMatchObject({ min: 1, max: 50, now: 25 });
  });

  it('offers the whole 0 to 100 range for minimum match quality, as the website does', () => {
    const { getByLabelText } = render(<MatchPreferencesScreen />);

    expect(getByLabelText('Minimum match quality').props.accessibilityValue).toMatchObject({ min: 0, max: 100, now: 50 });
  });

  it('shows the value the server kept after a save', async () => {
    mockUpdatePreferences.mockResolvedValue({ ...preferences, max_distance_km: 40 });
    const { getByText } = render(<MatchPreferencesScreen />);
    expect(getByText('25 km')).toBeTruthy();

    fireEvent.press(getByText('Save preferences'));

    await waitFor(() => expect(getByText('40 km')).toBeTruthy());
  });

  it('does not expose a save button when stored preferences failed to load', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: new Error('offline'), refresh });

    const { getAllByText, queryByText } = render(<MatchPreferencesScreen />);

    expect(getAllByText('Could not load match preferences').length).toBeGreaterThan(0);
    expect(queryByText('Save preferences')).toBeNull();
  });

  it('shows visible feedback when saving fails', async () => {
    mockUpdatePreferences.mockRejectedValue(new Error('network down'));
    const { getByText } = render(<MatchPreferencesScreen />);

    fireEvent.press(getByText('Save preferences'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
      variant: 'danger',
    })));
  });
});
