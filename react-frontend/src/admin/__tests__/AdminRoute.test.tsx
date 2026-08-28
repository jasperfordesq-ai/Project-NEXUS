// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for AdminRoute — route guard for admin access
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message?: string }) => <div data-testid="loading">{message}</div>,
}));

const mockUseAuth = vi.fn();
const mockUseTenant = vi.fn();

vi.mock('@/contexts', () => ({
  useAuth: () => mockUseAuth(),
  useTenant: () => mockUseTenant(),

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

import { AdminRoute } from '../AdminRoute';

function renderWithRouter(initialEntry = '/admin') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<AdminRoute />}>
          <Route path="/admin" element={<div data-testid="admin-content">Admin Content</div>} />
        </Route>
        <Route path="/test/login" element={<div data-testid="login-page">Login</div>} />
        <Route path="/test/dashboard" element={<div data-testid="dashboard-page">Dashboard</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AdminRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTenant.mockReturnValue({
      tenantPath: (p: string) => `/test${p}`,
    });
  });

  it('shows loading screen when auth is loading', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: true,
      status: 'loading',
    });

    renderWithRouter();
    // Copy is sentence case — "Checking permissions" — not title case. The old
    // exact-match on 'Checking Permissions' could never match.
    expect(screen.getByText(/checking permissions/i)).toBeInTheDocument();
  });

  it('redirects to login when not authenticated', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      status: 'idle',
    });

    renderWithRouter();
    // Should redirect to login
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument();
  });

  it('redirects non-admin users to dashboard', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'member' },
      isAuthenticated: true,
      isLoading: false,
      status: 'authenticated',
    });

    renderWithRouter();
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument();
  });

  it('allows admin users through', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'admin' },
      isAuthenticated: true,
      isLoading: false,
      status: 'authenticated',
    });

    renderWithRouter();
    expect(screen.getByTestId('admin-content')).toBeInTheDocument();
  });

  it('allows tenant_admin users through', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'tenant_admin' },
      isAuthenticated: true,
      isLoading: false,
      status: 'authenticated',
    });

    renderWithRouter();
    expect(screen.getByTestId('admin-content')).toBeInTheDocument();
  });

  it('allows super_admin users through', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'super_admin' },
      isAuthenticated: true,
      isLoading: false,
      status: 'authenticated',
    });

    renderWithRouter();
    expect(screen.getByTestId('admin-content')).toBeInTheDocument();
  });

  it('allows users with is_super_admin flag', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'member', is_super_admin: true },
      isAuthenticated: true,
      isLoading: false,
      status: 'authenticated',
    });

    renderWithRouter();
    expect(screen.getByTestId('admin-content')).toBeInTheDocument();
  });

  it('allows users with is_admin flag', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'member', is_admin: true },
      isAuthenticated: true,
      isLoading: false,
      status: 'authenticated',
    });

    renderWithRouter();
    expect(screen.getByTestId('admin-content')).toBeInTheDocument();
  });

  it('redirects broker users even when a stale admin flag is present', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, role: 'broker', is_admin: true },
      isAuthenticated: true,
      isLoading: false,
      status: 'authenticated',
    });

    renderWithRouter();
    expect(screen.queryByTestId('admin-content')).not.toBeInTheDocument();
  });
});
