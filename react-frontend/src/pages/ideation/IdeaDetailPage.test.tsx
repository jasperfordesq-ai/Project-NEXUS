// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { api } from '@/lib/api';
import type { ReactNode } from 'react';

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: { children?: ReactNode; [k: string]: unknown }) => {
      const { variants: _v, initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props as Record<string, unknown>;
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const translations: Record<string, string> = {
        'idea_detail.actions': 'Idea actions',
      };

      return translations[key] ?? (opts?.fallbackValue as string | undefined) ?? key;
    },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await import('react-router-dom');
  const React = await import('react');
  return {
    ...actual,
    Link: ({ children, to, ...rest }: { children: ReactNode; to: string; [k: string]: unknown }) =>
      React.createElement('a', { href: String(to), ...rest }, children),
    useNavigate: () => vi.fn(),
    useParams: () => ({ challengeId: '3', id: '201' }),
  };
});

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

// 🔴 Mock the context modules by their DIRECT paths, NOT the '@/contexts' barrel.
// IdeaDetailPage itself imports the barrel, but PageMeta
// (src/components/seo/PageMeta.tsx:26) imports `useTenant` from
// '@/contexts/TenantContext'. Vitest's mock registry is keyed per-specifier, so a
// `vi.mock('@/contexts', ...)` override never reached that import: the real hook
// loaded and threw "useTenant must be used within a TenantProvider"
// (TenantContext.tsx:722), killing every test in this file. (src/test/setup.ts:70
// tries to neutralise PageMeta globally, but it mocks the '@/components/seo'
// barrel, which this page also bypasses.)
// Mocking the direct path fixes BOTH importers — the real '@/contexts' barrel just
// re-exports the mocked module — so no barrel mock belongs here.
// ToastContext is deliberately left REAL: src/test/test-utils.tsx already wraps
// every render in a real <ToastProvider>, so the tests below assert the error toast
// the user actually sees instead of a spy call.
// The factories are TOTAL (no importOriginal spread) on purpose: TenantContext
// imports '@/i18n', whose module scope calls i18next.init() with an HTTP backend
// and would clobber the synchronous English resources src/test/setup.ts loads.
// Every name '@/contexts' re-exports from these modules must be present, or the
// barrel's re-export fails to link.
const authState = vi.hoisted(() => ({
  current: {
    user: { id: 10, first_name: 'Alice', name: 'Alice Member', role: 'member' },
    isAuthenticated: true,
  } as { user: { id: number; first_name: string; name: string; role: string }; isAuthenticated: boolean },
}));

vi.mock('@/contexts/TenantContext', () => ({
  TenantProvider: ({ children }: { children: ReactNode }) => children,
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantSlug: 'test',
    branding: { name: 'Test Tenant' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: () => true,
    hasModule: () => true,
  }),
  useFeature: () => true,
  useModule: () => true,
}));

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => authState.current,
  useAuthOptional: () => authState.current,
}));

// IdeaDetailPage calls useConfirm() unconditionally at the top of the component
// (IdeaDetailPage.tsx:104) and imports it from the DIRECT path
// '@/components/ui/ConfirmDialog'. The real hook needs a <ConfirmDialogProvider>
// (absent from test-utils) plus a lazy portal round-trip to resolve — infrastructure
// this page test has no business owning — so only the hook is stubbed; every other
// export of the module stays real.
const mockConfirm = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/components/ui/ConfirmDialog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/ConfirmDialog')>()),
  useConfirm: () => mockConfirm,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null) => url ?? '',
  formatRelativeTime: (d: string) => d,
}));

// NOTE: there is deliberately no '@/components/ui' barrel mock here. IdeaDetailPage
// imports every UI primitive by its direct path (IdeaDetailPage.tsx:1-12), so the
// uiMock barrel override was dead code — the real components rendered anyway and the
// assertions below target their real DOM.

import { IdeaDetailPage } from './IdeaDetailPage';

const mockIdea = {
  id: 201,
  challenge_id: 3,
  user_id: 10,
  title: 'Reusable Shopping Bags',
  description: 'Bring reusable bags to every grocery trip to reduce plastic waste.',
  votes_count: 14,
  comments_count: 1,
  status: 'submitted' as const,
  has_voted: false,
  created_at: '2026-02-01T10:00:00Z',
  creator: { id: 10, name: 'Alice Member', avatar_url: null },
};

const mockComments = [
  {
    id: 501,
    idea_id: 201,
    user_id: 20,
    body: 'Great idea! I already do this.',
    created_at: '2026-02-05T08:00:00Z',
    author: { id: 20, name: 'Bob Commenter', avatar_url: null },
  },
];

const mockCommentsResponse = {
  success: true,
  data: mockComments,
  meta: { cursor: null, has_more: false },
};

function setupMocks() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('/comments')) {
      return Promise.resolve(mockCommentsResponse);
    }
    return Promise.resolve({ success: true, data: mockIdea });
  });
}

