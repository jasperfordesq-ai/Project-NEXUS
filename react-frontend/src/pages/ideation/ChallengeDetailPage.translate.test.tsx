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
  resolveAvatarUrl: (url: string | null | undefined) => url ?? '',
  resolveAssetUrl: (url: string | null | undefined) => url ?? '',
  resolveThumbnailUrl: (url: string | null | undefined) => url ?? '',
  formatRelativeTime: (d: string | null | undefined) => d ?? '',
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
  meta: { cursor: null, has_more: false, per_page: 20 },
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

// Owner, 31 Oct 2026: the challenge itself, not only its ideas and comments,
// must be translatable. One Translate press translates description and title.
describe('ChallengeDetailPage — Translate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.current = {
      user: { id: 1, first_name: 'Test', name: 'Test User', role: 'member' },
      isAuthenticated: true,
    };
    setupMocks();
    vi.mocked(api.post).mockImplementation((_url: string, body?: unknown) => {
      const type = (body as { content_type: string }).content_type;
      return Promise.resolve({
        success: true,
        data: {
          translated_text: type === 'ideation_challenge_title' ? 'Défi zéro déchet' : 'Partagez vos meilleures astuces zéro déchet.',
          source_locale: 'en',
          target_locale: 'fr',
          cached: false,
        },
      });
    });
  });

  it('translates the description and title together, then restores the original', async () => {
    render(<ChallengeDetailPage />);
    await screen.findByRole('heading', { level: 1, name: 'Zero-Waste Living Challenge' });

    fireEvent.click(screen.getByRole('button', { name: 'translate.translate' }));

    await screen.findByText('Partagez vos meilleures astuces zéro déchet.');
    expect(screen.getByRole('heading', { level: 1, name: 'Défi zéro déchet' })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'ideation_challenge',
      content_id: 3,
      source_text: 'Share your best zero-waste living tips with the community.',
    }));
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'ideation_challenge_title',
      content_id: 3,
      source_text: 'Zero-Waste Living Challenge',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'translate.show_original' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Zero-Waste Living Challenge' })).toBeInTheDocument());
    expect(screen.getByText('Share your best zero-waste living tips with the community.')).toBeInTheDocument();
  });
});
