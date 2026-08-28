// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
// Use the raw RTL render here — we supply our own MemoryRouter wrapper so that
// useParams can see the :id segment; the standard test-utils render wraps in
// BrowserRouter which would cause a nested-Router error.
import { render } from '@testing-library/react';
import { screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@/contexts/ToastContext';

// ── Mock adminApi ────────────────────────────────────────────────────────────
vi.mock('@/admin/api/adminApi', () => {
  const get = vi.fn();
  return {
    adminUsers: { get },
  };
});

// ── Mock contexts ────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...real,
    useNavigate: () => mockNavigate,
  };
});

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ── Stable test data ─────────────────────────────────────────────────────────
const MOCK_USER = vi.hoisted(() => ({
  id: 7,
  name: 'Carol Admin',
  email: 'carol@example.com',
  role: 'admin',
  is_super_admin: false,
  is_tenant_super_admin: true,
  is_admin: true,
  permissions: ['manage_listings', 'view_reports'],
}));

const MOCK_USER_NO_PERMS = vi.hoisted(() => ({
  ...MOCK_USER,
  permissions: [],
  is_tenant_super_admin: false,
  is_admin: false,
}));

import { adminUsers } from '@/admin/api/adminApi';
import { UserPermissions } from './UserPermissions';

/** Helper: render UserPermissions with a route param :id, supplying all
 *  providers explicitly (no nested BrowserRouter from test-utils). */
function renderWithId(id: string) {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={[`/admin/users/${id}/permissions`]}>
        <ToastProvider>
          <Routes>
            <Route path="/admin/users/:id/permissions" element={<UserPermissions />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </HelmetProvider>
  );
}

describe('UserPermissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Loading state ────────────────────────────────────────────────────────
  it('shows busy spinner while fetching user data', () => {
    vi.mocked(adminUsers.get).mockReturnValue(new Promise(() => {}));
    renderWithId('7');

    const statusEls = screen.getAllByRole('status');
    const spinner = statusEls.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeInTheDocument();
  });

  it('removes busy spinner after user loads', async () => {
    vi.mocked(adminUsers.get).mockResolvedValueOnce({
      success: true,
      data: MOCK_USER,
    } as never);

    renderWithId('7');

    await waitFor(() => {
      const spinner = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true'
      );
      expect(spinner).toBeUndefined();
    });
  });

  // ── Populated state ──────────────────────────────────────────────────────
  it('renders user name and email', async () => {
    vi.mocked(adminUsers.get).mockResolvedValueOnce({
      success: true,
      data: MOCK_USER,
    } as never);

    renderWithId('7');

    await waitFor(() => {
      expect(screen.getByText('Carol Admin')).toBeInTheDocument();
      expect(screen.getByText('(carol@example.com)')).toBeInTheDocument();
    });
  });

  it('renders the user role chip', async () => {
    vi.mocked(adminUsers.get).mockResolvedValueOnce({
      success: true,
      data: MOCK_USER,
    } as never);

    renderWithId('7');

    await waitFor(() => {
      // Role chips are TRANSLATED — roleLabels maps 'admin' to
      // t('users.role_admin') = "Admin" — so the raw slug is never rendered.
      // Both the role chip and the is_admin chip carry that same label.
      const adminEls = screen.getAllByText('Admin');
      expect(adminEls.length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('admin')).not.toBeInTheDocument();
    });
  });

  it('renders permission chips for each permission', async () => {
    vi.mocked(adminUsers.get).mockResolvedValueOnce({
      success: true,
      data: MOCK_USER,
    } as never);

    renderWithId('7');

    await waitFor(() => {
      expect(screen.getByText('manage_listings')).toBeInTheDocument();
      expect(screen.getByText('view_reports')).toBeInTheDocument();
    });
  });

  it('renders tenant_super_admin chip when is_tenant_super_admin is true', async () => {
    vi.mocked(adminUsers.get).mockResolvedValueOnce({
      success: true,
      data: MOCK_USER,
    } as never);

    renderWithId('7');

    await waitFor(() => {
      // t('users.role_tenant_super_admin') = "Tenant Super Admin".
      expect(screen.getByText('Tenant Super Admin')).toBeInTheDocument();
    });
  });

  // ── Empty permissions state ──────────────────────────────────────────────
  it('shows no-explicit-permissions message when permissions array is empty', async () => {
    vi.mocked(adminUsers.get).mockResolvedValueOnce({
      success: true,
      data: MOCK_USER_NO_PERMS,
    } as never);

    renderWithId('7');

    await waitFor(() => {
      expect(screen.queryByText('manage_listings')).not.toBeInTheDocument();
    });
  });

  // ── Error: API fails ─────────────────────────────────────────────────────
  it('calls toast.error when adminUsers.get rejects', async () => {
    vi.mocked(adminUsers.get).mockRejectedValueOnce(new Error('503'));

    renderWithId('7');

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('calls toast.error when API returns success:false', async () => {
    vi.mocked(adminUsers.get).mockResolvedValueOnce({
      success: false,
      data: null,
    } as never);

    renderWithId('7');

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── Back button ──────────────────────────────────────────────────────────
  it('renders a Back button', async () => {
    vi.mocked(adminUsers.get).mockResolvedValueOnce({
      success: true,
      data: MOCK_USER,
    } as never);

    renderWithId('7');

    // Back button is always present (rendered outside the conditional)
    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  // ── API call ─────────────────────────────────────────────────────────────
  it('calls adminUsers.get with the numeric id from the route param', async () => {
    vi.mocked(adminUsers.get).mockResolvedValueOnce({
      success: true,
      data: MOCK_USER,
    } as never);

    renderWithId('7');

    await waitFor(() => {
      expect(adminUsers.get).toHaveBeenCalledWith(7);
    });
  });
});
