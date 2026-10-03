// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';
import type { BrokerDashboardActivityEntry } from '../dashboardTypes';

const mockGetDashboard = vi.hoisted(() => vi.fn());

vi.mock('@/admin/api/adminApi', () => ({
  adminBroker: { getDashboard: mockGetDashboard },
}));
vi.mock('@/contexts', () => createMockContexts());

import { BrokerActivityTimeline, activityLinkFor, formatActivityDetails } from './BrokerActivityTimeline';

const minutesAgo = (n: number) => new Date(Date.now() - n * 60 * 1000).toISOString();

const entry = (over: Partial<BrokerDashboardActivityEntry>): BrokerDashboardActivityEntry => ({
  id: 1,
  source: 'audit',
  user_id: 9,
  first_name: 'Alice',
  last_name: 'Broker',
  action_type: 'exchange_approved',
  details: null,
  created_at: minutesAgo(5),
  target_user_id: null,
  ...over,
});

const MESSAGE_ENTRY = entry({ id: 2, action_type: 'broker_message_flagged', details: '{"message_id":87,"has_notes":true}', created_at: minutesAgo(90) });
const MEMBER_ENTRY = entry({ id: 4, source: 'activity', action_type: 'admin_approve_user', details: 'Approved user #31 (a@example.org)' });

const ENTRIES: BrokerDashboardActivityEntry[] = [
  entry({ id: 1, action_type: 'exchange_approved', details: '{"exchange_id":42,"notes":""}' }),
  MESSAGE_ENTRY,
  entry({ id: 3, action_type: 'listing_risk_tag_created', details: '{"listing_id":164,"risk_level":"high"}' }),
  MEMBER_ENTRY,
  entry({ id: 5, action_type: 'match_approved', details: '{"approval_id":7}', target_user_id: 31 }),
];

describe('BrokerActivityTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names the actor, the action and the record for each row', () => {
    render(<BrokerActivityTimeline entries={ENTRIES} />);
    expect(screen.getAllByText('Alice Broker').length).toBe(5);
    expect(screen.getByText('approved an exchange')).toBeInTheDocument();
    expect(screen.getByText('Exchange #42')).toBeInTheDocument();
    expect(screen.getByText('Message #87 · with a note')).toBeInTheDocument();
    // New in October 2026: member actions from activity_log, with their plain sentence.
    expect(screen.getByText('approved a new member')).toBeInTheDocument();
    expect(screen.getByText('Approved user #31 (a@example.org)')).toBeInTheDocument();
    expect(screen.getByText('Member approved')).toBeInTheDocument();
    expect(screen.getByText('Match #7')).toBeInTheDocument();
  });

  it('links a row to the exchange, message, risk tag or match it concerns, and not a member', () => {
    render(<BrokerActivityTimeline entries={ENTRIES} />);
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/broker/exchanges/42');
    expect(hrefs).toContain('/test/broker/messages/87');
    expect(hrefs).toContain('/test/broker/risk-tags');
    expect(hrefs).toContain('/test/broker/match-approvals/7');
    // The member approval has only a sentence, so it is not a link.
    expect(hrefs).toHaveLength(4);
    expect(activityLinkFor(MEMBER_ENTRY)).toBeNull();
  });

  // jsdom has no PointerEvent, so React Aria never sees a hover here; the
  // keyboard path is the one a screen-reader user takes anyway.
  it('shows the exact date and time when the relative time is focused', async () => {
    const user = userEvent.setup();
    render(<BrokerActivityTimeline entries={[MESSAGE_ENTRY]} />);
    const button = screen.getByText('1h ago').closest('button') as HTMLButtonElement;
    for (let i = 0; i < 6 && document.activeElement !== button; i++) await user.tab();
    expect(button).toHaveFocus();
    const tooltip = await screen.findByRole('tooltip');
    const expected = new Date(MESSAGE_ENTRY.created_at).toLocaleString();
    expect(tooltip).toHaveTextContent(expected);
  });

  it('opens a drawer with the last 100 actions from the same endpoint', async () => {
    mockGetDashboard.mockResolvedValue({
      success: true,
      data: { recent_activity: [...ENTRIES, entry({ id: 6, action_type: 'exchange_reversed', details: '{"exchange_id":99,"reason":"double booked"}' })] },
    });
    const user = userEvent.setup();
    render(<BrokerActivityTimeline entries={ENTRIES} />);

    await user.click(screen.getByRole('button', { name: 'See all' }));
    const dialog = await screen.findByRole('dialog');
    expect(mockGetDashboard).toHaveBeenCalledWith({ only: 'activity', activity_limit: 100 });
    await waitFor(() => expect(within(dialog).getByText('Exchange #99 · double booked')).toBeInTheDocument());
    expect(within(dialog).getByText('reversed a completed exchange')).toBeInTheDocument();
  });

  it('shows the empty state, without a See all action, when there is nothing yet', () => {
    render(<BrokerActivityTimeline entries={[]} />);
    expect(screen.getByText('No recent broker activity')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'See all' })).not.toBeInTheDocument();
  });

  it('shows the load error inside the panel when the feed failed', () => {
    render(<BrokerActivityTimeline entries={[]} failed />);
    expect(screen.getByText("Couldn't load the activity feed")).toBeInTheDocument();
  });

  describe('formatActivityDetails', () => {
    const t = (key: string, opts?: Record<string, unknown>) => {
      const table: Record<string, string> = {
        'dashboard.activity.detail_match': `Match #${opts?.id}`,
        'dashboard.activity.detail_final_hours': `settled at ${opts?.hours} hours`,
        'dashboard.activity.detail_adjustment': `balance changed by ${opts?.amount} hours`,
        'dashboard.activity.detail_exchange': `Exchange #${opts?.id}`,
      };
      return table[key] ?? String(opts?.defaultValue ?? key);
    };

    it('reads the new audit fields: match approvals, settlements and balance adjustments', () => {
      expect(formatActivityDetails('{"approval_id":7}', t)).toBe('Match #7');
      expect(formatActivityDetails('{"exchange_id":5,"final_hours":"2.50","notes":"Agreed"}', t)).toBe('Exchange #5 · settled at 2.50 hours · Agreed');
      expect(formatActivityDetails('{"reason":"Correction","adjustment":-1.5}', t)).toBe('balance changed by -1.5 hours · Correction');
    });
  });
});
