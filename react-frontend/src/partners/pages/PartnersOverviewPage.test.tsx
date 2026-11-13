// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockAdminFederation } = vi.hoisted(() => ({
  mockAdminFederation: {
    getAnalyticsOverview: vi.fn(),
    getSettings: vi.fn(),
    getProfile: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({ adminFederation: mockAdminFederation }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
    useAuth: () => ({
      user: { id: 1, name: 'Admin', role: 'admin', is_admin: true, is_tenant_super_admin: true },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  })
);

/**
 * The listing as AdminFederationController::profile() really sends it: the
 * text lives under `federation_profile`, and there is no `is_visible`.
 */
function serverProfile(description: string) {
  return {
    id: 2,
    name: 'Test Tenant',
    slug: 'test',
    status: 'active',
    federation_profile: { description, contact_email: '', website: '', categories: [] },
  };
}

const PUBLISH_STEP = "Publish your community's listing in the partner directory";

describe('PartnersOverviewPage — setup checklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminFederation.getAnalyticsOverview.mockResolvedValue({
      success: true,
      data: {
        kpis: { total_partnerships: 0, active_partnerships: 0, pending_partnerships: 0, external_partners: 0, federated_transactions: 0, federated_messages: 0, federated_listings: 0, inbound_reviews: 0 },
        daily_calls: [], top_partners: [], recent_errors: [],
      },
    });
    mockAdminFederation.getSettings.mockResolvedValue({ success: true, data: { federation_enabled: true, settings: {} } });
  });

  it('ticks "publish your listing" once the listing has a description', async () => {
    // Regression: the page read a top-level `description` the endpoint never
    // sent, so this step could not tick however complete the listing was.
    mockAdminFederation.getProfile.mockResolvedValue({ success: true, data: serverProfile('A friendly community.') });
    const Page = (await import('./PartnersOverviewPage')).default;
    render(<Page />);

    await waitFor(() => expect(screen.getByText(PUBLISH_STEP).className).toContain('line-through'));
  });

  it('leaves the step open while the listing has no description', async () => {
    mockAdminFederation.getProfile.mockResolvedValue({ success: true, data: serverProfile('   ') });
    const Page = (await import('./PartnersOverviewPage')).default;
    render(<Page />);

    // Wait for the load to finish (the "turn on partnering" step ticks), then check.
    await waitFor(() =>
      expect(screen.getByText('Turn on partnering in Network settings').className).toContain('line-through'),
    );
    expect(screen.getByText(PUBLISH_STEP).className).not.toContain('line-through');
  });

  it('does not tell ordinary admins the area is for super admins only', async () => {
    mockAdminFederation.getProfile.mockResolvedValue({ success: true, data: serverProfile('x') });
    const Page = (await import('./PartnersOverviewPage')).default;
    render(<Page />);

    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByText(/only visible to super admins/i)).not.toBeInTheDocument();
  });
});
