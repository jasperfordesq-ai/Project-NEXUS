// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';
import type { User } from '@/types/api';

// ── Stable hoisted refs ──────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

const mockAdminSuper = vi.hoisted(() => ({
  getTenant: vi.fn(),
  getTenantFederationFeatures: vi.fn(),
  getWhitelist: vi.fn(),
  getFederationPartnerships: vi.fn(),
  updateTenantFederationFeature: vi.fn(),
  addToWhitelist: vi.fn(),
  removeFromWhitelist: vi.fn(),
  suspendPartnership: vi.fn(),
  terminatePartnership: vi.fn(),
}));

// The signed-in viewer; each test sets it.
const authState = vi.hoisted(() => ({ user: null as User | null }));

vi.mock('@/admin/api/adminApi', () => ({
  adminSuper: mockAdminSuper,
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: authState.user,
      isAuthenticated: authState.user !== null,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  }),
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// react-router-dom: stub useParams to return tenantId=5
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ tenantId: '5' }),
  };
});

import { FederationTenantFeatures } from './FederationTenantFeatures';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const TENANT = { id: 5, name: 'Test Tenant', slug: 'test-tenant', domain: 'test.example.com' };

const FEATURE_FLAGS = {
  cross_tenant_profiles_enabled: true,
  cross_tenant_messaging_enabled: false,
  cross_tenant_transactions_enabled: false,
  cross_tenant_listings_enabled: false,
  cross_tenant_events_enabled: false,
  cross_tenant_groups_enabled: false,
};

// The row shape `getTenantPartnerships()` returns for one community.
const PARTNERSHIP = {
  id: 10,
  tenant_id: 5,
  partner_tenant_id: 20,
  partner_id: 20,
  partner_name: 'Partner Tenant',
  partner_domain: 'partner.example.com',
  status: 'active' as const,
  created_at: '2024-01-01T00:00:00Z',
};

const SUPER_ADMIN = { id: 1, is_super_admin: true, role: 'super_admin' } as unknown as User;
const PLATFORM_TEAM = { id: 2, is_super_admin: true, is_god: true, role: 'super_admin' } as unknown as User;

function setupMocks({
  isWhitelisted = false,
  partnerships = [PARTNERSHIP] as unknown[],
} = {}) {
  mockAdminSuper.getTenant.mockResolvedValue({ success: true, data: TENANT });
  mockAdminSuper.getTenantFederationFeatures.mockResolvedValue({
    success: true,
    data: { tenant: TENANT, features: FEATURE_FLAGS, is_whitelisted: isWhitelisted, partnerships },
  });
}

