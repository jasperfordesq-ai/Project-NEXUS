// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { render, screen } from '@/test/test-utils';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageInputArea } from './MessageInputArea';
import type { MessageInputAreaProps } from './MessageInputArea';
import { createRef } from 'react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/contexts', () => ({
  useTenant: () => ({
    hasFeature: vi.fn((_key: string) => true),
    hasModule: vi.fn((_key: string) => true),
    tenantPath: (p: string) => `/t/test${p}`,
  }),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('./VoiceMessagePlayer', () => ({
  VoiceMessagePlayer: () => <div data-testid="voice-player">Voice Player</div>,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

const defaultProps: MessageInputAreaProps = {
  isDirectMessagingEnabled: true,
  messagingRestriction: null,
  newMessage: '',
  onNewMessageChange: vi.fn(),
  onSendMessage: vi.fn(),
  isSending: false,
  onTypingIndicator: vi.fn(),
  onBlurTypingStop: vi.fn(),
  isRecording: false,
  recordingTime: 0,
  audioBlob: null,
  onStartRecording: vi.fn(),
  onStopRecording: vi.fn(),
  onCancelRecording: vi.fn(),
  onSendVoiceMessage: vi.fn(),
  onClearAudioBlob: vi.fn(),
  attachments: [],
  attachmentPreviews: [],
  fileInputRef: createRef<HTMLInputElement>(),
  onFileSelect: vi.fn(),
  onRemoveAttachment: vi.fn(),
};

describe('MessageInputArea', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders textarea for message input', () => {
    render(<MessageInputArea {...defaultProps} />);
    // Should have a textarea
    const textareas = screen.getAllByRole('textbox');
    expect(textareas.length).toBeGreaterThan(0);
  });

  it('shows disabled notice when direct messaging is disabled', () => {
    render(<MessageInputArea {...defaultProps} isDirectMessagingEnabled={false} />);
    expect(screen.getByText('disabled_inline')).toBeDefined();
    expect(screen.getByText('exchanges_link')).toBeDefined();
  });

  it('shows restriction alert when messaging_disabled is true', () => {
    render(
      <MessageInputArea
        {...defaultProps}
        messagingRestriction={{ messaging_disabled: true, under_monitoring: false, restriction_reason: 'Violation' }}
      />
    );
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getByText('messaging_restricted_title')).toBeDefined();
  });

  it('shows recording indicator when isRecording is true', () => {
    render(<MessageInputArea {...defaultProps} isRecording={true} recordingTime={15} />);
    // Should show recording time
    expect(screen.getByText('0:15')).toBeDefined();
  });

  it('shows voice player preview when audioBlob exists', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    render(<MessageInputArea {...defaultProps} audioBlob={blob} />);
    expect(screen.getByTestId('voice-player')).toBeDefined();
  });

  it('renders send voice message button when audioBlob present', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    render(<MessageInputArea {...defaultProps} audioBlob={blob} />);
    // The send voice button text is t('send') in the component
    expect(screen.getByText('send')).toBeDefined();
  });

  it('calls onClearAudioBlob when cancel clicked on voice preview', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    render(<MessageInputArea {...defaultProps} audioBlob={blob} />);
    await user.click(screen.getByText('cancel'));
    expect(defaultProps.onClearAudioBlob).toHaveBeenCalled();
  });

  it('calls onStartRecording when mic button clicked', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<MessageInputArea {...defaultProps} />);
    const micBtn = screen.getByLabelText('aria_record_voice');
    await user.click(micBtn);
    expect(defaultProps.onStartRecording).toHaveBeenCalled();
  });

  it('calls onStopRecording when stop button clicked during recording', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<MessageInputArea {...defaultProps} isRecording={true} />);
    await user.click(screen.getByText('stop_recording'));
    expect(defaultProps.onStopRecording).toHaveBeenCalled();
  });

  it('renders send button when there is message text', () => {
    render(<MessageInputArea {...defaultProps} newMessage="Hello!" />);
    expect(screen.getByLabelText('aria_send_message')).toBeDefined();
  });

  it('shows attachment previews', () => {
    const previews = [
      { file: new File(['img'], 'photo.jpg', { type: 'image/jpeg' }), preview: 'data:image/jpeg;base64,abc', type: 'image' as const },
    ];
    render(<MessageInputArea {...defaultProps} attachments={[previews[0].file]} attachmentPreviews={previews} />);
    // Should render preview images
    const imgs = screen.getAllByRole('img');
    expect(imgs.length).toBeGreaterThan(0);
  });

  it('replaces text, attachment, and voice controls when safeguarding denies contact', () => {
    render(<MessageInputArea {...defaultProps} safeguardingPolicyStatus="deny" />);
    expect(screen.getByText('composer_blocked_safeguarding')).toBeDefined();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByLabelText('aria_record_voice')).toBeNull();
  });

  it('fails closed with distinct copy when the safeguarding policy is unavailable', () => {
    render(<MessageInputArea {...defaultProps} safeguardingPolicyStatus="unavailable" />);
    expect(screen.getByText('composer_blocked_safeguarding_unavailable')).toBeDefined();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('MessageInputArea — mobile compose-tools collapse (<640px)', () => {
  function mockViewport(matchesMobile: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: matchesMobile && query.includes('max-width: 639px'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockViewport(true);
  });

  afterEach(() => {
    mockViewport(false);
  });

  it('collapses attach tools into a chevron on focus and restores them on empty blur', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<MessageInputArea {...defaultProps} />);
    // Tools visible initially
    expect(screen.getByLabelText('aria_add_attachment')).toBeInTheDocument();

    await user.click(screen.getByRole('textbox'));
    // Focus collapses tools to the expand chevron
    expect(screen.queryByLabelText('aria_add_attachment')).toBeNull();
    expect(screen.getByLabelText('aria_show_compose_tools')).toBeInTheDocument();

    // Blur with empty input restores tools
    await user.click(document.body);
    expect(screen.getByLabelText('aria_add_attachment')).toBeInTheDocument();
  });

  it('re-expands the tools when the chevron is pressed', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<MessageInputArea {...defaultProps} newMessage="draft text" />);
    await user.click(screen.getByRole('textbox'));
    expect(screen.getByLabelText('aria_show_compose_tools')).toBeInTheDocument();

    await user.click(screen.getByLabelText('aria_show_compose_tools'));
    expect(screen.getByLabelText('aria_add_attachment')).toBeInTheDocument();
  });
});
