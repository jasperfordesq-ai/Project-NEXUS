// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        title: 'AI Chat',
        page_title: 'AI Assistant',
        header_title: 'AI Assistant',
        header_subtitle: 'Powered by AI',
        input_placeholder: 'Ask me anything...',
        input_aria: 'Message',
        send_aria: 'Send message',
        empty_title: 'AI Assistant',
        empty_description: 'Ask me anything about timebanking, your account, or this community.',
        try_asking: 'Try asking...',
        starter_q1: 'What time credits do I have and how can I use them?',
        starter_q2: 'What skills are community members currently offering?',
        starter_q3: 'How does timebanking work?',
        starter_q4: 'What upcoming events are happening?',
        starter_q5: 'How do I create a listing to offer my skills?',
        error_connection: 'Failed to connect to the AI service. Please check your connection and try again.',
        error_label: 'Error',
        typing_aria: 'AI is typing',
        timeout: 'The response is taking too long. Please try again.',
        disclaimer: 'AI responses may not always be accurate. Verify important information.',
        new_conversation_aria: 'Start new conversation',
        limits_left_today: opts ? `${String(opts.count ?? 0)} left today` : '0 left today',
        messages_region: 'Messages',
        you: 'You',
        'feedback.label': 'Was this helpful?',
        'feedback.upLabel': 'Mark response helpful',
        'feedback.downLabel': 'Mark response not helpful',
        'feedback.noteTitle': 'What went wrong?',
        'feedback.noteDescription': 'Add a short note to help improve future answers.',
        'feedback.notePlaceholder': 'Tell us what was missing or wrong',
        'feedback.submitNote': 'Send note',
        'feedback.skipNote': 'Skip',
        'tool_results.label': 'Results',
        'tool_results.fallbackTitle': 'Result',
        'tool_results.open': opts ? `Open ${String(opts.title ?? '')}` : 'Open result',
        'tool_results.type.listing': 'Listing',
        'common:back': 'Back',
      };
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
  }),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { first_name: 'Jasper', last_name: 'Ford', avatar_url: null },
    displayName: 'Jasper Ford',
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Text, TextInput, View } = require('react-native');

  const Button = ({
    accessibilityLabel,
    children,
    onPress,
  }: {
    accessibilityLabel?: string;
    children: React.ReactNode;
    onPress?: () => void;
  }) => (
    <Text accessibilityLabel={accessibilityLabel} onPress={onPress}>{children}</Text>
  );
  Button.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;

  const Card = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Card.Body = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;

  const Chip = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Chip.Label = ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>;

  const HeroInput = React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => (
    <TextInput ref={ref} {...props} />
  ));

  return {
    Button,
    Card,
    Chip,
    FieldError: ({ children }: { children?: React.ReactNode }) => <Text>{children}</Text>,
    Input: HeroInput,
    Label: ({ children }: { children?: React.ReactNode }) => <Text>{children}</Text>,
    Spinner: () => null,
    Surface: ({ children }: { children?: React.ReactNode }) => <View>{children}</View>,
    TextField: ({ children }: { children?: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock('@/lib/api/chat', () => ({
  getChatStarters: jest.fn().mockResolvedValue({ starters: [] }),
  sendChatMessage: jest.fn().mockResolvedValue({
    data: {
      conversation_id: 'conv-1',
      message: {
        id: 'msg-2',
          role: 'assistant',
          content: 'Hello!',
          created_at: new Date().toISOString(),
          trace_id: 101,
          message_id: 202,
          tool_invocations: [
          {
            name: 'search_listings',
            arguments: {},
            ok: true,
            summary: 'Found listings',
            card_type: 'listing',
            results: [
              {
                id: 12,
                title: 'Garden help',
                location: 'Community garden',
                excerpt: 'Help with raised beds.',
                url: 'https://app.project-nexus.ie/exchanges/12',
              },
            ],
          },
        ],
      },
    },
  }),
  submitChatFeedback: jest.fn().mockResolvedValue({ data: { recorded: true, feedback: 'up' } }),
}));

jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/BottomSheet', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return ({ visible, title, children }: { visible: boolean; title?: string; children?: React.ReactNode }) => {
    if (!visible) return null;
    return (
      <View accessibilityLabel={title}>
        <Text>{title}</Text>
        {children}
      </View>
    );
  };
});

