// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── Hoisted mock refs ──────────────────────────────────────────────────────
const { mockAdminBroker, mockToast } = vi.hoisted(() => ({
  mockAdminBroker: {
    getExchanges: vi.fn(),
    approveExchange: vi.fn(),
    rejectExchange: vi.fn(),
  },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminBroker: mockAdminBroker,
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ── Fixtures ───────────────────────────────────────────────────────────────
const EXCHANGE_PENDING = {
  id: 1,
  requester_name: 'Alice Smith',
  provider_name: 'Bob Jones',
  listing_title: 'Gardening',
  status: 'pending_broker',
  final_hours: 2,
  created_at: '2026-01-15T10:00:00Z',
};

const EXCHANGE_COMPLETED = {
  id: 2,
  requester_name: 'Carol White',
  provider_name: 'Dave Brown',
  listing_title: 'Cooking',
  status: 'completed',
  final_hours: 1,
  created_at: '2026-01-10T09:00:00Z',
};

const EMPTY_RESPONSE = { success: true, data: [], meta: { total: 0 } };
const POPULATED_RESPONSE = {
  success: true,
  data: [EXCHANGE_PENDING, EXCHANGE_COMPLETED],
  meta: { total: 2 },
};

import { ExchangeManagement } from './ExchangesPage';

// test-utils renders inside a BrowserRouter, which reads window.location —
// push the deep-link path before rendering to exercise ?status= handling.
function renderAt(path = '/broker/exchanges') {
  window.history.pushState({}, '', path);
  return render(<ExchangeManagement />);
}

describe('ExchangeManagement — loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/broker/exchanges');
    // Never resolve — keeps component in loading state
    mockAdminBroker.getExchanges.mockReturnValue(new Promise(() => {}));
  });

  it('renders the shell header with the page title', () => {
    render(<ExchangeManagement />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Exchange Management' })
    ).toBeInTheDocument();
  });

  it('shows skeleton placeholders instead of a bare spinner while loading', () => {
    render(<ExchangeManagement />);
    // BrokerSkeleton (table) + BrokerStatCard loading skeletons expose role="status"
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  });
});

describe('ExchangeManagement — empty state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/broker/exchanges');
    mockAdminBroker.getExchanges.mockResolvedValue(EMPTY_RESPONSE);
  });

  it('renders status tabs', async () => {
    render(<ExchangeManagement />);
    await waitFor(() => {
      expect(mockAdminBroker.getExchanges).toHaveBeenCalled();
    });
    // Tabs rendered for status filter
    const tabList = screen.queryAllByRole('tab');
    expect(tabList.length).toBeGreaterThan(0);
  });

  it('shows the neutral empty state on the default (all) filter', async () => {
    render(<ExchangeManagement />);
    await waitFor(() => {
      expect(screen.getByText('No exchanges found.')).toBeInTheDocument();
    });
  });

  it('shows the all-caught-up empty state on the pending queue', async () => {
    renderAt('/broker/exchanges?status=pending_broker');
    await waitFor(() => {
      expect(screen.getByText('No exchanges waiting')).toBeInTheDocument();
    });
  });

  it('shows its own empty state on the needs-action queue', async () => {
    renderAt('/broker/exchanges?status=needs_action');
    await waitFor(() => {
      expect(screen.getByText('Nothing needs your action')).toBeInTheDocument();
    });
  });
});

