// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';
import { ConfirmDialogProvider } from '@/components/ui';

const api = vi.hoisted(() => ({
  usersList: vi.fn(),
  approve: vi.fn(),
  getMessages: vi.fn(),
  reviewMessage: vi.fn(),
  getExchanges: vi.fn(),
  vettingList: vi.fn(),
  getApprovals: vi.fn(),
  get: vi.fn(),
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminUsers: { list: api.usersList, approve: api.approve },
  adminBroker: { getMessages: api.getMessages, reviewMessage: api.reviewMessage, getExchanges: api.getExchanges },
  adminVetting: { list: api.vettingList },
  adminMatching: { getApprovals: api.getApprovals },
}));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: { get: api.get },
}));
vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

import { BrokerInbox } from './BrokerInbox';

const ok = <T,>(data: T, total?: number) => ({ success: true, data, meta: { total: total ?? (Array.isArray(data) ? data.length : 0) } });

const SUPPORT_NEEDS = [
  {
    user_id: 31, user_name: 'Rosa Keane', consent_given_at: '2026-09-28 10:00:00', has_triggers: true, is_declination_only: false,
    needs_review: true, options: [{ option_key: 'vetted_only', label: 'Vetted contact only', is_declination: false }],
  },
  {
    user_id: 32, user_name: 'Seen Already', consent_given_at: '2026-09-20 10:00:00', has_triggers: true, is_declination_only: false,
    needs_review: false, options: [],
  },
];

