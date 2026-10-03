// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminBroker } = vi.hoisted(() => ({
  mockAdminBroker: {
    showExchange: vi.fn(),
    approveExchange: vi.fn(),
    rejectExchange: vi.fn(),
    resolveDispute: vi.fn(),
    cancelDispute: vi.fn(),
    reverseExchange: vi.fn(),
  },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminBroker: mockAdminBroker,
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/serverTime', () => ({
  formatServerDateTime: (s: string) => s,
}));

// ─── Routing ─────────────────────────────────────────────────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useParams: () => ({ id: '42' }),
    useNavigate: () => vi.fn(),
    Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
  };
});

// ─── Contexts ────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

const { mockResolveAvatarUrl } = vi.hoisted(() => ({
  mockResolveAvatarUrl: vi.fn((url: string | null | undefined) => (url ? `resolved:${url}` : '')),
}));

vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: mockResolveAvatarUrl,
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeExchange = (overrides = {}) => ({
  id: 42,
  requester_id: 1,
  requester_name: 'Alice Requester',
  requester_email: 'alice@example.com',
  provider_id: 2,
  provider_name: 'Bob Provider',
  provider_email: 'bob@example.com',
  listing_id: 7,
  listing_title: 'Garden Help',
  status: 'pending_broker',
  broker_notes: null,
  broker_conditions: null,
  final_hours: 2,
  created_at: '2026-01-15T10:00:00Z',
  ...overrides,
});

const makeHistory = (overrides = {}) => ({
  id: 1,
  exchange_id: 42,
  actor_name: 'Admin User',
  action: 'created',
  notes: null,
  created_at: '2026-01-15T10:00:00Z',
  ...overrides,
});

