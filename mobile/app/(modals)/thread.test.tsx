// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, FlatList, KeyboardAvoidingView, Platform } from 'react-native';

// --- Mocks ---

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));
jest.mock('@/lib/messageOperation', () => ({
  reserveMessageOperation: jest.fn().mockResolvedValue({ storageKey: 'saved-message', key: 'message-operation-123', createdAt: 1 }),
  completeMessageOperation: jest.fn().mockResolvedValue(undefined),
}));
const mockLoadCreationDraft = jest.fn().mockResolvedValue(null);
const mockSaveCreationDraft = jest.fn().mockResolvedValue(true);
const mockClearCreationDraft = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/creationDraftStore', () => ({
  loadCreationDraft: (...args: unknown[]) => mockLoadCreationDraft(...args),
  saveCreationDraft: (...args: unknown[]) => mockSaveCreationDraft(...args),
  clearCreationDraft: (...args: unknown[]) => mockClearCreationDraft(...args),
}));
const mockRetainMessageDraftMedia = jest.fn().mockResolvedValue('file:///documents/message-drafts-v1/photo.jpg');
const mockExistingMessageDraftMedia = jest.fn().mockResolvedValue(true);
const mockRemoveMessageDraftMedia = jest.fn().mockResolvedValue(undefined);
const mockRemoveMessageDraftMediaBatch = jest.fn().mockResolvedValue(undefined);
const mockRemoveTransientMessageMedia = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/messageDraftMedia', () => ({
  retainMessageDraftMedia: (...args: unknown[]) => mockRetainMessageDraftMedia(...args),
  existingMessageDraftMedia: (...args: unknown[]) => mockExistingMessageDraftMedia(...args),
  removeMessageDraftMedia: (...args: unknown[]) => mockRemoveMessageDraftMedia(...args),
  removeMessageDraftMediaBatch: (...args: unknown[]) => mockRemoveMessageDraftMediaBatch(...args),
  removeTransientMessageMedia: (...args: unknown[]) => mockRemoveTransientMessageMedia(...args),
  isManagedMessageDraftMedia: (uri: string) => uri.includes('/message-drafts-v1/'),
}));

