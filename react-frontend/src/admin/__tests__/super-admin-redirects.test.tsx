// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';

vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message?: string }) => <div>{message || 'Loading'}</div>,
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, role: 'super_admin', is_super_admin: true },
    isAuthenticated: true,
    isLoading: false,
    status: 'authenticated',
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (path: string) => `/test${path}`,
  })),
}));

// The admin route tree also contains modules that import useTenant from
// '@/contexts/TenantContext' directly (LegalDocVersionList among them), where the barrel override
// above does not apply. Mock the direct path too so the whole graph sees one tenant.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (path: string) => `/test${path}`,
  })),
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

vi.mock('../modules/dashboard/AdminDashboard', () => ({
  default: () => <div>Admin Dashboard</div>,
}));

vi.mock('../modules/AdminNotFound', () => ({
  default: () => <div>Admin Not Found</div>,
}));

import { AdminRoutes } from '../routes';

function renderAdminRoutes(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/test/admin/*" element={<Outlet />}>
          {AdminRoutes()}
        </Route>
        <Route path="/test/super-admin/*" element={<div data-testid="new-super-admin-route">New Super Admin Route</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('super admin legacy redirects', () => {
  it('redirects old /admin/super tenant URLs to the separate super-admin panel', async () => {
    renderAdminRoutes('/test/admin/super/tenants/42/edit');

    expect(await screen.findByTestId('new-super-admin-route')).toBeInTheDocument();
  });

  it('redirects old standalone admin super-admin URLs to their new super-admin paths', async () => {
    renderAdminRoutes('/test/admin/provisioning-requests');

    expect(await screen.findByTestId('new-super-admin-route')).toBeInTheDocument();
  });
});
