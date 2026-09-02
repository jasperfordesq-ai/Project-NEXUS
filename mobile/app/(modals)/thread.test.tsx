// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { FlatList, KeyboardAvoidingView, Platform } from 'react-native';

// --- Mocks ---

let mockThreadSearchParams: Record<string, string> = { id: '5', name: 'Alice' };
const mockRouterPush = jest.fn();
const mockLaunchImageLibraryAsync = jest.fn();
const mockRequestMediaLibraryPermissionsAsync = jest.fn();
const mockAudioRecording = {
  stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
  getURI: jest.fn(() => 'file:///tmp/voice.m4a'),
};
const mockCreateRecordingAsync = jest.fn().mockResolvedValue({ recording: mockAudioRecording });
const mockRequestAudioPermissionsAsync = jest.fn().mockResolvedValue({ granted: true });
const mockSetAudioModeAsync = jest.fn().mockResolvedValue(undefined);
type MockThreadMessage = {
  id: number;
  body: string;
  sender: { id: number; name: string; avatar_url: null };
  sender_id?: number;
  created_at: string;
  is_own: boolean;
  is_voice: boolean;
  audio_url: null;
  reactions: Record<string, number>;
  is_read: boolean;
};
let mockRealtimeCallback: ((message: MockThreadMessage) => void) | null = null;
const thumbsUpReaction = '\u{1F44D}';

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args), back: jest.fn() },
  useLocalSearchParams: () => mockThreadSearchParams,
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'thread.invalidConversation': 'Invalid conversation.',
        'thread.loadError': 'Failed to load messages.',
        'thread.inputPlaceholder': 'Type a message...',
        'thread.send': 'Send',
        'thread.voiceMessage': 'Voice message',
        'thread.voice.record': 'Record voice message',
        'thread.voice.recording': 'Recording voice message',
        'thread.voice.ready': 'Voice message ready',
        'thread.voice.stop': 'Stop',
        'thread.voice.cancel': 'Cancel voice message',
        'thread.voice.send': 'Send voice message',
        'thread.voice.permissionTitle': 'Microphone access needed',
        'thread.voice.permissionMessage': 'Allow microphone access to record voice messages.',
        'thread.voice.failedTitle': 'Voice message failed',
        'thread.voice.startFailed': 'Could not start recording. Please try again.',
        'thread.voice.stopFailed': 'Could not save this recording. Please try again.',
        'thread.voice.sendFailed': 'Voice message could not be sent. Please try again.',
        'thread.sendFailed': 'Message not sent.',
        'thread.goBack': 'Go back',
        'thread.messageCount': '2 messages',
        'thread.messagingRestrictedTitle': 'Messaging paused',
        'thread.messagingRestrictedContact': 'Please contact your community team before sending more messages.',
        'thread.messageOptions': 'Message options',
        'thread.attachments.add': 'Add attachment',
        'thread.attachments.title': 'Add attachment',
        'thread.attachments.photoLibrary': 'Photo library',
        'thread.attachments.remove': `Remove ${String(options?.name ?? '')}`,
        'thread.attachments.removeLabel': 'Remove',
        'thread.attachments.open': `Open ${String(options?.name ?? '')}`,
        'thread.attachments.file': 'Attachment',
        'thread.attachments.permissionTitle': 'Photo access needed',
        'thread.attachments.permissionMessage': 'Allow photo access to attach images.',
        'thread.attachmentName': `Attachment ${String(options?.index ?? '')}`,
        'thread.edit': 'Edit',
        'thread.editing': 'Editing message',
        'thread.saveEdit': 'Save edit',
        'thread.cancelEdit': 'Cancel edit',
        'thread.edited': 'Edited',
        'thread.delete': 'Delete',
        'thread.deleteTitle': 'Delete message',
        'thread.deleteForMe': 'Delete for me',
        'thread.deleteForEveryone': 'Delete for everyone',
        'thread.deleteSelfConfirm': 'Remove this message from your view?',
        'thread.deleteEveryoneConfirm': 'Delete this message for everyone?',
        'thread.deletedMessage': 'This message was deleted.',
        'unknownMember': 'Community member',
        'thread.reactWith': `React with ${String(options?.emoji ?? '')}`,
        'thread.toggleReaction': `Toggle ${String(options?.emoji ?? '')} reaction`,
        'context.regarding': 'Regarding',
        'context.open': 'Open context',
        'context.title': `${String(options?.type ?? '')} #${String(options?.id ?? '')}`,
        'context.type.listing': 'Listing',
        'context.type.event': 'Event',
        'context.type.job': 'Job',
        'context.type.volunteering': 'Volunteering',
        'errors.sendFailed': 'Send failed',
        'errors.editFailedTitle': 'Edit failed',
        'errors.editFailed': 'Could not update this message.',
        'errors.deleteFailedTitle': 'Delete failed',
        'errors.deleteFailed': 'Could not delete this message.',
        'errors.reactionFailedTitle': 'Reaction failed',
        'errors.reactionFailed': 'Could not update that reaction.',
        'common:buttons.retry': 'Retry',
        'common:labels.you': 'You',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
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

