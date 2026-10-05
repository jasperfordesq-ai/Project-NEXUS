// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { HandoverList } from './HandoverList';
import type { Handover, HandoverListData } from '@/lib/fundraisingTypes';

const handover = (overrides: Partial<Handover>): Handover => ({
  id: 1,
  giving_day_id: 3,
  organization_id: 9,
  amount: 40,
  currency: 'EUR',
  handed_over_on: '2026-10-01',
  method: 'bank_transfer',
  reference: 'TRF-1',
  note: null,
  status: 'recorded',
  recorded_by_name: 'Ada Admin',
  created_at: '2026-10-01 10:00:00',
  confirmed_by_name: null,
  confirmed_at: null,
  cancelled_by_name: null,
  cancelled_at: null,
  cancel_reason: null,
  ...overrides,
});

const data = (items: Handover[]): HandoverListData => ({
  items,
  summary: { raised: 100, handed_over: 40, still_held: 60, currency: 'EUR' },
});

describe('HandoverList', () => {
  it('shows raised, passed on and still held', () => {
    render(<HandoverList data={data([])} />);
    expect(screen.getByText('Raised')).toBeInTheDocument();
    expect(screen.getByText('€100.00')).toBeInTheDocument();
    expect(screen.getByText('Passed on')).toBeInTheDocument();
    expect(screen.getByText('€40.00')).toBeInTheDocument();
    expect(screen.getByText('Still held')).toBeInTheDocument();
    expect(screen.getByText('€60.00')).toBeInTheDocument();
    expect(screen.getByText('No money has been passed on yet.')).toBeInTheDocument();
  });

  it('shows each hand-over with its status, method and reference', () => {
    render(<HandoverList data={data([
      handover({ id: 1 }),
      handover({ id: 2, status: 'confirmed', confirmed_by_name: 'Olu Owner', method: 'cheque', reference: 'CHQ-9' }),
      handover({ id: 3, status: 'cancelled', cancelled_by_name: 'Ada Admin', cancel_reason: 'Typed twice' }),
    ])} />);

    expect(screen.getByText('Waiting for confirmation')).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText(/Cheque/)).toBeInTheDocument();
    expect(screen.getByText(/CHQ-9/)).toBeInTheDocument();
    expect(screen.getByText('Confirmed by Olu Owner')).toBeInTheDocument();
    expect(screen.getByText('Reason: Typed twice')).toBeInTheDocument();
  });

  it('offers Cancel only on open hand-overs, and only when allowed', () => {
    const onCancel = vi.fn();
    const items = [handover({ id: 1 }), handover({ id: 2, status: 'confirmed' })];
    const { unmount } = render(<HandoverList data={data(items)} />);
    expect(screen.queryByRole('button', { name: 'Cancel hand-over' })).not.toBeInTheDocument();
    unmount();

    render(<HandoverList data={data(items)} onCancel={onCancel} />);
    const [cancel, ...others] = screen.getAllByRole('button', { name: 'Cancel hand-over' });
    expect(others).toHaveLength(0);
    fireEvent.click(cancel as HTMLElement);
    expect(onCancel).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('offers Confirm received only on open hand-overs', () => {
    const onConfirm = vi.fn();
    render(<HandoverList data={data([handover({ id: 1 }), handover({ id: 2, status: 'cancelled' })])} onConfirm={onConfirm} />);

    const [confirm, ...others] = screen.getAllByRole('button', { name: 'Confirm received' });
    expect(others).toHaveLength(0);
    fireEvent.click(confirm as HTMLElement);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
});
