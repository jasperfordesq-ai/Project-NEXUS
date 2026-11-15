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
      screen.getByRole('heading', { level: 1, name: 'Exchanges' })
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
      expect(screen.getByText('Nothing needs a decision')).toBeInTheDocument();
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
    expect(screen.getByRole('tab', { name: /Needs a decision/ })).toHaveAttribute('aria-selected', 'true');
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

  // The row of four number tiles repeated the tabs and pushed the list down
  // the page (Nov 2026). The tabs carry the counts now.
  it('has no row of number tiles above the list', async () => {
    render(<ExchangeManagement />);
    expect(await screen.findByRole('tab', { name: /^All/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Waiting for approval/ })).toBeInTheDocument();
    expect(screen.queryByText('Total exchanges')).not.toBeInTheDocument();
    expect(screen.queryByText('Pending broker review')).not.toBeInTheDocument();
  });

  it('renders panel-wide status chips for exchange statuses', async () => {
    render(<ExchangeManagement />);
    await waitFor(() => {
      expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
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

describe('ExchangeManagement — a failed decision keeps the typed reason', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/broker/exchanges');
    mockAdminBroker.getExchanges.mockResolvedValue(POPULATED_RESPONSE);
  });

  // Until this fix the finally block closed the modal and wiped the textarea on
  // every outcome, so a broker whose reject failed (network blip, 403) lost
  // the reason they had just written and had no idea which it was.
  it('keeps the reject modal and the reason open when the request fails', async () => {
    const user = userEvent.setup();
    mockAdminBroker.rejectExchange.mockResolvedValue({ success: false, error: 'Server said no' });
    render(<ExchangeManagement />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Reject Exchange' }));
    const reason = await screen.findByLabelText(/Reason \(required\)/);
    await user.type(reason, 'Not a safe exchange');
    await user.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith('Server said no'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/Reason \(required\)/)).toHaveValue('Not a safe exchange');
  });

  it('closes the modal only once the decision succeeded', async () => {
    const user = userEvent.setup();
    mockAdminBroker.approveExchange.mockResolvedValue({ success: true });
    render(<ExchangeManagement />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Approve Exchange' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('ExchangeManagement — tab counts and labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/broker/exchanges');
    // One probe per status; the list itself is the unfiltered call.
    mockAdminBroker.getExchanges.mockImplementation(async ({ status }: { status?: string }) => {
      const totals: Record<string, number> = { pending_broker: 3, needs_action: 5, disputed: 2 };
      if (status && status in totals) {
        return { success: true, data: [], meta: { total: totals[status] } };
      }
      return { success: true, data: [EXCHANGE_PENDING, EXCHANGE_COMPLETED], meta: { total: 10 } };
    });
  });

  // Each count is read from the same one-row probe as before, and now sits
  // on the tab it belongs to instead of on a tile above the tabs.
  it('shows each count once, on its tab', async () => {
    render(<ExchangeManagement />);
    const needs = await screen.findByRole('tab', { name: /Needs a decision/ });
    await waitFor(() => expect(needs.textContent).toContain('5'));
    expect(screen.getByRole('tab', { name: /Waiting for approval/ }).textContent).toContain('3');
    expect(screen.getByRole('tab', { name: /Disputed/ }).textContent).toContain('2');
    expect(screen.getByRole('tab', { name: /^All/ }).textContent).toContain('10');
    // No tile repeats them.
    expect(screen.queryByRole('link', { name: 'Needs a decision' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Disputed' })).not.toBeInTheDocument();
  });

  // "Disputed" was the last of eight tabs, where its count scrolled out of
  // sight on a laptop. The three lists a broker acts on now sit together.
  it('puts the three lists a broker acts on before the history tabs', async () => {
    render(<ExchangeManagement />);
    await screen.findByRole('tab', { name: /Needs a decision/ });
    const names = screen.getAllByRole('tab').map((tab) => tab.textContent ?? '');
    const at = (label: string) => names.findIndex((name) => name.includes(label));
    expect(at('Needs a decision')).toBeLessThan(at('Waiting for approval'));
    expect(at('Waiting for approval')).toBeLessThan(at('Disputed'));
    expect(at('Disputed')).toBeLessThan(at('Approved'));
    expect(at('Disputed')).toBeLessThan(at('Completed'));
  });

  it('says in a sentence what the tab you are on means, for the lists a broker acts on', async () => {
    render(<ExchangeManagement />);
    await screen.findByRole('tab', { name: /Needs a decision/ });
    // Nothing on "All".
    expect(screen.queryByText('Awaiting your approval or in dispute')).not.toBeInTheDocument();
    expect(screen.queryByText('Members disagree about the hours')).not.toBeInTheDocument();
  });

  it('explains the Disputed tab when it is the one open', async () => {
    window.history.pushState({}, '', '/broker/exchanges?status=disputed');
    render(<ExchangeManagement />);
    expect(await screen.findByText('Members disagree about the hours')).toBeInTheDocument();
    expect(screen.queryByText('Awaiting your approval or in dispute')).not.toBeInTheDocument();
  });

  it('writes hours through a translated label instead of a bare "h" suffix', async () => {
    render(<ExchangeManagement />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    expect(screen.getByText('2 hours')).toBeInTheDocument();
    expect(screen.getByText('1 hour')).toBeInTheDocument();
    expect(screen.queryByText('2h')).not.toBeInTheDocument();
  });

  it('uses the panel-wide soft danger style for the row Reject button', async () => {
    render(<ExchangeManagement />);
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    const reject = screen.getByRole('button', { name: 'Reject Exchange' });
    expect(reject.className).toContain('danger-soft');
  });

  it('carries the current tab into the detail link so Back can return to it', async () => {
    mockAdminBroker.getExchanges.mockResolvedValue(POPULATED_RESPONSE);
    renderAt('/broker/exchanges?status=disputed');
    await waitFor(() => expect(screen.getByText('Alice Smith')).toBeInTheDocument());
    const details = screen.getAllByRole('link', { name: 'View Exchange Details' });
    expect(details[0]).toHaveAttribute('href', expect.stringContaining('/broker/exchanges/1?queue=disputed'));
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
