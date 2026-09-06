// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockUsePaginatedApi = jest.fn();
const mockRefresh = jest.fn();
const mockMarkRead = jest.fn().mockResolvedValue({});
const mockMarkReadBatch = jest.fn().mockResolvedValue({ data: { updated: 1 } });
const mockSendFederationMessage = jest.fn().mockResolvedValue({ data: { id: 202 } });
const mockTranslateFederationMessage = jest.fn().mockResolvedValue({ data: { translated_text: 'Could we coordinate this across communities? (translated)' } });
const mockGetFederationMembers = jest.fn();
let mockSearchParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'directory.messages.eyebrow': 'Federated inbox',
        'directory.messages.title': 'Federated Messages',
        'directory.messages.subtitle': 'Message members in trusted partner communities.',
        'directory.messages.unknownSender': 'Unknown sender',
        'directory.messages.emptyForPartnerTitle': 'No messages with this partner yet',
        'directory.messages.emptyForPartnerDescription': 'Start from a profile, or clear the filter.',
        'directory.messages.unreadCount': `${String(opts?.count ?? 0)} unread`,
        'directory.messages.delivered': 'Delivered',
        'directory.messages.threadEyebrow': 'Federated conversation',
        'directory.messages.backToInbox': 'Back to inbox',
        'directory.messages.translate': 'Translate',
        'directory.messages.showOriginal': 'Show original',
        'directory.messages.translatedLabel': 'Translated',
        'directory.messages.translateFailed': 'Translation is unavailable right now.',
        'directory.messages.reply': 'Reply',
        'directory.messages.replyPlaceholder': 'Write a federated reply...',
        'directory.messages.sendReply': 'Send reply',
        'directory.messages.composeEyebrow': 'New federated message',
        'directory.messages.loadingRecipient': 'Loading recipient...',
        'directory.messages.recipientFallback': 'Federated member',
        'directory.messages.noRecipient': 'Choose a federated member before sending a message.',
        'directory.messages.recipientSearch': 'Find a recipient',
        'directory.messages.recipientSearchPlaceholder': 'Search federated members...',
        'directory.messages.selectRecipient': `Message ${String(opts?.name ?? '')}`,
        'directory.messages.changeRecipient': 'Change recipient',
        'directory.messages.noRecipientsFound': 'No federated members found.',
        'directory.messages.recipientSearchFailed': "We couldn't search for members just now.",
        'directory.messages.recipientSearchRetry': 'Try again',
        'directory.messages.subject': 'Subject',
        'directory.messages.subjectPlaceholder': 'Add a short subject',
        'directory.messages.body': 'Message',
        'directory.messages.bodyPlaceholder': 'Write your message...',
        'directory.messages.send': 'Send message',
        'directory.messages.sentTitle': 'Message sent',
        'directory.messages.sentDescription': `Your message to ${String(opts?.name ?? '')} has been delivered.`,
        'directory.messages.sendFailedTitle': 'Message not sent',
        'directory.messages.sendFailedDescription': 'Please try again.',
        'directory.messages.federated': 'Federated',
        'directory.resultsCount': `${String(opts?.count ?? 0)} results`,
        'directory.unknownCommunity': 'Partner community',
        'common:back': 'Back',
      };
      if (key === 'directory.messages.openThread') return `Open thread with ${String(opts?.name ?? '')}`;
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: (feature: string) => feature === 'message_translation' }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    error: '#e53e3e',
    success: '#22c55e',
  }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

