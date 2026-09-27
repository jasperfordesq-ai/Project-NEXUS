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
    hasFeature: vi.fn((_key: string) => true),
    hasModule: vi.fn((_key: string) => true),
  },
}));

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
    useLocation: () => ({ pathname: '/broker' }),
  };
});

// ─── Stub feedback so we can detect loading state ────────────────────────────
vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message?: string }) => (
    <div data-testid="loading-screen" aria-busy="true">{message}</div>
  ),
}));

// ─────────────────────────────────────────────────────────────────────────────
describe('BrokerRoute', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reset to safe defaults
    mockAuth.user = null;
    mockAuth.isAuthenticated = false;
    mockAuth.isLoading = false;
    mockAuth.status = 'idle';
    mockTenant.hasFeature = vi.fn(() => true);
    mockTenant.tenantPath = (p: string) => `/test${p}`;
  });

  it('shows loading screen while auth is loading', async () => {
    mockAuth.isLoading = true;
    const { BrokerRoute } = await import('./BrokerRoute');
    render(<BrokerRoute />);
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('shows loading screen when status is "loading"', async () => {
    mockAuth.isLoading = false;
    mockAuth.status = 'loading';
    const { BrokerRoute } = await import('./BrokerRoute');
    render(<BrokerRoute />);
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
  });

  it('redirects unauthenticated users to login', async () => {
    mockAuth.isAuthenticated = false;
    mockAuth.user = null;
    const { BrokerRoute } = await import('./BrokerRoute');
    render(<BrokerRoute />);
    const redirect = screen.getByTestId('redirect');
    expect(redirect).toBeInTheDocument();
    expect(redirect.getAttribute('data-to')).toBe('/test/login');
  });

  it('redirects authenticated user with no broker role to dashboard', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 1, role: 'member' };
    const { BrokerRoute } = await import('./BrokerRoute');
    render(<BrokerRoute />);
    const redirect = screen.getByTestId('redirect');
    expect(redirect.getAttribute('data-to')).toBe('/test/dashboard');
  });

  it('grants a broker access even when the exchange_workflow feature is disabled', async () => {
    // The broker panel spans safeguarding/vetting/insurance/members which are
    // unrelated to exchanges, so access must NOT depend on exchange_workflow.
    // Only the Exchanges surfaces are feature-gated (elsewhere).
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 1, role: 'broker' };
    mockTenant.hasFeature = vi.fn((f: string) => f !== 'exchange_workflow');
    const { BrokerRoute } = await import('./BrokerRoute');
    render(<BrokerRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.queryByTestId('redirect')).not.toBeInTheDocument();
  });

  it('renders Outlet for user with broker role and feature enabled', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 1, role: 'broker' };
    mockTenant.hasFeature = vi.fn(() => true);
    const { BrokerRoute } = await import('./BrokerRoute');
    render(<BrokerRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
    expect(screen.queryByTestId('redirect')).not.toBeInTheDocument();
  });

  it('renders Outlet for coordinator role with feature enabled', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 2, role: 'coordinator' };
    mockTenant.hasFeature = vi.fn(() => true);
    const { BrokerRoute } = await import('./BrokerRoute');
    render(<BrokerRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('renders Outlet for admin role with feature enabled', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 3, role: 'admin' };
    mockTenant.hasFeature = vi.fn(() => true);
    const { BrokerRoute } = await import('./BrokerRoute');
    render(<BrokerRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('renders Outlet for super_admin with feature enabled', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 4, role: 'super_admin' };
    mockTenant.hasFeature = vi.fn(() => true);
    const { BrokerRoute } = await import('./BrokerRoute');
    render(<BrokerRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('redirects plain member even when feature is enabled', async () => {
    mockAuth.isAuthenticated = true;
    mockAuth.user = { id: 5, role: 'member' };
    mockTenant.hasFeature = vi.fn(() => true);
    const { BrokerRoute } = await import('./BrokerRoute');
    render(<BrokerRoute />);
    expect(screen.getByTestId('redirect')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });
});
