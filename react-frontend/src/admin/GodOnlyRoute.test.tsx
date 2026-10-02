// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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

vi.mock('@/contexts', () => ({
  useAuth: () => ({ ...mockAuth }),
  useTenant: () => ({ ...mockTenant }),
}));

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

vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message?: string }) => (
    <div data-testid="loading-screen" aria-busy="true">{message}</div>
  ),
}));

import { GodOnlyRoute } from './GodOnlyRoute';

describe('GodOnlyRoute', () => {
  beforeEach(() => {
    mockAuth.user = null;
    mockAuth.isLoading = false;
    mockAuth.status = 'idle';
  });

  it('shows the loading screen while auth is loading', () => {
    mockAuth.isLoading = true;
    render(<GodOnlyRoute />);
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });

  it('admits a user with the is_god flag', () => {
    mockAuth.user = { id: 1, role: 'admin', is_god: true };
    render(<GodOnlyRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it('admits a user with role "god"', () => {
    mockAuth.user = { id: 2, role: 'god' };
    render(<GodOnlyRoute />);
    expect(screen.getByTestId('outlet')).toBeInTheDocument();
  });

  it.each([
    ['platform super admin', { id: 3, role: 'super_admin', is_super_admin: true }],
    ['tenant super admin', { id: 4, role: 'admin', is_tenant_super_admin: true }],
    ['admin', { id: 5, role: 'admin', is_admin: true }],
    ['broker', { id: 6, role: 'broker' }],
    ['is_god false', { id: 7, role: 'admin', is_god: false }],
  ])('sends a %s back to the admin dashboard', (_label, user) => {
    mockAuth.user = user;
    render(<GodOnlyRoute />);
    expect(screen.getByTestId('redirect')).toHaveAttribute('data-to', '/test/admin');
    expect(screen.queryByTestId('outlet')).not.toBeInTheDocument();
  });
});
