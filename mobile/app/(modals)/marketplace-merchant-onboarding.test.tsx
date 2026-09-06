// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
}));

jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common:errors.alertTitle': 'Error',
        'forms.validation': 'Validation',
        'merchantOnboarding.eyebrow': 'Seller setup',
        'merchantOnboarding.title': 'Seller setup',
        'merchantOnboarding.subtitle': 'Create your seller profile.',
        'merchantOnboarding.completeTitle': 'Seller setup complete',
        'merchantOnboarding.completeSubtitle': 'Your seller profile is ready.',
        'merchantOnboarding.stepLabel': `Step ${String(opts?.step ?? '')}`,
        'merchantOnboarding.sellerType.business': 'Business',
        'merchantOnboarding.sellerType.private': 'Private',
        'merchantOnboarding.businessName': 'Business name',
        'merchantOnboarding.businessNamePlaceholder': 'Your shop or organisation',
        'merchantOnboarding.displayName': 'Display name',
        'merchantOnboarding.displayNamePlaceholder': 'How buyers see you',
        'merchantOnboarding.bio': 'Seller bio',
        'merchantOnboarding.bioPlaceholder': 'What you sell and how you help.',
        'merchantOnboarding.registration': 'Business registration',
        'merchantOnboarding.registrationPlaceholder': 'Optional registration or charity number',
        'merchantOnboarding.street': 'Street',
        'merchantOnboarding.streetPlaceholder': 'Street and number',
        'merchantOnboarding.city': 'Town or city',
        'merchantOnboarding.cityPlaceholder': 'City',
        'merchantOnboarding.postalCode': 'Postal code',
        'merchantOnboarding.postalCodePlaceholder': 'Postal code',
        'merchantOnboarding.country': 'Country',
        'merchantOnboarding.countryPlaceholder': 'Country',
        'merchantOnboarding.openingHours': 'Opening hours',
        'merchantOnboarding.days.mon': 'Monday',
        'merchantOnboarding.days.tue': 'Tuesday',
        'merchantOnboarding.days.wed': 'Wednesday',
        'merchantOnboarding.days.thu': 'Thursday',
        'merchantOnboarding.days.fri': 'Friday',
        'merchantOnboarding.days.sat': 'Saturday',
        'merchantOnboarding.days.sun': 'Sunday',
        'merchantOnboarding.open': 'Open',
        'merchantOnboarding.closed': 'Closed',
        'merchantOnboarding.openTime': 'Open time',
        'merchantOnboarding.closeTime': 'Close time',
        'merchantOnboarding.openTimePlaceholder': '09:00',
        'merchantOnboarding.closeTimePlaceholder': '18:00',
        'merchantOnboarding.next': 'Next',
        'merchantOnboarding.complete': 'Complete setup',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    border: '#d1d5db',
    error: '#dc2626',
    success: '#16a34a',
    warning: '#f59e0b',
  }),
}));
jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 9, avatar_url: '/uploads/avatar.jpg', bio: 'Community seller' },
    displayName: 'Jane Seller',
    refreshUser: jest.fn(),
  }),
}));
jest.mock('@/lib/utils/resolveImageUrl', () => ({
  resolveImageUrl: (value?: string | null) => value ?? null,
}));
jest.mock('@/lib/api/profile', () => ({
  updateAvatar: jest.fn(),
}));
jest.mock('@/lib/api/marketplace', () => ({
  completeMerchantOnboarding: jest.fn(),
  getMerchantOnboardingStatus: jest.fn(),
  saveMerchantOnboardingStep1: jest.fn(),
  saveMerchantOnboardingStep2: jest.fn(),
  saveMerchantOnboardingStep3: jest.fn(),
}));

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

import MarketplaceMerchantOnboardingRoute from './marketplace-merchant-onboarding';
import {
  getMerchantOnboardingStatus,
  saveMerchantOnboardingStep1,
  saveMerchantOnboardingStep2,
} from '@/lib/api/marketplace';

describe('MarketplaceMerchantOnboardingRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getMerchantOnboardingStatus).mockResolvedValue({
      data: { has_profile: false, onboarding_completed: false, profile: null },
    } as never);
    jest.mocked(saveMerchantOnboardingStep1).mockResolvedValue({ data: { profile: {} } } as never);
    jest.mocked(saveMerchantOnboardingStep2).mockResolvedValue({ data: { profile: {} } } as never);
  });

  it('saves editable opening hours from the location step', async () => {
    const { getAllByPlaceholderText, getAllByText, getByPlaceholderText, getByText } = render(<MarketplaceMerchantOnboardingRoute />);

    await waitFor(() => {
      expect(getByText('Seller setup')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('Your shop or organisation'), 'Nexus Shop');
    fireEvent.press(getByText('Next'));

    await waitFor(() => {
      expect(saveMerchantOnboardingStep1).toHaveBeenCalled();
      expect(getByText('Opening hours')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('Street and number'), '1 Community Lane');
    fireEvent.changeText(getByPlaceholderText('City'), 'Cork');
    fireEvent.changeText(getByPlaceholderText('Country'), 'Ireland');
    fireEvent.changeText(getAllByPlaceholderText('09:00')[0], '08:30');
    fireEvent.changeText(getAllByPlaceholderText('18:00')[0], '17:30');
    fireEvent.press(getAllByText('Closed')[0]);
    fireEvent.press(getByText('Next'));

    await waitFor(() => {
      expect(saveMerchantOnboardingStep2).toHaveBeenCalledWith({
        business_address: {
          street: '1 Community Lane',
          city: 'Cork',
          postal_code: '',
          country: 'Ireland',
        },
        opening_hours: expect.objectContaining({
          mon: { open: '08:30', close: '17:30' },
          sat: { open: '09:00', close: '18:00' },
          sun: null,
        }),
      });
    });
  });
});
