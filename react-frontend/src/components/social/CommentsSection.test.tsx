// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { within } from '@testing-library/react';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import userEvent from '@testing-library/user-event';
import type { CommentsSectionProps } from './CommentsSection';

// Stable toast.error spy so failure-path tests can assert the error toast fired.
const toastErrorSpy = vi.hoisted(() => vi.fn());

// ─── Stubs for imports ───────────────────────────────────────────────────────
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null) => url ?? '',
  formatRelativeTime: () => '5 minutes ago',
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useToast: () => ({ success: vi.fn(), error: toastErrorSpy, info: vi.fn(), warning: vi.fn() }),
  })
);

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [key: string]: unknown }) => (
      <a href={to} {...(rest as object)}>{children}</a>
    ),
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/', search: '', hash: '' }),
  };
});

// ─── Stub motion ─────────────────────────────────────────────────────────────
vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...rest }: { children: React.ReactNode; [key: string]: unknown }) => (
      <div {...(rest as object)}>{children}</div>
    ),
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Stub heavy child components ──────────────────────────────────────────────
vi.mock('./MentionRenderer', () => ({
  MentionRenderer: ({ text }: { text: string }) => <span>{text}</span>,
}));

vi.mock('./UserHoverCard', () => ({
  UserHoverCard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/SafeHtml', () => ({
  SafeHtml: ({ content, ...rest }: { content: string; [key: string]: unknown }) => (
    <div dangerouslySetInnerHTML={{ __html: content }} {...(rest as object)} />
  ),
  containsHtml: (content: string) => /<[a-z][\s\S]*>/i.test(content),
}));

vi.mock('@/hooks/useSocialInteractions', () => ({
  AVAILABLE_REACTIONS: ['like', 'love', 'laugh', 'wow', 'sad', 'celebrate'],
  COMMENT_REACTION_EMOJI_MAP: {
    like: '👍',
    love: '❤️',
    laugh: '😂',
    wow: '😮',
    sad: '😢',
    celebrate: '🎉',
  },
}));

// ─── Stub HeroUI components ───────────────────────────────────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    Modal: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
      isOpen ? <div role="dialog" aria-label="Dialog">{children}</div> : null,
    ModalContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    ModalFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Avatar: ({ name }: { name?: string }) => <div data-testid="avatar" aria-label={name}>{name}</div>,
    Skeleton: () => <div data-testid="skeleton" />,
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    Textarea: ({ value, onChange, ...rest }: {
      value?: string;
      onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
      [key: string]: unknown;
    }) => (
      <textarea value={value} onChange={onChange} {...(rest as object)} />
    ),
    Input: ({ value, onChange, placeholder, endContent, ...rest }: {
      value?: string;
      onChange?: (val: string) => void;
      placeholder?: string;
      endContent?: React.ReactNode;
      [key: string]: unknown;
    }) => (
      <span>
        <input
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
          aria-label={(rest as Record<string, string>)['aria-label'] || placeholder}
        />
        {endContent}
      </span>
    ),
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────
function makeComment(overrides: Partial<{
  id: number;
  content: string;
  created_at: string;
  edited: boolean;
  is_own: boolean;
  author: { id: number; name: string; avatar: string | null };
  reactions: Record<string, number>;
  user_reactions: string[];
  replies: unknown[];
}> = {}) {
  return {
    id: 1,
    content: 'This is a test comment.',
    created_at: new Date().toISOString(),
    edited: false,
    is_own: false,
    author: { id: 10, name: 'Jane Doe', avatar: null },
    reactions: {},
    user_reactions: [],
    replies: [],
    ...overrides,
  };
}

