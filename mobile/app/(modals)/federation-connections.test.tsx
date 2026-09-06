// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false) },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'directory.connections.title': 'Federation Connections',
        'directory.connections.eyebrow': 'Cross-community contacts',
        'directory.connections.subtitle': 'Manage members you are connected with.',
        'directory.connections.tabs.accepted': 'Connected',
        'directory.connections.tabs.pending_received': 'Received',
        'directory.connections.tabs.pending_sent': 'Sent',
        'directory.connections.empty.accepted.title': 'No connected members yet',
        'directory.connections.empty.accepted.description': 'Browse federated members and send connection requests.',
        'directory.connections.browseMembers': 'Browse federated members',
        'directory.connections.viewProfile': opts ? `View profile for ${String(opts.name ?? '')}` : 'View profile',
        'directory.connections.status.accepted': 'Connected',
        'directory.connections.message': 'Message',
        'directory.connections.remove': 'Remove',
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
    error: '#e53e3e',
  }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/api/federation', () => ({
  acceptFederationConnection: jest.fn(),
  getFederationConnections: jest.fn(),
  rejectFederationConnection: jest.fn(),
  removeFederationConnection: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/Avatar', () => 'View');

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

import FederationConnectionsRoute from './federation-connections';

beforeEach(() => {
  mockUseApi.mockReturnValue({ data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() });
});

const connection = {
  id: 8,
  user_id: 272,
  name: 'Katherine',
  avatar_url: null,
  tenant_id: 5,
  tenant_name: 'Partner Timebank',
  status: 'accepted' as const,
  message: 'Hello from another community',
  created_at: '2026-05-01T12:00:00Z',
};

describe('FederationConnectionsRoute', () => {
  it('renders the accepted empty state with browse members action', () => {
    const { getByText } = render(<FederationConnectionsRoute />);
    expect(getByText('No connected members yet')).toBeTruthy();
    expect(getByText('Browse federated members')).toBeTruthy();
  });

  it('renders federation connection cards', () => {
    mockUseApi.mockReturnValueOnce({ data: { data: [connection] }, isLoading: false, error: null, refresh: jest.fn() });
    const { router } = require('expo-router');
    const { getByText, getByLabelText } = render(<FederationConnectionsRoute />);
    expect(getByText('Katherine')).toBeTruthy();
    expect(getByText('Partner Timebank')).toBeTruthy();
    fireEvent.press(getByLabelText('View profile for Katherine'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/federation-member',
      params: { id: '272', tenant_id: '5' },
    });

    router.push.mockClear();
    fireEvent.press(getByText('Message'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/federation-messages',
      params: { compose: 'true', to_user: '272', to_tenant: '5', name: 'Katherine', community: 'Partner Timebank' },
    });
  });
});
