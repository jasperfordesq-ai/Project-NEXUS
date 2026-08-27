// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// --- Mocks ---

// 🔴 The spies live INSIDE the factory. Declared outside, jest's hoisting can
// evaluate the factory while they are still in the temporal dead zone, which
// assigns undefined and fails with "router.push is not a function".
jest.mock('expo-router', () => {
  const routerMock = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
  return {
    useRouter: () => routerMock,
    router: routerMock,
    useLocalSearchParams: () => ({}),
    useNavigation: () => ({ setOptions: jest.fn() }),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, string>) => {
      const map: Record<string, string> = {
        'legal:acceptance.title': 'Accept the updated terms to continue',
        'legal:acceptance.intro': 'These documents have changed since you last agreed to them.',
        'legal:acceptance.newTag': 'New',
        'legal:acceptance.updatedTag': 'Updated',
        'legal:acceptance.acceptButton': 'Accept and continue',
        'legal:acceptance.signOut': 'Sign out instead',
        'legal:acceptance.error': 'That could not be recorded. Nothing has been accepted.',
        'legal:document.versionLabel': 'Version',
        'common:errors.generic': 'Something went wrong. Please try again.',
        'common:errors.alertTitle': 'Error',
        'common:buttons.retry': 'Retry',
      };
      if (key === 'legal:acceptance.readLink') {
        return `Read ${params?.title ?? ''} in full`;
      }
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true }),
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
    error: '#e53e3e',
    success: '#22c55e',
    warning: '#f59e0b',
    info: '#3b82f6',
    errorBg: '#fef2f2',
    successBg: '#f0fdf4',
    infoBg: '#eff6ff',
    warningBg: '#fffbeb',
  }),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

const mockGetStatus = jest.fn();
const mockAcceptAll = jest.fn();

jest.mock('@/lib/api/legal', () => ({
  getLegalAcceptanceStatus: (...args: unknown[]) => mockGetStatus(...args),
  acceptAllLegalDocuments: (...args: unknown[]) => mockAcceptAll(...args),
  pendingDocuments: (response: { data?: { documents?: { acceptance_status?: string }[] } } | null) => {
    const documents = response?.data?.documents;
    if (!Array.isArray(documents)) return [];
    return documents.filter((document) => document?.acceptance_status !== 'current');
  },
}));

const mockLogout = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/context/AuthContext', () => ({
  useAuthContext: () => ({ logout: mockLogout }),
}));

const mockShowToast = jest.fn();

jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast, hide: jest.fn(), isToastVisible: false }),
}));

jest.mock('@/components/OfflineBanner', () => () => null);

// --- Tests ---

import LegalAcceptanceScreen from './legal-acceptance';

const { router } = require('expo-router') as {
  router: { push: jest.Mock; replace: jest.Mock; back: jest.Mock };
};
const mockPush = router.push;
const mockBack = router.back;

const PENDING = {
  data: {
    has_pending: true,
    documents: [
      {
        document_id: 12,
        document_type: 'terms',
        title: 'Community Terms',
        current_version_id: 91,
        current_version: '2.1',
        acceptance_status: 'outdated',
        accepted_at: '2026-01-05T00:00:00Z',
      },
      {
        document_id: 13,
        document_type: 'community_guidelines',
        title: 'Community guidelines',
        current_version_id: 44,
        current_version: '1.0',
        acceptance_status: 'not_accepted',
        accepted_at: null,
      },
    ],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetStatus.mockResolvedValue(PENDING);
  mockAcceptAll.mockResolvedValue({ data: { accepted: ['terms'], message: 'ok' } });
});

describe('LegalAcceptanceScreen', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<LegalAcceptanceScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('names every pending document', async () => {
    const { getByText } = render(<LegalAcceptanceScreen />);

    await waitFor(() => expect(getByText('Community Terms')).toBeTruthy());
    expect(getByText('Community guidelines')).toBeTruthy();
  });

  it('distinguishes a new document from an updated one', async () => {
    // 🔴 "Updated" on something the member has never seen is simply wrong.
    const { getByText } = render(<LegalAcceptanceScreen />);

    await waitFor(() => expect(getByText('New')).toBeTruthy());
    expect(getByText('Updated')).toBeTruthy();
  });

  it('offers a link to read each document in full', async () => {
    // Agreeing to a list of titles is not consent.
    const { getByText } = render(<LegalAcceptanceScreen />);

    await waitFor(() => expect(getByText('Read Community Terms in full')).toBeTruthy());
  });

  it('opens the document screen with the document type', async () => {
    const { getByText } = render(<LegalAcceptanceScreen />);

    await waitFor(() => expect(getByText('Read Community Terms in full')).toBeTruthy());
    fireEvent.press(getByText('Read Community Terms in full'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(modals)/legal-document',
      params: { type: 'terms' },
    });
  });

  it('offers a way out', async () => {
    // 🔴 "I do not accept" has to have an answer, or this screen is a trap: the
    // member can neither use the app nor leave it.
    const { getByText } = render(<LegalAcceptanceScreen />);

    await waitFor(() => expect(getByText('Sign out instead')).toBeTruthy());
  });

  it('signs the member out when they choose to', async () => {
    const { getByText } = render(<LegalAcceptanceScreen />);

    await waitFor(() => expect(getByText('Sign out instead')).toBeTruthy());
    fireEvent.press(getByText('Sign out instead'));

    await waitFor(() => expect(mockLogout).toHaveBeenCalled());
  });

  it('accepts everything and closes', async () => {
    const { getByText } = render(<LegalAcceptanceScreen />);

    await waitFor(() => expect(getByText('Community Terms')).toBeTruthy());
    fireEvent.press(getByText('Accept and continue'));

    await waitFor(() => expect(mockAcceptAll).toHaveBeenCalled());
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('never reports a failed acceptance as success', async () => {
    // 🔴 The API records acceptances in one transaction and fails the whole call if
    // any could not be written. Telling the member their agreement was recorded
    // when it may not have been is the one thing this screen must not do.
    mockAcceptAll.mockRejectedValueOnce(new Error('server said no'));
    const { getByText } = render(<LegalAcceptanceScreen />);

    await waitFor(() => expect(getByText('Community Terms')).toBeTruthy());
    mockBack.mockClear();
    fireEvent.press(getByText('Accept and continue'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('closes itself when nothing is pending', async () => {
    // The member accepted elsewhere, or arrived from a stale refusal. An empty list
    // with a button that would do nothing is worse than closing.
    mockGetStatus.mockResolvedValue({ data: { has_pending: false, documents: [] } });

    render(<LegalAcceptanceScreen />);

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('offers a retry rather than guessing when the status cannot be read', async () => {
    // 🔴 Treating a failed check as "nothing pending" would send the member back to
    // an action the platform still refuses, in a loop with no visible cause.
    mockGetStatus.mockRejectedValue(new Error('offline'));

    const { getByText } = render(<LegalAcceptanceScreen />);

    await waitFor(() => expect(getByText('Retry')).toBeTruthy());
    expect(mockBack).not.toHaveBeenCalled();
  });
});