const mockRefreshCounts = jest.fn();

jest.mock('@/lib/context/RealtimeContext', () => ({
  useRealtimeContext: () => ({
    subscribeToMessages: jest.fn((_threadId: number, callback: (message: MockThreadMessage) => void) => {
      mockRealtimeCallback = callback;
      return jest.fn();
    }),
    refreshCounts: (...args: unknown[]) => mockRefreshCounts(...args),
  }),
}));

const mockMarkConversationRead = jest.fn().mockResolvedValue({ data: { marked_read: 1 } });
const mockToggleMessageReaction = jest.fn().mockResolvedValue({ data: { action: 'added', emoji: thumbsUpReaction, message_id: 1 } });
const mockGetMessagingRestrictionStatus = jest.fn().mockResolvedValue({
  data: { messaging_disabled: false, under_monitoring: false, restriction_reason: null },
});
const mockUpdateMessage = jest.fn().mockResolvedValue({ data: { id: 2, body: 'Edited reply', is_edited: true } });
const mockDeleteMessage = jest.fn().mockResolvedValue({ data: { success: true } });
const mockSendMessageWithAttachments = jest.fn().mockResolvedValue({
  data: {
    id: 100,
    body: 'Photo update',
    sender: { id: 1, name: 'Me', avatar_url: null },
    created_at: '2026-03-10T10:03:00Z',
    is_own: true,
    is_voice: false,
    audio_url: null,
    reactions: {},
    is_read: false,
    attachments: [{ id: 8, name: 'photo.jpg', url: 'https://example.test/photo.jpg', type: 'image', size: 2048 }],
  },
});
const mockSendVoiceMessage = jest.fn().mockResolvedValue({
  data: {
    id: 101,
    body: '',
    sender: { id: 1, name: 'Me', avatar_url: null },
    created_at: '2026-03-10T10:04:00Z',
    is_own: true,
    is_voice: true,
    audio_url: 'https://example.test/voice.m4a',
    reactions: {},
    is_read: false,
  },
});

jest.mock('@/lib/api/messages', () => ({
  getThread: jest.fn(),
  getOrCreateThread: jest.fn(),
  getMessagingRestrictionStatus: (...args: unknown[]) => mockGetMessagingRestrictionStatus(...args),
  markConversationRead: (...args: unknown[]) => mockMarkConversationRead(...args),
  sendMessage: jest.fn().mockResolvedValue({ data: { id: 99 } }),
  sendMessageWithAttachments: (...args: unknown[]) => mockSendMessageWithAttachments(...args),
  sendVoiceMessage: (...args: unknown[]) => mockSendVoiceMessage(...args),
  toggleMessageReaction: (...args: unknown[]) => mockToggleMessageReaction(...args),
  updateMessage: (...args: unknown[]) => mockUpdateMessage(...args),
  deleteMessage: (...args: unknown[]) => mockDeleteMessage(...args),
  displayName: (user: any, fallback = 'Unknown') => user?.name ?? fallback,
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) => mockRequestMediaLibraryPermissionsAsync(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
}));

jest.mock('expo-av', () => ({
  Audio: {
    requestPermissionsAsync: (...args: unknown[]) => mockRequestAudioPermissionsAsync(...args),
    setAudioModeAsync: (...args: unknown[]) => mockSetAudioModeAsync(...args),
    Recording: {
      createAsync: (...args: unknown[]) => mockCreateRecordingAsync(...args),
    },
    RecordingOptionsPresets: { HIGH_QUALITY: 'HIGH_QUALITY' },
  },
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Test User' }, isAuthenticated: true }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/Avatar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ name }: { name: string }) => React.createElement(View, { accessibilityLabel: `${name} avatar` });
});
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/ActionSheet', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return ({ visible, title, actions }: { visible: boolean; title?: string; actions: { label: string; onPress: () => void }[] }) => {
    if (!visible) return null;
    return (
      <View accessibilityLabel={title}>
        {actions.map((action) => (
          <Pressable key={action.label} accessibilityLabel={action.label} onPress={action.onPress}>
            <Text>{action.label}</Text>
          </Pressable>
        ))}
      </View>
    );
  };
});
jest.mock('@/components/OfflineBanner', () => () => null);
jest.mock('@/components/VoiceMessageBubble', () => 'View');

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