import ChatScreen from './chat';
import { submitChatFeedback } from '@/lib/api/chat';

describe('ChatScreen', () => {
  it('renders the chat screen without crashing', () => {
    const { toJSON } = render(<ChatScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the message text input', () => {
    const { getByPlaceholderText } = render(<ChatScreen />);
    expect(getByPlaceholderText('Ask me anything...')).toBeTruthy();
  });

  it('renders the send button', () => {
    const { getByLabelText } = render(<ChatScreen />);
    expect(getByLabelText('Send message')).toBeTruthy();
  });

  it('renders the assistant header and disclaimer text', () => {
    const { getAllByText, getByText } = render(<ChatScreen />);
    expect(getAllByText('AI Assistant').length).toBeGreaterThanOrEqual(1);
    expect(getByText('Powered by AI')).toBeTruthy();
    expect(getByText('AI responses may not always be accurate. Verify important information.')).toBeTruthy();
  });

  it('renders the empty state and starter prompts when no messages exist', () => {
    const { getByText } = render(<ChatScreen />);
    expect(getByText('Ask me anything about timebanking, your account, or this community.')).toBeTruthy();
    expect(getByText('Try asking...')).toBeTruthy();
    expect(getByText('How does timebanking work?')).toBeTruthy();
  });

  it('renders AI tool result cards from assistant responses', async () => {
    const { getByLabelText, getByPlaceholderText, findByText } = render(<ChatScreen />);

    fireEvent.changeText(getByPlaceholderText('Ask me anything...'), 'Find gardening offers');
    fireEvent.press(getByLabelText('Send message'));

    expect(await findByText('Garden help')).toBeTruthy();
    expect(await findByText('Community garden')).toBeTruthy();
    await waitFor(() => {
      expect(getByLabelText('Open Garden help')).toBeTruthy();
    });
  });

  it('submits feedback for assistant responses', async () => {
    const { getByLabelText, getByPlaceholderText, findByText } = render(<ChatScreen />);

    fireEvent.changeText(getByPlaceholderText('Ask me anything...'), 'Find gardening offers');
    fireEvent.press(getByLabelText('Send message'));

    expect(await findByText('Hello!')).toBeTruthy();
    fireEvent.press(getByLabelText('Mark response helpful'));

    await waitFor(() => {
      expect(submitChatFeedback).toHaveBeenCalledWith({
        trace_id: 101,
        message_id: 202,
        feedback: 'up',
      });
    });
  });

  it('submits an optional note after negative feedback', async () => {
    const { getByLabelText, getByPlaceholderText, findByText } = render(<ChatScreen />);

    fireEvent.changeText(getByPlaceholderText('Ask me anything...'), 'Find gardening offers');
    fireEvent.press(getByLabelText('Send message'));

    expect(await findByText('Hello!')).toBeTruthy();
    fireEvent.press(getByLabelText('Mark response not helpful'));

    await waitFor(() => {
      expect(submitChatFeedback).toHaveBeenCalledWith({
        trace_id: 101,
        message_id: 202,
        feedback: 'down',
      });
    });

    expect(await findByText('What went wrong?')).toBeTruthy();
    fireEvent.changeText(getByPlaceholderText('Tell us what was missing or wrong'), 'It missed the local context.');
    fireEvent.press(getByLabelText('Send note'));

    await waitFor(() => {
      expect(submitChatFeedback).toHaveBeenCalledWith({
        trace_id: 101,
        message_id: 202,
        feedback: 'down',
        note: 'It missed the local context.',
      });
    });
  });
});