describe('IdeaDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfirm.mockResolvedValue(true);
    authState.current = {
      user: { id: 10, first_name: 'Alice', name: 'Alice Member', role: 'member' },
      isAuthenticated: true,
    };
  });

  it('renders idea title and description on success', async () => {
    setupMocks();
    render(<IdeaDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Reusable Shopping Bags')).toBeInTheDocument();
    });
    expect(screen.getByText('Bring reusable bags to every grocery trip to reduce plastic waste.')).toBeInTheDocument();
  });

  it('renders comments on success', async () => {
    setupMocks();
    render(<IdeaDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Great idea! I already do this.')).toBeInTheDocument();
    });
  });

  it('shows error state when API fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<IdeaDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('ideas.load_error')).toBeInTheDocument();
    });
  });

  it('shows vote button with count', async () => {
    setupMocks();
    render(<IdeaDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Reusable Shopping Bags')).toBeInTheDocument();
    });
    expect(screen.getByText('14')).toBeInTheDocument();
  });

  it('shows an error toast when a vote fails (no silent failure)', async () => {
    // Regression: handleVote checked only `if (response.data)` (not response.success)
    // and had no else branch, so a failed vote — which api.post resolves as
    // { success: false } WITHOUT throwing — silently did nothing (no update, no
    // feedback). Live-verified on the running app. Now it shows an error toast.
    setupMocks();
    vi.mocked(api.post).mockResolvedValue({ success: false, error: 'Voting is closed' } as never);

    render(<IdeaDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Reusable Shopping Bags')).toBeInTheDocument();
    });

    const voteBtn = screen.getByRole('button', { name: 'ideas.vote' });
    fireEvent.click(voteBtn);

    // The real ToastProvider from test-utils renders the message, so assert the
    // feedback the user actually gets — not merely that a spy was called.
    await waitFor(() => {
      expect(screen.getByText('toast.error_generic')).toBeInTheDocument();
    });
    // The failed vote must not have optimistically bumped the count.
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.queryByText('15')).not.toBeInTheDocument();
  });

  it('shows an error toast (no fake success) when posting a comment fails', async () => {
    // Regression: handlePostComment showed an unconditional success toast and cleared
    // the input after `await api.post(...)` without checking response.success — a
    // failed post (4xx → { success: false }, no throw) faked a posted comment and
    // discarded the user's text. Live-verified. (Same class as the vote fix above and
    // the group-exchange/bookmark actions.)
    setupMocks();
    vi.mocked(api.post).mockResolvedValue({ success: false, error: 'nope' } as never);

    render(<IdeaDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Reusable Shopping Bags')).toBeInTheDocument();
    });

    const commentInput = screen.getByPlaceholderText('comments.add_placeholder');
    fireEvent.change(commentInput, { target: { value: 'My comment' } });
    fireEvent.click(screen.getByRole('button', { name: /add_button/i }));

    // The server's message is surfaced verbatim via the real ToastProvider...
    await waitFor(() => expect(screen.getByText('nope')).toBeInTheDocument());
    // ...no fake success toast...
    expect(screen.queryByText('toast.comment_added')).not.toBeInTheDocument();
    // ...and the user's text is preserved rather than discarded.
    expect(commentInput).toHaveValue('My comment');
  });

  it('shows comment form for authenticated users', async () => {
    setupMocks();
    render(<IdeaDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Reusable Shopping Bags')).toBeInTheDocument();
    });
    expect(screen.getByPlaceholderText('comments.add_placeholder')).toBeInTheDocument();
  });

  it('shows creator name', async () => {
    setupMocks();
    render(<IdeaDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Reusable Shopping Bags')).toBeInTheDocument();
    });
    // The "submitted by" byline is rendered (the mocked t() collapses it to its key)...
    expect(screen.getByText('idea_detail.submitted_by')).toBeInTheDocument();
    // ...and the creator's Avatar is fed the creator's name: with no avatar_url the
    // real Avatar falls back to initials derived from `name` (Avatar.tsx:143 →
    // initialsFromName), so "Alice Member" surfaces as "AM". The old
    // `[name="Alice Member"]` selector only ever matched the dead uiMock stub, which
    // spread the prop straight onto a DOM node.
    expect(screen.getByText('AM')).toBeInTheDocument();
  });

  it('shows admin controls for admin users', async () => {
    // Persist the admin identity for the whole render: useAuth is re-read on every
    // commit, so it must not revert to `member` when a fetch resolves.
    authState.current = {
      user: { id: 1, first_name: 'Admin', name: 'Admin User', role: 'admin' },
      isAuthenticated: true,
    };

    setupMocks();
    render(<IdeaDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Reusable Shopping Bags')).toBeInTheDocument();
    });
    // Admin dropdown with status controls — the trigger button has aria-label="Idea actions"
    expect(screen.getByRole('button', { name: /Idea actions/i })).toBeInTheDocument();
  });

  it('calls the correct API endpoints on mount', async () => {
    setupMocks();
    render(<IdeaDetailPage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('/v2/ideation-ideas/201'),
      );
    });
    expect(api.get).toHaveBeenCalledWith(
      expect.stringContaining('/v2/ideation-ideas/201/comments'),
    );
  });
});