// Auto-confirm: triggering a destructive action runs onConfirm immediately,
// mirroring the old Alert.alert destructive-button simulation.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (opts: { onConfirm: () => void | Promise<void> }) => {
      void opts.onConfirm();
    },
    confirmDialog: null,
  }),
}));

// --- Tests ---

import ThreadScreen from './thread';
import { useAppToast } from '@/components/ui/AppToast';
import { sendMessage } from '@/lib/api/messages';

const mockMessages = [
  {
    id: 1,
    body: 'Hello there!',
    sender: { id: 5, name: 'Alice', avatar_url: null },
    created_at: '2026-03-10T10:00:00Z',
    is_own: false,
    is_voice: false,
    audio_url: null,
    reactions: {},
    is_read: true,
  },
  {
    id: 2,
    body: 'Hi back!',
    sender: { id: 1, name: 'Me', avatar_url: null },
    created_at: '2026-03-10T10:01:00Z',
    is_own: true,
    is_voice: false,
    audio_url: null,
    reactions: {},
    is_read: true,
  },
];

beforeEach(() => {
  mockThreadSearchParams = { id: '5', name: 'Alice' };
  mockRouterPush.mockClear();
  mockRealtimeCallback = null;
  mockMarkConversationRead.mockClear();
  mockToggleMessageReaction.mockClear();
  mockGetMessagingRestrictionStatus.mockClear();
  mockUpdateMessage.mockClear();
  mockDeleteMessage.mockClear();
  mockSendMessageWithAttachments.mockClear();
  mockSendVoiceMessage.mockClear();
  mockAudioRecording.stopAndUnloadAsync.mockClear();
  mockAudioRecording.getURI.mockClear();
  mockCreateRecordingAsync.mockClear();
  mockRequestAudioPermissionsAsync.mockClear();
  mockSetAudioModeAsync.mockClear();
  mockCreateRecordingAsync.mockResolvedValue({ recording: mockAudioRecording });
  mockRequestAudioPermissionsAsync.mockResolvedValue({ granted: true });
  mockSetAudioModeAsync.mockResolvedValue(undefined);
  mockRequestMediaLibraryPermissionsAsync.mockReset();
  mockLaunchImageLibraryAsync.mockReset();
  mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
  mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: [] });
  mockGetMessagingRestrictionStatus.mockResolvedValue({
    data: { messaging_disabled: false, under_monitoring: false, restriction_reason: null },
  });
  mockUpdateMessage.mockResolvedValue({ data: { id: 2, body: 'Edited reply', is_edited: true } });
  mockDeleteMessage.mockResolvedValue({ data: { success: true } });
  mockToggleMessageReaction.mockResolvedValue({ data: { action: 'added', emoji: thumbsUpReaction, message_id: 1 } });
  (sendMessage as jest.Mock).mockClear();
  // Restored per test: one case below makes it REJECT, and a leaked rejection would fail
  // every later send silently.
  (sendMessage as jest.Mock).mockResolvedValue({ data: { id: 99 } });
  mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });
  mockRefreshCounts.mockClear();
  jest.restoreAllMocks();
});

