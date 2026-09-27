// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── mock contexts ────────────────────────────────────────────────────────────

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast }),
);

// ── mock adminApi ────────────────────────────────────────────────────────────

const mockGetSubscriptions = vi.hoisted(() => vi.fn());

vi.mock('@/admin/api/adminApi', () => ({
  adminPlans: {
    getSubscriptions: mockGetSubscriptions,
  },
}));

// ── mock hooks ───────────────────────────────────────────────────────────────

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ── component ────────────────────────────────────────────────────────────────

import { Subscriptions } from './Subscriptions';

const MOCK_SUBS = vi.hoisted(() => [
  {
    id: 1,
    tenant_name: 'Hour Timebank',
    plan_name: 'Community Pro',
    plan_tier_level: 2,
    status: 'active',
    starts_at: '2026-01-01T00:00:00Z',
    expires_at: '2027-01-01T00:00:00Z',
    trial_ends_at: null,
    stripe_subscription_id: 'sub_abc123',
  },
  {
    id: 2,
    tenant_name: 'Test Tenant',
    plan_name: 'Starter',
    plan_tier_level: 1,
    status: 'trial',
    starts_at: '2026-05-01T00:00:00Z',
    expires_at: '2026-06-01T00:00:00Z',
    trial_ends_at: '2026-06-15T00:00:00Z',
    stripe_subscription_id: null,
  },
]);

describe('Subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading spinner while fetching', () => {
    mockGetSubscriptions.mockReturnValue(new Promise(() => {}));
    render(<Subscriptions />);

    const spinner = screen.getAllByRole('status').find(
      (el) => el.getAttribute('aria-busy') === 'true',
    );
    expect(spinner).toBeDefined();
  });

  it('renders subscription rows in the data table', async () => {
    mockGetSubscriptions.mockResolvedValue({ success: true, data: MOCK_SUBS });
    render(<Subscriptions />);

    await waitFor(() => {
      expect(screen.getByText('Hour Timebank')).toBeInTheDocument();
    });
    expect(screen.getByText('Test Tenant')).toBeInTheDocument();
  });

  it('renders plan names', async () => {
    mockGetSubscriptions.mockResolvedValue({ success: true, data: MOCK_SUBS });
    render(<Subscriptions />);

    await waitFor(() => {
      expect(screen.getByText('Community Pro')).toBeInTheDocument();
    });
    expect(screen.getByText('Starter')).toBeInTheDocument();
  });

  it('renders stripe subscription id', async () => {
    mockGetSubscriptions.mockResolvedValue({ success: true, data: MOCK_SUBS });
    render(<Subscriptions />);

    await waitFor(() => {
      expect(screen.getByText('sub_abc123')).toBeInTheDocument();
    });
  });

  it('shows empty state when data is an empty array', async () => {
    mockGetSubscriptions.mockResolvedValue({ success: true, data: [] });
    render(<Subscriptions />);

    await waitFor(() => {
      expect(screen.getByText(/no data available/i)).toBeInTheDocument();
    });
  });

  it('shows a retryable error when success=false', async () => {
    mockGetSubscriptions.mockResolvedValue({ success: false });
    render(<Subscriptions />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/failed to load subscriptions/i);
    });
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('shows a retryable error without a toast on fetch exception', async () => {
    mockGetSubscriptions.mockRejectedValue(new Error('network'));
    render(<Subscriptions />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/failed to load subscriptions/i);
    });
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it('still renders subscriptions from a legacy/fallback nested { data: [...] } payload', async () => {
    // Legacy/fallback shape only. GET /v2/admin/subscriptions really sends a
    // bare array (respondWithData), which is what the other tests here mock.
    mockGetSubscriptions.mockResolvedValue({
      success: true,
      data: { data: MOCK_SUBS },
    });
    render(<Subscriptions />);

    await waitFor(() => {
      expect(screen.getByText('Hour Timebank')).toBeInTheDocument();
    });
  });
});
