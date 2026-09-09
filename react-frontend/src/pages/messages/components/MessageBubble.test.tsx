// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { render, screen } from '@/test/test-utils';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MessageBubble } from './MessageBubble';
import type { MessageBubbleProps } from './MessageBubble';
import type { Message } from '@/types/api';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/lib/motion', () => ({
  motion: new Proxy({}, {
    get: (_: object, prop: string) => {
      const { createElement, forwardRef } = require('react');
      return forwardRef(({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>, ref: React.Ref<unknown>) =>
        createElement(prop as string, { ...props, ref }, children)
      );
    },
  }),
  AnimatePresence: ({ children }: React.PropsWithChildren) => children,
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null) => url ?? '',
  formatNumber: (value: number) => String(value),
  getFormattingLocale: () => 'en-US',
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// 🔴 Both gates are required even when nothing in this file reads them: shared
// components (Breadcrumbs, headers, menus) ask the tenant context whether a
// destination is enabled, and a partial mock makes that call throw during render.
// Granting everything keeps these cases about their own subject.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    hasModule: vi.fn((_key: string) => true),
    tenantPath: (path: string) => `/test${path}`,
    hasFeature: vi.fn(() => false),
  }),
}));

vi.mock('./VoiceMessagePlayer', () => ({
  VoiceMessagePlayer: () => <div data-testid="voice-player">Voice Player</div>,
}));

const mockMessage: Message = {
  id: 1,
  body: 'Hello, world!',
  content: 'Hello, world!',
  created_at: '2026-01-01T12:00:00Z',
  sender_id: 10,
  is_own: true,
  is_read: false,
  is_deleted: false,
  is_edited: false,
  is_voice: false,
  audio_url: undefined,
  attachments: [],
  reactions: {},
} as unknown as Message;

const otherUser = { id: 20, name: 'Bob', avatar_url: null };

const defaultProps: MessageBubbleProps = {
  message: mockMessage,
  isOwn: true,
  showAvatar: true,
  otherUser,
  onReact: vi.fn(),
  onEdit: vi.fn(),
  onDelete: vi.fn(),
};

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

describe('MessageBubble', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders message content', () => {
    render(<MessageBubble {...defaultProps} />);
    expect(screen.getByText('Hello, world!')).toBeDefined();
  });

  it('renders voice player for voice messages', () => {
    const voiceMsg = { ...mockMessage, is_voice: true, audio_url: 'https://cdn.example.com/audio.mp3' };
    render(<MessageBubble {...defaultProps} message={voiceMsg as Message} />);
    expect(screen.getByTestId('voice-player')).toBeDefined();
  });

  it('shows deleted message placeholder', () => {
    const deletedMsg = { ...mockMessage, is_deleted: true };
    render(<MessageBubble {...defaultProps} message={deletedMsg as Message} />);
    // Should show some deleted state indicator
    expect(screen.queryByText('Hello, world!')).toBeNull();
  });

  it('renders avatar for other user when showAvatar is true', () => {
    render(<MessageBubble {...defaultProps} isOwn={false} showAvatar={true} />);
    // Avatar should be present for received messages
    // HeroUI Avatar renders with img or initials
    expect(screen.queryByText('B')).toBeDefined(); // Initials from "Bob"
  });

  it('renders edit input when isEditing is true', () => {
    render(
      <MessageBubble
        {...defaultProps}
        isEditing={true}
        editingText="Hello, world!"
        onEditingTextChange={vi.fn()}
        onSaveEdit={vi.fn()}
        onCancelEdit={vi.fn()}
      />
    );
    const input = screen.getByDisplayValue('Hello, world!');
    expect(input).toBeDefined();
  });

  it('highlights text matching highlightQuery', () => {
    render(
      <MessageBubble
        {...defaultProps}
        isHighlighted={true}
        highlightQuery="world"
      />
    );
    // Text should still be visible
    expect(screen.getByText(/world/i)).toBeDefined();
  });

  it('renders with unique id prop', () => {
    render(<MessageBubble {...defaultProps} id="msg-1" />);
    const el = document.getElementById('msg-1');
    expect(el).toBeDefined();
  });

  it('renders reaction picker trigger button', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<MessageBubble {...defaultProps} />);

    // Hover to reveal actions (or look for reaction button)
    const reactionBtns = screen.queryAllByRole('button');
    expect(reactionBtns.length).toBeGreaterThan(0);
  });

  it('renders a valid reaction count without exposing internal metadata', () => {
    const thumbsUp = '\u{1F44D}';
    const message = {
      ...mockMessage,
      reactions: {
        [thumbsUp]: 2,
        _users: { [`20_${thumbsUp}`]: true },
      },
    } as unknown as Message;

    render(<MessageBubble {...defaultProps} message={message} />);

    expect(screen.getByRole('button', { name: 'aria_toggle_reaction' })).toBeInTheDocument();
    expect(screen.getByText(thumbsUp)).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.queryByText('_users')).toBeNull();
  });

  it('normalizes a legacy JSON reaction string instead of rendering character offsets', () => {
    const thumbsUp = '\u{1F44D}';
    const message = {
      ...mockMessage,
      reactions: JSON.stringify({
        [thumbsUp]: 1,
        _users: { [`20_${thumbsUp}`]: true },
      }),
    } as unknown as Message;

    render(<MessageBubble {...defaultProps} message={message} />);

    expect(screen.getByRole('button', { name: 'aria_toggle_reaction' })).toBeInTheDocument();
    expect(screen.getByText(thumbsUp)).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText('_users')).toBeNull();
  });

  it('ignores malformed reaction arrays', () => {
    const message = {
      ...mockMessage,
      reactions: Array.from({ length: 52 }, (_, index) => index),
    } as unknown as Message;

    render(<MessageBubble {...defaultProps} message={message} />);

    expect(screen.queryByRole('button', { name: 'aria_toggle_reaction' })).toBeNull();
    expect(screen.queryByText('51')).toBeNull();
  });
});

describe('MessageBubble — mobile action sheet (<640px)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockViewport(true);
  });

  afterEach(() => {
    mockViewport(false);
  });

  it('renders the single ⋮ options button instead of the desktop hover pair', () => {
    render(<MessageBubble {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'aria_message_options' })).toBeInTheDocument();
    // Desktop-only reaction hover button must NOT render on mobile
    expect(screen.queryByRole('button', { name: 'aria_add_reaction' })).toBeNull();
  });

  it('opens the bottom action sheet with reactions and actions from the ⋮ button', async () => {
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<MessageBubble {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: 'aria_message_options' }));
    // Sheet content: reaction row (6 emojis) + copy/edit/delete actions
    expect(screen.getAllByRole('button', { name: 'aria_react_with' })).toHaveLength(6);
    expect(screen.getByText('message_copy')).toBeInTheDocument();
    expect(screen.getByText('message_edit')).toBeInTheDocument();
    expect(screen.getByText('message_delete')).toBeInTheDocument();
  });

  it('does not render the ⋮ button for deleted messages', () => {
    const deletedMsg = { ...mockMessage, is_deleted: true } as Message;
    render(<MessageBubble {...defaultProps} message={deletedMsg} />);
    expect(screen.queryByRole('button', { name: 'aria_message_options' })).toBeNull();
  });
});
