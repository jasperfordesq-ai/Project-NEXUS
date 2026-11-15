// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

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
    hasFeature: vi.fn((_key: string) => true),
    hasModule: vi.fn((_key: string) => true),
  },
}));

const mockLocation = { pathname: '/platform-team', search: '', hash: '' };

vi.mock('@/contexts', () =>
  createMockContexts({
    // Cast: partial context shapes would trip the shrink-only test-type ratchet.
    useAuth: () => ({ ...mockAuth }) as never,
    useTenant: () => ({ ...mockTenant }) as never,
  })
);

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    Navigate: ({ to }: { to: string }) => <div data-testid="redirect" data-to={to} />,
    Outlet: () => <div data-testid="outlet">children</div>,
    useLocation: () => mockLocation,
  };
});

vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message?: string }) => (
    <div data-testid="loading-screen" aria-busy="true">{message}</div>
  ),
}));

vi.mock('@/components/routing/AuthUnavailableScreen', () => ({
  AuthUnavailableScreen: () => <div data-testid="auth-unavailable" />,
}));

async function renderGuard() {
  const { PlatformTeamRoute } = await import('./PlatformTeamRoute');
  render(<PlatformTeamRoute />);
}

function signedInAs(user: Record<string, unknown>) {
  mockAuth.isAuthenticated = true;
  mockAuth.user = { id: 1, ...user };
}

function redirectTarget(): string | null {
  return screen.getByTestId('redirect').getAttribute('data-to');
}

describe('PlatformTeamRoute', () => {
  beforeEach(() => {
    mockAuth.user = null;
    mockAuth.isAuthenticated = false;
    mockAuth.isLoading = false;
    mockAuth.status = 'idle';
    mockLocation.pathname = '/platform-team';
    mockLocation.search = '';
    mockLocation.hash = '';
  });

  it('shows the loading screen while the account is still loading', async () => {
    mockAuth.isLoading = true;
    await renderGuard();
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('shows the loading screen while the status is "loading"', async () => {
    mockAuth.status = 'loading';
    await renderGuard();
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
  });

  it('shows the "cannot check your account" screen rather than bouncing anyone', async () => {
    mockAuth.status = 'unavailable';
    signedInAs({ is_god: true, is_super_admin: true });
    await renderGuard();
    expect(screen.getByTestId('auth-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    expect(screen.queryByTestId('redirect')).not.toBeInTheDocument();
  });

  it('sends a signed-out visitor to sign in, and back to the exact address afterwards', async () => {
    mockLocation.pathname = '/platform-team/cron-jobs';
    mockLocation.search = '?x=1';
    mockLocation.hash = '#y';
    await renderGuard();
    expect(redirectTarget()).toBe(
      `/test/login?next=${encodeURIComponent('/test/platform-team/cron-jobs?x=1#y')}`,
    );
  });

  it('sends a community admin to the admin panel', async () => {
    signedInAs({ role: 'admin' });
    await renderGuard();
    expect(redirectTarget()).toBe('/test/admin');
  });

  it('sends a tenant super admin to the admin panel', async () => {
    signedInAs({ role: 'admin', is_tenant_super_admin: true });
    await renderGuard();
    expect(redirectTarget()).toBe('/test/admin');
  });

  it('sends a global super admin who is not on the platform team to the admin panel', async () => {
    signedInAs({ role: 'super_admin', is_super_admin: true });
    await renderGuard();
    expect(redirectTarget()).toBe('/test/admin');
  });

  it('sends an account with is_god but not super admin to the admin panel', async () => {
    signedInAs({ is_god: true });
    await renderGuard();
    expect(redirectTarget()).toBe('/test/admin');
  });

  it('does not accept the role string "god" on its own, as the server does not', async () => {
    signedInAs({ role: 'god', is_super_admin: true });
    await renderGuard();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
    expect(redirectTarget()).toBe('/test/admin');
  });

  it('sends a broker to the broker panel', async () => {
    signedInAs({ role: 'broker' });
    await renderGuard();
    expect(redirectTarget()).toBe('/test/broker');
  });

  it('sends a member to their dashboard', async () => {
    signedInAs({ role: 'member' });
    await renderGuard();
    expect(redirectTarget()).toBe('/test/dashboard');
  });

  it('lets the platform team in: is_god with the super admin flag', async () => {
    signedInAs({ is_god: true, is_super_admin: true, role: 'member' });
    await renderGuard();
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.queryByTestId('redirect')).not.toBeInTheDocument();
  });

  it('lets the platform team in: is_god with the super admin role', async () => {
    signedInAs({ is_god: true, role: 'super_admin' });
    await renderGuard();
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });
});
