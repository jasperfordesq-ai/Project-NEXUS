// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

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
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
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
import { storage } from '@/lib/storage';
import { getMe } from '@/lib/api/auth';
import { ApiResponseError } from '@/lib/api/client';
import { updateProfile } from '@/lib/api/profile';
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

  it('does not navigate the replacement account when an earlier profile write finishes', async () => {
    let finishWrite!: () => void;
    const write = jest.spyOn(storage, 'setJson').mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve; }));
    jest.mocked(getOnboardingStatus).mockResolvedValueOnce({ onboarding_completed: true, has_avatar: true, has_bio: true, interests: [] });
    const screen = render(<OnboardingScreen />);
    await waitFor(() => expect(write).toHaveBeenCalled());
    mockUser = { ...mockUser, id: 8 };
    jest.mocked(getMe).mockResolvedValue({ data: mockUser as never });
    screen.rerender(<OnboardingScreen />);
    await act(async () => finishWrite());
    expect(mockReplace).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it('ignores a completed profile response from a replaced account', async () => {
    const oldUser = { ...mockUser };
    let resolveOld!: (value: { data: never }) => void;
    jest.mocked(getMe).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }));
    jest.mocked(getOnboardingStatus).mockResolvedValueOnce({ onboarding_completed: true, has_avatar: true, has_bio: true, interests: [] });
    const screen = render(<OnboardingScreen />);
    mockUser = { ...oldUser, id: 8, first_name: 'Replacement' };
    jest.mocked(getMe).mockResolvedValue({ data: mockUser as never });
    screen.rerender(<OnboardingScreen />);
    await act(async () => resolveOld({ data: oldUser as never }));
    expect(mockRefreshUser).not.toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
    expect(mockReplace).not.toHaveBeenCalled();
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

  describe('profile step for a member with no location', () => {
    const profileConfig = {
      config: { bio_min_length: 10, avatar_required: false, bio_required: true },
      steps: [
        { slug: 'profile', label_code: 'profile', required: true },
        { slug: 'confirm', label_code: 'confirm', required: false },
      ],
    };
    const fullProfile = (extra: Record<string, unknown> = {}) => ({
      data: { ...mockUser, ...extra } as never,
    });
    // Resolves to the profile the server would return once the place is saved.
    const savedProfile = (extra: Record<string, unknown> = {}) => ({
      data: { ...mockUser, location: 'Cork', location_missing: false, ...extra } as never,
    });

    beforeEach(() => {
      jest.mocked(getOnboardingConfig).mockResolvedValue(profileConfig as never);
      jest.mocked(updateProfile).mockResolvedValue(savedProfile());
    });

    it('asks where the member is based when the server says the location is missing', async () => {
      jest.mocked(getMe).mockResolvedValue(fullProfile({ avatar_url: null, bio: '', location_missing: true }));
      const { getByTestId, getByLabelText } = render(<OnboardingScreen />);
      await waitFor(() => expect(getByTestId('onboarding-location-input')).toBeTruthy());
      expect(getByLabelText('location_label')).toBeTruthy();
    });

    it.each([
      ['has a location', { location_missing: false }],
      ['was not told either way', {}],
    ])('does not ask a member who %s', async (_label, extra) => {
      jest.mocked(getMe).mockResolvedValue(fullProfile({ avatar_url: null, bio: '', ...extra }));
      const { getByTestId, queryByTestId } = render(<OnboardingScreen />);
      await waitFor(() => expect(getByTestId('onboarding-next')).toBeTruthy());
      expect(queryByTestId('onboarding-location-input')).toBeNull();
    });

    it('does not skip the profile step for a member who has a photo and bio but no location', async () => {
      jest.mocked(getMe).mockResolvedValue(fullProfile({ location_missing: true }));
      const { getByTestId } = render(<OnboardingScreen />);
      await waitFor(() => expect(getByTestId('onboarding-location-input')).toBeTruthy());
    });

    it('still skips the profile step for a member who is complete and has a location', async () => {
      jest.mocked(getMe).mockResolvedValue(fullProfile({ location_missing: false }));
      const { getByTestId, queryByTestId } = render(<OnboardingScreen />);
      await waitFor(() => expect(getByTestId('onboarding-complete')).toBeTruthy());
      expect(queryByTestId('onboarding-location-input')).toBeNull();
    });

    it('will not continue while the place is blank or only spaces', async () => {
      jest.mocked(getMe).mockResolvedValue(fullProfile({ location_missing: true, avatar_url: null }));
      const { getByTestId } = render(<OnboardingScreen />);
      await waitFor(() => expect(getByTestId('onboarding-location-input')).toBeTruthy());
      fireEvent.changeText(getByTestId('onboarding-location-input'), '   ');
      fireEvent.press(getByTestId('onboarding-next'));

      expect(updateProfile).not.toHaveBeenCalled();
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'toast_location_required',
        variant: 'danger',
      }));
    });

    it('saves the trimmed place together with the bio, refreshes the member and moves on', async () => {
      jest.mocked(getMe).mockResolvedValue(fullProfile({ location_missing: true, avatar_url: null, bio: '' }));
      const { getByTestId, getByLabelText } = render(<OnboardingScreen />);
      await waitFor(() => expect(getByTestId('onboarding-location-input')).toBeTruthy());
      fireEvent.changeText(getByLabelText('bio_label'), '  I like helping with gardens.  ');
      fireEvent.changeText(getByTestId('onboarding-location-input'), '  Cork  ');
      fireEvent.press(getByTestId('onboarding-next'));

      await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({
        bio: 'I like helping with gardens.',
        location: 'Cork',
      }));
      await waitFor(() => expect(mockRefreshUser).toHaveBeenCalledWith(expect.objectContaining({
        location: 'Cork',
        location_missing: false,
      })));
      await waitFor(() => expect(getByTestId('onboarding-complete')).toBeTruthy());
    });

    it('shows our own translated message when the server refuses the place, not its English', async () => {
      jest.mocked(getMe).mockResolvedValue(fullProfile({ location_missing: true }));
      jest.mocked(updateProfile).mockRejectedValueOnce(
        new ApiResponseError(422, 'The location may not be greater than 255 characters.', undefined, 'VALIDATION', 'location'),
      );
      const { getByTestId } = render(<OnboardingScreen />);
      await waitFor(() => expect(getByTestId('onboarding-location-input')).toBeTruthy());
      fireEvent.changeText(getByTestId('onboarding-location-input'), 'Cork');
      fireEvent.press(getByTestId('onboarding-next'));

      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        description: 'toast_location_invalid_desc',
        variant: 'danger',
      })));
      expect(mockRefreshUser).not.toHaveBeenCalled();
    });

    it('sends only the bio for a member who already has a location, as before', async () => {
      jest.mocked(getMe).mockResolvedValue(fullProfile({ location_missing: false, avatar_url: null, bio: '' }));
      const { getByTestId, getByLabelText } = render(<OnboardingScreen />);
      await waitFor(() => expect(getByLabelText('bio_label')).toBeTruthy());
      fireEvent.changeText(getByLabelText('bio_label'), 'I like helping with gardens.');
      fireEvent.press(getByTestId('onboarding-next'));
      await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ bio: 'I like helping with gardens.' }));
    });
  });
});
