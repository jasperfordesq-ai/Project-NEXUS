// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for TenantShell component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import React from 'react';

// --- Mocks ---

// Track the tenantSlug passed to TenantProvider
let capturedTenantSlug: string | undefined;

const mockUseTenant = vi.fn();
const mockUseAuth = vi.fn();
const mockRefreshTenant = vi.fn(() => Promise.resolve());
const mockLoadRouteRegistry = vi.hoisted(() => vi.fn());

vi.mock('@/routes/routeRegistryLoader', () => ({
  loadRouteRegistry: (kind: 'auth' | 'public' | 'app') => mockLoadRouteRegistry(kind),
}));

vi.mock('@/contexts', () => ({
  TenantProvider: ({ children, tenantSlug }: { children: React.ReactNode; tenantSlug?: string }) => {
    capturedTenantSlug = tenantSlug;
    return <div data-testid="tenant-provider" data-slug={tenantSlug || ''}>{children}</div>;
  },
  AuthProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="auth-provider">{children}</div>,
  NotificationsProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PusherProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useTenant: (...args: unknown[]) => mockUseTenant(...args),
  useAuth: (...args: unknown[]) => mockUseAuth(...args),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/contexts/TenantContext', () => ({
  TenantProvider: ({ children, tenantSlug }: { children: React.ReactNode; tenantSlug?: string }) => {
    capturedTenantSlug = tenantSlug;
    return <div data-testid="tenant-provider" data-slug={tenantSlug || ''}>{children}</div>;
  },
  useTenant: (...args: unknown[]) => mockUseTenant(...args),
}));

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="auth-provider">{children}</div>,
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
}));

vi.mock('@/contexts/CookieConsentContext', () => ({
  useCookieConsent: () => ({
    consent: null,
    showBanner: false,
    openPreferences: vi.fn(),
    resetConsent: vi.fn(),
    saveConsent: vi.fn(),
    hasConsent: vi.fn(() => true),
    updateConsent: vi.fn(),
  }),
  readStoredConsent: () => null,
}));

vi.mock('@/contexts/NotificationsContext', () => ({
  NotificationsProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/contexts/PusherContext', () => ({
  PusherProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/contexts/MenuContext', () => ({
  MenuProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('./TenantAppProviders', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tenant-app-providers">{children}</div>
  ),
}));

vi.mock('./TenantPublicProviders', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tenant-public-providers">{children}</div>
  ),
}));

const mockDetectTenantFromUrl = vi.fn(() => ({ slug: null, source: null }));

