// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { FundraisingHistoryList } from './FundraisingHistoryList';
import type { HistoryItem } from '@/lib/fundraisingTypes';

const item = (overrides: Partial<HistoryItem>): HistoryItem => ({
  id: 1,
  event: 'campaign_created',
  actor_kind: 'community_admin',
  actor_name: null,
  amount: null,
  currency: null,
  donation_id: null,
  handover_id: null,
  details: null,
  stripe_object_id: null,
  created_at: '2026-10-05 12:00:00',
  ...overrides,
});

describe('FundraisingHistoryList', () => {
  it('shows an empty state', () => {
    render(<FundraisingHistoryList items={[]} />);
    expect(screen.getByText('Nothing has been recorded for this campaign yet.')).toBeInTheDocument();
  });

  it('labels each event and says who did it', () => {
    render(<FundraisingHistoryList items={[
      item({ id: 2, event: 'campaign_paused', actor_name: 'Ada Admin' }),
      item({ id: 1, event: 'donation_paid', actor_kind: 'stripe', amount: 25, currency: 'EUR', donation_id: 44 }),
    ]} />);

    expect(screen.getByText('Campaign paused')).toBeInTheDocument();
    expect(screen.getByText(/by Ada Admin/)).toBeInTheDocument();
    expect(screen.getByText('Gift paid')).toBeInTheDocument();
    expect(screen.getByText(/Gift #44/)).toBeInTheDocument();
    expect(screen.getByText(/€25\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Stripe$/)).toBeInTheDocument();
  });

  it('shows what changed in an edit, before and after', () => {
    render(<FundraisingHistoryList items={[
      item({ event: 'campaign_updated', details: { changes: { goal_amount: { from: '500.00', to: '800.00' } } } }),
    ]} />);

    expect(screen.getByText('Goal changed from 500.00 to 800.00')).toBeInTheDocument();
  });

  it('shows a cancellation reason', () => {
    render(<FundraisingHistoryList items={[item({ event: 'handover_cancelled', details: { reason: 'Typed twice' } })]} />);
    expect(screen.getByText('Reason: Typed twice')).toBeInTheDocument();
  });

  it('shows Stripe references only when asked to', () => {
    const items = [item({ event: 'donation_paid', stripe_object_id: 'pi_123' })];
    const { unmount } = render(<FundraisingHistoryList items={items} />);
    expect(screen.queryByText('Stripe reference pi_123')).not.toBeInTheDocument();
    unmount();

    render(<FundraisingHistoryList items={items} showStripe />);
    expect(screen.getByText('Stripe reference pi_123')).toBeInTheDocument();
  });
});