function makeProps(overrides: Partial<CommentsSectionProps> = {}): CommentsSectionProps {
  return {
    comments: [],
    commentsCount: 0,
    commentsLoading: false,
    commentsLoaded: true,
    loadComments: vi.fn(async () => {}),
    submitComment: vi.fn(async () => true),
    editComment: vi.fn(async () => true),
    deleteComment: vi.fn(async () => true),
    toggleReaction: vi.fn(async () => {}),
    isAuthenticated: false,
    currentUserId: undefined,
    currentUserAvatar: undefined,
    currentUserName: undefined,
    searchMentions: undefined,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('CommentsSection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders without crashing', async () => {
    const { CommentsSection } = await import('./CommentsSection');
    render(<CommentsSection {...makeProps()} />);
    // Use heading role to avoid matching multiple "comments" text nodes
    expect(screen.getByRole('heading', { name: /comments/i })).toBeInTheDocument();
  });

  it('shows empty state when no comments and loaded', async () => {
    const { CommentsSection } = await import('./CommentsSection');
    render(<CommentsSection {...makeProps({ comments: [], commentsLoaded: true })} />);
    expect(screen.getByText(/no comments yet/i)).toBeInTheDocument();
  });

  it('shows loading skeletons when commentsLoading is true', async () => {
    const { CommentsSection } = await import('./CommentsSection');
    render(<CommentsSection {...makeProps({ commentsLoading: true, commentsLoaded: false })} />);
    const skeletons = screen.getAllByTestId('skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders list of comments when provided', async () => {
    const { CommentsSection } = await import('./CommentsSection');
    render(
      <CommentsSection
        {...makeProps({
          comments: [makeComment({ content: 'Hello world!' }), makeComment({ id: 2, content: 'Second comment' })],
          commentsCount: 2,
          commentsLoaded: true,
        })}
      />
    );
    expect(screen.getByText('Hello world!')).toBeInTheDocument();
    expect(screen.getByText('Second comment')).toBeInTheDocument();
  });

  it('shows comment input when user is authenticated', async () => {
    const { CommentsSection } = await import('./CommentsSection');
    render(
      <CommentsSection
        {...makeProps({
          isAuthenticated: true,
          currentUserId: 5,
          currentUserName: 'Me',
        })}
      />
    );
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
  });

  it('does not show comment input when unauthenticated', async () => {
    const { CommentsSection } = await import('./CommentsSection');
    render(<CommentsSection {...makeProps({ isAuthenticated: false })} />);
    const input = screen.queryByRole('textbox');
    expect(input).not.toBeInTheDocument();
  });

  it('shows the send comment button when authenticated with text input', async () => {
    const submitComment = vi.fn(async () => true);
    const { CommentsSection } = await import('./CommentsSection');
    render(
      <CommentsSection
        {...makeProps({
          isAuthenticated: true,
          currentUserId: 5,
          submitComment,
        })}
      />
    );
    // The send button is rendered in the Input's endContent
    const sendBtn = screen.getByRole('button', { name: /send comment/i });
    expect(sendBtn).toBeInTheDocument();
    // Button should be initially disabled (no text entered)
    expect(sendBtn).toBeDisabled();
  });

  it('shows comment count in header when non-zero', async () => {
    const { CommentsSection } = await import('./CommentsSection');
    render(
      <CommentsSection
        {...makeProps({
          comments: [makeComment()],
          commentsCount: 7,
          commentsLoaded: true,
        })}
      />
    );
    expect(screen.getByText(/\(7\)/)).toBeInTheDocument();
  });

  it('shows edit and delete buttons for own comments', async () => {
    const { CommentsSection } = await import('./CommentsSection');
    render(
      <CommentsSection
        {...makeProps({
          comments: [makeComment({ is_own: true, author: { id: 5, name: 'Me', avatar: null } })],
          commentsLoaded: true,
          isAuthenticated: true,
          currentUserId: 5,
        })}
      />
    );
    // Edit and delete buttons should be present for own comment
    const editBtn = screen.queryByRole('button', { name: /edit/i });
    const deleteBtn = screen.queryByRole('button', { name: /delete/i });
    expect(editBtn).toBeInTheDocument();
    expect(deleteBtn).toBeInTheDocument();
  });

  it('does not show edit/delete buttons for other users comments', async () => {
    const { CommentsSection } = await import('./CommentsSection');
    render(
      <CommentsSection
        {...makeProps({
          comments: [makeComment({ is_own: false, author: { id: 99, name: 'Other', avatar: null } })],
          commentsLoaded: true,
          isAuthenticated: true,
          currentUserId: 5,
        })}
      />
    );
    const editBtn = screen.queryByRole('button', { name: /edit/i });
    const deleteBtn = screen.queryByRole('button', { name: /delete/i });
    expect(editBtn).not.toBeInTheDocument();
    expect(deleteBtn).not.toBeInTheDocument();
  });

  it('shows delete confirmation dialog when delete is clicked on own comment', async () => {
    const { CommentsSection } = await import('./CommentsSection');
    render(
      <CommentsSection
        {...makeProps({
          comments: [makeComment({ is_own: true, author: { id: 5, name: 'Me', avatar: null } })],
          commentsLoaded: true,
          isAuthenticated: true,
          currentUserId: 5,
        })}
      />
    );
    const deleteBtn = screen.getByRole('button', { name: /delete/i });
    await userEvent.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('loads comments on mount when not yet loaded', async () => {
    const loadComments = vi.fn(async () => {});
    const { CommentsSection } = await import('./CommentsSection');
    render(
      <CommentsSection
        {...makeProps({
          commentsLoaded: false,
          commentsLoading: false,
          loadComments,
        })}
      />
    );
    await waitFor(() => {
      expect(loadComments).toHaveBeenCalled();
    });
  });

  it('shows reply button for top-level authenticated comments', async () => {
    const { CommentsSection } = await import('./CommentsSection');
    render(
      <CommentsSection
        {...makeProps({
          comments: [makeComment()],
          commentsLoaded: true,
          isAuthenticated: true,
          currentUserId: 5,
        })}
      />
    );
    const replyBtn = screen.getByRole('button', { name: /reply/i });
    expect(replyBtn).toBeInTheDocument();
  });

  it('shows reaction display when comment has reactions', async () => {
    const { CommentsSection } = await import('./CommentsSection');
    render(
      <CommentsSection
        {...makeProps({
          comments: [makeComment({ reactions: { like: 3, love: 1 } })],
          commentsLoaded: true,
          isAuthenticated: true,
          currentUserId: 5,
        })}
      />
    );
    // Reaction badges should show the emoji + count
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  // ─── Regression: failed comment mutations must surface, not fake success ──────
  // api.* resolves { success:false } on a 4xx WITHOUT throwing, and a 4xx gets no
  // global toast. These handlers used to ignore the returned boolean: the delete
  // dialog closed as if it worked, and a failed edit/post gave zero feedback.

  it('keeps the delete dialog open and shows an error when the delete is rejected', async () => {
    const deleteComment = vi.fn(async () => false);
    const { CommentsSection } = await import('./CommentsSection');
    render(
      <CommentsSection
        {...makeProps({
          comments: [makeComment({ is_own: true, author: { id: 5, name: 'Me', avatar: null } })],
          commentsLoaded: true,
          isAuthenticated: true,
          currentUserId: 5,
          deleteComment,
        })}
      />
    );
    // Open the confirmation dialog (only the action-row Delete exists at this point)
    await userEvent.click(screen.getByRole('button', { name: /delete/i }));
    const dialog = await screen.findByRole('dialog');
    // Confirm the deletion (the Delete button inside the dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(deleteComment).toHaveBeenCalledWith(1));
    // Pre-fix: the dialog closed unconditionally and no toast fired.
    expect(toastErrorSpy).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeInTheDocument();
  });

  it('keeps the editor open and shows an error when an edit is rejected', async () => {
    const editComment = vi.fn(async () => false);
    const { CommentsSection } = await import('./CommentsSection');
    render(
      <CommentsSection
        {...makeProps({
          comments: [makeComment({ is_own: true, content: 'Original text', author: { id: 5, name: 'Me', avatar: null } })],
          commentsLoaded: true,
          isAuthenticated: true,
          currentUserId: 5,
          editComment,
        })}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /edit/i }));
    // Editor opens pre-filled with the existing content; save it unchanged.
    await userEvent.click(await screen.findByRole('button', { name: /save/i }));

    await waitFor(() => expect(editComment).toHaveBeenCalled());
    expect(toastErrorSpy).toHaveBeenCalled();
    // Pre-fix: nothing happened on failure; the editor must stay open to retry.
    expect(screen.getByLabelText('Edit comment')).toBeInTheDocument();
  });

  it('shows react button for authenticated users to pick a reaction', async () => {
    const { CommentsSection } = await import('./CommentsSection');
    render(
      <CommentsSection
        {...makeProps({
          comments: [makeComment()],
          commentsLoaded: true,
          isAuthenticated: true,
          currentUserId: 5,
        })}
      />
    );
    const reactBtn = screen.getByRole('button', { name: /react/i });
    expect(reactBtn).toBeInTheDocument();
    // Click react to open picker
    fireEvent.click(reactBtn);
    await waitFor(() => {
      // Reaction picker should appear with emoji buttons
      const emojiButtons = screen.getAllByRole('button').filter((b) =>
        b.getAttribute('aria-label')?.startsWith('reaction.')
        || b.textContent?.includes('👍')
        || b.textContent?.includes('❤️')
      );
      expect(emojiButtons.length).toBeGreaterThan(0);
    });
  });

  // F-568 (E-093): the comment box is a plain text box. Cyphere's F-562 retest
  // payload and any other tag a member types must come out as words, never as
  // a link, heading or image. The SafeHtml mock above renders raw HTML, so this
  // only passes when CommentsSection no longer hands comment text to SafeHtml.
  describe('comments are words, never markup (F-568)', () => {
    it("shows Cyphere's payload as plain words with no link", async () => {
      const { CommentsSection } = await import('./CommentsSection');
      const { container } = render(
        <CommentsSection
          {...makeProps({
            comments: [makeComment({ content: '<a href="https://google.com">Click here to re-authenticate</a>' })],
            commentsCount: 1,
            commentsLoaded: true,
          })}
        />
      );
      expect(screen.getByText('Click here to re-authenticate')).toBeInTheDocument();
      expect(container.querySelector('a[href="https://google.com"]')).toBeNull();
    });

    it('shows a heading and an image as words only', async () => {
      const { CommentsSection } = await import('./CommentsSection');
      const { container } = render(
        <CommentsSection
          {...makeProps({
            comments: [makeComment({ content: '<h1>Your session has expired</h1><img src="https://evil.example/x.png" alt="Sign in">' })],
            commentsCount: 1,
            commentsLoaded: true,
          })}
        />
      );
      expect(screen.getByText('Your session has expired')).toBeInTheDocument();
      expect(container.querySelector('h1')).toBeNull();
      expect(container.querySelector('img[src="https://evil.example/x.png"]')).toBeNull();
    });
  });
});
