// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { BackHandler } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
// The community on screen. `settings` carries its Admin → Welcome steps choice.
let mockTenant: { name: string; settings?: Record<string, unknown> } = { name: 'Timebank Global' };
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
  useTenant: () => ({ tenant: mockTenant }),
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
jest.mock('@/lib/api/twoFactor', () => ({ getTwoFactorStatus: jest.fn() }));
// The enrolment flow has its own suite (components/security/TwoFactorEnrolment.test.tsx);
// here only its two exits matter.
jest.mock('@/components/security/TwoFactorEnrolment', () => {
  const { Pressable, Text, View } = require('react-native');
  return ({ onDone, onCancel, onStageChange, onFieldFocus }: {
    onDone: () => void;
    onCancel?: () => void;
    onStageChange?: (stage: string) => void;
    onFieldFocus?: () => void;
  }) => (
    <View testID="two-factor-enrolment">
      <Pressable testID="enrolment-finish" onPress={onDone}><Text>finish</Text></Pressable>
      {onCancel ? <Pressable testID="enrolment-cancel" onPress={onCancel}><Text>cancel</Text></Pressable> : null}
      {/* Stands in for a verified code: the backup codes are on screen and two-factor is on. */}
      <Pressable testID="enrolment-show-codes" onPress={() => onStageChange?.('codes')}><Text>codes</Text></Pressable>
      {/* Stands in for the six-digit code box getting focus. */}
      <Pressable testID="enrolment-focus-code" onPress={() => onFieldFocus?.()}><Text>focus</Text></Pressable>
    </View>
  );
});
const mockBringEndIntoView = jest.fn();
const mockScrollRef: { current: unknown } = { current: null };
jest.mock('@/lib/hooks/useScrollToEndOnKeyboard', () => ({
  useScrollToEndOnKeyboard: () => ({ scrollRef: mockScrollRef, bringEndIntoView: mockBringEndIntoView }),
}));