let mockThreadSearchParams: Record<string, string> = { id: '5', name: 'Alice' };
const mockRouterPush = jest.fn();
const mockLaunchImageLibraryAsync = jest.fn();
const mockRequestMediaLibraryPermissionsAsync = jest.fn();
const mockAudioRecording = {
  stop: jest.fn().mockResolvedValue(undefined),
  uri: 'file:///tmp/voice.m4a',
  record: jest.fn(),
  prepareToRecordAsync: (...args: unknown[]) => mockCreateRecordingAsync(...args),
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
let mockRealtimeCallback: ((message: MockThreadMessage) => boolean | void) | null = null;
const thumbsUpReaction = '\u{1F44D}';

/*
  Captured so a test can put the screen behind another one and watch what changes.

  🔴 An ARRAY, and the tests use the FIRST entry. `AppTopBar` also registers a focus
  effect (its Android back handler, audit F10) and it renders inside this screen, so a
  single slot ends up holding the top bar's callback rather than the thread's — and the
  test would then be driving the wrong component's focus.
*/
const mockFocusCallbacks: (() => (() => void) | void)[] = [];
const mockFocusCallback = {
  get current(): (() => (() => void) | void) | undefined { return mockFocusCallbacks[0]; },
};

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn((cb: () => (() => void) | void) => { mockFocusCallbacks.push(cb); }),
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
        'thread.voice.draftStorageTitle': 'Voice note kept for this session',
        'thread.voice.draftStorageWarning': 'The voice note is ready, but it may not survive if the app closes.',
        'thread.sendFailed': 'Message not sent.',
        'thread.goBack': 'Go back',
        'thread.messageCount': '2 messages',
        'thread.messagingRestrictedTitle': 'Messaging paused',
        'thread.messagingRestrictedContact': 'Please contact your community team before sending more messages.',
        'thread.messageOptions': 'Message options',
        'thread.messageActions': 'Message actions',
        'thread.loadEarlier': 'Load earlier messages',
        'thread.loadEarlierFailed': 'Earlier messages could not be loaded.',
        'thread.attachments.add': 'Add attachment',
        'thread.attachments.title': 'Add attachment',
        'thread.attachments.photoLibrary': 'Photo library',
        'thread.attachments.remove': `Remove ${String(options?.name ?? '')}`,
        'thread.attachments.uploading': `Sending photos… ${String(options?.percent ?? '')}%`,
        'thread.attachments.cancelUpload': 'Cancel upload',
        'thread.attachments.draftStorageTitle': 'Photo kept for this session',
        'thread.attachments.draftStorageWarning': 'The photo is attached, but it may not survive if the app closes.',
        'thread.attachments.removeLabel': 'Remove',
        'thread.attachments.open': `Open ${String(options?.name ?? '')}`,
        'thread.attachments.file': 'Attachment',
        'thread.attachments.permissionTitle': 'Photo access needed',
        'thread.attachments.permissionMessage': 'Allow photo access to attach images.',
        'thread.attachmentName': `Attachment ${String(options?.index ?? '')}`,
        'thread.edit': 'Edit',
        'thread.editUnsentDraft': 'Edit unsent draft',
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
        'draftStorage.title': 'Draft not protected',
        'draftStorage.message': 'This draft could not be saved securely.',
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

const mockRefreshCounts = jest.fn();
let mockRecoveryVersion = 0;

jest.mock('@/lib/context/RealtimeContext', () => ({
  useRealtimeContext: () => ({
    recoveryVersion: mockRecoveryVersion,
    subscribeToMessages: jest.fn((_threadId: number, callback: (message: MockThreadMessage) => boolean | void) => {
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
    audio_duration: 38,
    reactions: {},
    is_read: false,
  },
});

const mockGetThread = jest.fn();

jest.mock('@/lib/api/messages', () => ({
  getThread: (...args: unknown[]) => mockGetThread(...args),
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

jest.mock('expo-audio', () => ({
  AudioModule: { requestRecordingPermissionsAsync: (...args: unknown[]) => mockRequestAudioPermissionsAsync(...args) },
  setAudioModeAsync: (...args: unknown[]) => mockSetAudioModeAsync(...args),
  useAudioRecorder: () => mockAudioRecording,
  RecordingPresets: { HIGH_QUALITY: 'HIGH_QUALITY' },
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
jest.mock('@/components/VoiceMessageBubble', () => {
  const React = require('react');
  const { View } = require('react-native');
  return (props: { durationMs?: number }) =>
    React.createElement(View, { testID: `voice-bubble-${props.durationMs ?? 'none'}` });
});

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
  {
    // id 7, not 3: the realtime test pushes id 3 and the thread dedupes by id.
    id: 7,
    body: '',
    sender: { id: 1, name: 'Me', avatar_url: null },
    created_at: '2026-03-10T10:02:00Z',
    is_own: true,
    is_voice: true,
    audio_url: 'https://example.test/voice.m4a',
    // The server stores the length; the client type carries it since the 2026-09-06 audit.
    audio_duration: 38,
    reactions: {},
    is_read: true,
  },
];

beforeEach(() => {
  mockRecoveryVersion = 0;
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  mockThreadSearchParams = { id: '5', name: 'Alice' };
  mockRouterPush.mockClear();
  mockRealtimeCallback = null;
  mockFocusCallbacks.length = 0;
  mockMarkConversationRead.mockClear();
  mockToggleMessageReaction.mockClear();
  mockGetMessagingRestrictionStatus.mockClear();
  mockUpdateMessage.mockClear();
  mockDeleteMessage.mockClear();
  mockSendMessageWithAttachments.mockReset().mockResolvedValue({
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
  mockSendVoiceMessage.mockClear();
  mockAudioRecording.stop.mockClear();
  mockAudioRecording.record.mockClear();
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
  mockLoadCreationDraft.mockReset().mockResolvedValue(null);
  mockSaveCreationDraft.mockReset().mockResolvedValue(true);
  mockClearCreationDraft.mockReset().mockResolvedValue(true);
  mockRetainMessageDraftMedia.mockReset().mockImplementation((_uri: string, filename: string) => Promise.resolve(
    filename.startsWith('voice-')
      ? 'file:///documents/message-drafts-v1/voice.m4a'
      : 'file:///documents/message-drafts-v1/photo.jpg',
  ));
  mockExistingMessageDraftMedia.mockReset().mockResolvedValue(true);
  mockRemoveMessageDraftMedia.mockReset().mockResolvedValue(undefined);
  mockRemoveMessageDraftMediaBatch.mockReset().mockResolvedValue(undefined);
  mockRemoveTransientMessageMedia.mockReset().mockResolvedValue(undefined);
  (useAppToast().show as jest.Mock).mockClear();
});

describe('ThreadScreen', () => {
  const originalPlatformOS = Platform.OS;

  it('clears a recovered legacy draft at its original key after successful send', async () => {
    const legacyContext = 'recipient:5:listing:0:context:none:0';
    mockLoadCreationDraft.mockImplementation(async (scope: { contextId: string }) => (
      scope.contextId === legacyContext ? { text: 'Legacy inbox draft' } : null
    ));
    mockUseApi.mockReturnValue({ data: { data: mockMessages, meta: { conversation: { other_user: { id: 5 } } } }, isLoading: false, error: null, refresh: jest.fn() });
    const view = render(<ThreadScreen />);
    await waitFor(() => expect(view.getByPlaceholderText('Type a message...').props.value).toBe('Legacy inbox draft'));
    fireEvent.press(view.getByLabelText('Send'));
    await waitFor(() => expect(mockClearCreationDraft).toHaveBeenCalledWith(expect.objectContaining({ contextId: legacyContext })));
    expect(mockSaveCreationDraft).toHaveBeenCalledWith(expect.objectContaining({ contextId: legacyContext }), expect.objectContaining({ text: 'Legacy inbox draft' }));
    view.unmount();
  });

  it('uses the same new plain draft scope from inbox and deep-link entry', async () => {
    mockThreadSearchParams = { recipientId: '5', name: 'Alice' };
    const view = render(<ThreadScreen />);
    await act(async () => {});
    fireEvent.changeText(view.getByPlaceholderText('Type a message...'), 'Shared entry draft');
    await waitFor(() => expect(mockSaveCreationDraft).toHaveBeenCalledWith(
      expect.objectContaining({ contextId: 'conversation:5' }),
      expect.objectContaining({ text: 'Shared entry draft' }),
    ));
    view.unmount();
  });

  it('defers recovery reads while the app is backgrounded', async () => {
    Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
    let onState: ((state: 'active' | 'background' | 'inactive' | 'unknown' | 'extension') => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
      onState = handler;
      return { remove: jest.fn() };
    });
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({ data: { data: mockMessages }, isLoading: false, error: null, refresh });
    const view = render(<ThreadScreen />);
    mockRecoveryVersion = 1;
    view.rerender(<ThreadScreen />);
    expect(refresh).not.toHaveBeenCalled();
    act(() => onState?.('active'));
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {});
    view.unmount();
  });

  it('reloads the open conversation when the member returns to the app, even with no realtime reconnect', async () => {
    let onState: ((state: 'active' | 'background' | 'inactive' | 'unknown' | 'extension') => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, handler) => {
      onState = handler;
      return { remove: jest.fn() };
    });
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({ data: { data: mockMessages }, isLoading: false, error: null, refresh });
    const view = render(<ThreadScreen />);
    await act(async () => {});
    refresh.mockClear();
    // Realtime may be down or slow to resubscribe; messages sent meanwhile must still appear.
    act(() => onState?.('background'));
    act(() => onState?.('active'));
    expect(refresh).toHaveBeenCalledTimes(1);
    // An inactive blip (notification shade, system dialog) is not a return from the background.
    act(() => onState?.('inactive'));
    act(() => onState?.('active'));
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => {});
    view.unmount();
  });

  it('refetches missed messages on recovery but defers a covered conversation until focus returns', async () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({ data: { data: mockMessages }, isLoading: false, error: null, refresh });
    const view = render(<ThreadScreen />);
    let blur: (() => void) | void;
    act(() => { blur = mockFocusCallback.current?.(); });
    mockRecoveryVersion = 1;
    view.rerender(<ThreadScreen />);
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => blur?.());
    mockRecoveryVersion = 2;
    view.rerender(<ThreadScreen />);
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => { mockFocusCallback.current?.(); });
    expect(refresh).toHaveBeenCalledTimes(2);
    await act(async () => {});
    view.unmount();
  });

  it('follows late message layout until the reader deliberately scrolls into history', async () => {
    const scrollToEnd = jest.spyOn(FlatList.prototype, 'scrollToOffset').mockImplementation(() => {});
    mockUseApi.mockReturnValue({ data: { data: mockMessages }, isLoading: false, error: null, refresh: jest.fn() });
    const view = render(<ThreadScreen />);
    await act(async () => {});
    const list = view.UNSAFE_getByType(FlatList);
    // Native measurement can report the initial top position before all bubbles lay out.
    const atTop = { nativeEvent: { contentOffset: { y: 0 }, contentSize: { height: 2000 }, layoutMeasurement: { height: 600 } } };
    act(() => list.props.onScroll(atTop));
    scrollToEnd.mockClear();
    act(() => list.props.onContentSizeChange(400, 2400));
    expect(scrollToEnd).toHaveBeenCalledWith({ offset: 2400, animated: false });

    // Deliberate history reading must survive later image/content measurements.
    act(() => list.props.onScrollBeginDrag());
    act(() => list.props.onScroll(atTop));
    scrollToEnd.mockClear();
    act(() => list.props.onContentSizeChange(400, 2800));
    expect(scrollToEnd).not.toHaveBeenCalled();
    view.unmount();
  });

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
      expect(sendMessage).toHaveBeenCalledWith(42, 'Thanks Alice', {}, 'message-operation-123');
    });
  });

  it('restores an encrypted text draft for the current account, community and conversation', async () => {
    mockLoadCreationDraft.mockResolvedValueOnce({ text: 'D62 restored message draft' });
    mockUseApi.mockReturnValue({
      data: { data: mockMessages }, isLoading: false, error: null, refresh: jest.fn(),
    });

    const screen = render(<ThreadScreen />);

    await waitFor(() => expect(screen.getByPlaceholderText('Type a message...').props.value).toBe('D62 restored message draft'));
    expect(mockLoadCreationDraft).toHaveBeenCalledWith({
      kind: 'message',
      tenantId: 'hour-timebank',
      userId: 1,
      contextId: 'conversation:5',
    });
  });

  it('does not overwrite text entered while an encrypted draft is still loading', async () => {
    let finishLoad!: (draft: { text: string }) => void;
    mockLoadCreationDraft.mockImplementationOnce(() => new Promise((resolve) => { finishLoad = resolve; }));
    mockUseApi.mockReturnValue({
      data: { data: mockMessages }, isLoading: false, error: null, refresh: jest.fn(),
    });
    const screen = render(<ThreadScreen />);

    fireEvent.changeText(screen.getByPlaceholderText('Type a message...'), 'Newer text wins');
    await act(async () => { finishLoad({ text: 'Older saved text' }); });

    expect(screen.getByPlaceholderText('Type a message...').props.value).toBe('Newer text wins');
    await waitFor(() => expect(mockSaveCreationDraft).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'message', contextId: 'conversation:5' }),
      { text: 'Newer text wins', attachments: [], failedDrafts: [], voice: null },
    ));
  });

  it('autosaves text to the exact conversation and clears it after confirmed send', async () => {
    mockUseApi.mockReturnValue({
      data: { data: mockMessages, meta: { conversation: { other_user: { id: 42, name: 'Alice' } } } },
      isLoading: false, error: null, refresh: jest.fn(),
    });
    const screen = render(<ThreadScreen />);
    const scope = { kind: 'message', tenantId: 'hour-timebank', userId: 1, contextId: 'conversation:5' };

    fireEvent.changeText(screen.getByPlaceholderText('Type a message...'), 'Persist this exact reply');
    await waitFor(() => expect(mockSaveCreationDraft).toHaveBeenCalledWith(
      scope,
      { text: 'Persist this exact reply', attachments: [], failedDrafts: [], voice: null },
    ));
    fireEvent.press(screen.getByLabelText('Send'));

    await waitFor(() => expect(mockClearCreationDraft).toHaveBeenCalledWith(scope));
  });

  it('sends one message when Send is tapped twice before busy state renders', async () => {
    let finish!: (value: { data: { id: number } }) => void;
    (sendMessage as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    mockUseApi.mockReturnValue({
      data: { data: mockMessages, meta: { conversation: { other_user: { id: 42, name: 'Alice' } } } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
    const screen = render(<ThreadScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Type a message...'), 'Only once');
    const send = screen.getByLabelText('Send');

    fireEvent.press(send);
    fireEvent.press(send);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    finish({ data: { id: 100 } });
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
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
    await waitFor(() => expect(getByPlaceholderText('Type a message...').props.value).toBe('Legal gate walk'));
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
      }, 'message-operation-123');
    });
  });

  it('retains a failed photo with its own draft while the next text draft is being written', async () => {
    let rejectUpload!: (reason: Error) => void;
    mockSendMessageWithAttachments.mockImplementation(() => new Promise((_resolve, reject) => { rejectUpload = reject; }));
    const screen = await attachAPhoto();
    fireEvent.changeText(screen.getByPlaceholderText('Type a message...'), 'Photo caption');
    fireEvent.press(screen.getByLabelText('Send'));
    await waitFor(() => expect(mockSendMessageWithAttachments).toHaveBeenCalled());
    fireEvent.changeText(screen.getByPlaceholderText('Type a message...'), 'Next text draft');
    await act(async () => rejectUpload(new Error('Upload disconnected')));
    expect(screen.getByPlaceholderText('Type a message...').props.value).toBe('Next text draft');
    expect(screen.queryByLabelText('Remove photo.jpg')).toBeNull();
    fireEvent.press(screen.getByText('Edit unsent draft'));
    expect(screen.getByPlaceholderText('Type a message...').props.value).toBe('Photo caption');
    expect(screen.getByLabelText('Remove photo.jpg')).toBeTruthy();
    fireEvent.press(screen.getByText('Edit unsent draft'));
    expect(screen.getByPlaceholderText('Type a message...').props.value).toBe('Next text draft');
    expect(screen.queryByLabelText('Remove photo.jpg')).toBeNull();
  });

  it('restores and cycles multiple failed drafts without hiding photo-only content', async () => {
    mockLoadCreationDraft.mockResolvedValueOnce({
      text: 'Current draft',
      failedDrafts: [
        {
          body: '',
          attachments: [{
            id: 'failed-photo',
            uri: 'file:///documents/message-drafts-v1/failed-photo.jpg',
            name: 'failed-photo.jpg',
            mimeType: 'image/jpeg',
          }],
        },
        { body: 'Second failed draft', attachments: [] },
      ],
    });
    mockUseApi.mockReturnValue({ data: { data: mockMessages }, isLoading: false, error: null, refresh: jest.fn() });
    const screen = render(<ThreadScreen />);

    await waitFor(() => expect(screen.getByText('failed-photo.jpg')).toBeTruthy());
    fireEvent.press(screen.getByText('Edit unsent draft'));
    expect(screen.getByPlaceholderText('Type a message...').props.value).toBe('');
    expect(screen.getByLabelText('Remove failed-photo.jpg')).toBeTruthy();

    fireEvent.press(screen.getByText('Edit unsent draft'));
    expect(screen.getByPlaceholderText('Type a message...').props.value).toBe('Second failed draft');
    expect(screen.queryByLabelText('Remove failed-photo.jpg')).toBeNull();
    await waitFor(() => expect(mockSaveCreationDraft).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'message', contextId: 'conversation:5' }),
      expect.objectContaining({
        text: 'Second failed draft',
        failedDrafts: [
          { body: 'Current draft', attachments: [] },
          expect.objectContaining({ attachments: [expect.objectContaining({ name: 'failed-photo.jpg' })] }),
        ],
      }),
    ));
  });

  it('keeps a visible warning until encrypted message-draft autosave recovers', async () => {
    mockSaveCreationDraft.mockImplementation(async (_scope, draft: { text?: string }) => draft.text !== 'Storage-pressure draft');
    const screen = render(<ThreadScreen />);
    act(() => { mockFocusCallback.current?.(); });
    await waitFor(() => expect(mockLoadCreationDraft).toHaveBeenCalled());

    fireEvent.changeText(screen.getByPlaceholderText('Type a message...'), 'Storage-pressure draft');
    await waitFor(() => expect(screen.getByTestId('message-draft-storage-warning')).toBeTruthy());

    fireEvent.changeText(screen.getByPlaceholderText('Type a message...'), 'Storage-pressure draft retry');
    await waitFor(() => expect(mockSaveCreationDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ text: 'Storage-pressure draft retry' }),
    ));
    await waitFor(() => expect(screen.queryByTestId('message-draft-storage-warning')).toBeNull());
  });


  it('preserves a composer draft and photo when editing an older message', async () => {
    const screen = await attachAPhoto();
    fireEvent.changeText(screen.getByPlaceholderText('Type a message...'), 'Unsent photo caption');
    fireEvent.press(screen.getAllByLabelText('Message actions')[1]);
    fireEvent.press(screen.getAllByLabelText('Message options')[0]);
    fireEvent.press(screen.getByLabelText('Edit'));
    expect(screen.queryByLabelText('Remove photo.jpg')).toBeNull();
    fireEvent.press(screen.getByLabelText('Cancel edit'));
    fireEvent.press(screen.getByText('Edit unsent draft'));
    expect(screen.getByPlaceholderText('Type a message...').props.value).toBe('Unsent photo caption');
    expect(screen.getByLabelText('Remove photo.jpg')).toBeTruthy();
  });

  it('does not open the photo library when permission completes after departure', async () => {
    let finish!: (value: { granted: boolean }) => void;
    mockRequestMediaLibraryPermissionsAsync.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const screen = render(<ThreadScreen />);
    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Photo library'));
    screen.unmount();
    await act(async () => finish({ granted: true }));
    expect(mockLaunchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it('prevents overlapping photo permission requests', async () => {
    let finish!: (value: { granted: boolean }) => void;
    mockRequestMediaLibraryPermissionsAsync.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const screen = render(<ThreadScreen />);
    fireEvent.press(screen.getByLabelText('Add attachment'));
    const pick = screen.getByLabelText('Photo library');
    act(() => { fireEvent.press(pick); fireEvent.press(pick); });
    expect(mockRequestMediaLibraryPermissionsAsync).toHaveBeenCalledTimes(1);
    await act(async () => finish({ granted: false }));
  });

  it.each(['permission', 'picker'])('reports a photo %s failure and allows another attempt with the draft preserved', async (stage) => {
    if (stage === 'permission') mockRequestMediaLibraryPermissionsAsync.mockRejectedValueOnce(new Error('Native permission unavailable'));
    else mockLaunchImageLibraryAsync.mockRejectedValueOnce(new Error('Native picker unavailable'));
    const screen = render(<ThreadScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Type a message...'), 'Keep my caption');
    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Photo library'));
    await waitFor(() => expect(useAppToast().show).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' })));
    expect(screen.getByPlaceholderText('Type a message...').props.value).toBe('Keep my caption');
    if (!screen.queryByLabelText('Photo library')) fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Photo library'));
    await waitFor(() => expect(mockLaunchImageLibraryAsync).toHaveBeenCalledTimes(stage === 'picker' ? 2 : 1));
  });

  it('does not retain picked photos returned after departure', async () => {
    let finish!: (value: unknown) => void;
    mockLaunchImageLibraryAsync.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const screen = render(<ThreadScreen />);
    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Photo library'));
    await waitFor(() => expect(mockLaunchImageLibraryAsync).toHaveBeenCalled());
    screen.unmount();
    await act(async () => finish({ canceled: false, assets: [{ uri: 'file:///tmp/late.jpg', fileName: 'late.jpg' }] }));
    expect(mockRetainMessageDraftMedia).not.toHaveBeenCalled();
  });

  it('removes a managed photo copy that finishes after departure', async () => {
    let finishCopy!: (value: string) => void;
    mockLaunchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///tmp/late.jpg', fileName: 'late.jpg', width: 800, height: 600 }] });
    mockRetainMessageDraftMedia.mockReturnValueOnce(new Promise((resolve) => { finishCopy = resolve; }));
    const screen = render(<ThreadScreen />);
    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Photo library'));
    await waitFor(() => expect(mockRetainMessageDraftMedia).toHaveBeenCalled());
    screen.unmount();
    await act(async () => finishCopy('file:///documents/message-drafts-v1/late.jpg'));
    expect(mockRemoveMessageDraftMediaBatch).toHaveBeenCalledWith(['file:///documents/message-drafts-v1/late.jpg']);
  });

  /** Opens the thread, picks one photo from the library, and returns the screen. */
  async function attachAPhoto() {
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
        meta: { conversation: { other_user: { id: 42, name: 'Alice' } } },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const screen = render(<ThreadScreen />);
    await waitFor(() => expect(mockLoadCreationDraft).toHaveBeenCalled());
    await act(async () => {});
    fireEvent.press(screen.getByLabelText('Add attachment'));
    fireEvent.press(screen.getByLabelText('Photo library'));
    await waitFor(() => expect(screen.getByText('photo.jpg')).toBeTruthy());
    return screen;
  }

  it('restores an existing managed photo for the exact conversation after process death', async () => {
    mockLoadCreationDraft.mockResolvedValueOnce({
      text: 'Restored caption',
      attachments: [{
        id: 'persisted-photo',
        uri: 'file:///documents/message-drafts-v1/restored.jpg',
        name: 'restored.jpg',
        mimeType: 'image/jpeg',
        width: 800,
        height: 600,
        size: 2048,
      }],
    });
    mockUseApi.mockReturnValue({ data: { data: mockMessages }, isLoading: false, error: null, refresh: jest.fn() });

    const screen = render(<ThreadScreen />);

    await waitFor(() => expect(screen.getByLabelText('Remove restored.jpg')).toBeTruthy());
    expect(screen.getByPlaceholderText('Type a message...').props.value).toBe('Restored caption');
    expect(mockExistingMessageDraftMedia).toHaveBeenCalledWith('file:///documents/message-drafts-v1/restored.jpg');
  });

  it('drops persisted attachment metadata when its managed file no longer exists', async () => {
    mockExistingMessageDraftMedia.mockResolvedValueOnce(false);
    mockLoadCreationDraft.mockResolvedValueOnce({
      text: '',
      attachments: [{ id: 'missing', uri: 'file:///documents/message-drafts-v1/missing.jpg', name: 'missing.jpg', mimeType: 'image/jpeg' }],
    });
    mockUseApi.mockReturnValue({ data: { data: mockMessages }, isLoading: false, error: null, refresh: jest.fn() });

    const screen = render(<ThreadScreen />);

    await waitFor(() => expect(mockExistingMessageDraftMedia).toHaveBeenCalled());
    expect(screen.queryByLabelText('Remove missing.jpg')).toBeNull();
    await waitFor(() => expect(mockClearCreationDraft).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'message', contextId: 'conversation:5' }),
    ));
  });

  it('copies a picked photo into managed storage and persists its metadata', async () => {
    const screen = await attachAPhoto();

    expect(mockRetainMessageDraftMedia).toHaveBeenCalledWith('file:///tmp/photo.jpg', 'photo.jpg');
    await waitFor(() => expect(mockSaveCreationDraft).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'message', contextId: 'conversation:5' }),
      expect.objectContaining({
        attachments: [expect.objectContaining({ uri: 'file:///documents/message-drafts-v1/photo.jpg', name: 'photo.jpg' })],
      }),
    ));
    fireEvent.press(screen.getByLabelText('Remove photo.jpg'));
    expect(mockRemoveMessageDraftMedia).toHaveBeenCalledWith('file:///documents/message-drafts-v1/photo.jpg');
  });

  it('keeps a picked photo visible and warns when the durable copy fails', async () => {
    mockRetainMessageDraftMedia.mockResolvedValueOnce(null);
    const screen = await attachAPhoto();

    expect(screen.getByLabelText('Remove photo.jpg')).toBeTruthy();
    expect(useAppToast().show).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Photo kept for this session',
      variant: 'warning',
    }));
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
      expect(mockSaveCreationDraft).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'message', contextId: 'conversation:5' }),
        expect.objectContaining({
          text: 'Photo update',
          attachments: [expect.objectContaining({ uri: 'file:///documents/message-drafts-v1/photo.jpg' })],
        }),
      );
      expect(mockSendMessageWithAttachments).toHaveBeenCalledWith(
        42,
        'Photo update',
        expect.arrayContaining([
          expect.objectContaining({ uri: 'file:///documents/message-drafts-v1/photo.jpg', name: 'photo.jpg', mimeType: 'image/jpeg' }),
        ]),
        undefined,
        // 🔴 The fifth argument is what makes the upload observable and stoppable.
        expect.objectContaining({ onProgress: expect.any(Function), signal: expect.anything(), idempotencyKey: 'message-operation-123' }),
      );
    });
    await waitFor(() => expect(mockRemoveMessageDraftMediaBatch).toHaveBeenCalledWith([
      'file:///documents/message-drafts-v1/photo.jpg',
    ]));
  });

  it('does not dispatch an immediate photo send when its recovery manifest cannot be saved', async () => {
    mockSaveCreationDraft.mockResolvedValue(false);
    const screen = await attachAPhoto();
    fireEvent.changeText(screen.getByPlaceholderText('Type a message...'), 'Must remain recoverable');
    fireEvent.press(screen.getByLabelText('Send'));

    await waitFor(() => expect(mockSaveCreationDraft).toHaveBeenCalled());
    expect(mockSendMessageWithAttachments).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Remove photo.jpg')).toBeTruthy();
  });

  /*
    🔴 A photo upload used to show a spinner with no number and no way out. React
    Native's fetch reports nothing at all while a body is going out, so on a slow
    connection the only escape was force-quitting the app. Audit 2026-09-07, fixed
    2026-09-08.
  */
  describe('sending photos shows progress and can be stopped', () => {
    async function startAnUpload() {
      let reportProgress: ((percent: number) => void) | undefined;
      let abortSignal: AbortSignal | undefined;
      mockSendMessageWithAttachments.mockImplementation(
        (
          _id: number,
          _body: string,
          _attachments: unknown[],
          _options: unknown,
          upload?: { onProgress?: (p: number) => void; signal?: AbortSignal },
        ) => {
          reportProgress = upload?.onProgress;
          abortSignal = upload?.signal;
          return new Promise(() => { /* held open, like a real upload in flight */ });
        },
      );

      const screen = await attachAPhoto();
      fireEvent.changeText(screen.getByPlaceholderText('Type a message...'), 'Photo update');
      fireEvent.press(screen.getByLabelText('Send'));
      await waitFor(() => expect(mockSendMessageWithAttachments).toHaveBeenCalled());
      return { screen, reportProgress: () => reportProgress, abortSignal: () => abortSignal };
    }

    it('shows how far along the upload is', async () => {
      const { screen, reportProgress } = await startAnUpload();

      expect(screen.getByTestId('thread-upload-progress')).toBeTruthy();

      await act(async () => { reportProgress()?.(42); });
      expect(screen.getByTestId('thread-upload-progress')).toHaveTextContent(/42%/);
    });

    it('gives the member a way to stop it', async () => {
      const { screen, abortSignal } = await startAnUpload();

      fireEvent.press(screen.getByTestId('thread-upload-cancel'));

      expect(abortSignal()?.aborted).toBe(true);
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
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'duckOthers',
        shouldRouteThroughEarpiece: false,
      }));
      expect(mockCreateRecordingAsync).toHaveBeenCalled();
      expect(getByText('Recording voice message')).toBeTruthy();
    });

    fireEvent.press(getByLabelText('Stop'));

    await waitFor(() => {
      expect(mockAudioRecording.stop).toHaveBeenCalled();
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
      expect(mockSendVoiceMessage).toHaveBeenCalledWith(42, 'file:///documents/message-drafts-v1/voice.m4a', undefined, 0, 'message-operation-123');
    });
    expect(mockRetainMessageDraftMedia).toHaveBeenCalledWith('file:///tmp/voice.m4a', expect.stringMatching(/^voice-\d+\.m4a$/));
    expect(mockRemoveTransientMessageMedia).toHaveBeenCalledWith('file:///tmp/voice.m4a');
    await waitFor(() => expect(mockRemoveMessageDraftMedia).toHaveBeenCalledWith('file:///documents/message-drafts-v1/voice.m4a'));
  });

  it('finalizes and persists an active recording when the app backgrounds', async () => {
    let appStateChange: ((state: 'active' | 'background' | 'inactive' | 'unknown' | 'extension') => void) | null = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      appStateChange = listener;
      return { remove: jest.fn() };
    });
    mockUseApi.mockReturnValue({ data: { data: mockMessages }, isLoading: false, error: null, refresh: jest.fn() });
    const ui = render(<ThreadScreen />);

    fireEvent.press(ui.getByLabelText('Record voice message'));
    await waitFor(() => expect(ui.getByText('Recording voice message')).toBeTruthy());
    await act(async () => { appStateChange?.('background'); });

    await waitFor(() => expect(ui.getByText('Voice message ready')).toBeTruthy());
    expect(mockAudioRecording.stop).toHaveBeenCalledTimes(1);
    expect(mockRetainMessageDraftMedia).toHaveBeenCalledWith('file:///tmp/voice.m4a', expect.stringMatching(/^voice-\d+\.m4a$/));
    await waitFor(() => expect(mockSaveCreationDraft).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'message', contextId: 'conversation:5' }),
      expect.objectContaining({ voice: { uri: 'file:///documents/message-drafts-v1/voice.m4a', durationSeconds: 0 } }),
    ));
  });

  it('restores a stopped voice note and its duration from the exact conversation draft', async () => {
    mockLoadCreationDraft.mockResolvedValueOnce({
      text: '',
      voice: { uri: 'file:///documents/message-drafts-v1/restored-voice.m4a', durationSeconds: 12 },
    });
    mockUseApi.mockReturnValue({ data: { data: mockMessages }, isLoading: false, error: null, refresh: jest.fn() });

    const ui = render(<ThreadScreen />);

    await waitFor(() => expect(ui.getByText('Voice message ready')).toBeTruthy());
    expect(ui.getByText('0:12')).toBeTruthy();
    expect(mockExistingMessageDraftMedia).toHaveBeenCalledWith('file:///documents/message-drafts-v1/restored-voice.m4a');
    fireEvent.press(ui.getByLabelText('Cancel voice message'));
    await waitFor(() => expect(mockRemoveMessageDraftMedia).toHaveBeenCalledWith('file:///documents/message-drafts-v1/restored-voice.m4a'));
  });

  it('does not start a recorder when permission returns after leaving', async () => {
    let finish!: (value: { granted: boolean }) => void;
    mockRequestAudioPermissionsAsync.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const screen = render(<ThreadScreen />);
    fireEvent.press(screen.getByLabelText('Record voice message'));
    screen.unmount();
    await act(async () => { finish({ granted: true }); });
    expect(mockCreateRecordingAsync).not.toHaveBeenCalled();
    expect(mockAudioRecording.record).not.toHaveBeenCalled();
  });

  it('prevents overlapping record requests while permission is pending', async () => {
    let finish!: (value: { granted: boolean }) => void;
    mockRequestAudioPermissionsAsync.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const screen = render(<ThreadScreen />);
    fireEvent.press(screen.getByLabelText('Record voice message'));
    fireEvent.press(screen.getByLabelText('Record voice message'));
    expect(mockRequestAudioPermissionsAsync).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ granted: true }); });
    expect(mockAudioRecording.record).toHaveBeenCalledTimes(1);
    screen.unmount();
  });

  it('preserves a recorded voice duration when a failed upload is retried', async () => {
    jest.useFakeTimers();
    try {
      mockUseApi.mockReturnValue({
        data: { data: mockMessages, meta: { conversation: { other_user: { id: 42, name: 'Alice' } } } },
        isLoading: false, error: null, refresh: jest.fn(),
      });
      mockSendVoiceMessage.mockRejectedValueOnce(new Error('Network unavailable'));
      const ui = render(<ThreadScreen />);
      fireEvent.press(ui.getByLabelText('Record voice message'));
      await waitFor(() => expect(ui.getByText('Recording voice message')).toBeTruthy());
      act(() => { jest.advanceTimersByTime(7000); });
      fireEvent.press(ui.getByLabelText('Stop'));
      await waitFor(() => expect(ui.getByText('Voice message ready')).toBeTruthy());
      fireEvent.press(ui.getByLabelText('Send voice message'));
      await waitFor(() => expect(mockSendVoiceMessage).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(ui.getByText('Voice message ready')).toBeTruthy());
      fireEvent.press(ui.getByLabelText('Send voice message'));
      await waitFor(() => expect(mockSendVoiceMessage).toHaveBeenCalledTimes(2));
      expect(mockSendVoiceMessage.mock.calls[0][3]).toBe(7);
      expect(mockSendVoiceMessage.mock.calls[1][3]).toBe(7);
      ui.unmount();
    } finally {
      jest.useRealTimers();
    }
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

    // Quick actions are hidden until the bubble is tapped (audit 2026-09-05).
    fireEvent.press(getAllByLabelText('Message actions')[1]);
    fireEvent.press(getAllByLabelText('Message options')[0]);
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

    fireEvent.press(getAllByLabelText('Message actions')[0]);
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

    const { getByLabelText, getByText, getByTestId } = render(<ThreadScreen />);

    expect(getByText('Regarding')).toBeTruthy();
    expect(getByText('Job #44')).toBeTruthy();
    expect(getByTestId('thread-context-card').props.style).toEqual(expect.objectContaining({
      alignSelf: 'stretch',
      minHeight: 48,
    }));

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

    fireEvent.press(getAllByLabelText('Message actions')[0]);
    fireEvent.press(getAllByLabelText(`React with ${thumbsUpReaction}`)[0]);

    await waitFor(() => {
      expect(mockToggleMessageReaction).toHaveBeenCalledWith(1, thumbsUpReaction);
      expect(getByText('1')).toBeTruthy();
    });
  });

  it('offers a way back to older messages instead of stopping at the first page', async () => {
    /*
      🔴 S3-13: the thread fetched one page — the server sends 50 — and offered nothing to
      say more existed. A long conversation was silently truncated (audit 2026-09-06).
    */
    mockUseApi.mockReturnValue({
      data: { data: mockMessages, meta: { per_page: 50, has_more: true, cursor: 'cursor-2' } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
    mockGetThread.mockResolvedValueOnce({
      data: [{
        id: 40,
        body: 'A much older message',
        sender: { id: 5, name: 'Alice', avatar_url: null },
        created_at: '2026-03-01T09:00:00Z',
        is_own: false,
        is_voice: false,
        audio_url: null,
        reactions: {},
        is_read: true,
      }],
      meta: { per_page: 50, has_more: false, cursor: null },
    });

    const { getByText, queryByText } = render(<ThreadScreen />);

    expect(queryByText('A much older message')).toBeNull();
    fireEvent.press(getByText('Load earlier messages'));

    await waitFor(() => expect(getByText('A much older message')).toBeTruthy());
    // The server said there is nothing above that page, so the button goes.
    await waitFor(() => expect(queryByText('Load earlier messages')).toBeNull());
  });

  it('gives the voice bubble the length the server stored, so it does not read 0:00', () => {
    /*
      🔴 The server records `audio_duration` and the client type never carried it, so every
      voice note showed 0:00 until the member pressed play (emulator, 2026-09-05).
    */
    mockUseApi.mockReturnValue({
      data: { data: mockMessages },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByTestId } = render(<ThreadScreen />);

    // 38 seconds, in milliseconds, as the audio component expects.
    expect(getByTestId('voice-bubble-38000')).toBeTruthy();
  });

  /*
    🔴 Audit F09. This screen subscribes in a plain effect rather than a focus-scoped
    one, so following the conversation's "Regarding" card to the listing or event pushes a
    screen ON TOP of a thread that stays mounted and subscribed. The handler nonetheless
    marked every incoming message read - locally and on the server - and its existence told
    the realtime provider a viewer had taken it, so the badge never rose. A member who could
    not see the message was recorded as having read it, with nothing to tell them otherwise.

    The message must still ARRIVE while the thread is covered; only the acknowledgement
    waits. Both halves are asserted.
  */
  it('receives but does not acknowledge a message while another screen covers the thread', async () => {
    mockUseApi.mockReturnValue({
      data: { data: mockMessages }, isLoading: false, error: null, refresh: jest.fn(),
    });

    const { getByText } = render(<ThreadScreen />);
    expect(mockFocusCallback.current).toBeTruthy();

    // Open the linked listing: the thread blurs but stays mounted and subscribed.
    let cleanup: (() => void) | void;
    act(() => { cleanup = mockFocusCallback.current?.(); });
    act(() => { cleanup?.(); });

    mockMarkConversationRead.mockClear();
    let acknowledged: boolean | void = undefined;
    act(() => {
      acknowledged = mockRealtimeCallback?.({
        id: 4,
        body: 'Arrived while you were away',
        sender: { id: 5, name: 'Alice', avatar_url: null },
        sender_id: 5,
        created_at: '2026-03-10T10:05:00Z',
        is_own: false,
        is_voice: false,
        audio_url: null,
        reactions: {},
        is_read: false,
      });
    });

    // Still delivered and cached, so it is there when the member comes back.
    await waitFor(() => expect(getByText('Arrived while you were away')).toBeTruthy());
    // But not marked read, and reported to the provider as unseen so the badge rises.
    expect(mockMarkConversationRead).not.toHaveBeenCalled();
    expect(acknowledged).toBe(false);
  });

  it('clears what arrived while it was covered as soon as the member comes back', async () => {
    // Otherwise a member returns to a thread they are looking at and a stale badge stays up
    // until they happen to tap something.
    mockUseApi.mockReturnValue({
      data: { data: mockMessages }, isLoading: false, error: null, refresh: jest.fn(),
    });

    render(<ThreadScreen />);

    let cleanup: (() => void) | void;
    act(() => { cleanup = mockFocusCallback.current?.(); });
    act(() => { cleanup?.(); });

    act(() => {
      mockRealtimeCallback?.({
        id: 5,
        body: 'Missed you',
        sender: { id: 5, name: 'Alice', avatar_url: null },
        sender_id: 5,
        created_at: '2026-03-10T10:06:00Z',
        is_own: false,
        is_voice: false,
        audio_url: null,
        reactions: {},
        is_read: false,
      });
    });

    mockMarkConversationRead.mockClear();
    act(() => { mockFocusCallback.current?.(); });

    await waitFor(() => expect(mockMarkConversationRead).toHaveBeenCalledWith(5));
  });

  it('shows the quick-react row only for the tapped message, not under every bubble', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockMessages },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getAllByLabelText, queryAllByLabelText } = render(<ThreadScreen />);

    // Nothing is expanded on first render — the thread reads as messages, not buttons.
    expect(queryAllByLabelText(`React with ${thumbsUpReaction}`)).toHaveLength(0);

    fireEvent.press(getAllByLabelText('Message actions')[0]);
    expect(queryAllByLabelText(`React with ${thumbsUpReaction}`)).toHaveLength(1);

    // Tapping the same bubble again folds it away.
    fireEvent.press(getAllByLabelText('Message actions')[0]);
    expect(queryAllByLabelText(`React with ${thumbsUpReaction}`)).toHaveLength(0);
  });
});