vi.mock('@/lib/tenant-routing', () => ({
  RESERVED_PATHS: new Set([
    'login', 'register', 'dashboard', 'listings', 'events', 'groups',
    'messages', 'notifications', 'wallet', 'feed', 'search', 'members',
    'profile', 'settings', 'admin', 'admin-legacy', 'api', 'assets',
    'help', 'about', 'faq', 'terms', 'privacy',
  ]),
  detectTenantFromUrl: (...args: unknown[]) => mockDetectTenantFromUrl(...args),
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

vi.mock('@/contexts/PresenceContext', () => ({
  PresenceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/feedback', () => ({
  CookieConsentBanner: () => null,
  LoadingScreen: ({ message }: { message: string }) => <div data-testid="loading-screen">{message}</div>,
  EmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('@/components/feedback/CookieConsentBanner', () => ({
  CookieConsentBanner: () => null,
}));

vi.mock('@/components/seo/PageMeta', () => ({
  PageMeta: () => null,
}));

vi.mock('react-helmet-async', () => ({
  Helmet: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/pages/public/MaintenancePage', () => ({
  default: () => <div>Maintenance mode</div>,
}));

vi.mock('@/routes/AuthRoutes', async () => {
  const React = await import('react');
  const { Route } = await import('react-router-dom');
  return {
    AuthRoutes: () => React.createElement(Route, {
      path: '*',
      element: React.createElement('div', { 'data-testid': 'auth-routes' }, 'Auth routes'),
    }),
  };
});

vi.mock('@/routes/PublicAppRoutes', async () => {
  const React = await import('react');
  const { Route } = await import('react-router-dom');
  return {
    PublicAppRoutes: () => React.createElement(Route, {
      path: '*',
      element: React.createElement('div', { 'data-testid': 'public-routes' }, 'Public routes'),
    }),
  };
});

vi.mock('@/routes/AppRoutes', async () => {
  const React = await import('react');
  const { Route } = await import('react-router-dom');
  return {
    AppRoutes: () => React.createElement(Route, {
      path: '*',
      element: React.createElement('div', { 'data-testid': 'app-routes' }, 'App routes'),
    }),
  };
});

vi.mock('@/lib/motion', () => {
  const proxy = new Proxy({}, {
    get: (_t: object, prop: string | symbol) => {
      return ({ children, ref, ...p }: Record<string, unknown> & { ref?: React.Ref<HTMLElement> }) => {
        const safe: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(p)) {
          if (!['variants', 'initial', 'animate', 'exit', 'transition', 'whileHover', 'whileTap', 'whileInView', 'layout', 'viewport', 'layoutId'].includes(k)) safe[k] = v;
        }
        return React.createElement(typeof prop === 'string' ? prop : 'div', { ...safe, ref }, children);
      };
    },
  });
  return { motion: proxy, AnimatePresence: ({ children }: { children: React.ReactNode }) => children };
});

import { TenantShell } from './TenantShell';

function setupDefaultMocks(overrides: {
  tenant?: Record<string, unknown>;
  auth?: Record<string, unknown>;
} = {}) {
  mockUseTenant.mockReturnValue({
    isLoading: false,
    notFoundSlug: null,
    error: null,
    refreshTenant: mockRefreshTenant,
    tenant: { id: 2, name: 'Test Tenant', slug: 'test-tenant', settings: {} },
    ...overrides.tenant,
  });
  mockUseAuth.mockReturnValue({
    user: null,
    ...overrides.auth,
  });
}

function renderWithRouter(initialPath: string, appRoutes?: () => React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/*" element={<TenantShell appRoutes={appRoutes} />} />
      </Routes>
    </MemoryRouter>,
  );
}

function NavigationProbe({ onReady }: { onReady: (navigate: ReturnType<typeof useNavigate>) => void }) {
  const navigate = useNavigate();

  React.useEffect(() => {
    onReady(navigate);
  }, [navigate, onReady]);

  return null;
}

describe('TenantShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedTenantSlug = undefined;
    setupDefaultMocks();
    mockLoadRouteRegistry.mockImplementation(async (kind: 'auth' | 'public' | 'app') => ({
      kind,
      routes: () => React.createElement(Route, {
        path: '*',
        element: React.createElement(
          'div',
          { 'data-testid': `${kind}-routes` },
          `${kind} routes`,
        ),
      }),
    }));
  });

  describe('Tenant slug detection', () => {
    it('does NOT detect slug from reserved paths like /dashboard', () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: null, source: null });
      renderWithRouter('/dashboard');
      expect(capturedTenantSlug).toBeUndefined();
    });

    it('does NOT detect slug from reserved paths like /login', () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: null, source: null });
      renderWithRouter('/login');
      expect(capturedTenantSlug).toBeUndefined();
    });

    it('does NOT detect slug from reserved paths like /admin', () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: null, source: null });
      renderWithRouter('/admin');
      expect(capturedTenantSlug).toBeUndefined();
    });

    it('detects tenant slug from non-reserved first segment', () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: 'hour-timebank', source: 'path' });
      renderWithRouter('/hour-timebank/dashboard');
      expect(capturedTenantSlug).toBe('hour-timebank');
    });

    it('detects tenant slug from a simple community path', () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: 'my-community', source: 'path' });
      renderWithRouter('/my-community/listings');
      expect(capturedTenantSlug).toBe('my-community');
    });

    it('handles root path without slug', () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: null, source: null });
      renderWithRouter('/');
      expect(capturedTenantSlug).toBeUndefined();
    });

    it('keeps the detected slug when a later render sees a slug-less URL (sticky within document)', () => {
      // Regression: pages inside the slug-stripped nested Routes rewrite the
      // browser URL relative to the stripped pathname (e.g. ListingsPage
      // setSearchParams turns /hour-timebank/listings into /listings).
      // TenantShell re-renders on every navigation; re-detecting from the
      // momentarily slug-less URL flipped the app to the master tenant and
      // unmounted SlugUrlGuard before it could restore the URL.
      mockDetectTenantFromUrl.mockReturnValue({ slug: 'hour-timebank', source: 'path' });
      const { rerender } = render(
        <MemoryRouter initialEntries={['/hour-timebank/listings']}>
          <Routes>
            <Route path="/*" element={<TenantShell />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(capturedTenantSlug).toBe('hour-timebank');

      // Simulate the post-rewrite render: the URL no longer carries the slug
      mockDetectTenantFromUrl.mockReturnValue({ slug: null, source: null });
      rerender(
        <MemoryRouter initialEntries={['/hour-timebank/listings']}>
          <Routes>
            <Route path="/*" element={<TenantShell />} />
          </Routes>
        </MemoryRouter>,
      );
      expect(capturedTenantSlug).toBe('hour-timebank');
    });
  });

  describe('Provider wrapping', () => {
    it('renders TenantProvider', () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: null, source: null });
      renderWithRouter('/dashboard');
      expect(screen.getByTestId('tenant-provider')).toBeInTheDocument();
    });

    it('renders AuthProvider', () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: null, source: null });
      renderWithRouter('/dashboard');
      expect(screen.getByTestId('auth-provider')).toBeInTheDocument();
    });

    it('loads the auth registry for mandatory enrollment rather than the protected app', async () => {
      renderWithRouter('/auth/two-factor/setup');
      expect(await screen.findByTestId('auth-routes')).toBeInTheDocument();
      expect(screen.queryByTestId('app-routes')).not.toBeInTheDocument();
    });

    it('does not render stale app routes after navigating to an auth route', async () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: null, source: null });
      let navigateTo: ReturnType<typeof useNavigate> | null = null;

      render(
        <MemoryRouter initialEntries={['/dashboard']}>
          <NavigationProbe onReady={(navigate) => { navigateTo = navigate; }} />
          <Routes>
            <Route path="/*" element={<TenantShell />} />
          </Routes>
        </MemoryRouter>,
      );

      expect(await screen.findByTestId('app-routes')).toBeInTheDocument();
      await waitFor(() => expect(navigateTo).not.toBeNull());

      await act(async () => {
        navigateTo?.('/login');
      });

      expect(screen.queryByTestId('app-routes')).not.toBeInTheDocument();
      expect(await screen.findByTestId('auth-routes')).toBeInTheDocument();
    });

    it('shows a translated retry state when a route registry import fails', async () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: null, source: null });
      mockLoadRouteRegistry.mockRejectedValueOnce(new Error('Network import failure'));

      renderWithRouter('/dashboard');

      expect(await screen.findByText('Unable to connect')).toBeInTheDocument();
      expect(screen.queryByTestId('app-routes')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

      expect(await screen.findByTestId('app-routes')).toBeInTheDocument();
      expect(mockLoadRouteRegistry).toHaveBeenCalledTimes(2);
    });

    it('uses full app providers for protected routes even before auth is settled', async () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: null, source: null });
      setupDefaultMocks({
        auth: {
          isAuthenticated: false,
          isLoading: true,
          user: null,
        },
      });

      renderWithRouter('/dashboard');

      expect(await screen.findByTestId('tenant-app-providers')).toBeInTheDocument();
      expect(screen.queryByTestId('tenant-public-providers')).not.toBeInTheDocument();
    });

    it.each([
      '/explore',
      '/listings/42',
      '/events/42',
      '/groups/42',
      '/jobs/42',
      '/courses/community-skills',
      '/podcasts/show/episode',
      '/marketplace/my-listings',
      '/volunteering/opportunities/42',
      '/resources',
      '/kb/42',
      '/organisations/42',
      '/ideation/42/ideas/9',
      '/settings/data-export',
      '/clubs/42/admin/import',
      '/clubs/42/admin/dues',
      '/me/verein-dues',
      '/me/verein-invitations',
      '/municipality-calendar',
    ])('loads the authenticated app registry for %s', async (path) => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: null, source: null });

      renderWithRouter(path);

      expect(await screen.findByTestId('app-routes')).toBeInTheDocument();
      expect(screen.queryByTestId('public-routes')).not.toBeInTheDocument();
      expect(mockLoadRouteRegistry).toHaveBeenCalledWith('app');
    });

    it('loads the authenticated registry for tenant-prefixed member content', async () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: 'hour-timebank', source: 'path' });

      renderWithRouter('/hour-timebank/listings/42');

      expect(await screen.findByTestId('app-routes')).toBeInTheDocument();
      expect(mockLoadRouteRegistry).toHaveBeenCalledWith('app');
    });

    it.each([
      '/about',
      '/blog',
      '/blog/community-update',
      '/volunteering/guardian-consent/verify/test-token',
    ])('keeps identity-free route %s in the public registry', async (path) => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: null, source: null });

      renderWithRouter(path);

      expect(await screen.findByTestId('public-routes')).toBeInTheDocument();
      expect(screen.queryByTestId('app-routes')).not.toBeInTheDocument();
      expect(mockLoadRouteRegistry).toHaveBeenCalledWith('public');
    });

    it('keeps tenant-prefixed blog articles in the public registry', async () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: 'hour-timebank', source: 'path' });

      renderWithRouter('/hour-timebank/blog/community-update');

      expect(await screen.findByTestId('public-routes')).toBeInTheDocument();
      expect(screen.queryByTestId('app-routes')).not.toBeInTheDocument();
      expect(mockLoadRouteRegistry).toHaveBeenCalledWith('public');
    });
  });

  describe('Community Not Found', () => {
    it('shows CommunityNotFound when notFoundSlug is set', async () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: 'nonexistent-community', source: 'path' });
      setupDefaultMocks({
        tenant: {
          isLoading: false,
          notFoundSlug: 'nonexistent-community',
          tenant: null,
        },
      });
      renderWithRouter('/nonexistent-community/dashboard');
      expect(await screen.findByText('Community not found')).toBeInTheDocument();
      expect(screen.getByText(/nonexistent-community/)).toBeInTheDocument();
    });

    it('shows Go Home button in CommunityNotFound', async () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: 'bad-slug', source: 'path' });
      setupDefaultMocks({
        tenant: {
          isLoading: false,
          notFoundSlug: 'bad-slug',
          tenant: null,
        },
      });
      renderWithRouter('/bad-slug/dashboard');
      const goHome = await screen.findByText('Go home');
      // Must be a real full-document navigation (<a href="/">), not an SPA
      // <Link>: a client-side nav keeps the sticky bad slug and re-renders this
      // page, which is why the button used to appear to do nothing.
      expect(goHome.closest('a')).toHaveAttribute('href', '/');
    });

    it('shows Find Community button in CommunityNotFound', async () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: 'bad-slug', source: 'path' });
      setupDefaultMocks({
        tenant: {
          isLoading: false,
          notFoundSlug: 'bad-slug',
          tenant: null,
        },
      });
      renderWithRouter('/bad-slug/dashboard');
      const findCommunity = await screen.findByText('Find a community');
      // Full-document navigation (<a href="/login">), not an SPA <Link> — see above.
      expect(findCommunity.closest('a')).toHaveAttribute('href', '/login');
    });
  });

  describe('Retryable bootstrap failure', () => {
    it('shows the translated retry screen instead of CommunityNotFound', async () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: 'hour-timebank', source: 'path' });
      setupDefaultMocks({
        tenant: {
          isLoading: false,
          notFoundSlug: null,
          tenant: null,
          error: 'Network unavailable',
        },
      });

      renderWithRouter('/hour-timebank/events');

      expect(await screen.findByText('Unable to connect')).toBeInTheDocument();
      expect(screen.queryByText('Community not found')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(mockRefreshTenant).toHaveBeenCalledOnce();
    });
  });

  describe('Valid tenant', () => {
    it('renders Outlet (children) when tenant is valid', () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: null, source: null });
      setupDefaultMocks({
        tenant: {
          isLoading: false,
          notFoundSlug: null,
          tenant: { id: 2, name: 'Test', slug: 'test', settings: {} },
        },
      });
      renderWithRouter('/dashboard');
      // When no slug prefix and no appRoutes, it renders <Outlet /> which is empty
      // The important thing is no error/not-found page is shown
      expect(screen.queryByText('Community Not Found')).not.toBeInTheDocument();
    });

    it('does NOT show CommunityNotFound when tenant is valid', () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: 'valid-tenant', source: 'path' });
      setupDefaultMocks({
        tenant: {
          isLoading: false,
          notFoundSlug: null,
          tenant: { id: 2, name: 'Valid', slug: 'valid-tenant', settings: {} },
        },
      });
      renderWithRouter('/valid-tenant/dashboard');
      expect(screen.queryByText('Community Not Found')).not.toBeInTheDocument();
    });
  });

  describe('Loading state', () => {
    it('does not show CommunityNotFound while loading', () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: 'some-slug', source: 'path' });
      setupDefaultMocks({
        tenant: {
          isLoading: true,
          notFoundSlug: null,
          tenant: null,
        },
      });
      renderWithRouter('/some-slug/dashboard');
      expect(screen.queryByText('Community Not Found')).not.toBeInTheDocument();
    });
  });

  describe('Maintenance mode', () => {
    it('shows maintenance page for non-admin users when enabled', () => {
      mockDetectTenantFromUrl.mockReturnValue({ slug: null, source: null });
      setupDefaultMocks({
        tenant: {
          isLoading: false,
          notFoundSlug: null,
          tenant: { id: 2, name: 'Test', slug: 'test', settings: { maintenance_mode: true } },
        },
        auth: { user: { role: 'member' } },
      });
      // MaintenancePage is lazy loaded, so we just verify no CommunityNotFound
      renderWithRouter('/dashboard');
      expect(screen.queryByText('Community Not Found')).not.toBeInTheDocument();
    });
  });
});
