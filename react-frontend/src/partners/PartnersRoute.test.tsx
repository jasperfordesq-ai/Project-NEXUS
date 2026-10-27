// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mutable auth / tenant state (read by the factory each render) ───────────
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

// Mutable so a test can put a query string on the address.
const mockLocation = { pathname: '/partner-timebanks', search: '', hash: '' };

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({ ...mockAuth }),
    useTenant: () => ({ ...mockTenant }),
  })
);

// ─── Stub Navigate + Outlet so we can detect redirects without a full router ──
vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    Navigate: ({ to }: { to: string }) => (
      <div data-testid="redirect" data-to={to} />
    ),
    Outlet: () => <div data-testid="outlet">children</div>,
    useLocation: () => mockLocation,
  };
});

// ─── Stub feedback so we can detect loading state ────────────────────────────
vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message?: string }) => (
    <div data-testid="loading-screen" aria-busy="true">{message}</div>
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────
describe('PartnersRoute', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAuth.user = null;
    mockAuth.isAuthenticated = false;
    mockAuth.isLoading = false;
    mockAuth.status = 'idle';
    mockTenant.hasFeature = vi.fn(() => true);
    mockTenant.tenantPath = (p: string) => `/test${p}`;
  });

  it('shows loading screen while auth is loading', async () => {
    mockAuth.isLoading = true;
    const { PartnersRoute } = await import('./PartnersRoute');
    render(<PartnersRoute />);
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('redirects unauthenticated users to login', async () => {
    const { PartnersRoute } = await import('./PartnersRoute');
    render(<PartnersRoute />);
    expect(screen.getByTestId('redirect').getAttribute('data-to')).toBe('/test/login?next=%2Ftest%2Fpartner-timebanks');
  });

  it('redirects plain members to the member dashboard', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 1, role: 'member' };
    const { PartnersRoute } = await import('./PartnersRoute');
    render(<PartnersRoute />);
    expect(screen.getByTestId('redirect').getAttribute('data-to')).toBe('/test/dashboard');
  });

  it('admits a NORMAL admin — the read-mostly panel is for every admin', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 2, role: 'admin', is_admin: true };
    const { PartnersRoute } = await import('./PartnersRoute');
    render(<PartnersRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.queryByTestId('redirect')).not.toBeInTheDocument();
  });

  it('admits a tenant_admin role', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 3, role: 'tenant_admin' };
    const { PartnersRoute } = await import('./PartnersRoute');
    render(<PartnersRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('redirects brokers to the member dashboard', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 4, role: 'broker' };
    const { PartnersRoute } = await import('./PartnersRoute');
    render(<PartnersRoute />);
    expect(screen.getByTestId('redirect').getAttribute('data-to')).toBe('/test/dashboard');
  });

  it('renders Outlet for super_admin role', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 5, role: 'super_admin' };
    const { PartnersRoute } = await import('./PartnersRoute');
    render(<PartnersRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.queryByTestId('redirect')).not.toBeInTheDocument();
  });

  it('renders Outlet for a tenant super admin flag (matches the Communications gate)', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 6, role: 'admin', is_tenant_super_admin: true };
    const { PartnersRoute } = await import('./PartnersRoute');
    render(<PartnersRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('renders Outlet for god accounts', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 7, role: 'god', is_god: true };
    const { PartnersRoute } = await import('./PartnersRoute');
    render(<PartnersRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('redirects a super admin when NO partnering surface is enabled', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 8, role: 'super_admin' };
    mockTenant.hasFeature = vi.fn(() => false);
    const { PartnersRoute } = await import('./PartnersRoute');
    render(<PartnersRoute />);
    expect(screen.getByTestId('redirect').getAttribute('data-to')).toBe('/test/admin');
  });

  it('grants a super admin access when only the caring_community feature is enabled', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 9, role: 'super_admin' };
    mockTenant.hasFeature = vi.fn((f: string) => f === 'caring_community');
    const { PartnersRoute } = await import('./PartnersRoute');
    render(<PartnersRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('redirects a NORMAL admin when only super-admin-only surfaces exist (caring/partner_api, no federation)', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 10, role: 'admin', is_admin: true };
    mockTenant.hasFeature = vi.fn((f: string) => f === 'caring_community' || f === 'partner_api');
    const { PartnersRoute } = await import('./PartnersRoute');
    render(<PartnersRoute />);
    expect(screen.getByTestId('redirect').getAttribute('data-to')).toBe('/test/admin');
  });
});