describe('ThreadScreen', () => {
  const originalPlatformOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => originalPlatformOS });
  });

  it('renders without crashing when data is loaded', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockMessages },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { toJSON } = render(<ThreadScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('🔴 refreshes the unread badge after the thread loads', () => {
    // Regression: the message badge came back at every login. Fetching a thread
    // marks it read server-side, but nothing told the badge, so it kept showing
    // a count for messages the member had already read. A forced refresh is
    // required — the throttled call is a no-op this soon after the seed.
    mockUseApi.mockReturnValue({
      data: { data: mockMessages },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    render(<ThreadScreen />);

    expect(mockRefreshCounts).toHaveBeenCalledWith(true);
  });

  it('does not refresh the badge when the thread failed to load', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: new Error('nope'), refresh: jest.fn() });

    render(<ThreadScreen />);

    expect(mockRefreshCounts).not.toHaveBeenCalled();
  });

  it('renders the message input and send button', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockMessages },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByLabelText, getByPlaceholderText } = render(<ThreadScreen />);
    expect(getByPlaceholderText('Type a message...')).toBeTruthy();
    expect(getByLabelText('Send')).toBeTruthy();
  });

  it('keeps the native chat frame full height with an explicit background', () => {
    mockUseApi.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByTestId, UNSAFE_getByType } = render(<ThreadScreen />);
    const screen = getByTestId('thread-screen');
    const keyboardFrame = UNSAFE_getByType(KeyboardAvoidingView);
    const messageList = UNSAFE_getByType(FlatList);

    expect(screen.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(keyboardFrame.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(messageList.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(messageList.props.contentContainerStyle).toEqual(expect.objectContaining({
      flexGrow: 1,
      backgroundColor: '#ffffff',
    }));
  });

  it('uses Android height keyboard avoidance so the composer is resized instead of panned under the header', () => {
    Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
    mockUseApi.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { UNSAFE_getByType } = render(<ThreadScreen />);
    const keyboardFrame = UNSAFE_getByType(KeyboardAvoidingView);

    expect(keyboardFrame.props.behavior).toBe('height');
    expect(keyboardFrame.props.keyboardVerticalOffset).toBe(0);
  });

  it('renders message bubbles when messages are loaded', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockMessages },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<ThreadScreen />);
    expect(getByText('Hello there!')).toBeTruthy();
    expect(getByText('Hi back!')).toBeTruthy();
  });

  it('uses the translated member fallback for unnamed inbound senders', () => {
    mockUseApi.mockReturnValue({
      data: {
        data: [{
          ...mockMessages[0],
          sender: { id: 5, name: null, first_name: null, last_name: null, organization_name: null, avatar_url: null },
        }],
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByLabelText } = render(<ThreadScreen />);

    expect(getByLabelText('Community member avatar')).toBeTruthy();
  });

  it('renders loading state without crashing', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: true, error: null, refresh: jest.fn() });

    expect(() => render(<ThreadScreen />)).not.toThrow();
  });

  it('renders error state with retry when load fails', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: 'Network error', refresh: jest.fn() });

    const { getByText } = render(<ThreadScreen />);
    expect(getByText('Failed to load messages.')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
  });

  it('sends replies to the other user from conversation metadata', async () => {
    mockUseApi.mockReturnValue({
      data: {
        data: mockMessages,
        meta: {
          conversation: {
            other_user: { id: 42, name: 'Alice' },
          },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByLabelText, getByPlaceholderText } = render(<ThreadScreen />);

    fireEvent.changeText(getByPlaceholderText('Type a message...'), 'Thanks Alice');
    fireEvent.press(getByLabelText('Send'));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(42, 'Thanks Alice');
    });
  });

  /**
   * 🔴 The legal-acceptance gate is attached per WRITE route, so sending a message is one of
   * the actions it refuses. `lib/api/client.ts` opens the acceptance screen centrally for that
   * code — so before this, the member got the screen explaining it AND a red "Message failed
   * to send. Tap to retry." on top. Measured on a device 2026-08-22. Retrying changes nothing
   * until they accept, and two explanations of one event is worse than one.
   */
  it('🔴 does not report a legal-acceptance refusal as a failed send', async () => {
    const { ApiResponseError } = jest.requireActual('@/lib/api/client');
    mockUseApi.mockReturnValue({
      data: {
        data: mockMessages,
        meta: { conversation: { other_user: { id: 42, name: 'Alice' } } },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    (sendMessage as jest.Mock).mockRejectedValue(
      new ApiResponseError(403, 'Acceptance required', undefined, 'LEGAL_ACCEPTANCE_REQUIRED'),
    );

    const { getByPlaceholderText, getByLabelText } = render(<ThreadScreen />);

    fireEvent.changeText(getByPlaceholderText('Type a message...'), 'Legal gate walk');
    fireEvent.press(getByLabelText('Send'));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(useAppToast().show).not.toHaveBeenCalled();
    // The body is restored so accepting and pressing send again loses nothing.
    expect(getByPlaceholderText('Type a message...').props.value).toBe('Legal gate walk');
  });

  it('still reports an ordinary send failure', async () => {
    const { ApiResponseError } = jest.requireActual('@/lib/api/client');
    mockUseApi.mockReturnValue({
      data: {
        data: mockMessages,
        meta: { conversation: { other_user: { id: 42, name: 'Alice' } } },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    (sendMessage as jest.Mock).mockRejectedValue(new ApiResponseError(500, 'Server error'));

    const { getByPlaceholderText, getByLabelText } = render(<ThreadScreen />);

    fireEvent.changeText(getByPlaceholderText('Type a message...'), 'Ordinary failure');
    fireEvent.press(getByLabelText('Send'));

    await waitFor(() => expect(useAppToast().show).toHaveBeenCalled());
  });

  it('sends contextual fields for a new conversation from deep-link params', async () => {
    mockThreadSearchParams = {
      recipientId: '42',
      name: 'Alice',
      listing: '9',
      context_type: 'job',
      context_id: '44',
    };
    mockUseApi.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByLabelText, getByPlaceholderText } = render(<ThreadScreen />);

    fireEvent.changeText(getByPlaceholderText('Type a message...'), 'I can help with this.');
    fireEvent.press(getByLabelText('Send'));

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith(42, 'I can help with this.', {
        listing_id: 9,
        context_type: 'job',
        context_id: 44,
      });
    });
  });

  it('attaches images and sends them through the multipart message helper', async () => {
    mockLaunchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{
        uri: 'file:///tmp/photo.jpg',
        fileName: 'photo.jpg',
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        fileSize: 2048,
      }],
    });
    mockUseApi.mockReturnValue({
      data: {
        data: mockMessages,
        meta: {
          conversation: {
            other_user: { id: 42, name: 'Alice' },
          },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByLabelText, getByPlaceholderText, getByText } = render(<ThreadScreen />);

    fireEvent.press(getByLabelText('Add attachment'));
    fireEvent.press(getByLabelText('Photo library'));

    await waitFor(() => {
      expect(mockRequestMediaLibraryPermissionsAsync).toHaveBeenCalled();
      expect(getByText('photo.jpg')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('Type a message...'), 'Photo update');
    fireEvent.press(getByLabelText('Send'));

    await waitFor(() => {
      expect(mockSendMessageWithAttachments).toHaveBeenCalledWith(42, 'Photo update', expect.arrayContaining([
        expect.objectContaining({ uri: 'file:///tmp/photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg' }),
      ]), undefined);
    });
  });

  it('renders message attachments with open actions', () => {
    mockUseApi.mockReturnValue({
      data: {
        data: [{
          ...mockMessages[0],
          attachments: [{ id: 8, name: 'photo.jpg', url: 'https://example.test/photo.jpg', type: 'image', size: 2048 }],
        }],
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByLabelText } = render(<ThreadScreen />);

    expect(getByLabelText('Open photo.jpg')).toBeTruthy();
  });

  it('records and sends a voice message through the voice upload helper', async () => {
    mockUseApi.mockReturnValue({
      data: {
        data: mockMessages,
        meta: {
          conversation: {
            other_user: { id: 42, name: 'Alice' },
          },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByLabelText, getByText } = render(<ThreadScreen />);

    fireEvent.press(getByLabelText('Record voice message'));

    await waitFor(() => {
      expect(mockRequestAudioPermissionsAsync).toHaveBeenCalled();
      expect(mockSetAudioModeAsync).toHaveBeenCalledWith(expect.objectContaining({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
      }));
      expect(mockCreateRecordingAsync).toHaveBeenCalledWith('HIGH_QUALITY');
      expect(getByText('Recording voice message')).toBeTruthy();
    });

    fireEvent.press(getByLabelText('Stop'));

    await waitFor(() => {
      expect(mockAudioRecording.stopAndUnloadAsync).toHaveBeenCalled();
      expect(getByText('Voice message ready')).toBeTruthy();
    });

    fireEvent.press(getByLabelText('Send voice message'));

    await waitFor(() => {
      /**
       * 🔴 The fourth argument is the recorded length in seconds, and it must be sent.
       * `MessagesController::sendVoice()` used to pass a literal 0 to the uploader, which
       * stores `max(1, duration)` — so every voice message on the platform was recorded as
       * one second long and shown to the recipient as "0:00" (measured on a device
       * 2026-08-22). It is 0 here because this test never lets the recording timer tick;
       * `lib/api/messages.test.ts` covers the real values, including that 0 means the field
       * is omitted so the server's own floor applies.
       */
      expect(mockSendVoiceMessage).toHaveBeenCalledWith(42, 'file:///tmp/voice.m4a', undefined, 0);
    });
  });

  it('shows messaging restriction notice and blocks sends when disabled', async () => {
    mockGetMessagingRestrictionStatus.mockResolvedValue({
      data: { messaging_disabled: true, under_monitoring: true, restriction_reason: 'Safety review' },
    });
    mockUseApi.mockReturnValue({
      data: {
        data: mockMessages,
        meta: {
          conversation: {
            other_user: { id: 42, name: 'Alice' },
          },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByLabelText, getByPlaceholderText, getByText } = render(<ThreadScreen />);

    await waitFor(() => {
      expect(getByText('Messaging paused')).toBeTruthy();
      expect(getByText('Please contact your community team before sending more messages.')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('Type a message...'), 'Can I send?');
    fireEvent.press(getByLabelText('Send'));

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('edits an own text message through message options', async () => {
    mockUseApi.mockReturnValue({
      data: { data: mockMessages },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getAllByLabelText, getByDisplayValue, getByLabelText, getByText } = render(<ThreadScreen />);

    fireEvent.press(getAllByLabelText('Message options')[1]);
    fireEvent.press(getByLabelText('Edit'));

    expect(getByText('Editing message')).toBeTruthy();
    fireEvent.changeText(getByDisplayValue('Hi back!'), 'Edited reply');
    fireEvent.press(getByLabelText('Save edit'));

    await waitFor(() => {
      expect(mockUpdateMessage).toHaveBeenCalledWith(2, 'Edited reply');
      expect(getByText('Edited reply')).toBeTruthy();
      expect(getByText('Edited')).toBeTruthy();
    });
  });

  it('deletes a message for the current user through message options', async () => {
    mockUseApi.mockReturnValue({
      data: { data: mockMessages },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getAllByLabelText, queryByText } = render(<ThreadScreen />);

    fireEvent.press(getAllByLabelText('Message options')[0]);
    await act(async () => {
      fireEvent.press(getAllByLabelText('Delete for me')[0]);
    });

    await waitFor(() => {
      expect(mockDeleteMessage).toHaveBeenCalledWith(1, 'self');
      expect(queryByText('Hello there!')).toBeNull();
    });
  });

  it('shows supported context cards that open native detail routes', () => {
    mockThreadSearchParams = {
      recipientId: '42',
      name: 'Alice',
      context_type: 'job',
      context_id: '44',
    };
    mockUseApi.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByLabelText, getByText } = render(<ThreadScreen />);

    expect(getByText('Regarding')).toBeTruthy();
    expect(getByText('Job #44')).toBeTruthy();

    fireEvent.press(getByLabelText('Open context'));

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/job-detail',
      params: { id: '44' },
    });
  });

  it('shows context cards from loaded message metadata for existing conversations', () => {
    mockUseApi.mockReturnValue({
      data: {
        data: [
          { ...mockMessages[0], context_type: 'event', context_id: 12 },
          mockMessages[1],
        ],
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByLabelText, getByText } = render(<ThreadScreen />);

    expect(getByText('Regarding')).toBeTruthy();
    expect(getByText('Event #12')).toBeTruthy();

    fireEvent.press(getByLabelText('Open context'));

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/event-detail',
      params: { id: '12' },
    });
  });

  it('marks realtime inbound messages as read while the thread is open', async () => {
    mockUseApi.mockReturnValue({
      data: { data: mockMessages },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<ThreadScreen />);

    expect(mockRealtimeCallback).toBeTruthy();
    act(() => {
      mockRealtimeCallback?.({
        id: 3,
        body: 'Fresh update',
        sender: { id: 5, name: 'Alice', avatar_url: null },
        sender_id: 5,
        created_at: '2026-03-10T10:02:00Z',
        is_own: false,
        is_voice: false,
        audio_url: null,
        reactions: {},
        is_read: false,
      });
    });

    await waitFor(() => {
      expect(getByText('Fresh update')).toBeTruthy();
      expect(mockMarkConversationRead).toHaveBeenCalledWith(5);
    });
  });

  it('toggles message reactions and updates the visible count', async () => {
    mockUseApi.mockReturnValue({
      data: { data: mockMessages },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getAllByLabelText, getByText } = render(<ThreadScreen />);

    fireEvent.press(getAllByLabelText(`React with ${thumbsUpReaction}`)[0]);

    await waitFor(() => {
      expect(mockToggleMessageReaction).toHaveBeenCalledWith(1, thumbsUpReaction);
      expect(getByText('1')).toBeTruthy();
    });
  });
});
