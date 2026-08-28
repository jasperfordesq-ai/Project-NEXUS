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
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── contexts ─────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast }),
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── admin sub-components ─────────────────────────────────────────────────────
vi.mock('../../components', () => ({
  PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));

// ─── fixtures ─────────────────────────────────────────────────────────────────
const makeSub = (overrides = {}) => ({
  id: 1,
  tenant_id: 2,
  partner_name: 'City of Basel',
  partner_type: 'municipality',
  contact_email: 'contact@basel.ch',
  billing_email: 'billing@basel.ch',
  plan_tier: 'pro',
  status: 'active',
  trial_ends_at: null,
  current_period_start: '2025-01-01',
  current_period_end: '2025-12-31',
  monthly_price_cents: 29900,
  currency: 'CHF',
  enabled_modules: ['trends', 'demographics'],
  created_at: '2025-01-01T00:00:00Z',
  ...overrides,
});

const makeListResp = (subscriptions = [] as object[]) => ({
  success: true,
  data: { subscriptions },
});

// ─── tests ────────────────────────────────────────────────────────────────────
describe('RegionalAnalyticsAdminPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue(makeListResp());
  });

  it('shows a spinner while loading', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {}));
    const { default: Page } = await import('./RegionalAnalyticsAdminPage');
    render(<Page />);
    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders empty state when no subscriptions', async () => {
    const { default: Page } = await import('./RegionalAnalyticsAdminPage');
    render(<Page />);
    await waitFor(() => {
      const spinners = screen.queryAllByRole('status');
      expect(spinners.find((el) => el.getAttribute('aria-busy') === 'true')).toBeUndefined();
    });
    // No table rows appear
    expect(screen.queryByText('City of Basel')).not.toBeInTheDocument();
  });

  it('renders subscription rows when data is returned', async () => {
    mockApi.get.mockResolvedValue(makeListResp([makeSub()]));
    const { default: Page } = await import('./RegionalAnalyticsAdminPage');
    render(<Page />);
    await waitFor(() => {
      expect(screen.getByText('City of Basel')).toBeInTheDocument();
    });
    expect(screen.getByText('contact@basel.ch')).toBeInTheDocument();
  });

  it('shows price formatted from cents', async () => {
    mockApi.get.mockResolvedValue(makeListResp([makeSub({ monthly_price_cents: 29900, currency: 'CHF' })]));
    const { default: Page } = await import('./RegionalAnalyticsAdminPage');
    render(<Page />);
    await waitFor(() => {
      // formatCurrency uses Intl, which places the currency BEFORE the amount
      // for CHF in these locales ("CHF 299.00"). The old regex demanded the
      // opposite order and could never match. Accept either, because symbol
      // placement is the locale's business, not this page's.
      expect(screen.getByText(/CHF\s?299\.00|299\.00\s?CHF/)).toBeInTheDocument();
    });
  });

  it('shows suspend button for active subscriptions', async () => {
    mockApi.get.mockResolvedValue(makeListResp([makeSub({ status: 'active' })]));
    const { default: Page } = await import('./RegionalAnalyticsAdminPage');
    render(<Page />);
    await waitFor(() => {
      const btn = screen.queryAllByRole('button').find(
        (b) => b.getAttribute('aria-label')?.toLowerCase().includes('suspend'),
      );
      expect(btn).toBeDefined();
    });
  });

  it('shows resume button for past_due subscriptions', async () => {
    mockApi.get.mockResolvedValue(makeListResp([makeSub({ status: 'past_due' })]));
    const { default: Page } = await import('./RegionalAnalyticsAdminPage');
    render(<Page />);
    await waitFor(() => {
      const btn = screen.queryAllByRole('button').find(
        (b) => b.getAttribute('aria-label')?.toLowerCase().includes('resume'),
      );
      expect(btn).toBeDefined();
    });
  });

  it('calls PUT when suspend is clicked', async () => {
    mockApi.get.mockResolvedValue(makeListResp([makeSub({ status: 'active' })]));
    mockApi.put.mockResolvedValue({ success: true });
    const { default: Page } = await import('./RegionalAnalyticsAdminPage');
    render(<Page />);

    await waitFor(() => expect(screen.getByText('City of Basel')).toBeInTheDocument());

    const suspendBtn = screen.queryAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('suspend'),
    );
    expect(suspendBtn).toBeDefined();
    await userEvent.click(suspendBtn!);

    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith(
        '/super-admin/regional-analytics/subscriptions/1',
        { status: 'past_due' },
      );
    });
  });

  it('calls POST to generate report', async () => {
    mockApi.get.mockResolvedValue(makeListResp([makeSub()]));
    mockApi.post.mockResolvedValue({ success: true });
    const { default: Page } = await import('./RegionalAnalyticsAdminPage');
    render(<Page />);

    await waitFor(() => expect(screen.getByText('City of Basel')).toBeInTheDocument());

    const reportBtn = screen.queryAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('report'),
    );
    expect(reportBtn).toBeDefined();
    await userEvent.click(reportBtn!);

    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith(
        '/super-admin/regional-analytics/subscriptions/1/generate-report',
      );
    });
  });

  it('opens access log modal when view-log button is clicked', async () => {
    mockApi.get
      .mockResolvedValueOnce(makeListResp([makeSub()]))
      .mockResolvedValue({ success: true, data: { items: [] } });
    const { default: Page } = await import('./RegionalAnalyticsAdminPage');
    render(<Page />);

    await waitFor(() => expect(screen.getByText('City of Basel')).toBeInTheDocument());

    const logBtn = screen.queryAllByRole('button').find(
      (b) => b.getAttribute('aria-label')?.toLowerCase().includes('log'),
    );
    expect(logBtn).toBeDefined();
    await userEvent.click(logBtn!);

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });
  });

  it('opens create subscription modal when New Subscription is clicked', async () => {
    const { default: Page } = await import('./RegionalAnalyticsAdminPage');
    render(<Page />);

    await waitFor(() => {
      const spinners = screen.queryAllByRole('status');
      expect(spinners.find((el) => el.getAttribute('aria-busy') === 'true')).toBeUndefined();
    });

    const newBtn = screen.queryAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('subscription') ||
             b.textContent?.toLowerCase().includes('new'),
    );
    expect(newBtn).toBeDefined();
    await userEvent.click(newBtn!);

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });
  });

  it('shows error toast when API call fails', async () => {
    mockApi.get.mockRejectedValue(new Error('network'));
    const { default: Page } = await import('./RegionalAnalyticsAdminPage');
    render(<Page />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});
