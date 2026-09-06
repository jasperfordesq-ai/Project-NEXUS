// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'directory.onboarding.eyebrow': 'Federation setup',
        'directory.onboarding.title': 'Federation Setup',
        'directory.onboarding.subtitle': 'Choose what you share with partner communities.',
        'directory.onboarding.privacy': 'Profile visibility',
        'directory.onboarding.communication': 'Communication',
        'directory.onboarding.reach': 'Service reach',
        'directory.onboarding.next': 'Next',
        'directory.onboarding.finish': 'Enable federation',
        'directory.onboarding.ready': 'Ready to enable federation',
        'directory.onboarding.review': 'Review your federation setup',
        'directory.onboarding.reviewDescription': 'Confirm what partner communities can see.',
        'directory.onboarding.doLater': 'Do this later',
        'directory.onboarding.on': 'On',
        'directory.onboarding.off': 'Off',
        'directory.onboarding.failedTitle': 'Setup failed',
        'directory.onboarding.failedDescription': 'Please try again.',
        'directory.onboarding.benefits.discover.title': 'Discover partner members',
        'directory.onboarding.benefits.discover.description': 'Find people across timebanks.',
        'directory.onboarding.benefits.message.title': 'Coordinate safely',
        'directory.onboarding.benefits.message.description': 'Use cross-community messaging.',
        'directory.onboarding.benefits.exchange.title': 'Share time-credit activity',
        'directory.onboarding.benefits.exchange.description': 'Enable partner exchanges.',
        'directory.settings.profile_visible_federated.label': 'Show my profile',
        'directory.settings.profile_visible_federated.description': 'Let partner communities see your profile.',
        'directory.settings.appear_in_federated_search.label': 'Appear in search',
        'directory.settings.appear_in_federated_search.description': 'Allow partner members to discover you.',
        'directory.settings.show_skills_federated.label': 'Share skills',
        'directory.settings.show_skills_federated.description': 'Include your skills.',
        'directory.settings.show_location_federated.label': 'Share location',
        'directory.settings.show_location_federated.description': 'Show your general location.',
        'directory.settings.show_reviews_federated.label': 'Share reviews',
        'directory.settings.show_reviews_federated.description': 'Include trust signals.',
        'directory.settings.messaging_enabled_federated.label': 'Allow federation messaging',
        'directory.settings.messaging_enabled_federated.description': 'Let partner members message you.',
        'directory.settings.transactions_enabled_federated.label': 'Allow federation exchanges',
        'directory.settings.transactions_enabled_federated.description': 'Let partner members arrange exchanges.',
        'directory.settings.email_notifications.label': 'Email notifications',
        'directory.settings.email_notifications.description': 'Receive email updates.',
        'directory.settings.reach.local_only': 'Local only',
        'directory.settings.reach.remote_ok': 'Remote ok',
        'directory.settings.reach.travel_ok': 'Can travel',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    borderSubtle: '#eeeeee',
    success: '#22c55e',
    error: '#ef4444',
    onPrimary: '#ffffff',
  }),
}));

jest.mock('@/lib/api/federation', () => ({
  setupFederation: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success' },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

import FederationOnboardingRoute from './federation-onboarding';

describe('FederationOnboardingRoute', () => {
  it('renders the benefits step', () => {
    const { getAllByText, getByText } = render(<FederationOnboardingRoute />);
    expect(getAllByText('Federation Setup').length).toBeGreaterThan(0);
    expect(getByText('Discover partner members')).toBeTruthy();
  });

  it('reaches the final review step before enabling federation', () => {
    const { getByText } = render(<FederationOnboardingRoute />);
    fireEvent.press(getByText('Next'));
    fireEvent.press(getByText('Next'));
    fireEvent.press(getByText('Next'));
    expect(getByText('Review your federation setup')).toBeTruthy();
    expect(getByText('Enable federation')).toBeTruthy();
    expect(getByText('Local only')).toBeTruthy();
  });
});
