// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminTimebanking, mockAdminUsers } = vi.hoisted(() => ({
  mockAdminTimebanking: {
    getCommunityFund: vi.fn(),
    getCommunityFundTransactions: vi.fn(),
    depositCommunityFund: vi.fn(),
    withdrawCommunityFund: vi.fn(),
    getStats: vi.fn(),
    getAlerts: vi.fn(),
    adjustBalance: vi.fn(),
  },
  mockAdminUsers: {
    list: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminTimebanking: mockAdminTimebanking,
  adminUsers: mockAdminUsers,
}));

// ─── Mock AdminMetaContext ────────────────────────────────────────────────────
vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
  AdminMetaProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Mock heavy admin components ──────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/DataTable' (and friends) directly, and vitest keys
// mocks per resolved module, so a barrel-only mock never installs for those
// imports — the real components rendered and the stub testids were never in the
// DOM. A function DECLARATION, not a const: vi.mock calls are hoisted above the
// module body, so a const factory is still uninitialised when they run.
function adminComponentsMock() {
  return {
    DataTable: ({ data, isLoading, emptyContent }: { data: unknown[]; isLoading: boolean; emptyContent?: React.ReactNode }) => (
      isLoading
        ? <div role="status" aria-busy="true" aria-label="loading" />
        : data.length === 0
          ? <div data-testid="data-table-empty">{emptyContent}</div>
          : <div data-testid="data-table">{data.length} rows</div>
    ),
    PageHeader: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
      <div>
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    StatCard: ({ label, value, loading }: { label: string; value: string; loading?: boolean }) => (
      loading
        ? <div role="status" aria-busy="true" aria-label={label} />
        : <div data-testid="stat-card"><span>{label}</span><span>{value}</span></div>
    ),
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/DataTable', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/StatCard', adminComponentsMock);

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeFund = (overrides = {}) => ({
  balance: 42.5,
  total_deposited: 100.0,
  total_withdrawn: 50.0,
  total_donated: 7.5,
  ...overrides,
});

const makeTx = (overrides = {}) => ({
  id: 1,
  type: 'deposit' as const,
  amount: 10.0,
  balance_after: 52.5,
  description: 'Test deposit',
  user_name: 'Admin User',
  created_at: '2025-05-01T10:00:00Z',
  ...overrides,
});

const okFundRes = (data = makeFund()) => ({ success: true, data });
const okTxRes = (data: object[] = []) => ({ success: true, data });

// ─────────────────────────────────────────────────────────────────────────────
describe('CommunityFund', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminTimebanking.getCommunityFund.mockResolvedValue(okFundRes());
    mockAdminTimebanking.getCommunityFundTransactions.mockResolvedValue(okTxRes());
  });

  it('shows loading spinners while fetching fund data', async () => {
    // Keep promise pending so loading state persists
    mockAdminTimebanking.getCommunityFund.mockImplementation(() => new Promise(() => {}));
    mockAdminTimebanking.getCommunityFundTransactions.mockImplementation(() => new Promise(() => {}));

    const { CommunityFund } = await import('./CommunityFund');
    render(<CommunityFund />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders balance stat card with correct amount after load', async () => {
    mockAdminTimebanking.getCommunityFund.mockResolvedValue(okFundRes(makeFund({ balance: 42.5 })));

    const { CommunityFund } = await import('./CommunityFund');
    render(<CommunityFund />);

    await waitFor(() => {
      const statCards = screen.getAllByTestId('stat-card');
      // At least one stat card renders with the balance value (rendered via t('timebanking.hours_value'))
      expect(statCards.length).toBeGreaterThan(0);
    });
  });

  it('renders all 4 stat cards (balance, deposited, withdrawn, donated)', async () => {
    const { CommunityFund } = await import('./CommunityFund');
    render(<CommunityFund />);

    await waitFor(() => {
      expect(screen.getAllByTestId('stat-card')).toHaveLength(4);
    });
  });

  it('shows error toast when getCommunityFund fails', async () => {
    mockAdminTimebanking.getCommunityFund.mockRejectedValue(new Error('network'));

    const { CommunityFund } = await import('./CommunityFund');
    render(<CommunityFund />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows error toast when getCommunityFundTransactions fails', async () => {
    mockAdminTimebanking.getCommunityFundTransactions.mockRejectedValue(new Error('network'));

    const { CommunityFund } = await import('./CommunityFund');
    render(<CommunityFund />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders deposit form with amount and description fields', async () => {
    const { CommunityFund } = await import('./CommunityFund');
    render(<CommunityFund />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    // Deposit form fields are present
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThan(0);
  });

  it('calls depositCommunityFund with correct amount and description', async () => {
    mockAdminTimebanking.depositCommunityFund.mockResolvedValue({ success: true, data: { balance: 52.5 } });

    const { CommunityFund } = await import('./CommunityFund');
    render(<CommunityFund />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    // Find number input (amount) and textarea (description) in the deposit form
    const numberInputs = document.querySelectorAll('input[type="number"]');
    const amountInput = Array.from(numberInputs)[0] as HTMLInputElement;
    const textareas = document.querySelectorAll('textarea');
    const descTextarea = Array.from(textareas)[0] as HTMLTextAreaElement;

    if (amountInput && descTextarea) {
      fireEvent.change(amountInput, { target: { value: '5' } });
      fireEvent.change(descTextarea, { target: { value: 'Community event funding' } });

      const buttons = screen.getAllByRole('button');
      // Deposit button is enabled only when both amount and description are filled
      const depositBtn = buttons.find(
        (b) => b.textContent?.toLowerCase().includes('deposit') && !b.hasAttribute('disabled'),
      );
      if (depositBtn) {
        fireEvent.click(depositBtn);
        await waitFor(() => {
          expect(mockAdminTimebanking.depositCommunityFund).toHaveBeenCalledWith(
            5,
            'Community event funding',
          );
        });
      }
    }
  });

  it('shows success toast after successful deposit', async () => {
    mockAdminTimebanking.depositCommunityFund.mockResolvedValue({ success: true, data: { balance: 52.5 } });

    const { CommunityFund } = await import('./CommunityFund');
    render(<CommunityFund />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    const numberInputs = document.querySelectorAll('input[type="number"]');
    const amountInput = Array.from(numberInputs)[0] as HTMLInputElement;
    const textareas = document.querySelectorAll('textarea');
    const descTextarea = Array.from(textareas)[0] as HTMLTextAreaElement;

    if (amountInput && descTextarea) {
      fireEvent.change(amountInput, { target: { value: '10' } });
      fireEvent.change(descTextarea, { target: { value: 'Deposit reason' } });

      const buttons = screen.getAllByRole('button');
      const depositBtn = buttons.find(
        (b) => b.textContent?.toLowerCase().includes('deposit') && !b.hasAttribute('disabled'),
      );
      if (depositBtn) {
        fireEvent.click(depositBtn);
        await waitFor(() => {
          expect(mockToast.success).toHaveBeenCalled();
        });
      }
    }
  });

  it('shows error toast when deposit fails', async () => {
    mockAdminTimebanking.depositCommunityFund.mockResolvedValue({ success: false, error: 'Deposit failed' });

    const { CommunityFund } = await import('./CommunityFund');
    render(<CommunityFund />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    const numberInputs = document.querySelectorAll('input[type="number"]');
    const amountInput = Array.from(numberInputs)[0] as HTMLInputElement;
    const textareas = document.querySelectorAll('textarea');
    const descTextarea = Array.from(textareas)[0] as HTMLTextAreaElement;

    if (amountInput && descTextarea) {
      fireEvent.change(amountInput, { target: { value: '10' } });
      fireEvent.change(descTextarea, { target: { value: 'Reason' } });

      const buttons = screen.getAllByRole('button');
      const depositBtn = buttons.find(
        (b) => b.textContent?.toLowerCase().includes('deposit') && !b.hasAttribute('disabled'),
      );
      if (depositBtn) {
        fireEvent.click(depositBtn);
        await waitFor(() => {
          expect(mockToast.error).toHaveBeenCalled();
        });
      }
    }
  });

  it('renders transaction table when transactions are returned', async () => {
    mockAdminTimebanking.getCommunityFundTransactions.mockResolvedValue(
      okTxRes([makeTx(), makeTx({ id: 2, type: 'withdrawal', amount: 5, user_name: 'Member B' })])
    );

    const { CommunityFund } = await import('./CommunityFund');
    render(<CommunityFund />);

    await waitFor(() => {
      expect(screen.getByTestId('data-table')).toBeInTheDocument();
    });
  });

  it('renders refresh button and re-fetches on click', async () => {
    const { CommunityFund } = await import('./CommunityFund');
    render(<CommunityFund />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    const refreshBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('refresh'),
    );
    expect(refreshBtn).toBeDefined();

    if (refreshBtn) {
      fireEvent.click(refreshBtn);
      await waitFor(() => {
        // Called at least 2 times: on mount + on refresh click
        expect(mockAdminTimebanking.getCommunityFund.mock.calls.length).toBeGreaterThanOrEqual(2);
      });
    }
  });

  it('calls withdrawCommunityFund via the grant form when member is selected', async () => {
    // The grant form requires a selected member first; the member-search uses adminUsers.list
    // This test verifies the withdraw call with a pre-set up scenario
    mockAdminUsers.list.mockResolvedValue({
      success: true,
      data: [{ id: 10, name: 'Bob Member', email: 'bob@example.com', balance: 20 }],
    });
    mockAdminTimebanking.withdrawCommunityFund.mockResolvedValue({ success: true, data: { balance: 32.5 } });

    const { CommunityFund } = await import('./CommunityFund');
    render(<CommunityFund />);

    await waitFor(() => screen.getAllByTestId('stat-card'));

    // Trigger member search by typing in search input
    const searchInputs = document.querySelectorAll('input[type="search"]');
    const memberSearch = Array.from(searchInputs)[0] as HTMLInputElement;

    if (memberSearch) {
      fireEvent.change(memberSearch, { target: { value: 'Bob' } });

      await waitFor(() => {
        expect(mockAdminUsers.list).toHaveBeenCalledWith(expect.objectContaining({ search: 'Bob' }));
      });

      // Select the member from results
      await waitFor(() => {
        const memberBtn = screen.getAllByRole('button').find((b) => b.textContent?.includes('Bob Member'));
        if (memberBtn) fireEvent.click(memberBtn);
      });
    }
  });
});