const makeDetail = (exchangeOverrides = {}, historyItems = [makeHistory()], riskTag = null) => ({
  exchange: makeExchange(exchangeOverrides),
  history: historyItems,
  risk_tag: riskTag,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ExchangeDetailPage (ExchangeDetail)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAdminBroker.showExchange.mockResolvedValue({
      success: true,
      data: makeDetail(),
    });
  });

  it('shows detail skeleton initially', async () => {
    mockAdminBroker.showExchange.mockImplementationOnce(() => new Promise(() => {}));
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    const skeleton = document.querySelector('[aria-busy="true"]');
    expect(skeleton).toBeTruthy();
  });

  it('calls showExchange with the numeric id from useParams', async () => {
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => expect(mockAdminBroker.showExchange).toHaveBeenCalledWith(42));
  });

  it('renders requester name after load', async () => {
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => {
      expect(screen.getByText('Alice Requester')).toBeInTheDocument();
    });
  });

  it('renders provider name after load', async () => {
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => {
      expect(screen.getByText('Bob Provider')).toBeInTheDocument();
    });
  });

  it('renders listing title in the page shell description', async () => {
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => {
      expect(screen.getByText('Garden Help')).toBeInTheDocument();
    });
  });

  it('highlights the current stage in the lifecycle pipeline', async () => {
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => {
      const current = document.querySelector('[aria-current="step"]');
      expect(current).toBeTruthy();
      expect(current?.textContent).toContain('Pending Broker Approval');
    });
  });

  // Every status the workflow service can produce (ExchangeWorkflowService
  // TRANSITIONS) must light a stage. Until this fix pending_provider,
  // in_progress and pending_confirmation had no stage, so the strip showed
  // nothing current for a live exchange.
  it.each([
    ['pending_provider', 'Pending Provider'],
    ['pending_broker', 'Pending Broker Approval'],
    ['accepted', 'Accepted'],
    ['in_progress', 'In Progress'],
    ['pending_confirmation', 'Pending Confirmation'],
    ['completed', 'Completed'],
  ])('highlights the %s stage in the lifecycle pipeline', async (status, label) => {
    mockAdminBroker.showExchange.mockResolvedValue({ success: true, data: makeDetail({ status }) });
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => {
      const current = document.querySelector('[aria-current="step"]');
      expect(current).toBeTruthy();
      expect(current?.textContent).toContain(label);
    });
    // Six linear stages, in workflow order (the badge number is stripped; a
    // completed stage shows a tick instead of its number).
    const stages = Array.from(document.querySelectorAll('ol[aria-label="Exchange progress"] > li'))
      .slice(0, 6)
      .map((li) => (li.textContent ?? '').replace(/^\d+/, ''));
    expect(stages).toEqual([
      'Pending Provider',
      'Pending Broker Approval',
      'Accepted',
      'In Progress',
      'Pending Confirmation',
      'Completed',
    ]);
  });

  it.each(['cancelled', 'disputed', 'expired'])('shows %s as a terminal off-ramp', async (status) => {
    mockAdminBroker.showExchange.mockResolvedValue({ success: true, data: makeDetail({ status }) });
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => {
      const current = document.querySelector('[aria-current="step"]');
      expect(current).toBeTruthy();
      expect(current?.className).toContain('items-center');
    });
    // No linear stage is lit when the exchange left the happy path.
    expect(document.querySelectorAll('[aria-current="step"]').length).toBe(1);
  });

  it('returns to the exchanges tab the broker came from when ?queue= is set', async () => {
    window.history.pushState({}, '', '/test/broker/exchanges/42?queue=disputed');
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => expect(screen.getByText('Alice Requester')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Back to Exchanges' })).toHaveAttribute(
      'href',
      '/test/broker/exchanges?status=disputed',
    );
    window.history.pushState({}, '', '/');
  });

  it('returns to the plain exchanges list when no queue is known', async () => {
    window.history.pushState({}, '', '/test/broker/exchanges/42');
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => expect(screen.getByText('Alice Requester')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Back to Exchanges' })).toHaveAttribute('href', '/test/broker/exchanges');
  });

  it('ignores an unknown ?queue= value', async () => {
    window.history.pushState({}, '', '/test/broker/exchanges/42?queue=javascript');
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => expect(screen.getByText('Alice Requester')).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'Back to Exchanges' })).toHaveAttribute('href', '/test/broker/exchanges');
    window.history.pushState({}, '', '/');
  });

  it('resolves party avatars through the shared avatar helper', async () => {
    mockAdminBroker.showExchange.mockResolvedValue({
      success: true,
      data: makeDetail({ requester_avatar: '/uploads/alice.png', provider_avatar: '/uploads/bob.png' }),
    });
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => expect(screen.getByText('Alice Requester')).toBeInTheDocument());
    // jsdom never fires image load, so the <img> itself is not observable;
    // the helper being asked for both uploads is what the fix guarantees.
    expect(mockResolveAvatarUrl).toHaveBeenCalledWith('/uploads/alice.png');
    expect(mockResolveAvatarUrl).toHaveBeenCalledWith('/uploads/bob.png');
  });

  it('leaves a party without an uploaded avatar on initials, not on the default image', async () => {
    mockResolveAvatarUrl.mockClear();
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => expect(screen.getByText('Alice Requester')).toBeInTheDocument());
    expect(mockResolveAvatarUrl).not.toHaveBeenCalled();
  });

  it('marks a cancelled exchange as a terminal pipeline stage and hides actions', async () => {
    mockAdminBroker.showExchange.mockResolvedValue({
      success: true,
      data: makeDetail({ status: 'cancelled' }),
    });
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => {
      const current = document.querySelector('[aria-current="step"]');
      expect(current?.textContent).toContain('Cancelled');
    });
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('approves a pending_broker exchange through the action modal', async () => {
    mockAdminBroker.approveExchange.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => expect(screen.getByText('Alice Requester')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(screen.getByText('Approve Exchange')).toBeInTheDocument());

    const approveButtons = screen.getAllByRole('button', { name: 'Approve' });
    await user.click(approveButtons[approveButtons.length - 1]);

    await waitFor(() => {
      expect(mockAdminBroker.approveExchange).toHaveBeenCalledWith(42, undefined);
    });
  });

  it('renders a not-found state when API returns failure', async () => {
    mockAdminBroker.showExchange.mockResolvedValue({ success: false, data: null });
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => {
      expect(screen.getByText('Exchange not found.')).toBeInTheDocument();
      const backLink = screen.getAllByRole('link').find((el) =>
        el.getAttribute('href')?.includes('exchanges')
      );
      expect(backLink).toBeDefined();
    });
  });

  it('renders an honest error state with a retry button when the API throws', async () => {
    mockAdminBroker.showExchange.mockRejectedValue(new Error('network'));
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => {
      expect(screen.getByText('Failed to load this exchange')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      const backLink = screen.getAllByRole('link').find((el) =>
        el.getAttribute('href')?.includes('exchanges')
      );
      expect(backLink).toBeDefined();
    });
  });

  it('refetches the exchange when retry is pressed after a failure', async () => {
    mockAdminBroker.showExchange
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ success: true, data: makeDetail() });
    const user = userEvent.setup();
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(mockAdminBroker.showExchange).toHaveBeenCalledTimes(2);
      expect(screen.getByText('Alice Requester')).toBeInTheDocument();
    });
  });

  it('shows risk tag section when risk_tag is present', async () => {
    const riskTag = {
      id: 5,
      listing_id: 7,
      risk_level: 'high' as const,
      risk_category: 'physical',
      risk_notes: 'Requires PPE',
      requires_approval: true,
      insurance_required: false,
      dbs_required: true,
      created_at: '2026-01-10T00:00:00Z',
    };
    mockAdminBroker.showExchange.mockResolvedValue({
      success: true,
      data: makeDetail({}, [makeHistory()], riskTag),
    });
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => {
      expect(screen.getByText('Requires PPE')).toBeInTheDocument();
      expect(screen.getByText('Broker approval required')).toBeInTheDocument();
      expect(screen.getByText('Legacy role-vetting requirement unavailable — access remains blocked')).toBeInTheDocument();
    });
  });

  it('shows broker notes when present', async () => {
    mockAdminBroker.showExchange.mockResolvedValue({
      success: true,
      data: makeDetail({ broker_notes: 'Please verify credentials' }),
    });
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => {
      expect(screen.getByText('Please verify credentials')).toBeInTheDocument();
    });
  });

  it('shows history timeline entry with actor name', async () => {
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => {
      // The component renders "by {name}" via the translation key exchanges.detail_history_by
      expect(screen.getByText(/Admin User/)).toBeInTheDocument();
    });
  });

  it('shows the "no history" empty state when history array is empty', async () => {
    mockAdminBroker.showExchange.mockResolvedValue({
      success: true,
      data: makeDetail({}, []),
    });
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);
    await waitFor(() => {
      expect(screen.getByText('No history available.')).toBeInTheDocument();
    });
  });

  // ── Settling a dispute and reversing a completed exchange ───────────────
  const disputed = () => ({
    ...makeDetail({
      status: 'disputed',
      proposed_hours: '4.00',
      requester_confirmed_hours: '3.00',
      provider_confirmed_hours: '5.00',
    }),
    dispute_window: { min_hours: 3, max_hours: 5 },
  });

  it('shows what each member says on a disputed exchange', async () => {
    mockAdminBroker.showExchange.mockResolvedValue({ success: true, data: disputed() });
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);

    await waitFor(() => expect(screen.getByText('This exchange needs you to settle it')).toBeInTheDocument());
    expect(screen.getByText('Alice Requester says')).toBeInTheDocument();
    expect(screen.getByText('Bob Provider says')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settle dispute' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close with no hours' })).toBeInTheDocument();
  });

  it('settles a dispute at the chosen hours with the broker note', async () => {
    mockAdminBroker.showExchange.mockResolvedValue({ success: true, data: disputed() });
    mockAdminBroker.resolveDispute.mockResolvedValue({ success: true, data: { id: 42, status: 'completed', final_hours: 4 } });
    const user = userEvent.setup();
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);

    await user.click(await screen.findByRole('button', { name: 'Settle dispute' }));
    await user.type(await screen.findByLabelText(/What you decided, and why/), 'Spoke to both; four hours is fair.');
    await user.click(screen.getByRole('button', { name: 'Settle and pay 4 hours' }));

    await waitFor(() => {
      expect(mockAdminBroker.resolveDispute).toHaveBeenCalledWith(42, 4, 'Spoke to both; four hours is fair.');
    });
  });

  it('closes a dispute with no hours when the work did not happen', async () => {
    mockAdminBroker.showExchange.mockResolvedValue({ success: true, data: disputed() });
    mockAdminBroker.cancelDispute.mockResolvedValue({ success: true, data: { id: 42, status: 'cancelled' } });
    const user = userEvent.setup();
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    render(<ExchangeDetail />);

    await user.click(await screen.findByRole('button', { name: 'Close with no hours' }));
    await user.type(await screen.findByLabelText(/What you decided, and why/), 'The provider did not turn up.');
    // The panel's button and the dialog's confirm share a label; the dialog's is last.
    const matches = screen.getAllByRole('button', { name: 'Close with no hours' });
    const confirm = matches[matches.length - 1] as HTMLElement | undefined;
    expect(confirm).toBeDefined();
    await user.click(confirm as HTMLElement);

    await waitFor(() => {
      expect(mockAdminBroker.cancelDispute).toHaveBeenCalledWith(42, 'The provider did not turn up.');
    });
  });

  it('offers Reverse only on a completed exchange whose credits moved and were not yet put back', async () => {
    mockAdminBroker.showExchange.mockResolvedValue({
      success: true,
      data: makeDetail({ status: 'completed', transaction_id: 9, reversal_transaction_id: null }),
    });
    const { default: ExchangeDetail } = await import('./ExchangeDetailPage');
    const { unmount } = render(<ExchangeDetail />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reverse exchange' })).toBeInTheDocument());
    unmount();

    mockAdminBroker.showExchange.mockResolvedValue({
      success: true,
      data: makeDetail({ status: 'completed', transaction_id: 9, reversal_transaction_id: 10 }),
    });
    render(<ExchangeDetail />);
    await waitFor(() => expect(screen.getByText('This exchange was reversed')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Reverse exchange' })).not.toBeInTheDocument();
  });
});
