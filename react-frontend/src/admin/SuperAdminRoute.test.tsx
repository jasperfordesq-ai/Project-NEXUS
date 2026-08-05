// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mutable auth / tenant state ─────────────────────────────────────────────
const { mockAuth, mockTenant } = vi.hoisted(() => ({
  mockAuth: {
    user: null as Record<string, unknown> | null,
    isLoading: false,
    status: 'idle' as string,
    isAuthenticated: false,
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    error: null,
  },
  mockTenant: {
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({ ...mockAuth }),
    useTenant: () => ({ ...mockTenant }),
  })
);

// ─── Stub Navigate + Outlet ───────────────────────────────────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    Navigate: ({ to }: { to: string }) => (
      <div data-testid="redirect" data-to={to} />
    ),
    Outlet: () => <div data-testid="outlet">children</div>,
  };
});

// ─── Stub LoadingScreen ───────────────────────────────────────────────────────
vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message?: string }) => (
    <div data-testid="loading-screen" aria-busy="true">{message}</div>
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────
describe('SuperAdminRoute', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.user = null;
    mockAuth.isAuthenticated = false;
    mockAuth.isLoading = false;
    mockAuth.status = 'idle';
    mockTenant.tenantPath = (p: string) => `/test${p}`;
  });

  it('shows loading screen while isLoading is true', async () => {
    mockAuth.isLoading = true;
    const { SuperAdminRoute } = await import('./SuperAdminRoute');
    render(<SuperAdminRoute />);
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('shows loading screen when status is "loading"', async () => {
    mockAuth.isLoading = false;
    mockAuth.status = 'loading';
    const { SuperAdminRoute } = await import('./SuperAdminRoute');
    render(<SuperAdminRoute />);
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
  });

  it('redirects null user (unauthenticated) to /admin', async () => {
    mockAuth.user = null;
    const { SuperAdminRoute } = await import('./SuperAdminRoute');
    render(<SuperAdminRoute />);
    const redirect = screen.getByTestId('redirect');
    expect(redirect.getAttribute('data-to')).toBe('/test/admin');
  });

  it('redirects ordinary member to /admin', async () => {
    mockAuth.user = { id: 1, role: 'member' };
    const { SuperAdminRoute } = await import('./SuperAdminRoute');
    render(<SuperAdminRoute />);
    const redirect = screen.getByTestId('redirect');
    expect(redirect.getAttribute('data-to')).toBe('/test/admin');
  });

  it('redirects regular admin (not super_admin) to /admin', async () => {
    mockAuth.user = { id: 2, role: 'admin' };
    const { SuperAdminRoute } = await import('./SuperAdminRoute');
    render(<SuperAdminRoute />);
    expect(screen.getByTestId('redirect')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('redirects broker to /admin', async () => {
    mockAuth.user = { id: 3, role: 'broker' };
    const { SuperAdminRoute } = await import('./SuperAdminRoute');
    render(<SuperAdminRoute />);
    expect(screen.getByTestId('redirect')).toBeInTheDocument();
  });

  it('renders Outlet for user with role "super_admin"', async () => {
    mockAuth.user = { id: 4, role: 'super_admin' };
    const { SuperAdminRoute } = await import('./SuperAdminRoute');
    render(<SuperAdminRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.queryByTestId('redirect')).not.toBeInTheDocument();
  });

  it('renders Outlet for user with is_super_admin flag', async () => {
    mockAuth.user = { id: 5, role: 'member', is_super_admin: true };
    const { SuperAdminRoute } = await import('./SuperAdminRoute');
    render(<SuperAdminRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('redirects tenant-scoped super-admins to their tenant admin panel', async () => {
    mockAuth.user = { id: 6, role: 'member', is_tenant_super_admin: true };
    const { SuperAdminRoute } = await import('./SuperAdminRoute');
    render(<SuperAdminRoute />);
    expect(screen.getByTestId('redirect')).toHaveAttribute('data-to', '/test/admin');
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('renders Outlet for user with is_god flag', async () => {
    mockAuth.user = { id: 7, role: 'member', is_god: true };
    const { SuperAdminRoute } = await import('./SuperAdminRoute');
    render(<SuperAdminRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('redirect destination uses tenantPath(/admin)', async () => {
    mockAuth.user = { id: 8, role: 'member' };
    mockTenant.tenantPath = (p: string) => `/hour-timebank${p}`;
    const { SuperAdminRoute } = await import('./SuperAdminRoute');
    render(<SuperAdminRoute />);
    const redirect = screen.getByTestId('redirect');
    expect(redirect.getAttribute('data-to')).toBe('/hour-timebank/admin');
  });

  it('does not render Outlet when is_super_admin is false (not true)', async () => {
    mockAuth.user = { id: 9, role: 'member', is_super_admin: false };
    const { SuperAdminRoute } = await import('./SuperAdminRoute');
    render(<SuperAdminRoute />);
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    expect(screen.getByTestId('redirect')).toBeInTheDocument();
  });

  /**
   * 🔴 The panel now has two tiers, and this guard is the entry to both.
   *
   * It previously required a PLATFORM super-admin, which meant that once the
   * admin sidebar started offering the panel to the super-admin of a community
   * with communities beneath it, clicking that link silently bounced them back to
   * /admin. A dead link is worse than no link.
   */
  describe('branch (regional) super-admin entry', () => {
    it('admits a regional caller into the panel', async () => {
      mockAuth.user = { id: 20, is_tenant_super_admin: true, super_panel_level: 'regional' };
      const { SuperAdminRoute } = await import('./SuperAdminRoute');
      render(<SuperAdminRoute />);
      expect(screen.getByTestId('outlet')).toBeInTheDocument();
      expect(screen.queryByTestId('redirect')).not.toBeInTheDocument();
    });

    /**
     * 🔴 Asymmetric on purpose. The flag alone is not enough: the community must
     * also allow sub-communities and have a usable position in the hierarchy, and
     * only the server knows that. Without a level, no branch panel.
     */
    it('refuses a tenant super-admin whose level the server did not grant', async () => {
      mockAuth.user = { id: 21, is_tenant_super_admin: true };
      const { SuperAdminRoute } = await import('./SuperAdminRoute');
      render(<SuperAdminRoute />);
      expect(screen.getByTestId('redirect')).toBeInTheDocument();
      expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    });

    it('refuses an explicit level of none', async () => {
      mockAuth.user = { id: 22, is_tenant_super_admin: true, super_panel_level: 'none' };
      const { SuperAdminRoute } = await import('./SuperAdminRoute');
      render(<SuperAdminRoute />);
      expect(screen.getByTestId('redirect')).toBeInTheDocument();
    });
  });

  /**
   * 🔴 PlatformOnlyRoute guards the platform-wide screens INSIDE the panel —
   * billing, platform revenue, federation controls, the provisioning queue.
   *
   * Hiding them from the sidebar is a convention, not a control: a bookmark or a
   * pasted URL still routes straight to the page, which then fires requests the
   * API refuses one by one and looks broken. The API is still the authority (those
   * endpoints refuse tenant super-admins, proven by RegionalPanelIsolationTest);
   * this is about refusing cleanly.
   */
  describe('PlatformOnlyRoute', () => {
    it('lets a platform super-admin through', async () => {
      mockAuth.user = { id: 30, is_super_admin: true, super_panel_level: 'master' };
      const { PlatformOnlyRoute } = await import('./SuperAdminRoute');
      render(<PlatformOnlyRoute />);
      expect(screen.getByTestId('outlet')).toBeInTheDocument();
    });

    it('sends a branch admin back to the panel dashboard, not to a broken page', async () => {
      mockAuth.user = { id: 31, is_tenant_super_admin: true, super_panel_level: 'regional' };
      const { PlatformOnlyRoute } = await import('./SuperAdminRoute');
      render(<PlatformOnlyRoute />);
      const redirect = screen.getByTestId('redirect');
      expect(redirect.getAttribute('data-to')).toBe('/test/super-admin');
      expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    });

    it('fails closed when no level can be established', async () => {
      // Requires an explicit 'master'; anything else is refused.
      mockAuth.user = { id: 32, is_admin: true };
      const { PlatformOnlyRoute } = await import('./SuperAdminRoute');
      render(<PlatformOnlyRoute />);
      expect(screen.getByTestId('redirect')).toBeInTheDocument();
    });

    it('still admits a platform super-admin whose payload predates the level field', async () => {
      // Backwards compatibility: superPanelLevel() falls back to the platform
      // flags, so a cached /me from before the field existed does not lock them out.
      mockAuth.user = { id: 33, is_super_admin: true };
      const { PlatformOnlyRoute } = await import('./SuperAdminRoute');
      render(<PlatformOnlyRoute />);
      expect(screen.getByTestId('outlet')).toBeInTheDocument();
    });

    it('shows the loading screen rather than deciding early', async () => {
      mockAuth.isLoading = true;
      mockAuth.user = null;
      const { PlatformOnlyRoute } = await import('./SuperAdminRoute');
      render(<PlatformOnlyRoute />);
      expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
      expect(screen.queryByTestId('redirect')).not.toBeInTheDocument();
    });
  });
});
