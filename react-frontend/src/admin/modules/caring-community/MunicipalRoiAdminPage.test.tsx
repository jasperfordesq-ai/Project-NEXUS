// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ─── api mock ─────────────────────────────────────────────────────────────────
const { mockApi, mockTokenManager } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  mockTokenManager: { getAccessToken: vi.fn(() => 'tok'), getTenantId: vi.fn(() => '2') },
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
  tokenManager: mockTokenManager,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── contexts ─────────────────────────────────────────────────────────────────
const mockShowToast = vi.fn();

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => ({ showToast: mockShowToast, success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  }),
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── admin sub-components ─────────────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/Abbr', '../../components/PageHeader', etc. directly,
// and vitest keys mocks per resolved module, so a barrel-only mock never
// installs for those imports.
// A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
function adminComponentsMock() {
  return {
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div>
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    StatCard: ({ label, value }: { label: string; value: string }) => (
      <div data-testid="stat-card">
        <span>{label}</span>
        <span>{value}</span>
      </div>
    ),
    Abbr: ({ term, children }: { term: string; children?: React.ReactNode }) => (
      <abbr title={term}>{children ?? term}</abbr>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/Abbr', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/StatCard', adminComponentsMock);

// ─── fixtures ─────────────────────────────────────────────────────────────────
const makeRoi = (overrides = {}) => ({
  total_hours: 1200,
  active_members: 80,
  active_relationships: 55,
  recipient_count: 30,
  total_exchanges: 400,
  roi: {
    hourly_rate_chf: 45,
    formal_care_offset_chf: 54000,
    prevention_value_chf: 108000,
    social_isolation_prevented: 25,
  },
  trend: {
    hours_yoy_pct: 12.5,
  },
  ...overrides,
});

const makeSubRegions = () => ({
  success: true,
  data: [
    { id: 1, name: 'Altstadt' },
    { id: 2, name: 'Kleinbasel' },
  ],
});

// ─── tests ────────────────────────────────────────────────────────────────────
describe('MunicipalRoiAdminPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // First call is sub-regions, second is ROI data
    mockApi.get.mockResolvedValueOnce(makeSubRegions())
              .mockResolvedValue({ success: true, data: makeRoi() });
  });

  it('shows a spinner while loading', async () => {
    // Make both API calls hang
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { default: Page } = await import('./MunicipalRoiAdminPage');
    render(<Page />);
    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('hides spinner and renders stat cards after load', async () => {
    const { default: Page } = await import('./MunicipalRoiAdminPage');
    render(<Page />);
    await waitFor(() => {
      const spinners = screen.queryAllByRole('status');
      expect(spinners.find((el) => el.getAttribute('aria-busy') === 'true')).toBeUndefined();
    });
    const cards = screen.getAllByTestId('stat-card');
    expect(cards.length).toBeGreaterThanOrEqual(1);
  });

  it('displays total hours value', async () => {
    const { default: Page } = await import('./MunicipalRoiAdminPage');
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByText('1,200')).toBeInTheDocument();
    });
  });

  it('displays active members value', async () => {
    const { default: Page } = await import('./MunicipalRoiAdminPage');
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByText('80')).toBeInTheDocument();
    });
  });

  it('displays social isolation number', async () => {
    const { default: Page } = await import('./MunicipalRoiAdminPage');
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByText('25')).toBeInTheDocument();
    });
  });

  it('shows positive YoY trend chip', async () => {
    const { default: Page } = await import('./MunicipalRoiAdminPage');
    render(<Page />);
    await waitFor(() => {
      // yoy chip contains +12.5%
      const chips = screen.queryAllByText(/12\.5/);
      expect(chips.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('calls load API again when refresh button is clicked', async () => {
    const { default: Page } = await import('./MunicipalRoiAdminPage');
    render(<Page />);
    await waitFor(() => {
      const spinners = screen.queryAllByRole('status');
      expect(spinners.find((el) => el.getAttribute('aria-busy') === 'true')).toBeUndefined();
    });

    const refreshBtn = screen.queryAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('refresh'),
    );
    expect(refreshBtn).toBeDefined();
    await userEvent.click(refreshBtn!);

    // API should be called more times after refresh
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledTimes(3); // sub-regions + initial load + refresh
    });
  });

  it('renders sub-region breakdown table when data includes it', async () => {
    const roiWithBreakdown = makeRoi({
      breakdown_by_sub_region: [
        { sub_region_id: 1, sub_region_name: 'Nordstadt', hours: 500, weighted_hours: 510, formal_care_offset_chf: 22500 },
        { sub_region_id: 2, sub_region_name: 'Südstadt', hours: 700, weighted_hours: 710, formal_care_offset_chf: 31500 },
      ],
    });
    // Reset and re-configure for this test
    mockApi.get.mockReset();
    mockApi.get
      .mockResolvedValueOnce(makeSubRegions())
      .mockResolvedValueOnce({ success: true, data: roiWithBreakdown });

    const { default: Page } = await import('./MunicipalRoiAdminPage');
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByText('Nordstadt')).toBeInTheDocument();
      expect(screen.getByText('Südstadt')).toBeInTheDocument();
    });
  });

  it('shows error toast when API call fails', async () => {
    mockApi.get.mockReset();
    mockApi.get.mockResolvedValueOnce(makeSubRegions());
    mockApi.get.mockRejectedValue(new Error('network'));
    const { default: Page } = await import('./MunicipalRoiAdminPage');
    render(<Page />);
    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'error');
    });
  });

  it('renders Export CSV button', async () => {
    const { default: Page } = await import('./MunicipalRoiAdminPage');
    render(<Page />);
    await waitFor(() => {
      const exportBtn = screen.queryAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('csv') ||
               b.textContent?.toLowerCase().includes('export'),
      );
      expect(exportBtn).toBeDefined();
    });
  });
});