jest.mock('@/lib/api/federation', () => ({
  getFederationEvents: jest.fn(),
  getFederationGroups: jest.fn(),
  getFederationListings: jest.fn(),
  getFederationMembers: (...args: unknown[]) => mockGetFederationMembers(...args),
  getFederationMessages: jest.fn(),
  getFederationPartners: jest.fn(),
  getFederationSettings: jest.fn(),
  getFederationMember: jest.fn(),
  markFederationMessageRead: (...args: unknown[]) => mockMarkRead(...args),
  markFederationMessagesReadBatch: (...args: unknown[]) => mockMarkReadBatch(...args),
  sendFederationMessage: (...args: unknown[]) => mockSendFederationMessage(...args),
  translateFederationMessage: (...args: unknown[]) => mockTranslateFederationMessage(...args),
  updateFederationSettings: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');

  const Button = ({
    children,
    onPress,
    accessibilityLabel,
    isDisabled,
  }: {
    children: React.ReactNode;
    onPress?: () => void;
    accessibilityLabel?: string;
    isDisabled?: boolean;
  }) => (
    <Pressable accessibilityLabel={accessibilityLabel} onPress={isDisabled ? undefined : onPress}>
      <View>{children}</View>
    </Pressable>
  );
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;

  const Card = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Card.Body = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;

  const Chip = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Chip.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;

  return {
    Button,
    Card,
    Chip,
    Spinner: () => null,
    Surface: ({ children }: { children?: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/EmptyState', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return function EmptyState({ title, subtitle }: { title?: string; subtitle?: string }) {
    return (
      <View>
        {title ? <Text>{title}</Text> : null}
        {subtitle ? <Text>{subtitle}</Text> : null}
      </View>
    );
  };
});
jest.mock('@/components/ui/Input', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  return React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => (
    <TextInput ref={ref} {...props} />
  ));
});
jest.mock('@/components/ui/Toggle', () => 'View');

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

import FederationMessagesScreen from './federation-messages';

const message = {
  id: 101,
  subject: 'Shared project',
  body: 'Could we coordinate this across communities?',
  direction: 'inbound' as const,
  status: 'unread' as const,
  read_at: null,
  created_at: '2026-05-01T12:00:00Z',
  sender: {
    id: 272,
    name: 'Katherine',
    avatar: null,
    tenant_id: 5,
    tenant_name: 'Cork Timebank',
  },
  receiver: {
    id: 1,
    name: 'Jasper',
    avatar: null,
    tenant_id: 2,
    tenant_name: 'hOUR Timebank',
  },
};

const otherPartnerMessage = {
  ...message,
  id: 102,
  body: 'Different community message',
  sender: {
    id: 311,
    name: 'Brendan',
    avatar: null,
    tenant_id: 6,
    tenant_name: 'Galway Timebank',
  },
};

const partnerFilters = [
  {
    id: 5,
    name: 'Cork Timebank',
    slug: 'cork-timebank',
    description: null,
    logo: null,
    member_count: 20,
    location: 'Cork',
    website: null,
    connected_since: '2026-01-01T00:00:00Z',
  },
  {
    id: 6,
    name: 'Galway Timebank',
    slug: 'galway-timebank',
    description: null,
    logo: null,
    member_count: 18,
    location: 'Galway',
    website: null,
    connected_since: '2026-01-01T00:00:00Z',
  },
];

beforeEach(() => {
  mockSearchParams = {};
  mockRefresh.mockClear();
  mockMarkRead.mockClear();
  mockMarkReadBatch.mockClear();
  mockSendFederationMessage.mockClear();
  mockTranslateFederationMessage.mockClear();
  mockGetFederationMembers.mockReset();
  mockSendFederationMessage.mockResolvedValue({ data: { id: 202 } });
  mockTranslateFederationMessage.mockResolvedValue({ data: { translated_text: 'Could we coordinate this across communities? (translated)' } });
  mockGetFederationMembers.mockResolvedValue({ data: [] });
  mockUseApi.mockImplementation((_fetcher: unknown, deps?: unknown[]) => {
    if (Array.isArray(deps) && deps.length === 0) {
      return {
        data: { data: partnerFilters },
        isLoading: false,
        error: null,
        refresh: jest.fn(),
      };
    }
    return {
      data: { data: [message] },
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    };
  });
  mockUsePaginatedApi.mockReturnValue({
    items: [],
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    loadMore: jest.fn(),
    refresh: jest.fn(),
  });
});

describe('FederationMessagesScreen', () => {
  it('filters partner deep links to matching message threads', () => {
    mockSearchParams = { partner_id: '5' };
    mockUseApi.mockImplementation((_fetcher: unknown, deps?: unknown[]) => {
      if (Array.isArray(deps) && deps.length === 0) {
        return {
          data: { data: partnerFilters },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        };
      }
      return {
        data: { data: [message, otherPartnerMessage] },
        isLoading: false,
        error: null,
        refresh: mockRefresh,
      };
    });

    const { getByText, queryByText } = render(<FederationMessagesScreen />);

    expect(getByText('Katherine')).toBeTruthy();
    expect(queryByText('Brendan')).toBeNull();
  });

  it('shows a partner-specific empty state when a deep-linked inbox has no matching thread', () => {
    mockSearchParams = { partner_id: '6' };

    const { getByText } = render(<FederationMessagesScreen />);

    expect(getByText('No messages with this partner yet')).toBeTruthy();
    expect(getByText('Start from a profile, or clear the filter.')).toBeTruthy();
  });

  it('opens message cards as usable federated threads and sends replies to the partner', async () => {
    const { getByLabelText, getByPlaceholderText, getByText } = render(<FederationMessagesScreen />);

    fireEvent.press(getByLabelText('Open thread with Katherine'));

    expect(getByText('Federated conversation')).toBeTruthy();
    expect(getByText('Could we coordinate this across communities?')).toBeTruthy();

    await waitFor(() => {
      expect(mockMarkReadBatch).toHaveBeenCalledWith([101]);
    });

    fireEvent.changeText(getByPlaceholderText('Write a federated reply...'), 'Yes, let us coordinate.');
    fireEvent.press(getByText('Send reply'));

    await waitFor(() => {
      expect(mockSendFederationMessage).toHaveBeenCalledWith({
        receiver_id: 272,
        receiver_tenant_id: 5,
        subject: 'Shared project',
        body: 'Yes, let us coordinate.',
        reference_message_id: 101,
      });
    });
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('uses a translated fallback when a federated message partner has a blank name', () => {
    const blankNameMessage = {
      ...message,
      sender: {
        ...message.sender,
        name: '   ',
      },
    };
    mockUseApi.mockImplementation((_fetcher: unknown, deps?: unknown[]) => {
      if (Array.isArray(deps) && deps.length === 0) {
        return {
          data: { data: partnerFilters },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        };
      }
      return {
        data: { data: [blankNameMessage] },
        isLoading: false,
        error: null,
        refresh: mockRefresh,
      };
    });

    const { getByLabelText, getByText } = render(<FederationMessagesScreen />);

    expect(getByLabelText('Open thread with Unknown sender')).toBeTruthy();
    expect(getByText('Unknown sender')).toBeTruthy();

    fireEvent.press(getByLabelText('Open thread with Unknown sender'));

    expect(getByText('Federated conversation')).toBeTruthy();
    expect(getByText('Unknown sender')).toBeTruthy();
  });

  it('translates inbound federated messages and can restore the original', async () => {
    const { getByLabelText, getByText, queryByText } = render(<FederationMessagesScreen />);

    fireEvent.press(getByLabelText('Open thread with Katherine'));
    fireEvent.press(getByText('Translate'));

    await waitFor(() => {
      expect(mockTranslateFederationMessage).toHaveBeenCalledWith(101, 'en');
      expect(getByText('Could we coordinate this across communities? (translated)')).toBeTruthy();
    });

    expect(getByText('Translated')).toBeTruthy();

    fireEvent.press(getByText('Show original'));

    expect(getByText('Could we coordinate this across communities?')).toBeTruthy();
    expect(queryByText('Could we coordinate this across communities? (translated)')).toBeNull();
  });

  it('opens a sent compose deep link as a federated thread', async () => {
    mockSearchParams = { compose: 'true', to_user: '272', to_tenant: '5', name: 'Katherine' };
    const sentMessage = {
      ...message,
      id: 202,
      subject: 'Shared project',
      body: 'Let us coordinate this.',
      direction: 'outbound' as const,
      status: 'delivered' as const,
      sender: message.receiver,
      receiver: message.sender,
    };
    mockSendFederationMessage.mockResolvedValueOnce({ data: sentMessage });
    mockUseApi.mockImplementation((_fetcher: unknown, deps?: unknown[]) => {
      if (Array.isArray(deps) && deps[0] === '272') {
        return {
          data: {
            data: {
              id: 272,
              name: 'Katherine',
              avatar: null,
              tenant_id: 5,
              tenant_name: 'Cork Timebank',
            },
          },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
        error: null,
        refresh: mockRefresh,
      };
    });

    const { getByPlaceholderText, getByText } = render(<FederationMessagesScreen />);

    expect(getByText('New federated message')).toBeTruthy();

    fireEvent.changeText(getByPlaceholderText('Add a short subject'), 'Shared project');
    fireEvent.changeText(getByPlaceholderText('Write your message...'), 'Let us coordinate this.');
    fireEvent.press(getByText('Send message'));

    await waitFor(() => {
      expect(mockSendFederationMessage).toHaveBeenCalledWith({
        receiver_id: '272',
        receiver_tenant_id: '5',
        subject: 'Shared project',
        body: 'Let us coordinate this.',
      });
    });
    expect(getByText('Federated conversation')).toBeTruthy();
    expect(getByText('Let us coordinate this.')).toBeTruthy();
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('searches federated members when composing without a deep-linked recipient', async () => {
    mockSearchParams = { compose: 'true' };
    const sentMessage = {
      ...message,
      id: 203,
      subject: 'Shared project',
      body: 'Could we coordinate?',
      direction: 'outbound' as const,
      status: 'delivered' as const,
      sender: message.receiver,
      receiver: message.sender,
    };
    mockSendFederationMessage.mockResolvedValueOnce({ data: sentMessage });
    mockGetFederationMembers.mockResolvedValueOnce({
      data: [{
        id: 272,
        name: 'Katherine',
        avatar: null,
        tenant_id: 5,
        tenant_name: 'Cork Timebank',
      }],
    });
    mockUseApi.mockImplementation(() => ({
      data: { data: [] },
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    }));

    const { getByLabelText, getByPlaceholderText, getByText } = render(<FederationMessagesScreen />);

    fireEvent.changeText(getByPlaceholderText('Search federated members...'), 'Kath');

    await waitFor(() => {
      expect(mockGetFederationMembers).toHaveBeenCalledWith({ q: 'Kath', limit: '8' });
      expect(getByText('Katherine')).toBeTruthy();
    });

    fireEvent.press(getByLabelText('Message Katherine'));
    fireEvent.changeText(getByPlaceholderText('Add a short subject'), 'Shared project');
    fireEvent.changeText(getByPlaceholderText('Write your message...'), 'Could we coordinate?');
    fireEvent.press(getByText('Send message'));

    await waitFor(() => {
      expect(mockSendFederationMessage).toHaveBeenCalledWith({
        receiver_id: 272,
        receiver_tenant_id: 5,
        subject: 'Shared project',
        body: 'Could we coordinate?',
      });
    });
    expect(getByText('Federated conversation')).toBeTruthy();
  });

  /**
   * 🔴 A dropped recipient search left the result list empty, and the empty list renders as
   * "No federated members found." — so a network failure told the member that the person they
   * were looking for is not on the federated network at all (audit 2026-09-06).
   */
  it('says the search failed rather than that the member does not exist, and retries', async () => {
    mockSearchParams = { compose: 'true' };
    mockGetFederationMembers
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        data: [{ id: 272, name: 'Katherine', avatar: null, tenant_id: 5, tenant_name: 'Cork Timebank' }],
      });
    mockUseApi.mockImplementation(() => ({ data: { data: [] }, isLoading: false, error: null, refresh: mockRefresh }));

    const { getByPlaceholderText, getByText, queryByText } = render(<FederationMessagesScreen />);

    fireEvent.changeText(getByPlaceholderText('Search federated members...'), 'Kath');

    await waitFor(() => expect(getByText("We couldn't search for members just now.")).toBeTruthy());
    expect(queryByText('No federated members found.')).toBeNull();

    fireEvent.press(getByText('Try again'));

    await waitFor(() => expect(getByText('Katherine')).toBeTruthy());
    expect(queryByText("We couldn't search for members just now.")).toBeNull();
  });

  it('uses compose deep-link community metadata when recipient lookup is skipped', () => {
    mockSearchParams = { compose: 'true', to_user: 'ext-7-123', to_tenant: 'ext-7', name: 'External Sam', community: 'Remote partner' };
    mockUseApi.mockImplementation((_fetcher: unknown, deps?: unknown[]) => {
      if (Array.isArray(deps) && deps.length === 0) {
        return {
          data: { data: partnerFilters },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        };
      }
      return {
        data: { data: [] },
        isLoading: false,
        error: null,
        refresh: mockRefresh,
      };
    });

    const { getByText } = render(<FederationMessagesScreen />);

    expect(getByText('External Sam')).toBeTruthy();
    expect(getByText('Remote partner')).toBeTruthy();
    expect(mockUseApi).toHaveBeenCalledWith(expect.any(Function), ['ext-7-123', 'ext-7'], { enabled: false });
  });
});