import OnboardingScreen from './onboarding';
import { storage } from '@/lib/storage';
import { getMe } from '@/lib/api/auth';
import { ApiResponseError } from '@/lib/api/client';
import { updateProfile } from '@/lib/api/profile';
import { getTwoFactorStatus } from '@/lib/api/twoFactor';
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
    mockTenant = { name: 'Timebank Global' };
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

  it('shows what each safeguarding option really does when the server says so', async () => {
    jest.mocked(getSafeguardingOptions).mockResolvedValueOnce([
      {
        id: 11,
        option_key: 'only_vetted_contact',
        option_type: 'checkbox',
        label: 'Only vetted members can contact me',
        is_required: false,
        effects: [
          'Members without community-recorded vetting cannot message you.',
          'A coordinator is told you made this choice.',
        ],
      },
      {
        id: 12,
        option_key: 'old_server_option',
        option_type: 'checkbox',
        label: 'Option from an older server',
        is_required: false,
      },
      {
        id: 13,
        option_key: 'empty_effects',
        option_type: 'checkbox',
        label: 'Option with no effects',
        is_required: false,
        effects: [],
      },
    ]);
    const { getAllByText, getByTestId, getByText, queryByTestId } = render(<OnboardingScreen />);
    await waitFor(() => expect(getByText('Welcome to Timebank Global!')).toBeTruthy());
    fireEvent.press(getByTestId('onboarding-next'));

    await waitFor(() => expect(getByTestId('safeguarding-effects-11')).toBeTruthy());
    expect(getAllByText('safeguarding.what_this_does')).toHaveLength(1);
    expect(getByText('Members without community-recorded vetting cannot message you.')).toBeTruthy();
    expect(getByText('A coordinator is told you made this choice.')).toBeTruthy();
    expect(queryByTestId('safeguarding-effects-12')).toBeNull();
    expect(queryByTestId('safeguarding-effects-13')).toBeNull();
  });

  it('visibly refuses to bypass a required safeguarding response', async () => {
    const { getByTestId, getByText } = render(<OnboardingScreen />);
    await waitFor(() => expect(getByText('Welcome to Timebank Global!')).toBeTruthy());
    fireEvent.press(getByTestId('onboarding-next'));
    fireEvent.press(getByTestId('onboarding-next'));

    expect(saveSafeguardingPreferences).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
  });

  // The server refuses to finish (422 SAFEGUARDING_REQUIRED) when the community
  // made this step required and the member answered nothing. The screen used to
  // move on silently, so the member only found out at "Complete setup" (26 Oct 2026).
  describe('a required safeguarding step needs an answer', () => {
    const optionalOptions = [
      { id: 4, option_key: 'is_vulnerable_adult', option_type: 'checkbox' as const, label: 'I would like extra support', is_required: false },
      { id: 9, option_key: 'none_apply', option_type: 'checkbox' as const, label: 'None of these apply to me', is_required: false },
    ];

    async function reachSafeguarding(required: boolean) {
      jest.mocked(getSafeguardingOptions).mockResolvedValueOnce(optionalOptions);
      jest.mocked(getOnboardingConfig).mockResolvedValueOnce({
        config: { bio_min_length: 10, safeguarding_intro_text: '' },
        steps: [
          { slug: 'welcome', label_code: 'welcome', required: false },
          { slug: 'safeguarding', label_code: 'safeguarding', required },
          { slug: 'confirm', label_code: 'confirm', required: false },
        ],
      });
      const screen = render(<OnboardingScreen />);
      await waitFor(() => expect(screen.getByText('Welcome to Timebank Global!')).toBeTruthy());
      fireEvent.press(screen.getByTestId('onboarding-next'));
      await waitFor(() => expect(screen.getByLabelText('None of these apply to me')).toBeTruthy());
      return screen;
    }

    it('stays on the step and says how to answer when nothing is chosen', async () => {
      const screen = await reachSafeguarding(true);
      fireEvent.press(screen.getByTestId('onboarding-next'));

      const message = await screen.findByTestId('safeguarding-answer-missing');
      expect(message.props.accessibilityRole).toBe('alert');
      expect(screen.getByText('safeguarding.answer_missing_with_none')).toBeTruthy();
      expect(saveSafeguardingPreferences).not.toHaveBeenCalled();
      expect(screen.queryByTestId('onboarding-complete')).toBeNull();
    });

    it('clears the message and saves once "None of these apply to me" is chosen', async () => {
      const screen = await reachSafeguarding(true);
      fireEvent.press(screen.getByTestId('onboarding-next'));
      await screen.findByTestId('safeguarding-answer-missing');

      fireEvent(screen.getByLabelText('None of these apply to me'), 'selectedChange', true);
      expect(screen.queryByTestId('safeguarding-answer-missing')).toBeNull();
      fireEvent.press(screen.getByTestId('onboarding-next'));

      await waitFor(() => expect(saveSafeguardingPreferences).toHaveBeenCalledWith([{ option_id: 9, value: '1' }]));
    });

    it('still moves on with no answer when the step is not required', async () => {
      const screen = await reachSafeguarding(false);
      fireEvent.press(screen.getByTestId('onboarding-next'));

      await waitFor(() => expect(screen.getByTestId('onboarding-complete')).toBeTruthy());
      expect(saveSafeguardingPreferences).not.toHaveBeenCalled();
      expect(screen.queryByTestId('safeguarding-answer-missing')).toBeNull();
    });

    it('shows the server message and returns to the step when finishing is refused', async () => {
      const screen = await reachSafeguarding(false);
      fireEvent.press(screen.getByTestId('onboarding-next'));
      await waitFor(() => expect(screen.getByTestId('onboarding-complete')).toBeTruthy());

      jest.mocked(completeOnboarding).mockRejectedValueOnce(new ApiResponseError(
        422,
        'Please answer the safeguarding question before you finish.',
        undefined,
        'SAFEGUARDING_REQUIRED',
      ));
      fireEvent.press(screen.getByTestId('onboarding-complete'));

      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'safeguarding.answer_needed_title',
        description: 'Please answer the safeguarding question before you finish.',
        variant: 'danger',
      })));
      await waitFor(() => expect(screen.getByLabelText('None of these apply to me')).toBeTruthy());
      expect(screen.queryByTestId('onboarding-complete')).toBeNull();
      expect(mockReplace).not.toHaveBeenCalled();
    });
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

  describe('the optional "Protect your account" step', () => {
    const twoFactorStatus = (overrides: Record<string, unknown> = {}) => ({
      enabled: false,
      enrollment_allowed: true,
      enforcement_required: false,
      setup_required: false,
      backup_codes_remaining: 0,
      ...overrides,
    });

    beforeEach(() => {
      jest.mocked(getOnboardingConfig).mockResolvedValue({
        config: { bio_min_length: 10 },
        steps: [
          { slug: 'welcome', label_code: 'welcome', required: false },
          { slug: 'security', label_code: 'security', required: false },
          { slug: 'confirm', label_code: 'confirm', required: false },
        ],
      });
      jest.mocked(getTwoFactorStatus).mockResolvedValue(twoFactorStatus());
    });

    async function pastWelcome() {
      const view = render(<OnboardingScreen />);
      await waitFor(() => expect(view.getByText('Welcome to Timebank Global!')).toBeTruthy());
      fireEvent.press(view.getByTestId('onboarding-next'));
      return view;
    }

    it('is skipped when two-factor is already on', async () => {
      jest.mocked(getTwoFactorStatus).mockResolvedValue(twoFactorStatus({ enabled: true }));
      const view = await pastWelcome();
      await waitFor(() => expect(view.getByTestId('onboarding-complete')).toBeTruthy());
      expect(view.queryByText('security_title')).toBeNull();
      expect(view.getByText('Step 2 of 2 · step_confirm')).toBeTruthy();
    });

    it('is skipped when the community does not allow two-factor', async () => {
      jest.mocked(getTwoFactorStatus).mockResolvedValue(twoFactorStatus({ enrollment_allowed: false }));
      const view = await pastWelcome();
      await waitFor(() => expect(view.getByTestId('onboarding-complete')).toBeTruthy());
      expect(view.queryByText('security_title')).toBeNull();
    });

    it('is never invented when the server did not send it', async () => {
      jest.mocked(getOnboardingConfig).mockResolvedValue({
        config: { bio_min_length: 10 },
        steps: [
          { slug: 'welcome', label_code: 'welcome', required: false },
          { slug: 'confirm', label_code: 'confirm', required: false },
        ],
      });
      const view = await pastWelcome();
      await waitFor(() => expect(view.getByTestId('onboarding-complete')).toBeTruthy());
      expect(getTwoFactorStatus).not.toHaveBeenCalled();
    });

    it('"Not now" moves on without finishing onboarding or recording anything', async () => {
      const view = await pastWelcome();
      await waitFor(() => expect(view.getByText('security_title')).toBeTruthy());
      expect(view.getByText('security_not_now')).toBeTruthy();

      fireEvent.press(view.getByTestId('onboarding-next'));

      await waitFor(() => expect(view.getByTestId('onboarding-complete')).toBeTruthy());
      expect(completeOnboarding).not.toHaveBeenCalled();
      expect(saveSafeguardingPreferences).not.toHaveBeenCalled();
      expect(mockReplace).not.toHaveBeenCalled();
    });

    it('stays available when the status check fails, since it is optional', async () => {
      jest.mocked(getTwoFactorStatus).mockRejectedValue(new Error('offline'));
      const view = await pastWelcome();
      await waitFor(() => expect(view.getByText('security_title')).toBeTruthy());
    });

    it('runs the set-up inline, then goes straight on; Back from the last step shows it is on', async () => {
      const view = await pastWelcome();
      await waitFor(() => expect(view.getByTestId('onboarding-security-setup')).toBeTruthy());
      fireEvent.press(view.getByTestId('onboarding-security-setup'));

      expect(view.getByTestId('two-factor-enrolment')).toBeTruthy();
      // While setting up, the wizard's own buttons step aside so "Not now" cannot cut it short.
      expect(view.queryByTestId('onboarding-next')).toBeNull();

      // One tap: the backup codes' Continue moves on (it took two, found on the emulator).
      fireEvent.press(view.getByTestId('enrolment-finish'));
      await waitFor(() => expect(view.getByTestId('onboarding-complete')).toBeTruthy());
      expect(completeOnboarding).not.toHaveBeenCalled();

      // The last step had no way back except the phone's own Back button.
      fireEvent.press(view.getByTestId('onboarding-confirm-back'));
      await waitFor(() => expect(view.getByTestId('onboarding-security-done')).toBeTruthy());
      expect(view.getByText('security_continue')).toBeTruthy();
    });

    it('the last step lists only what this wizard asked for', async () => {
      // "Your Interests" showed in communities with no interests step (emulator, 7 Nov 2026).
      const view = await pastWelcome();
      await waitFor(() => expect(view.getByText('security_title')).toBeTruthy());
      fireEvent.press(view.getByTestId('onboarding-next'));
      await waitFor(() => expect(view.getByTestId('onboarding-complete')).toBeTruthy());

      expect(view.queryByText('summary_interests')).toBeNull();
      expect(view.queryByText('summary_offers')).toBeNull();
      expect(view.queryByText('summary_needs')).toBeNull();
    });

    it('the last step lists interests and skills when the wizard asked for them', async () => {
      jest.mocked(getOnboardingConfig).mockResolvedValue({
        config: { bio_min_length: 10 },
        steps: [
          { slug: 'welcome', label_code: 'welcome', required: false },
          { slug: 'interests', label_code: 'interests', required: false },
          { slug: 'skills', label_code: 'skills', required: false },
          { slug: 'confirm', label_code: 'confirm', required: false },
        ],
      });
      const view = await pastWelcome();
      await waitFor(() => expect(view.getByText('Step 2 of 4 · step_interests')).toBeTruthy());
      fireEvent.press(view.getByTestId('onboarding-next'));
      await waitFor(() => expect(view.getByText('Step 3 of 4 · step_skills')).toBeTruthy());
      fireEvent.press(view.getByTestId('onboarding-next'));
      await waitFor(() => expect(view.getByTestId('onboarding-complete')).toBeTruthy());

      expect(view.getByText('summary_interests')).toBeTruthy();
      expect(view.getByText('summary_offers')).toBeTruthy();
      expect(view.getByText('summary_needs')).toBeTruthy();
    });

    it('names the kind of app the member needs before they start', async () => {
      const view = await pastWelcome();
      await waitFor(() => expect(view.getByText('security_title')).toBeTruthy());
      expect(view.getByText('settings:twoFactor.screen.needApp')).toBeTruthy();
    });

    it("Android's Back button leaves the set-up, then steps back, and never closes the wizard", async () => {
      // Closing it only made the app reopen the wizard from the start (emulator, 7 Nov 2026).
      type BackPress = () => boolean | null | undefined;
      const handlers: BackPress[] = [];
      const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
        handlers.push(handler);
        return { remove: () => { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } };
      });
      const pressBack = () => {
        let handled: boolean | null | undefined = false;
        act(() => { handled = handlers[handlers.length - 1]?.(); });
        return handled;
      };
      try {
        const view = await pastWelcome();
        await waitFor(() => expect(view.getByTestId('onboarding-security-setup')).toBeTruthy());
        fireEvent.press(view.getByTestId('onboarding-security-setup'));
        expect(view.getByTestId('two-factor-enrolment')).toBeTruthy();

        expect(pressBack()).toBe(true);
        expect(view.queryByTestId('two-factor-enrolment')).toBeNull();
        expect(view.getByTestId('onboarding-security-setup')).toBeTruthy();

        expect(pressBack()).toBe(true);
        await waitFor(() => expect(view.getByText('Welcome to Timebank Global!')).toBeTruthy());

        expect(pressBack()).toBe(true);
        expect(view.getByText('Welcome to Timebank Global!')).toBeTruthy();
        expect(mockReplace).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });

    it("Android's Back on the backup codes keeps them on screen", async () => {
      // Two-factor is already on by then and the codes are shown once: Back used to
      // throw them away and offer "Set it up" again, which then said "already on".
      type BackPress = () => boolean | null | undefined;
      const handlers: BackPress[] = [];
      const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
        handlers.push(handler);
        return { remove: () => { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } };
      });
      try {
        const view = await pastWelcome();
        await waitFor(() => expect(view.getByTestId('onboarding-security-setup')).toBeTruthy());
        fireEvent.press(view.getByTestId('onboarding-security-setup'));
        fireEvent.press(view.getByTestId('enrolment-show-codes'));

        let handled: boolean | null | undefined = false;
        act(() => { handled = handlers[handlers.length - 1]?.(); });
        expect(handled).toBe(true);
        expect(view.getByTestId('two-factor-enrolment')).toBeTruthy();
        expect(view.queryByTestId('onboarding-security-setup')).toBeNull();
      } finally {
        spy.mockRestore();
      }
    });

    it('brings the code box and its button above the keyboard', async () => {
      // The keyboard opened over the Verify button below the code box (emulator, 7 Nov 2026).
      const view = await pastWelcome();
      await waitFor(() => expect(view.getByTestId('onboarding-security-setup')).toBeTruthy());
      fireEvent.press(view.getByTestId('onboarding-security-setup'));
      expect(mockScrollRef.current).toBeTruthy();

      fireEvent.press(view.getByTestId('enrolment-focus-code'));
      expect(mockBringEndIntoView).toHaveBeenCalledTimes(1);
    });

    it('can back out of the set-up to the step', async () => {
      const view = await pastWelcome();
      await waitFor(() => expect(view.getByTestId('onboarding-security-setup')).toBeTruthy());
      fireEvent.press(view.getByTestId('onboarding-security-setup'));
      fireEvent.press(view.getByTestId('enrolment-cancel'));
      expect(view.getByTestId('onboarding-security-setup')).toBeTruthy();
      expect(view.getByText('security_not_now')).toBeTruthy();
    });
  });
});

