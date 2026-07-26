// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
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
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn(),
  },
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, opts?: Record<string, unknown>) =>
      (opts?.fallbackValue as string | undefined) ?? key,
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
    useParams: () => ({ id: '3' }),
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
// ChallengeDetailPage itself imports the barrel, but PageMeta
// (src/components/seo/PageMeta.tsx:26) imports `useTenant` from
// '@/contexts/TenantContext'. Vitest's mock registry is keyed per-specifier, so a
// `vi.mock('@/contexts', ...)` override never reached that import: the real hook
// loaded and threw "useTenant must be used within a TenantProvider"
// (TenantContext.tsx:722), killing every test that got past the loading state.
// (src/test/setup.ts:70 tries to neutralise PageMeta globally, but it mocks the
// '@/components/seo' barrel, which this page also bypasses.)
// Mocking the direct path fixes BOTH importers — the real '@/contexts' barrel just
// re-exports the mocked module, which is also how SocialInteractionPanel and its
// children (useAuth/useTenant/useToast via the barrel) get their values.
// The factories are TOTAL (no importOriginal spread) on purpose: TenantContext
// imports '@/i18n', whose module scope calls i18next.init() with an HTTP backend
// and would clobber the synchronous English resources src/test/setup.ts loads.
// Every name '@/contexts' re-exports from these modules must be present, or the
// barrel's re-export fails to link.
const authState = vi.hoisted(() => ({
  current: {
    user: { id: 1, first_name: 'Test', name: 'Test User', role: 'member' },
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

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: (url: string | null) => url ?? '',
  resolveAssetUrl: (url: string | null) => url ?? '',
  resolveThumbnailUrl: (url: string | null) => url ?? '',
  formatRelativeTime: (d: string) => d,
}));

import { ChallengeDetailPage } from './ChallengeDetailPage';

const mockChallenge = {
  id: 3,
  tenant_id: 2,
  user_id: 5,
  title: 'Zero-Waste Living Challenge',
  description: 'Share your best zero-waste living tips with the community.',
  category: 'Environment',
  status: 'open' as const,
  ideas_count: 7,
  submission_deadline: '2026-12-01T00:00:00Z',
  voting_deadline: null,
  prize_description: '€200 reward',
  max_ideas_per_user: 2,
  created_at: '2026-01-10T10:00:00Z',
  user_idea_count: 0,
  tags: ['waste', 'sustainability'],
  cover_image: null,
  is_favorited: false,
  favorites_count: 5,
  views_count: 73,
  is_featured: false,
  campaign_id: null,
  campaign_name: null,
  creator: { id: 5, name: 'Admin User', avatar_url: null },
};

const mockIdeas = [
  {
    id: 201,
    challenge_id: 3,
    user_id: 10,
    title: 'Reusable Shopping Bags',
    description: 'Bring your own bags to every shop.',
    votes_count: 14,
    comments_count: 3,
    status: 'submitted' as const,
    has_voted: false,
    created_at: '2026-02-01T10:00:00Z',
    image_url: null,
    media: [],
    creator: { id: 10, name: 'Alice Member', avatar_url: null },
  },
];

const mockIdeasResponse = {
  success: true,
  data: mockIdeas,
  meta: { cursor: null, has_more: false },
};

function setupMocks() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('/ideas')) {
      return Promise.resolve(mockIdeasResponse);
    }
    if (url.includes('/drafts')) {
      return Promise.resolve({ success: true, data: [] });
    }
    return Promise.resolve({ success: true, data: mockChallenge });
  });
}

describe('ChallengeDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.current = {
      user: { id: 1, first_name: 'Test', name: 'Test User', role: 'member' },
      isAuthenticated: true,
    };
  });

  it('renders challenge title and description on success', async () => {
    setupMocks();
    render(<ChallengeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Zero-Waste Living Challenge')).toBeInTheDocument();
    });
    expect(screen.getByText('Share your best zero-waste living tips with the community.')).toBeInTheDocument();
  });

  it('renders submitted ideas on success', async () => {
    setupMocks();
    render(<ChallengeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Reusable Shopping Bags')).toBeInTheDocument();
    });
  });

  it('shows error state when challenge fetch fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<ChallengeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('challenges.load_error')).toBeInTheDocument();
    });
  });

  it('shows Submit Idea button for open challenges when authenticated', async () => {
    setupMocks();
    render(<ChallengeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Zero-Waste Living Challenge')).toBeInTheDocument();
    });
    expect(screen.getByText('ideas.submit')).toBeInTheDocument();
  });

  it('shows admin controls for admin users', async () => {
    // Persist the admin identity for the whole render: useAuth is re-read on every
    // commit, so it must not revert to `member` when a fetch resolves.
    authState.current = {
      user: { id: 1, first_name: 'Admin', name: 'Admin User', role: 'admin' },
      isAuthenticated: true,
    };

    setupMocks();
    render(<ChallengeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Zero-Waste Living Challenge')).toBeInTheDocument();
    });
    // Admin dropdown menu trigger should be present
    expect(screen.getByRole('button', { name: 'challenge_detail.actions' })).toBeInTheDocument();
  });

  it('shows prize description when set', async () => {
    setupMocks();
    render(<ChallengeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('€200 reward')).toBeInTheDocument();
    });
  });

  it('calls the challenge API with correct endpoint', async () => {
    setupMocks();
    render(<ChallengeDetailPage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('/v2/ideation-challenges/3'),
      );
    });
  });

  it('shows empty ideas state when no ideas submitted', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/ideas')) {
        return Promise.resolve({ success: true, data: [], meta: { cursor: null, has_more: false } });
      }
      if (url.includes('/drafts')) {
        return Promise.resolve({ success: true, data: [] });
      }
      return Promise.resolve({ success: true, data: mockChallenge });
    });
    render(<ChallengeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Zero-Waste Living Challenge')).toBeInTheDocument();
    });
    // Positive precondition for the absence assertion: the ideas section actually
    // resolved into its empty state (ChallengeDetailPage.tsx:1137-1154) rather than
    // still spinning.
    expect(screen.getByText('ideas.empty_title')).toBeInTheDocument();
    expect(screen.getByText('ideas.empty_description')).toBeInTheDocument();
    expect(screen.queryByText('Reusable Shopping Bags')).not.toBeInTheDocument();
  });
});