async function renderLoaded() {
  render(<FederationTenantFeatures />);
  await waitFor(() => {
    expect(screen.getByText('Test Tenant')).toBeInTheDocument();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('FederationTenantFeatures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = SUPER_ADMIN;
  });

  it('shows loading spinner while fetching', () => {
    mockAdminSuper.getTenant.mockReturnValue(new Promise(() => {}));
    mockAdminSuper.getTenantFederationFeatures.mockReturnValue(new Promise(() => {}));

    render(<FederationTenantFeatures />);

    const spinner = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-busy') === 'true');
    expect(spinner).toBeInTheDocument();
  });

  it('renders tenant info after load', async () => {
    setupMocks();
    await renderLoaded();
    expect(screen.getByText('test.example.com')).toBeInTheDocument();
  });

  it('shows "tenant not found" when tenant fetch returns no data', async () => {
    mockAdminSuper.getTenant.mockResolvedValue({ success: false, data: null });
    mockAdminSuper.getTenantFederationFeatures.mockResolvedValue({ success: false });

    render(<FederationTenantFeatures />);

    await waitFor(() => {
      expect(document.body.textContent).toMatch(/tenant_not_found|not found/i);
    });
  });

  // 17 Nov 2026 (owner decision): the platform-wide whitelist and partnership
  // list are the platform team's. This page reads its own community only.
  it('never asks for the platform-wide whitelist or partnership list', async () => {
    setupMocks();
    await renderLoaded();

    expect(mockAdminSuper.getTenantFederationFeatures).toHaveBeenCalledWith(5);
    expect(mockAdminSuper.getWhitelist).not.toHaveBeenCalled();
    expect(mockAdminSuper.getFederationPartnerships).not.toHaveBeenCalled();
  });

  it('shows the whitelisted status from the community request', async () => {
    setupMocks({ isWhitelisted: true });
    await renderLoaded();

    expect(screen.getByText('Whitelisted')).toBeInTheDocument();
    expect(screen.queryByText('Not Whitelisted')).not.toBeInTheDocument();
  });

  it('shows the not-whitelisted status from the community request', async () => {
    setupMocks({ isWhitelisted: false });
    await renderLoaded();

    expect(screen.getAllByText('Not Whitelisted').length).toBeGreaterThan(0);
  });

  it('offers no whitelist or partnership actions, to anyone', async () => {
    authState.user = PLATFORM_TEAM;
    setupMocks();
    await renderLoaded();

    const labels = screen.queryAllByRole('button').map((b) => b.textContent ?? '');
    for (const label of labels) {
      expect(label).not.toMatch(/whitelist|suspend|terminate/i);
    }
    expect(mockAdminSuper.addToWhitelist).not.toHaveBeenCalled();
    expect(mockAdminSuper.removeFromWhitelist).not.toHaveBeenCalled();
  });

  it('points a platform team member to the panel pages', async () => {
    authState.user = PLATFORM_TEAM;
    setupMocks();
    await renderLoaded();

    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/test/platform-team/federation/whitelist');
    expect(hrefs).toContain('/test/platform-team/federation/partnerships');
  });

  it('shows no panel pointer to a super admin who is not on the platform team', async () => {
    setupMocks();
    await renderLoaded();

    const hrefs = screen.queryAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.some((h) => h.includes('/platform-team/'))).toBe(false);
  });

  it('says the details are unavailable when the community request fails', async () => {
    mockAdminSuper.getTenant.mockResolvedValue({ success: true, data: TENANT });
    mockAdminSuper.getTenantFederationFeatures.mockResolvedValue({ success: false, error: 'Server error' });

    await renderLoaded();

    expect(screen.getAllByText(/unavailable right now/i).length).toBeGreaterThan(0);
    expect(screen.queryByText('Not Whitelisted')).not.toBeInTheDocument();
    expect(screen.queryByText('Whitelisted')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/No partnerships for tenant found/i);
    // Nor does it show every switch as off as if that were the answer.
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('renders feature toggles (switches)', async () => {
    setupMocks();
    await renderLoaded();
    expect(screen.getAllByRole('switch')).toHaveLength(6);
  });

  it('calls updateTenantFederationFeature when a toggle is clicked', async () => {
    setupMocks();
    mockAdminSuper.updateTenantFederationFeature.mockResolvedValue({ success: true });
    await renderLoaded();

    await userEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => {
      expect(mockAdminSuper.updateTenantFederationFeature).toHaveBeenCalledWith(
        5,
        expect.any(String),
        expect.any(Boolean),
      );
    });
  });

  it('shows success toast after toggling feature', async () => {
    setupMocks();
    mockAdminSuper.updateTenantFederationFeature.mockResolvedValue({ success: true });
    await renderLoaded();

    await userEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when feature toggle fails', async () => {
    setupMocks();
    mockAdminSuper.updateTenantFederationFeature.mockResolvedValue({ success: false, error: 'Forbidden' });
    await renderLoaded();

    await userEvent.click(screen.getAllByRole('switch')[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows the partnerships from the community request, by partner name', async () => {
    setupMocks();
    await renderLoaded();
    expect(screen.getByText('Partner Tenant')).toBeInTheDocument();
  });

  it('shows the no-partnerships message when the community has none', async () => {
    setupMocks({ partnerships: [] });
    await renderLoaded();
    expect(document.body.textContent).toMatch(/No partnerships for tenant found/i);
  });
});