describe('BrokerInbox ("Waiting for you")', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.usersList.mockResolvedValue(ok([{ id: 11, name: 'Priya Nolan', email: 'priya@example.org', created_at: '2026-08-24' }], 2));
    api.getMessages.mockResolvedValue(ok([
      { id: 21, sender_name: 'Ann', receiver_name: 'Ben', message_body: 'Saturday works', flagged: false },
      { id: 22, sender_name: 'Cal', receiver_name: 'Dee', message_body: 'Send cash first', flagged: true },
    ]));
    api.getExchanges.mockResolvedValue(ok([]));
    api.vettingList.mockResolvedValue(ok([]));
    api.getApprovals.mockResolvedValue(ok([]));
    api.get.mockImplementation((url: string) => Promise.resolve(url.includes('member-preferences') ? ok([]) : ok([])));
  });

  const renderInbox = (showExchanges = true) =>
    render(
      <ConfirmDialogProvider>
        <BrokerInbox showExchanges={showExchanges} />
      </ConfirmDialogProvider>,
    );

  it('shows each waiting queue with its total, and leaves out empty ones', async () => {
    renderInbox();
    await waitFor(() => expect(screen.getByText('Priya Nolan')).toBeInTheDocument());
    expect(screen.getByText('Waiting for you')).toBeInTheDocument();
    expect(screen.getByText('Ann → Ben')).toBeInTheDocument();
    expect(screen.queryByText('Pending Exchanges')).not.toBeInTheDocument();
    expect(screen.queryByText('Support needs not yet seen')).not.toBeInTheDocument();
  });

  it('asks the messages queue for three rows only', async () => {
    renderInbox();
    await waitFor(() => expect(api.getMessages).toHaveBeenCalledWith({ filter: 'unreviewed', per_page: 3 }));
  });

  it('offers Mark reviewed on a routine message but only Open on a flagged one', async () => {
    renderInbox();
    await waitFor(() => expect(screen.getByText('Cal → Dee')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Mark the message from Ann as reviewed' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark the message from Cal as reviewed' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the message from Cal' })).toBeInTheDocument();
  });

  it('approves a new member only after the broker confirms', async () => {
    api.approve.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderInbox();

    await user.click(await screen.findByRole('button', { name: 'Approve Priya Nolan' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(api.approve).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(api.approve).toHaveBeenCalledWith(11));
    await waitFor(() => expect(screen.queryByText('Priya Nolan')).not.toBeInTheDocument());
  });

  it('marks a routine message reviewed from the dashboard', async () => {
    api.reviewMessage.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderInbox();

    await user.click(await screen.findByRole('button', { name: 'Mark the message from Ann as reviewed' }));
    await waitFor(() => expect(api.reviewMessage).toHaveBeenCalledWith(21));
    await waitFor(() => expect(screen.queryByText('Ann → Ben')).not.toBeInTheDocument());
  });

  // Support needs were the heaviest-weighted queue in the hero yet absent here.
  // The page lists everyone and shows "not yet seen" by default; the same rule applies.
  it('lists members with support needs nobody has seen yet, each opening their own record', async () => {
    api.get.mockImplementation((url: string) => Promise.resolve(url.includes('member-preferences') ? ok(SUPPORT_NEEDS) : ok([])));
    renderInbox();
    await waitFor(() => expect(screen.getByText('Rosa Keane')).toBeInTheDocument());
    expect(screen.getByText('Support needs not yet seen')).toBeInTheDocument();
    expect(screen.queryByText('Seen Already')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: "Open Rosa Keane's support needs" }))
      .toHaveAttribute('href', '/test/broker/safeguarding/support-needs?user=31');
    expect(screen.getByText(/Vetted contact only/)).toBeInTheDocument();
  });

  it('lists vetting re-checks that are still pending and opens the review-requested filter', async () => {
    api.vettingList.mockResolvedValue({
      success: true,
      data: [
        { user_id: 41, first_name: 'Tomás', last_name: 'Byrne', email: 't@example.org', review_status: 'pending', requested_at: '2026-09-25 09:00:00' },
        { user_id: 42, first_name: 'Done', last_name: 'Already', email: 'd@example.org', review_status: 'resolved', requested_at: '2026-09-01 09:00:00' },
      ],
      meta: { pagination: { total: 1 } },
    });
    renderInbox();
    await waitFor(() => expect(screen.getByText('Tomás Byrne')).toBeInTheDocument());
    expect(api.vettingList).toHaveBeenCalledWith({ status: 'review_requested', per_page: 3 });
    expect(screen.queryByText('Done Already')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the vetting re-check for Tomás Byrne' }))
      .toHaveAttribute('href', '/test/broker/vetting?status=review_requested');
  });

  it('lists proposed matches waiting for approval, each opening its own page, only on exchange-workflow communities', async () => {
    api.getApprovals.mockResolvedValue(ok([
      { id: 5, user_1_name: 'Úna', user_2_name: 'Víctor', listing_title: 'Garden help', match_score: 82.4, status: 'pending', created_at: '2026-09-30' },
    ]));
    renderInbox();
    await waitFor(() => expect(screen.getByText('Úna ↔ Víctor')).toBeInTheDocument());
    expect(api.getApprovals).toHaveBeenCalledWith({ status: 'pending' });
    expect(screen.getByText('Matches to approve')).toBeInTheDocument();
    expect(screen.getByText('Garden help · 82% match')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open match 5' })).toHaveAttribute('href', '/test/broker/match-approvals/5');

    vi.clearAllMocks();
    api.getApprovals.mockResolvedValue(ok([]));
    renderInbox(false);
    await waitFor(() => expect(api.getMessages).toHaveBeenCalled());
    expect(api.getApprovals).not.toHaveBeenCalled();
    expect(api.getExchanges).not.toHaveBeenCalled();
  });

  it('renders nothing when every queue is empty, and says so', async () => {
    api.usersList.mockResolvedValue(ok([]));
    api.getMessages.mockResolvedValue(ok([]));
    const onVisibilityChange = vi.fn();
    const { container } = render(
      <ConfirmDialogProvider>
        <BrokerInbox showExchanges onVisibilityChange={onVisibilityChange} />
      </ConfirmDialogProvider>,
    );
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
    expect(onVisibilityChange).toHaveBeenLastCalledWith(false);
  });
});
