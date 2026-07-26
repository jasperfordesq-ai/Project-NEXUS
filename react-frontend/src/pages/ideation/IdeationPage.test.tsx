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
// IdeationPage itself imports the barrel, but PageMeta
// (src/components/seo/PageMeta.tsx:26) imports `useTenant` from
// '@/contexts/TenantContext'. Vitest's mock registry is keyed per-specifier, so a
// `vi.mock('@/contexts', ...)` override never reached that import: the real hook
// loaded and threw "useTenant must be used within a TenantProvider"
// (TenantContext.tsx:722), killing every test in this file. (src/test/setup.ts:70
// tries to neutralise PageMeta globally, but it mocks the '@/components/seo'
// barrel, which this page also bypasses.)
// Mocking the direct path fixes BOTH importers — the real '@/contexts' barrel
// just re-exports the mocked module — so no barrel mock belongs here.
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
  resolveAssetUrl: (url: string | null) => url ?? '',
  resolveAvatarUrl: (url: string | null) => url ?? '',
  resolveThumbnailUrl: (url: string | null) => url ?? '',
}));

import { IdeationPage } from './IdeationPage';

const mockChallenge = {
  id: 1,
  tenant_id: 2,
  user_id: 5,
  title: 'Reduce Plastic Waste',
  description: 'Submit your best ideas to reduce plastic waste in our community.',
  category: 'Environment',
  status: 'open' as const,
  ideas_count: 12,
  submission_deadline: '2026-12-01T00:00:00Z',
  voting_deadline: null,
  prize_description: '€500 grant',
  max_ideas_per_user: 3,
  created_at: '2026-01-15T10:00:00Z',
  tags: ['sustainability', 'environment'],
  cover_image: null,
  is_favorited: false,
  favorites_count: 7,
  views_count: 120,
  is_featured: false,
  creator: { id: 5, name: 'Admin User', avatar_url: null },
};

const mockChallengesResponse = {
  success: true,
  data: [mockChallenge],
  meta: {
    cursor: null,
    has_more: false,
  },
};

function setupMocks() {
  vi.mocked(api.get).mockImplementation((url: string) => {
    if (url.includes('/v2/ideation-categories')) {
      return Promise.resolve({ success: true, data: [] });
    }
    if (url.includes('/v2/ideation-tags/popular')) {
      return Promise.resolve({ success: true, data: [] });
    }
    if (url.includes('/v2/ideation-challenges')) {
      return Promise.resolve(mockChallengesResponse);
    }
    return Promise.resolve({ success: true, data: [] });
  });
}

describe('IdeationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.current = {
      user: { id: 1, first_name: 'Test', name: 'Test User', role: 'member' },
      isAuthenticated: true,
    };
  });

  it('shows loading state initially', () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<IdeationPage />);
    // The busy live region is what a screen-reader user gets while the first page
    // of challenges is in flight (IdeationPage.tsx:462). getAllByRole because the
    // real Spinner nests its own role="status" span inside it (Spinner.tsx:85);
    // the page's wrapper is the outer one, and the only one marked aria-busy.
    const [pageBusyRegion] = screen.getAllByRole('status', { name: 'loading' });
    expect(pageBusyRegion).toHaveAttribute('aria-busy', 'true');
    // ...and nothing from the resolved list is on screen yet.
    expect(screen.queryByText('challenges.load_more')).not.toBeInTheDocument();
  });

  it('renders challenge cards on success', async () => {
    setupMocks();
    render(<IdeationPage />);
    await waitFor(() => {
      expect(screen.getByText('Reduce Plastic Waste')).toBeInTheDocument();
    });
  });

  it('shows error state when API fails', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/ideation-challenges')) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({ success: true, data: [] });
    });
    render(<IdeationPage />);
    // The error branch renders an alert-role EmptyState carrying the load-error
    // title plus a retry action (IdeationPage.tsx:468-486).
    const alert = await waitFor(() => screen.getByRole('alert'));
    expect(alert).toHaveTextContent('challenges.load_error');
    expect(screen.getByRole('button', { name: 'actions.retry' })).toBeInTheDocument();
    // The grid must not also be showing.
    expect(screen.queryByText('Reduce Plastic Waste')).not.toBeInTheDocument();
  });

  it('shows empty state when no challenges exist', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/ideation-challenges')) {
        return Promise.resolve({ success: true, data: [], meta: { cursor: null, has_more: false } });
      }
      return Promise.resolve({ success: true, data: [] });
    });
    render(<IdeationPage />);
    // Positive precondition first: the empty state actually rendered (otherwise the
    // absence assertion below could pass while the page was still loading/crashed).
    await waitFor(() => {
      expect(screen.getByText('challenges.empty_title')).toBeInTheDocument();
    });
    expect(screen.getByText('challenges.empty_description')).toBeInTheDocument();
    expect(screen.queryByText('Reduce Plastic Waste')).not.toBeInTheDocument();
  });

  it('shows Load More button when has_more is true', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/v2/ideation-challenges')) {
        return Promise.resolve({
          success: true,
          data: [mockChallenge],
          meta: { cursor: 'next-cursor', has_more: true },
        });
      }
      return Promise.resolve({ success: true, data: [] });
    });
    render(<IdeationPage />);
    await waitFor(() => {
      expect(screen.getByText('challenges.load_more')).toBeInTheDocument();
    });
  });

  it('shows admin Create Challenge button for admin users', async () => {
    // Persist the admin identity for the whole render: useAuth is re-read on every
    // commit, so a mockReturnValueOnce would silently revert to `member` as soon as
    // the challenges fetch resolved and re-rendered the header.
    authState.current = {
      user: { id: 1, first_name: 'Admin', name: 'Admin User', role: 'admin' },
      isAuthenticated: true,
    };

    setupMocks();
    render(<IdeationPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'challenges.create' })).toBeInTheDocument();
    });
  });

  it('does not show Create Challenge button for regular members', async () => {
    setupMocks();
    render(<IdeationPage />);
    // Positive precondition: the page finished loading and rendered its content...
    await waitFor(() => {
      expect(screen.getByText('Reduce Plastic Waste')).toBeInTheDocument();
    });
    // ...and the always-visible header actions are there, so the header did render.
    expect(screen.getByRole('button', { name: 'campaigns.title' })).toBeInTheDocument();
    // Only then is the absence of the admin-only action meaningful.
    expect(screen.queryByText('challenges.create')).not.toBeInTheDocument();
  });

  it('calls the correct API endpoint on mount', async () => {
    setupMocks();
    render(<IdeationPage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        expect.stringContaining('/v2/ideation-challenges'),
      );
    });
  });
});