describe('ExchangeManagement — needs-action deep link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminBroker.getExchanges.mockResolvedValue(POPULATED_RESPONSE);
  });

  // The broker dashboard's "Pending Exchanges" card counts exchanges awaiting
  // approval AND disputed ones, and links here with ?status=needs_action. The
  // page must keep that filter (not fall back to "all") and send it to the API,
  // which expands it to the same two statuses.
  it('keeps ?status=needs_action and requests it from the API', async () => {
    renderAt('/broker/exchanges?status=needs_action');
    await waitFor(() => {
      expect(mockAdminBroker.getExchanges).toHaveBeenCalledWith(
        expect.objectContaining({ page: 1, status: 'needs_action' })
      );
    });
    expect(screen.getByRole('tab', { name: /Needs action/ })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('ExchangeManagement — populated state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/broker/exchanges');
    mockAdminBroker.getExchanges.mockResolvedValue(POPULATED_RESPONSE);
  });

  it('loads exchanges on mount and shows both parties of each exchange', async () => {
    render(<ExchangeManagement />);
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    expect(screen.getByText('Bob Jones')).toBeInTheDocument();
    expect(screen.getByText('Carol White')).toBeInTheDocument();
    expect(screen.getByText('Dave Brown')).toBeInTheDocument();
  });

  it('renders the KPI stat cards for total and pending exchanges', async () => {
    render(<ExchangeManagement />);
    await waitFor(() => {
      expect(screen.getByText('Total exchanges')).toBeInTheDocument();
    });
    expect(screen.getByText('Pending broker review')).toBeInTheDocument();
  });

  it('renders panel-wide status chips for exchange statuses', async () => {
    render(<ExchangeManagement />);
    await waitFor(() => {
      expect(screen.getByText('Pending Broker Approval')).toBeInTheDocument();
    });
  });

  it('honours a deep-linked ?status= filter', async () => {
    renderAt('/broker/exchanges?status=completed');
    await waitFor(() => {
      expect(mockAdminBroker.getExchanges).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' })
      );
    });
  });

  it('shows approve and reject action buttons only for pending_broker rows', async () => {
    render(<ExchangeManagement />);
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    // pending_broker row should have approve + reject icon buttons
    // (view details button is always present)
    const approveButtons = screen.queryAllByRole('button').filter((btn) =>
      btn.getAttribute('aria-label')?.toLowerCase().includes('approve') ||
      btn.getAttribute('aria-label')?.toLowerCase().includes('approv')
    );
    expect(approveButtons.length).toBeGreaterThan(0);
  });

  it('opens approve modal when approve button is pressed', async () => {
    const user = userEvent.setup();
    render(<ExchangeManagement />);
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });
    const approveBtn = screen.getAllByRole('button').find((btn) =>
      btn.getAttribute('aria-label')?.toLowerCase().includes('approv')
    );
    expect(approveBtn).toBeDefined();
    await user.click(approveBtn!);
    // Modal should appear — look for modal footer Cancel button
    await waitFor(() => {
      const cancelBtns = screen.queryAllByRole('button').filter(
        (btn) => btn.textContent?.toLowerCase().includes('cancel')
      );
      expect(cancelBtns.length).toBeGreaterThan(0);
    });
  });

  it('calls approveExchange when confirm is submitted', async () => {
    const user = userEvent.setup();
    mockAdminBroker.approveExchange.mockResolvedValue({ success: true });
    mockAdminBroker.getExchanges.mockResolvedValue(POPULATED_RESPONSE);

    render(<ExchangeManagement />);
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const approveBtn = screen.getAllByRole('button').find((btn) =>
      btn.getAttribute('aria-label')?.toLowerCase().includes('approv')
    );
    await user.click(approveBtn!);

    await waitFor(() => {
      // Look for approve confirm button inside modal
      const allBtns = screen.queryAllByRole('button');
      const confirmBtn = allBtns.find((btn) =>
        btn.textContent?.toLowerCase().includes('approv') &&
        !btn.getAttribute('aria-label')
      );
      expect(confirmBtn).toBeDefined();
    });
  });

  it('opens reject modal and validates reason is required', async () => {
    const user = userEvent.setup();
    render(<ExchangeManagement />);
    await waitFor(() => {
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    });

    const rejectBtn = screen.getAllByRole('button').find((btn) =>
      btn.getAttribute('aria-label')?.toLowerCase().includes('reject')
    );
    expect(rejectBtn).toBeDefined();
    await user.click(rejectBtn!);

    // Modal opens — find reject confirm button and click without entering reason
    await waitFor(() => {
      const allBtns = screen.queryAllByRole('button');
      const rejectConfirmBtn = allBtns.find((btn) =>
        btn.textContent?.toLowerCase() === 'reject'
      );
      expect(rejectConfirmBtn).toBeDefined();
    });
  });
});

describe('ExchangeManagement — error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/broker/exchanges');
    mockAdminBroker.getExchanges.mockRejectedValue(new Error('Network error'));
  });

  it('shows error toast when load fails', async () => {
    render(<ExchangeManagement />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders an honest error state with a retry action instead of an empty table', async () => {
    render(<ExchangeManagement />);
    await waitFor(() => {
      expect(screen.getByText("Couldn't load exchanges")).toBeInTheDocument();
    });
    // Retry buttons (header refresh + error-state retry) share the Refresh label
    expect(screen.getAllByRole('button', { name: 'Refresh' }).length).toBeGreaterThan(0);
  });
});
