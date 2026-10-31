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
    // The shared Translate button reads the reader's language.
    i18n: { language: 'en', resolvedLanguage: 'en' },
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
  resolveAvatarUrl: (url: string | null | undefined) => url ?? '',
  formatRelativeTime: (d: string | null | undefined) => d ?? '',
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
  meta: { cursor: null, has_more: false, per_page: 20 },
};

function setupMocks() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('/comments')) {
      return Promise.resolve(mockCommentsResponse);
    }
    return Promise.resolve({ success: true, data: mockIdea });
  });
}

// Owner, 31 Oct 2026: the idea itself, not only its comments, must be
// translatable. One Translate press translates the description and the title.
describe('IdeaDetailPage — Translate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
    vi.mocked(api.post).mockImplementation((_url: string, body?: unknown) => {
      const type = (body as { content_type: string }).content_type;
      return Promise.resolve({
        success: true,
        data: {
          translated_text: type === 'ideation_idea_title' ? 'Sacs réutilisables' : 'Apportez des sacs réutilisables à chaque course.',
          source_locale: 'en',
          target_locale: 'fr',
          cached: false,
        },
      });
    });
  });

  it('translates the description and title together, then restores the original', async () => {
    render(<IdeaDetailPage />);
    await screen.findByRole('heading', { level: 1, name: 'Reusable Shopping Bags' });

    fireEvent.click(screen.getByRole('button', { name: 'translate.translate' }));

    await screen.findByText('Apportez des sacs réutilisables à chaque course.');
    expect(screen.getByRole('heading', { level: 1, name: 'Sacs réutilisables' })).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'ideation_idea',
      content_id: 201,
      source_text: 'Bring reusable bags to every grocery trip to reduce plastic waste.',
    }));
    expect(api.post).toHaveBeenCalledWith('/v2/ugc-translate', expect.objectContaining({
      content_type: 'ideation_idea_title',
      content_id: 201,
      source_text: 'Reusable Shopping Bags',
    }));

    fireEvent.click(screen.getByRole('button', { name: 'translate.show_original' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Reusable Shopping Bags' })).toBeInTheDocument());
    expect(screen.getByText('Bring reusable bags to every grocery trip to reduce plastic waste.')).toBeInTheDocument();
  });
});
