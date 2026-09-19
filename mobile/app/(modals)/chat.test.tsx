// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

let mockFocus: () => void | (() => void);
let mockBlur: (() => void) | undefined;
let mockUserId = 1;
let mockTenantId = 2;
let mockFirstName = 'Jasper';

jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      mockFocus = callback;
      mockBlur = callback() || undefined;
      return () => mockBlur?.();
    }, [callback]);
  },
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
  useTenant: () => ({ tenant: { id: mockTenantId }, hasFeature: () => true }),
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
    user: { id: mockUserId, tenant_id: 2, first_name: mockFirstName, last_name: 'Ford', avatar_url: null },
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
import { sendChatMessage, submitChatFeedback, type ChatResponse } from '@/lib/api/chat';

describe('ChatScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = 1;
    mockTenantId = 2;
    mockFirstName = 'Jasper';
  });

  async function openFeedbackNote() {
    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'Question');
    fireEvent.press(screen.getByLabelText('Send message'));
    await screen.findByText('Hello!');
    fireEvent.press(screen.getByLabelText('Mark response not helpful'));
    await screen.findByText('What went wrong?');
    fireEvent.changeText(screen.getByPlaceholderText('Tell us what was missing or wrong'), 'Keep this note');
    return screen;
  }

  it.each(['account', 'community'])('clears prior chat and draft on %s replacement', async (identity) => {
    const screen = await openFeedbackNote();
    fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'Private draft');
    if (identity === 'account') mockUserId = 3;
    else mockTenantId = 4;
    screen.rerender(<ChatScreen />);
    expect(screen.queryByText('Hello!')).toBeNull();
    expect(screen.queryByText('What went wrong?')).toBeNull();
    expect(screen.getByPlaceholderText('Ask me anything...').props.value).toBe('');
  });

  it('keeps the chat draft on a profile refresh for the same identity', () => {
    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'My draft');
    mockFirstName = 'Updated';
    screen.rerender(<ChatScreen />);
    expect(screen.getByPlaceholderText('Ask me anything...').props.value).toBe('My draft');
  });

  it('ignores the old account reply after replacing the account', async () => {
    let finish!: (value: ChatResponse) => void;
    jest.mocked(sendChatMessage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'Old account question');
    fireEvent.press(screen.getByLabelText('Send message'));
    mockUserId = 3;
    screen.rerender(<ChatScreen />);
    await act(async () => finish({ data: { conversation_id: 'private', message: { id: 'private', role: 'assistant', content: 'Old account answer', created_at: new Date().toISOString() } } }));
    expect(screen.queryByText('Old account answer')).toBeNull();
    fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'New account question');
    fireEvent.press(screen.getByLabelText('Send message'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenLastCalledWith('New account question', null));
  });

  it('dismisses the feedback note on departure while preserving conversation text', async () => {
    const screen = await openFeedbackNote();
    act(() => { mockBlur?.(); });
    act(() => { mockBlur = mockFocus?.() || undefined; });
    expect(screen.queryByText('What went wrong?')).toBeNull();
    expect(screen.getByText('Hello!')).toBeTruthy();
  });

  it.each([false, true])('does not show feedback UI from a previous visit (failure: %s)', async (failure) => {
    let finish!: (value: Awaited<ReturnType<typeof submitChatFeedback>>) => void;
    let reject!: (error: Error) => void;
    jest.mocked(submitChatFeedback).mockImplementationOnce(() => new Promise((resolve, fail) => { finish = resolve; reject = fail; }));
    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'Question');
    fireEvent.press(screen.getByLabelText('Send message'));
    await screen.findByText('Hello!');
    fireEvent.press(screen.getByLabelText('Mark response not helpful'));
    act(() => { mockBlur?.(); });
    act(() => { mockBlur = mockFocus?.() || undefined; });
    await act(async () => {
      if (failure) reject(new Error('offline'));
      else finish({ data: { recorded: true, feedback: 'down' } });
    });
    expect(screen.queryByText('What went wrong?')).toBeNull();
    expect(require('@/components/ui/AppToast').useAppToast().show).not.toHaveBeenCalled();
    const down = screen.UNSAFE_getAllByType(require('@/components/ui/NativeButton').Button)
      .find(node => node.props.accessibilityLabel === 'Mark response not helpful')!;
    expect(down.props.isDisabled).toBe(false);
    expect(down.props.accessibilityState.selected).toBe(!failure);
  });

  it('submits a feedback note only once before busy state renders', async () => {
    const screen = await openFeedbackNote();
    let finish!: (value: Awaited<ReturnType<typeof submitChatFeedback>>) => void;
    jest.mocked(submitChatFeedback).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const press = screen.UNSAFE_getAllByType(require('@/components/ui/NativeButton').Button)
      .find(node => node.props.accessibilityLabel === 'Send note')!.props.onPress;
    act(() => { press(); press(); });
    expect(submitChatFeedback).toHaveBeenCalledTimes(2);
    await act(async () => finish({ data: { recorded: true, feedback: 'down' } }));
  });

  it('shows a failed note save and preserves the note for retry', async () => {
    const screen = await openFeedbackNote();
    jest.mocked(submitChatFeedback).mockRejectedValueOnce(new Error('offline'));
    fireEvent.press(screen.getByLabelText('Send note'));
    await waitFor(() => expect(require('@/components/ui/AppToast').useAppToast().show).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' })));
    expect(screen.getByPlaceholderText('Tell us what was missing or wrong').props.value).toBe('Keep this note');
    fireEvent.press(screen.getByLabelText('Send note'));
    await waitFor(() => expect(screen.queryByText('What went wrong?')).toBeNull());
    expect(submitChatFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ note: 'Keep this note' }));
  });

  it.each([false, true])('keeps votes disabled after closing an in-flight note (failure: %s)', async (failure) => {
    const screen = await openFeedbackNote();
    let finish!: (value: Awaited<ReturnType<typeof submitChatFeedback>>) => void;
    let reject!: (error: Error) => void;
    jest.mocked(submitChatFeedback).mockImplementationOnce(() => new Promise((resolve, fail) => { finish = resolve; reject = fail; }));
    fireEvent.press(screen.getByLabelText('Send note'));
    fireEvent.press(screen.getByLabelText('Skip'));
    const up = screen.UNSAFE_getAllByType(require('@/components/ui/NativeButton').Button)
      .find(node => node.props.accessibilityLabel === 'Mark response helpful')!;
    expect(up.props.isDisabled).toBe(true);
    // Even a callback captured before React applies disabled state cannot race the note.
    act(() => { up.props.onPress(); });
    expect(submitChatFeedback).toHaveBeenCalledTimes(2);
    await act(async () => {
      if (failure) reject(new Error('offline'));
      else finish({ data: { recorded: true, feedback: 'down' } });
    });
    expect(screen.queryByText('What went wrong?')).toBeNull();
    expect(require('@/components/ui/AppToast').useAppToast().show).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText('Mark response not helpful'));
    await screen.findByText('What went wrong?');
    fireEvent.changeText(screen.getByPlaceholderText('Tell us what was missing or wrong'), 'Replacement note');
    expect(screen.getByPlaceholderText('Tell us what was missing or wrong').props.value).toBe('Replacement note');
  });

  it('sends only once for repeated gestures before the busy state renders', async () => {
    let finish!: (value: ChatResponse) => void;
    jest.mocked(sendChatMessage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'One question');
    const press = screen.UNSAFE_getAllByType(require('@/components/ui/NativeButton').Button)
      .find(node => node.props.accessibilityLabel === 'Send message')!.props.onPress;
    act(() => { press(); press(); });
    expect(sendChatMessage).toHaveBeenCalledTimes(1);
    await act(async () => finish({ data: { conversation_id: 'one', message: { id: 'one', role: 'assistant', content: 'One answer', created_at: new Date().toISOString() } } }));
  });

  it.each([false, true])('ignores a previous conversation response (failure: %s)', async (failure) => {
    let finish!: (value: ChatResponse) => void;
    let reject!: (error: Error) => void;
    jest.mocked(sendChatMessage).mockImplementationOnce(() => new Promise((resolve, fail) => { finish = resolve; reject = fail; }));
    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'Old question');
    fireEvent.press(screen.getByLabelText('Send message'));
    fireEvent.press(screen.getByLabelText('Start new conversation'));
    await act(async () => {
      if (failure) reject(new Error('offline'));
      else finish({ data: { conversation_id: 'old-conversation', message: { id: 'old', role: 'assistant', content: 'Old answer', created_at: new Date().toISOString() } } });
    });
    expect(screen.queryByText('Old answer')).toBeNull();
    expect(screen.queryByText('Failed to connect to the AI service. Please check your connection and try again.')).toBeNull();
    fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'New question');
    fireEvent.press(screen.getByLabelText('Send message'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenLastCalledWith('New question', null));
  });

  it('keeps a new send busy when an older conversation request finishes', async () => {
    let finishOld!: (value: ChatResponse) => void;
    let finishNew!: (value: ChatResponse) => void;
    jest.mocked(sendChatMessage)
      .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockImplementationOnce(() => new Promise(resolve => { finishNew = resolve; }));
    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'Old question');
    fireEvent.press(screen.getByLabelText('Send message'));
    fireEvent.press(screen.getByLabelText('Start new conversation'));
    fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'New question');
    fireEvent.press(screen.getByLabelText('Send message'));
    await act(async () => finishOld({ data: { conversation_id: 'old', message: { id: 'old', role: 'assistant', content: 'Old answer', created_at: new Date().toISOString() } } }));
    expect(screen.getByText('AI is typing')).toBeTruthy();
    fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'Third question');
    fireEvent.press(screen.getByLabelText('Send message'));
    expect(sendChatMessage).toHaveBeenCalledTimes(2);
    await act(async () => finishNew({ data: { conversation_id: 'new', message: { id: 'new', role: 'assistant', content: 'New answer', created_at: new Date().toISOString() } } }));
    expect(screen.getByText('New answer')).toBeTruthy();
    expect(screen.queryByText('Old answer')).toBeNull();
  });

  it('ignores a response after its visible timeout', async () => {
    jest.useFakeTimers();
    try {
      let finish!: (value: ChatResponse) => void;
      jest.mocked(sendChatMessage).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      const screen = render(<ChatScreen />);
      fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'Slow question');
      fireEvent.press(screen.getByLabelText('Send message'));
      act(() => jest.advanceTimersByTime(30_000));
      expect(screen.getByText('The response is taking too long. Please try again.')).toBeTruthy();
      await act(async () => finish({ data: { conversation_id: 'late', message: { id: 'late', role: 'assistant', content: 'Late answer', created_at: new Date().toISOString() } } }));
      expect(screen.queryByText('Late answer')).toBeNull();
      screen.unmount();
    } finally {
      jest.useRealTimers();
    }
  });

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

  it('does not open an old feedback note after starting a new conversation', async () => {
    let finish!: (value: never) => void;
    jest.mocked(submitChatFeedback).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'Question');
    fireEvent.press(screen.getByLabelText('Send message'));
    await screen.findByText('Hello!');
    fireEvent.press(screen.getByLabelText('Mark response not helpful'));
    fireEvent.press(screen.getByLabelText('Start new conversation'));
    await act(async () => finish({ data: { recorded: true, feedback: 'down' } } as never));
    expect(screen.queryByText('What went wrong?')).toBeNull();
  });

  it('serializes repeated feedback gestures before rendering the pending state', async () => {
    let finish!: (value: never) => void;
    jest.mocked(submitChatFeedback).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'Question');
    fireEvent.press(screen.getByLabelText('Send message'));
    await screen.findByText('Hello!');
    const press = screen.UNSAFE_getAllByType(require('@/components/ui/NativeButton').Button)
      .find(node => node.props.accessibilityLabel === 'Mark response helpful')!.props.onPress;
    act(() => { press(); press(); });
    expect(submitChatFeedback).toHaveBeenCalledTimes(1);
    await act(async () => finish({ data: { recorded: true, feedback: 'up' } } as never));
  });

  it('restores the previously saved vote when a replacement vote fails', async () => {
    const screen = render(<ChatScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Ask me anything...'), 'Question');
    fireEvent.press(screen.getByLabelText('Send message'));
    await screen.findByText('Hello!');
    fireEvent.press(screen.getByLabelText('Mark response helpful'));
    await act(async () => {});
    jest.mocked(submitChatFeedback).mockRejectedValueOnce(new Error('offline'));
    fireEvent.press(screen.getByLabelText('Mark response not helpful'));
    await waitFor(() => expect(screen.UNSAFE_getAllByType(require('@/components/ui/NativeButton').Button)
      .find(node => node.props.accessibilityLabel === 'Mark response helpful')!.props.accessibilityState.selected).toBe(true));
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
