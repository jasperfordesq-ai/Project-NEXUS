// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import userEvent from '@testing-library/user-event';

// ─── API mock ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Toast / Auth / Tenant ──────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 99, name: 'Current User' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
  })
);

// ─── Stub heavy UI components ────────────────────────────────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
      isOpen ? <div role="dialog" aria-label="Dialog">{children}</div> : null,
    ModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalBody: ({ children, ...rest }: { children: React.ReactNode; [key: string]: unknown }) => (
      <div aria-label={(rest as Record<string, string>)['aria-label']}>{children}</div>
    ),
    Avatar: ({ name }: { name?: string }) => <div data-testid="avatar">{name}</div>,
    useConfirm: () => vi.fn(async () => true),
  };
});

// ─── Stub lib/helpers ───────────────────────────────────────────────────────
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null) => url ?? '',
  resolveAssetUrl: (url: string) => url,
  formatRelativeTime: () => '1 hour ago',
}));

// ─── Stub motion/animation ──────────────────────────────────────────────────
vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...rest }: { children: React.ReactNode; [key: string]: unknown }) => (
      <div {...(rest as object)}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Stub react-aria FocusScope ──────────────────────────────────────────────
vi.mock('@react-aria/focus', () => ({
  FocusScope: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─────────────────────────────────────────────────────────────────────────────

function makeStoryUser(overrides: Partial<{
  user_id: number;
  name: string;
  first_name: string;
  avatar_url: string | null;
  story_count: number;
  has_unseen: boolean;
  is_own: boolean;
  is_connected: boolean;
  latest_at: string;
}> = {}) {
  return {
    user_id: 10,
    name: 'Alice Example',
    first_name: 'Alice',
    avatar_url: null,
    story_count: 1,
    has_unseen: true,
    is_own: false,
    is_connected: true,
    latest_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeStory(overrides: Partial<{
  id: number;
  user_id: number;
  media_type: 'image' | 'text' | 'poll' | 'video';
  text_content: string | null;
  background_gradient: string | null;
  duration: number;
  view_count: number;
  is_viewed: boolean;
  expires_at: string;
  created_at: string;
}> = {}) {
  return {
    id: 1,
    user_id: 10,
    media_type: 'text' as const,
    text_content: 'Hello story!',
    background_gradient: 'from-accent to-blue-500',
    duration: 5,
    view_count: 42,
    is_viewed: false,
    expires_at: new Date(Date.now() + 86400000).toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('StoryViewer', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
    // Default: return one text story
    mockApi.get.mockResolvedValue({
      success: true,
      data: [makeStory()],
    });
    mockApi.post.mockResolvedValue({ success: true });
  });

  it('renders without crashing', async () => {
    const { StoryViewer } = await import('./StoryViewer');
    render(
      <StoryViewer
        storyUsers={[makeStoryUser()]}
        initialUserIndex={0}
        onClose={onClose}
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('shows close button', async () => {
    const { StoryViewer } = await import('./StoryViewer');
    render(
      <StoryViewer
        storyUsers={[makeStoryUser()]}
        initialUserIndex={0}
        onClose={onClose}
      />
    );
    const closeBtn = screen.getByRole('button', { name: /close/i });
    expect(closeBtn).toBeInTheDocument();
  });

  it('calls onClose when close button is pressed', async () => {
    const mockClose = vi.fn();
    const { StoryViewer } = await import('./StoryViewer');
    render(
      <StoryViewer
        storyUsers={[makeStoryUser()]}
        initialUserIndex={0}
        onClose={mockClose}
      />
    );
    const closeBtn = screen.getByRole('button', { name: /close/i });
    await userEvent.click(closeBtn);
    expect(mockClose).toHaveBeenCalled();
  });

  it('loads stories from API on mount', async () => {
    const { StoryViewer } = await import('./StoryViewer');
    render(
      <StoryViewer
        storyUsers={[makeStoryUser({ user_id: 10 })]}
        initialUserIndex={0}
        onClose={onClose}
      />
    );
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/stories/user/10');
    });
  });

  it('renders user name in the story header', async () => {
    const { StoryViewer } = await import('./StoryViewer');
    render(
      <StoryViewer
        storyUsers={[makeStoryUser({ name: 'Alice Example' })]}
        initialUserIndex={0}
        onClose={onClose}
      />
    );
    // avatar stub renders the name
    await waitFor(() => {
      const avatarEls = screen.getAllByTestId('avatar');
      const hasAlice = avatarEls.some((el) => el.textContent?.includes('Alice'));
      expect(hasAlice).toBe(true);
    });
  });

  // AWID accessibility report, Oct 2026: the description was hard-coded English.
  it('describes an image story in the reader\'s language, not hard-coded English', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: [{ ...makeStory({ media_type: 'image', text_content: null }), media_url: '/uploads/stories/1.jpg' }],
    });
    const { StoryViewer } = await import('./StoryViewer');
    render(
      <StoryViewer
        storyUsers={[makeStoryUser()]}
        initialUserIndex={0}
        onClose={onClose}
      />
    );
    // The test i18n setup loads English only, where both read alike, so also
    // pin that the description comes from the translated `viewer.story_from`.
    expect(await screen.findByRole('img', { name: 'Story from Alice Example' })).toBeInTheDocument();
    const source = (await import('./StoryViewer.tsx?raw')).default;
    expect(source).not.toContain('`Story from ');
    expect(source).toContain("alt={t('viewer.story_from'");
  });

  it('displays text story content after loading', async () => {
    const { StoryViewer } = await import('./StoryViewer');
    render(
      <StoryViewer
        storyUsers={[makeStoryUser()]}
        initialUserIndex={0}
        onClose={onClose}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('Hello story!')).toBeInTheDocument();
    });
  });

  it('shows progress bars after stories load', async () => {
    const { StoryViewer } = await import('./StoryViewer');
    render(
      <StoryViewer
        storyUsers={[makeStoryUser()]}
        initialUserIndex={0}
        onClose={onClose}
      />
    );
    await waitFor(() => {
      const progressBars = screen.getAllByRole('progressbar');
      expect(progressBars.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows reaction buttons for non-owner viewer', async () => {
    // Current user (id=99) viewing another user (id=10)'s story
    const { StoryViewer } = await import('./StoryViewer');
    render(
      <StoryViewer
        storyUsers={[makeStoryUser({ user_id: 10 }), makeStoryUser({ user_id: 20, name: 'Bob' })]}
        initialUserIndex={0}
        onClose={onClose}
      />
    );
    await waitFor(() => {
      // Reactions should be present (6 reaction buttons)
      const reactBtns = screen.getAllByRole('button').filter((b) =>
        b.getAttribute('aria-label')?.startsWith('React with') ||
        b.getAttribute('aria-label')?.toLowerCase().includes('react')
      );
      expect(reactBtns.length).toBeGreaterThan(0);
    });
  });

  it('shows next user arrow when multiple users present', async () => {
    const { StoryViewer } = await import('./StoryViewer');
    render(
      <StoryViewer
        storyUsers={[makeStoryUser(), makeStoryUser({ user_id: 20, name: 'Bob' })]}
        initialUserIndex={0}
        onClose={onClose}
      />
    );
    await waitFor(() => {
      const nextBtn = screen.queryByRole('button', { name: /next user/i });
      expect(nextBtn).toBeInTheDocument();
    });
  });

  it('shows reply input for non-owner on non-poll story', async () => {
    const { StoryViewer } = await import('./StoryViewer');
    render(
      <StoryViewer
        storyUsers={[makeStoryUser({ user_id: 10 }), makeStoryUser({ user_id: 20 })]}
        initialUserIndex={0}
        onClose={onClose}
      />
    );
    await waitFor(() => {
      const replyInput = screen.queryByRole('textbox');
      expect(replyInput).toBeInTheDocument();
    });
  });

  it('keeps the reply text and shows an error (not a fake success) when the reply returns success:false', async () => {
    // Regression: handleReply did an UNCHECKED `await api.post(.../reply)` then a
    // success toast + cleared the text. api.post resolves { success:false } on a 4xx
    // WITHOUT throwing, so a rejected reply used to show a fake "reply sent" toast AND
    // wipe the user's typed text while the DM was never delivered. It must keep the text
    // and show an error instead.
    mockApi.post.mockResolvedValue({ success: false, error: 'Cannot send' });
    const { StoryViewer } = await import('./StoryViewer');
    render(
      <StoryViewer
        storyUsers={[makeStoryUser({ user_id: 10 }), makeStoryUser({ user_id: 20 })]}
        initialUserIndex={0}
        onClose={onClose}
      />
    );

    const input = await screen.findByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Hello there' } });
    // The send button appears once there is text; click it (onPress = handleReply).
    const sendBtn = await waitFor(() => {
      const b = screen.getAllByRole('button').find((btn) => /send/i.test(btn.getAttribute('aria-label') ?? ''));
      if (!b) throw new Error('send button not shown');
      return b;
    });
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        expect.stringContaining('/reply'),
        expect.objectContaining({ body: 'Hello there' }),
      );
    });
    // The DM was not delivered: the text is kept (not cleared) and an error (not a fake
    // "sent" toast) is shown.
    expect((input as HTMLInputElement).value).toBe('Hello there');
    expect(mockToast.error).toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', async () => {
    const mockClose = vi.fn();
    const { StoryViewer } = await import('./StoryViewer');
    render(
      <StoryViewer
        storyUsers={[makeStoryUser()]}
        initialUserIndex={0}
        onClose={mockClose}
      />
    );
    // Simulate Escape
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => {
      expect(mockClose).toHaveBeenCalled();
    });
  });

  it('renders poll story with vote options', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: [
        makeStory({
          media_type: 'poll',
          text_content: null,
          // @ts-expect-error extra fields allowed by overrides
          poll_question: 'Cats or dogs?',
          poll_options: ['Cats', 'Dogs'],
        }),
      ],
    });
    const { StoryViewer } = await import('./StoryViewer');
    render(
      <StoryViewer
        storyUsers={[makeStoryUser()]}
        initialUserIndex={0}
        onClose={onClose}
      />
    );
    await waitFor(() => {
      expect(screen.getByText('Cats or dogs?')).toBeInTheDocument();
      expect(screen.getByText('Cats')).toBeInTheDocument();
      expect(screen.getByText('Dogs')).toBeInTheDocument();
    });
  });
});