/*
  The community chooses who goes through the welcome steps (Admin → Welcome steps). The
  choice reaches the app in the community settings. Until 13 Nov 2026 this screen behaved
  as if every community had made them compulsory.
*/
describe("OnboardingScreen and the community's choice about the welcome steps", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { id: 7, first_name: 'Alex', last_name: 'Member', avatar_url: null, bio: null, onboarding_completed: false };
    jest.mocked(getMe).mockResolvedValue({ data: mockUser as never });
    jest.mocked(getOnboardingStatus).mockResolvedValue({ onboarding_completed: false, has_avatar: false, has_bio: false, interests: [] });
    jest.mocked(getOnboardingConfig).mockResolvedValue({
      config: { bio_min_length: 10 },
      steps: [
        { slug: 'welcome', label_code: 'welcome', required: false },
        { slug: 'confirm', label_code: 'confirm', required: false },
      ],
    });
    jest.mocked(getOnboardingCategories).mockResolvedValue([]);
    jest.mocked(getSafeguardingOptions).mockResolvedValue([]);
  });

  it('shows nothing and goes Home when the community has switched the steps off', async () => {
    mockTenant = { name: 'Timebank Global', settings: { onboarding_enabled: false } };

    const view = render(<OnboardingScreen />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/home'));
    expect(getOnboardingConfig).not.toHaveBeenCalled();
    expect(view.queryByText('Welcome to Timebank Global!')).toBeNull();
  });

  it('offers "Skip for now" when the steps are optional, and it leaves', async () => {
    mockTenant = { name: 'Timebank Global', settings: { onboarding_enabled: true, onboarding_mandatory: false } };

    const view = render(<OnboardingScreen />);
    await waitFor(() => expect(view.getByText('Welcome to Timebank Global!')).toBeTruthy());

    fireEvent.press(view.getByTestId('onboarding-skip-for-now'));

    expect(mockReplace).toHaveBeenCalledWith('/(tabs)/home');
    expect(completeOnboarding).not.toHaveBeenCalled();
  });

  /*
    Found on the emulator, 13 Nov 2026. The app starts from its saved copy of the community
    settings and fetches the fresh copy a moment later. A community that had just made the
    steps optional still had "compulsory" in the saved copy, so the app opened the steps;
    when the fresh copy arrived the member was left on them with only "Skip for now".
  */
  it('goes Home when the fresh community settings say the steps are no longer compulsory', async () => {
    mockTenant = { name: 'Timebank Global', settings: { onboarding_enabled: true, onboarding_mandatory: true } };
    const view = render(<OnboardingScreen />);
    await waitFor(() => expect(view.getByText('Welcome to Timebank Global!')).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();

    mockTenant = { name: 'Timebank Global', settings: { onboarding_enabled: true, onboarding_mandatory: false } };
    view.rerender(<OnboardingScreen />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(tabs)/home'));
  });

  it('stays on optional steps the member opened by choice', async () => {
    mockTenant = { name: 'Timebank Global', settings: { onboarding_enabled: true, onboarding_mandatory: false } };
    const view = render(<OnboardingScreen />);
    await waitFor(() => expect(view.getByText('Welcome to Timebank Global!')).toBeTruthy());

    view.rerender(<OnboardingScreen />);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('has no way out when every new member must finish the steps', async () => {
    mockTenant = { name: 'Timebank Global', settings: { onboarding_enabled: true, onboarding_mandatory: true } };

    const view = render(<OnboardingScreen />);
    await waitFor(() => expect(view.getByText('Welcome to Timebank Global!')).toBeTruthy());

    expect(view.queryByTestId('onboarding-skip-for-now')).toBeNull();
  });

  it("lets Android's Back button leave optional steps from the first one", async () => {
    mockTenant = { name: 'Timebank Global', settings: { onboarding_enabled: true, onboarding_mandatory: false } };
    type BackPress = () => boolean | null | undefined;
    const handlers: BackPress[] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler);
      return { remove: () => { const at = handlers.indexOf(handler); if (at >= 0) handlers.splice(at, 1); } };
    });
    try {
      const view = render(<OnboardingScreen />);
      await waitFor(() => expect(view.getByText('Welcome to Timebank Global!')).toBeTruthy());

      let handled: boolean | null | undefined = false;
      act(() => { handled = handlers[handlers.length - 1]?.(); });

      expect(handled).toBe(true);
      expect(mockReplace).toHaveBeenCalledWith('/(tabs)/home');
    } finally {
      spy.mockRestore();
    }
  });
});
