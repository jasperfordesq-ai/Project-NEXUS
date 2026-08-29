// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
const mockRefreshUser = jest.fn();
const mockToast = jest.fn();
let mockUser: Record<string, unknown> = {
  id: 7,
  first_name: 'Alex',
  last_name: 'Member',
  avatar_url: 'https://example.org/alex.jpg',
  bio: 'I enjoy helping neighbours with gardening.',
  onboarding_completed: false,
};

jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'aria_step_progress') return `Step ${values?.step} of ${values?.total}`;
      if (key === 'welcome_title') return `Welcome to ${values?.name}!`;
      return key;
    },
  }),
}));
jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, refreshUser: mockRefreshUser }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ tenant: { name: 'Timebank Global' } }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', surface: '#fff', text: '#111', textSecondary: '#555', textMuted: '#777', border: '#ddd' }),
}));
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockToast }) }));
jest.mock('@/lib/api/auth', () => ({ getMe: jest.fn() }));
jest.mock('@/lib/api/profile', () => ({ updateAvatar: jest.fn(), updateProfile: jest.fn() }));
jest.mock('@/lib/api/onboarding', () => ({
  getOnboardingStatus: jest.fn(),
  getOnboardingConfig: jest.fn(),
  getOnboardingCategories: jest.fn(),
  getSafeguardingOptions: jest.fn(),
  saveSafeguardingPreferences: jest.fn(),
  completeOnboarding: jest.fn(),
}));

import OnboardingScreen from './onboarding';
import { getMe } from '@/lib/api/auth';
import {
  completeOnboarding,
  getOnboardingCategories,
  getOnboardingConfig,
  getOnboardingStatus,
  getSafeguardingOptions,
  saveSafeguardingPreferences,
} from '@/lib/api/onboarding';

describe('OnboardingScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = {
      id: 7,
      first_name: 'Alex',
      last_name: 'Member',
      avatar_url: 'https://example.org/alex.jpg',
      bio: 'I enjoy helping neighbours with gardening.',
      onboarding_completed: false,
    };
    jest.mocked(getMe).mockResolvedValue({ data: mockUser as never });
    jest.mocked(getOnboardingStatus).mockResolvedValue({
      onboarding_completed: false,
      has_avatar: true,
      has_bio: true,
      interests: [],
    });
    jest.mocked(getOnboardingConfig).mockResolvedValue({
      config: { bio_min_length: 10, safeguarding_intro_text: '' },
      steps: [
        { slug: 'welcome', label_code: 'welcome', required: false },
        { slug: 'safeguarding', label_code: 'safeguarding', required: true },
        { slug: 'confirm', label_code: 'confirm', required: false },
      ],
    });
    jest.mocked(getOnboardingCategories).mockResolvedValue([]);
    jest.mocked(getSafeguardingOptions).mockResolvedValue([{
      id: 9,
      option_key: 'none_apply',
      option_type: 'checkbox',
      label: 'None of these apply to me',
      is_required: true,
    }]);
    jest.mocked(saveSafeguardingPreferences).mockResolvedValue({ message: 'Saved', preferences_count: 1 });
    jest.mocked(completeOnboarding).mockResolvedValue({ message: 'Complete', listings_created: 0, listing_ids: [] });
  });

  it('records an explicit adult safeguarding response before completing onboarding', async () => {
    const { getByLabelText, getByTestId, getByText } = render(<OnboardingScreen />);
    await waitFor(() => expect(getByText('Welcome to Timebank Global!')).toBeTruthy());

    fireEvent.press(getByTestId('onboarding-next'));
    await waitFor(() => expect(getByLabelText('None of these apply to me')).toBeTruthy());
    fireEvent(getByLabelText('None of these apply to me'), 'selectedChange', true);
    fireEvent.press(getByTestId('onboarding-next'));

    await waitFor(() => expect(saveSafeguardingPreferences).toHaveBeenCalledWith([
      { option_id: 9, value: '1' },
    ]));
    fireEvent.press(getByTestId('onboarding-complete'));

    await waitFor(() => expect(completeOnboarding).toHaveBeenCalledWith({ interests: [], offers: [], needs: [] }));
    expect(mockRefreshUser).toHaveBeenCalledWith(expect.objectContaining({ onboarding_completed: true }));
    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/home');
  });

  it('visibly refuses to bypass a required safeguarding response', async () => {
    const { getByTestId, getByText } = render(<OnboardingScreen />);
    await waitFor(() => expect(getByText('Welcome to Timebank Global!')).toBeTruthy());
    fireEvent.press(getByTestId('onboarding-next'));
    fireEvent.press(getByTestId('onboarding-next'));

    expect(saveSafeguardingPreferences).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
  });
});
