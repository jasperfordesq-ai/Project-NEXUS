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
    isAuthenticated: false,
    isLoading: false,
    status: 'idle' as string,
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
    useLocation: () => ({ pathname: '/admin' }),
  };
});

// ─── Stub LoadingScreen ───────────────────────────────────────────────────────
vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message?: string }) => (
    <div data-testid="loading-screen" aria-busy="true">{message}</div>
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────
describe('AdminRoute', () => {
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
    const { AdminRoute } = await import('./AdminRoute');
    render(<AdminRoute />);
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('shows loading screen when status is "loading"', async () => {
    mockAuth.isLoading = false;
    mockAuth.status = 'loading';
    const { AdminRoute } = await import('./AdminRoute');
    render(<AdminRoute />);
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
  });

  it('keeps a temporarily unavailable admin session on a retry screen', async () => {
    mockAuth.status = 'unavailable';
    const { AdminRoute } = await import('./AdminRoute');
    render(<AdminRoute />);
    expect(screen.queryByTestId('redirect')).not.toBeInTheDocument();
    screen.getByRole('button').click();
    expect(mockAuth.refreshUser).toHaveBeenCalledOnce();
  });

  it('redirects unauthenticated users to login', async () => {
    mockAuth.isAuthenticated = false;
    mockAuth.user = null;
    const { AdminRoute } = await import('./AdminRoute');
    render(<AdminRoute />);
    const redirect = screen.getByTestId('redirect');
    expect(redirect.getAttribute('data-to')).toBe('/test/login');
  });

  it('redirects authenticated member (non-admin) to dashboard', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 1, role: 'member' };
    const { AdminRoute } = await import('./AdminRoute');
    render(<AdminRoute />);
    const redirect = screen.getByTestId('redirect');
    expect(redirect.getAttribute('data-to')).toBe('/test/dashboard');
  });

  it('redirects broker role to dashboard (broker is not admin)', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 2, role: 'broker' };
    const { AdminRoute } = await import('./AdminRoute');
    render(<AdminRoute />);
    expect(screen.getByTestId('redirect')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('renders Outlet for user with role "admin"', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 3, role: 'admin' };
    const { AdminRoute } = await import('./AdminRoute');
    render(<AdminRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.queryByTestId('redirect')).not.toBeInTheDocument();
  });

  it('renders Outlet for user with role "tenant_admin"', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 4, role: 'tenant_admin' };
    const { AdminRoute } = await import('./AdminRoute');
    render(<AdminRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('renders Outlet for user with role "super_admin"', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 5, role: 'super_admin' };
    const { AdminRoute } = await import('./AdminRoute');
    render(<AdminRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('renders Outlet for user with is_admin flag set', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 6, role: 'member', is_admin: true };
    const { AdminRoute } = await import('./AdminRoute');
    render(<AdminRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('renders Outlet for user with is_super_admin flag set', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 7, role: 'member', is_super_admin: true };
    const { AdminRoute } = await import('./AdminRoute');
    render(<AdminRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('renders Outlet for user with is_god flag set', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 8, role: 'member', is_god: true };
    const { AdminRoute } = await import('./AdminRoute');
    render(<AdminRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('uses tenantPath for login redirect target', async () => {
    mockAuth.isAuthenticated = false;
    mockTenant.tenantPath = (p: string) => `/hour-timebank${p}`;
    const { AdminRoute } = await import('./AdminRoute');
    render(<AdminRoute />);
    const redirect = screen.getByTestId('redirect');
    expect(redirect.getAttribute('data-to')).toBe('/hour-timebank/login');
  });
});
