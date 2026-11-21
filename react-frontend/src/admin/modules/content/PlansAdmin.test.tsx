// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── Stable mock refs ──────────────────────────────────────────────────────────
const { mockToast, mockNavigate, mockPlansList, mockPlansDelete, mockPlansSync } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockNavigate: vi.fn(),
  mockPlansList: vi.fn(),
  mockPlansDelete: vi.fn(),
  mockPlansSync: vi.fn(),
}));

// Auth with super_admin so all action columns appear
const SUPER_ADMIN_USER = { id: 1, role: 'super_admin', name: 'Admin', email: 'admin@test.ie' };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useAuth: () => ({
      user: SUPER_ADMIN_USER,
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

vi.mock('@/lib/api', () => {
  const m = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
  return { default: m, api: m };
});

vi.mock('../../api/adminApi', () => ({
  adminPlans: {
    list: mockPlansList,
    delete: mockPlansDelete,
    syncStripe: mockPlansSync,
  },
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import { PlansAdmin } from './PlansAdmin';

// ── Test data ─────────────────────────────────────────────────────────────────
const FREE_PLAN = {
  id: 1,
  name: 'Free Tier',
  description: 'Basic access',
  tier_level: 0,
  price_monthly: 0,
  price_yearly: 0,
  tenant_count: 5,
  stripe_synced: false,
  stripe_product_id: null,
  is_active: true,
};

const PRO_PLAN = {
  id: 2,
  name: 'Pro Plan',
  description: 'Professional features',
  tier_level: 1,
  price_monthly: 49,
  price_yearly: 490,
  tenant_count: 0,
  stripe_synced: true,
  stripe_product_id: 'prod_abc123',
  is_active: true,
};

function resolveList(items: unknown[]) {
  mockPlansList.mockResolvedValue({ success: true, data: items });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('PlansAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading spinner while fetching', () => {
    mockPlansList.mockReturnValue(new Promise(() => {}));
    render(<PlansAdmin />);
    const spinner = Array.from(document.body.querySelectorAll('[role="status"]')).find(
      (el) => el.getAttribute('aria-busy') === 'true'
    );
    expect(spinner).toBeTruthy();
  });

  it('renders plan rows after load', async () => {
    resolveList([FREE_PLAN, PRO_PLAN]);
    render(<PlansAdmin />);
    await waitFor(() => {
      expect(screen.getByText('Free Tier')).toBeInTheDocument();
      expect(screen.getByText('Pro Plan')).toBeInTheDocument();
    });
  });

  it('shows EmptyState when no plans exist', async () => {
    resolveList([]);
    render(<PlansAdmin />);
    await waitFor(() => {
      expect(screen.getByText(/no plans/i)).toBeInTheDocument();
    });
  });

  it('shows active/inactive chip correctly', async () => {
    resolveList([FREE_PLAN]);
    render(<PlansAdmin />);
    await waitFor(() => {
      expect(screen.getByText(/active/i)).toBeInTheDocument();
    });
  });

  it('shows Stripe synced chip for synced plans', async () => {
    resolveList([PRO_PLAN]);
    render(<PlansAdmin />);
    await waitFor(() => {
      expect(screen.getByText(/synced/i)).toBeInTheDocument();
    });
  });

  it('shows unsynced status for unsynced plans', async () => {
    resolveList([FREE_PLAN]);
    render(<PlansAdmin />);
    await waitFor(() => {
      expect(screen.getByText(/unsynced/i)).toBeInTheDocument();
    });
  });

  it('navigates to create plan page when Create button is clicked', async () => {
    resolveList([]);
    render(<PlansAdmin />);
    // When list is empty, EmptyState action + PageHeader action both exist;
    // click any one of them — both navigate to create
    await waitFor(() => screen.getAllByRole('button', { name: /create/i }));

    const createBtns = screen.getAllByRole('button', { name: /create/i });
    await userEvent.click(createBtns[0]);
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/platform-team/plans/create'));
  });

  it('opens delete confirm modal for plans with 0 tenants', async () => {
    const user = userEvent.setup();
    resolveList([PRO_PLAN]); // tenant_count = 0
    render(<PlansAdmin />);
    await waitFor(() => screen.getByText('Pro Plan'));

    const deleteBtn = screen.getByRole('button', { name: /delete plan/i });
    await user.click(deleteBtn);

    // Modal heading contains "Delete Plan" (i18n key content.plans_admin_title)
    await waitFor(() => {
      // Check that the confirm modal appeared by looking for a dialog or modal
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('delete button is disabled for plans with active tenants', async () => {
    resolveList([FREE_PLAN]); // tenant_count = 5
    render(<PlansAdmin />);
    await waitFor(() => screen.getByText('Free Tier'));

    const deleteBtn = screen.getByRole('button', { name: /delete plan/i });
    // HeroUI v3 disabled buttons are rendered with isDisabled — may be actual disabled or aria-disabled
    expect(
      deleteBtn.hasAttribute('disabled') ||
      deleteBtn.getAttribute('aria-disabled') === 'true' ||
      deleteBtn.getAttribute('data-disabled') === 'true'
    ).toBe(true);
  });

  it('calls adminPlans.delete and shows success toast on confirm', async () => {
    const user = userEvent.setup();
    resolveList([PRO_PLAN]);
    mockPlansDelete.mockResolvedValue({ success: true });
    mockPlansList
      .mockResolvedValueOnce({ success: true, data: [PRO_PLAN] })
      .mockResolvedValue({ success: true, data: [] });

    render(<PlansAdmin />);
    await waitFor(() => screen.getByText('Pro Plan'));

    const deleteBtn = screen.getByRole('button', { name: /delete plan/i });
    await user.click(deleteBtn);

    // Wait for dialog to appear
    await waitFor(() => screen.getByRole('dialog'));

    // Confirm via the Delete button inside the modal
    const confirmBtn = screen.getByRole('button', { name: /^delete$/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockPlansDelete).toHaveBeenCalledWith(2);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('calls adminPlans.syncStripe and shows success toast', async () => {
    resolveList([FREE_PLAN]);
    mockPlansSync.mockResolvedValue({ success: true });

    render(<PlansAdmin />);
    await waitFor(() => screen.getByText('Free Tier'));

    const syncBtn = screen.getByRole('button', { name: /sync to stripe/i });
    await userEvent.click(syncBtn);

    await waitFor(() => {
      expect(mockPlansSync).toHaveBeenCalledWith(1);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when Stripe sync fails', async () => {
    resolveList([FREE_PLAN]);
    mockPlansSync.mockResolvedValue({ success: false });

    render(<PlansAdmin />);
    await waitFor(() => screen.getByText('Free Tier'));

    const syncBtn = screen.getByRole('button', { name: /sync to stripe/i });
    await userEvent.click(syncBtn);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  it('shows the member number and the monthly price in both currencies', async () => {
    resolveList([
      // Decimals arrive from the API as strings.
      { ...PRO_PLAN, max_users: 250, price_monthly: '49.00', price_monthly_gbp: '42.00' },
      { ...FREE_PLAN, max_users: null, price_monthly_gbp: null },
    ]);
    render(<PlansAdmin />);
    await waitFor(() => screen.getByText('Pro Plan'));

    expect(screen.getByText('250')).toBeInTheDocument();
    expect(screen.getByText(/unlimited/i)).toBeInTheDocument();
    expect(screen.getByText(/^€\s?49\.00$/)).toBeInTheDocument();
    expect(screen.getByText(/^£\s?42\.00$/)).toBeInTheDocument();
    expect(screen.getByText(/no pound price/i)).toBeInTheDocument();
  });

  it('shows error toast when initial load fails', async () => {
    mockPlansList.mockRejectedValue(new Error('Network error'));
    render(<PlansAdmin />);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });
});