it('AUDIT keeps the next draft when an earlier send fails', async () => {
  mockUseApi.mockReturnValue({
    data: { data: mockMessages, meta: { conversation: { other_user: { id: 42, name: 'Alice' } } } },
    isLoading: false, error: null, refresh: jest.fn(),
  });

  let rejectSend!: (reason: Error) => void;
  (sendMessage as jest.Mock).mockImplementation(() => new Promise((_resolve, reject) => { rejectSend = reject; }));
  const ui = render(<ThreadScreen />);
  fireEvent.changeText(ui.getByPlaceholderText('Type a message...'), 'First message');
  fireEvent.press(ui.getByLabelText('Send'));
  await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, 'First message', {}, 'message-operation-123'));
  fireEvent.changeText(ui.getByPlaceholderText('Type a message...'), 'Next draft - do not lose this');
  expect(ui.getByPlaceholderText('Type a message...').props.value).toBe('Next draft - do not lose this');
  await act(async () => { rejectSend(new Error('Network request failed')); });
  expect(ui.getByPlaceholderText('Type a message...').props.value).toBe('Next draft - do not lose this');
  fireEvent.press(ui.getByText('Edit unsent draft'));
  expect(ui.getByPlaceholderText('Type a message...').props.value).toBe('First message');
  fireEvent.press(ui.getByText('Edit unsent draft'));
  expect(ui.getByPlaceholderText('Type a message...').props.value).toBe('Next draft - do not lose this');
});
