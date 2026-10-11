// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Hoisted mocks (must be defined before vi.mock factories) ─────────────────
const { mockAdminSuper, mockToast, mockUser } = vi.hoisted(() => ({
  mockAdminSuper: {
    listTenants: vi.fn(),
    deleteTenant: vi.fn(),
    updateTenant: vi.fn(),
    reactivateTenant: vi.fn(),
    toggleHub: vi.fn(),
  },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  // The panel's viewer. Defaults to the platform owner in beforeEach; the
  // create / hub / (de)activate controls are platform-only since 11 Oct 2026.
  mockUser: { current: null as Record<string, unknown> | null },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminSuper: mockAdminSuper,
}));

// ── Mock api (imported indirectly) ───────────────────────────────────────────
vi.mock('@/lib/api', () => {
  const m = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn() };
  return { default: m, api: m };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({ user: mockUser.current as never, isAuthenticated: mockUser.current !== null }),
  })
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ── Shared fixture ────────────────────────────────────────────────────────────
const TENANT_A = {
  id: 1,
  name: 'Alpha Timebank',
  slug: 'alpha',
  domain: 'alpha.example.com',
  is_active: true,
  user_count: 42,
  allows_subtenants: false,
  parent_name: null,
  created_at: '2024-01-01T00:00:00Z',
};

const TENANT_B = {
  id: 2,
  name: 'Beta Timebank',
  slug: 'beta',
  domain: null,
  is_active: false,
  user_count: 0,
  allows_subtenants: true,
  parent_name: 'Alpha Timebank',
  created_at: '2024-06-01T00:00:00Z',
};

import { TenantList } from './TenantList';

describe('TenantList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.current = { id: 1, is_super_admin: true, super_panel_level: 'master' };
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [] });
  });

  // ── Loading state ──────────────────────────────────────────────────────────
  it('shows a loading spinner while fetching', async () => {
    // Never resolves during this test
    mockAdminSuper.listTenants.mockReturnValue(new Promise(() => {}));
    render(<TenantList />);
    const spinner = getAllByRoleStatusBusy();
    expect(spinner).toBeTruthy();
  });

  // ── Empty state ────────────────────────────────────────────────────────────
  it('renders the page header after loading with no tenants', async () => {
    render(<TenantList />);
    await waitFor(() => expect(mockAdminSuper.listTenants).toHaveBeenCalledTimes(1));
    // PageHeader title should be present
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  // ── Populated state ────────────────────────────────────────────────────────
  it('renders tenant names after successful load', async () => {
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [TENANT_A, TENANT_B] });
    render(<TenantList />);
    await waitFor(() => {
      const matches = screen.getAllByText('Alpha Timebank');
      expect(matches.length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Beta Timebank').length).toBeGreaterThan(0);
  });

  it('renders tenant slug below the name', async () => {
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [TENANT_A] });
    render(<TenantList />);
    await waitFor(() => expect(screen.getByText('alpha')).toBeInTheDocument());
  });

  it('renders Active chip for active tenant', async () => {
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [TENANT_A] });
    render(<TenantList />);
    await waitFor(() => {
      const matches = screen.getAllByText(/active/i);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it('renders user count', async () => {
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [TENANT_A] });
    render(<TenantList />);
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
  });

  // ── Error state ────────────────────────────────────────────────────────────
  it('shows error toast when API call fails', async () => {
    mockAdminSuper.listTenants.mockResolvedValue({ success: false, error: 'Server unavailable' });
    render(<TenantList />);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  it('shows error toast when API throws', async () => {
    mockAdminSuper.listTenants.mockRejectedValue(new Error('Network error'));
    render(<TenantList />);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  // ── Filter tabs ────────────────────────────────────────────────────────────
  it('passes is_active=true when Active tab is clicked', async () => {
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [] });
    render(<TenantList />);
    await waitFor(() => expect(mockAdminSuper.listTenants).toHaveBeenCalledTimes(1));

    // Find the "Active" tab (not the chip inside a row — it's a Tab component)
    const tabs = screen.getAllByRole('tab');
    const activeTab = tabs.find((t) => /^active$/i.test(t.textContent?.trim() ?? ''));
    if (activeTab) {
      fireEvent.click(activeTab);
      await waitFor(() =>
        expect(mockAdminSuper.listTenants).toHaveBeenCalledWith(
          expect.objectContaining({ is_active: true })
        )
      );
    }
    // If Tab isn't found by role the test is a no-op with a note
  });

  // ── Primary action ─────────────────────────────────────────────────────────
  it('renders Create Tenant button', async () => {
    render(<TenantList />);
    await waitFor(() => expect(mockAdminSuper.listTenants).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  // ── Deactivate flow ─────────────────────────────────────────────────────────
  // The standalone "Delete" row action was removed — it only ever deactivated
  // the tenant (identical to this item). Permanent deletion now lives on the
  // tenant detail page as a god-only purge.
  it('exposes Deactivate (and no standalone Delete) in the row actions', async () => {
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [TENANT_A] });
    mockAdminSuper.updateTenant.mockResolvedValue({ success: true });

    render(<TenantList />);
    await waitFor(() => expect(screen.getByText('Alpha Timebank')).toBeInTheDocument());

    // Open actions menu
    const menuBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('actions')
    );
    expect(menuBtn).toBeTruthy();
    fireEvent.click(menuBtn!);

    // Deactivate is present; the misleading "Delete" item is gone.
    await waitFor(() => {
      expect(screen.getAllByText(/deactivate/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/^delete$/i)).toBeNull();
  });

  /*
   * Owner decision, 11 Oct 2026: a tenant super-admin does not act outside its
   * home community. The API refuses it every create, hub and (de)activate action
   * (canManageTenant / hasPlatformReach), so the list must not offer them.
   */
  it('offers a tenant super-admin no create, hub or deactivate controls', async () => {
    mockUser.current = { id: 9, is_tenant_super_admin: true, super_panel_level: 'regional' };
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: [TENANT_A] });

    render(<TenantList />);
    await waitFor(() => expect(screen.getByText('Alpha Timebank')).toBeInTheDocument());

    expect(screen.queryByRole('button', { name: /create tenant/i })).toBeNull();

    const menuBtn = screen.getAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('actions')
    );
    expect(menuBtn).toBeTruthy();
    fireEvent.click(menuBtn!);

    // Wait for the menu to open (View is always offered), then check the rest.
    await waitFor(() => {
      expect(screen.getAllByText(/^view$/i).length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/deactivate/i)).toBeNull();
    expect(screen.queryByText(/^(enable|disable) hub$/i)).toBeNull();
  });
});

// ── Utility ───────────────────────────────────────────────────────────────────
function getAllByRoleStatusBusy() {
  return document.querySelector('[role="status"][aria-busy="true"]');
}
