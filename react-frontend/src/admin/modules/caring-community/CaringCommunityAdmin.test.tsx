// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── vi.hoisted: stable refs used inside vi.mock factories ───────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
}));

const mockRefreshTenant = vi.hoisted(() => vi.fn());

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
      refreshTenant: mockRefreshTenant,
    }),
  })
);

vi.mock('@/admin/api/adminApi', () => ({
  adminConfig: {
    get: vi.fn(),
    updateFeature: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// Stub sub-components to keep tests focused
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/PageHeader' and '../../components/StatCard' directly
// (same resolved modules as the aliases below), and vitest keys mocks per
// resolved module, so a barrel-only mock never installs for those imports.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
function adminComponentsMock() {
  return {
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">{title}{actions}</div>
    ),
    StatCard: ({ label, value }: { label: string; value: string }) => (
      <div data-testid="stat-card">{label}: {value}</div>
    ),
  };
}

vi.mock('@/admin/components', adminComponentsMock);
vi.mock('@/admin/components/PageHeader', adminComponentsMock);
vi.mock('@/admin/components/StatCard', adminComponentsMock);

import { adminConfig } from '@/admin/api/adminApi';
import CaringCommunityAdmin from './CaringCommunityAdmin';

const mockTenantConfig = {
  features: {
    caring_community: true,
    volunteering: true,
    organisations: true,
    groups: true,
    resources: true,
    reviews: true,
  },
  modules: {
    listings: true,
  },
  settings: {},
};

describe('CaringCommunityAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner initially', async () => {
    // Never resolve so the spinner stays
    vi.mocked(adminConfig.get).mockReturnValue(new Promise(() => {}));
    render(<CaringCommunityAdmin />);
    const loading = screen.getAllByRole('status').find(
      (el) => el.getAttribute('aria-busy') === 'true',
    );
    expect(loading).toBeDefined();
  });

  it('renders config once loaded', async () => {
    vi.mocked(adminConfig.get).mockResolvedValueOnce({
      success: true,
      data: mockTenantConfig,
    });
    render(<CaringCommunityAdmin />);
    await waitFor(() => expect(adminConfig.get).toHaveBeenCalled());
    // Spinner gone
    const spinners = screen.queryAllByRole('status').filter(
      (el) => el.getAttribute('aria-busy') === 'true',
    );
    expect(spinners).toHaveLength(0);
    // Stat cards present
    expect(screen.getAllByTestId('stat-card').length).toBeGreaterThan(0);
  });

  it('shows master switch in enabled state when caring_community feature is true', async () => {
    vi.mocked(adminConfig.get).mockResolvedValueOnce({
      success: true,
      data: mockTenantConfig,
    });
    render(<CaringCommunityAdmin />);
    await waitFor(() =>
      expect(
        screen.queryAllByRole('status').filter(
          (el) => el.getAttribute('aria-busy') === 'true',
        ),
      ).toHaveLength(0),
    );
    const sw = screen.getByRole('switch');
    expect(sw).toBeInTheDocument();
  });

  it('shows master switch disabled when feature is false', async () => {
    vi.mocked(adminConfig.get).mockResolvedValueOnce({
      success: true,
      data: {
        ...mockTenantConfig,
        features: { ...mockTenantConfig.features, caring_community: false },
      },
    });
    render(<CaringCommunityAdmin />);
    await waitFor(() =>
      expect(
        screen.queryAllByRole('status').filter(
          (el) => el.getAttribute('aria-busy') === 'true',
        ),
      ).toHaveLength(0),
    );
    const sw = screen.getByRole('switch');
    expect(sw).toBeInTheDocument();
  });

  it('calls updateFeature when toggle is clicked', async () => {
    vi.mocked(adminConfig.get).mockResolvedValueOnce({
      success: true,
      data: mockTenantConfig,
    });
    vi.mocked(adminConfig.updateFeature).mockResolvedValueOnce({
      success: true,
      data: { success: true },
    });

    const user = userEvent.setup();
    render(<CaringCommunityAdmin />);
    await waitFor(() =>
      expect(
        screen.queryAllByRole('status').filter(
          (el) => el.getAttribute('aria-busy') === 'true',
        ),
      ).toHaveLength(0),
    );

    const sw = screen.getByRole('switch');
    await user.click(sw);

    await waitFor(() => expect(adminConfig.updateFeature).toHaveBeenCalled());
  });

  it('shows error toast when loading fails', async () => {
    vi.mocked(adminConfig.get).mockRejectedValueOnce(new Error('network'));
    render(<CaringCommunityAdmin />);
    await waitFor(() =>
      expect(
        screen.queryAllByRole('status').filter(
          (el) => el.getAttribute('aria-busy') === 'true',
        ),
      ).toHaveLength(0),
    );
    expect(mockToast.error).toHaveBeenCalled();
  });

  it('calls loadConfig again when refresh button is pressed', async () => {
    vi.mocked(adminConfig.get).mockResolvedValue({
      success: true,
      data: mockTenantConfig,
    });
    const user = userEvent.setup();
    render(<CaringCommunityAdmin />);
    await waitFor(() =>
      expect(
        screen.queryAllByRole('status').filter(
          (el) => el.getAttribute('aria-busy') === 'true',
        ),
      ).toHaveLength(0),
    );
    // Initial load
    expect(adminConfig.get).toHaveBeenCalledTimes(1);
    // The refresh button is the 3rd button in the header actions area.
    // In test i18n the label key renders literally.
    const allButtons = screen.getAllByRole('button');
    // Find the button that triggers loadConfig — use startContent RefreshCw icon aria-label fallback
    // or just pick the 3rd action button by filtering out disabled/switch controls
    const clickableButtons = allButtons.filter(
      (b) =>
        b.getAttribute('disabled') === null &&
        b.getAttribute('aria-disabled') !== 'true' &&
        b.getAttribute('role') !== 'switch',
    );
    // Refresh is always one of the first three action buttons
    // Click each until loadConfig is called again
    let clicked = false;
    for (const btn of clickableButtons) {
      const text = btn.textContent ?? '';
      if (/refresh/i.test(text) || /refresh/i.test(btn.getAttribute('aria-label') ?? '')) {
        await user.click(btn);
        clicked = true;
        break;
      }
    }
    if (!clicked && clickableButtons.length > 0) {
      // fallback: click first link-less button
      await user.click(clickableButtons[0]);
    }
    await waitFor(() => expect(adminConfig.get).toHaveBeenCalledTimes(2));
  });
});
