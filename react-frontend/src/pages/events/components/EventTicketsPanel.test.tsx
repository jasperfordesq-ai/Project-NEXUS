// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventTicketsApi, type EventTicketCatalogue } from '@/lib/event-tickets-api';
import { renderEventComponent } from '@/test/events-test-harness';
import { EventTicketsPanel } from './EventTicketsPanel';

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => mockToast }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

function catalogue(overrides: Partial<EventTicketCatalogue> = {}): EventTicketCatalogue {
  return {
    contract_version: 1,
    event_id: 1,
    currency: 'time_credit',
    payment_gateway: { free_supported: true, time_credit_supported: false, money_supported: false },
    permissions: { manage: false, reconcile: false, allocate_self: true },
    ticket_types: [{
      id: 9,
      version: 2,
      name: 'Community ticket',
      description: 'One place at the event.',
      kind: 'free',
      unit_price_credits: '0.00',
      allocation_limit: 20,
      sales_opens_at: '2029-12-01T00:00:00+00:00',
      sales_closes_at: '2030-01-01T09:00:00+00:00',
      per_member_limit: 1,
      refund_cutoff_at: null,
      organizer_cancel_refundable: false,
      status: 'active',
      availability: {
        eligibility: { eligible: true, reasons: [] },
        allocation_remaining: 12,
        member_remaining: 1,
        sales_window_open: true,
        materialization_supported: true,
        gateway_status: 'not_required',
        attendance_reward_included: false,
        refund_policy: { cutoff_at: null, organizer_cancel_refundable: false, execution_status: 'not_applicable' },
      },
      eligibility_policy: null,
    }],
    own_entitlements: [],
    ...overrides,
  };
}

describe('EventTicketsPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reserves an eligible free ticket with one idempotent allocation request', async () => {
    vi.spyOn(eventTicketsApi, 'get').mockResolvedValue({ success: true, data: catalogue() });
    const allocate = vi.spyOn(eventTicketsApi, 'allocateSelf').mockResolvedValue({
      success: true,
      data: {
        entitlement: {
          id: 20,
          ticket_type_id: 9,
          units: 1,
          kind: 'free',
          unit_price_credits: '0.00',
          total_price_credits: '0.00',
          status: 'confirmed',
          version: 1,
          confirmed_at: '2030-01-01T08:00:00+00:00',
          cancelled_at: null,
        },
        confirmed_units_after: 1,
        changed: true,
        idempotent_replay: false,
      },
    });
    const user = userEvent.setup();

    renderEventComponent(
      <EventTicketsPanel eventId={1} eventStart="2030-01-02T10:00:00+00:00" eventTimezone="UTC" />,
    );
    await user.click(await screen.findByRole('button', { name: 'Reserve ticket' }));

    await waitFor(() => expect(allocate).toHaveBeenCalledTimes(1));
    expect(allocate.mock.calls[0]?.slice(0, 3)).toEqual([1, 9, 1]);
    expect(String(allocate.mock.calls[0]?.[3])).toMatch(/^ticket-allocate-/);
    expect(mockToast.success).toHaveBeenCalledWith('Ticket reserved.');
  });

  it('shows the server explanation when a reservation is refused for a stated reason', async () => {
    vi.spyOn(eventTicketsApi, 'get').mockResolvedValue({ success: true, data: catalogue() });
    vi.spyOn(eventTicketsApi, 'allocateSelf').mockResolvedValue({
      success: false,
      code: 'EVENT_TICKET_VALIDATION_FAILED',
      error: 'You need a confirmed place at this event before you can take a ticket.',
      errors: [{
        code: 'EVENT_TICKET_VALIDATION_FAILED',
        message: 'You need a confirmed place at this event before you can take a ticket.',
        reason: 'event_ticket_confirmed_registration_required',
      }],
    });
    const user = userEvent.setup();

    renderEventComponent(
      <EventTicketsPanel eventId={1} eventStart="2030-01-02T10:00:00+00:00" eventTimezone="UTC" />,
    );
    await user.click(await screen.findByRole('button', { name: 'Reserve ticket' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledWith(
      'You need a confirmed place at this event before you can take a ticket.',
    ));
  });

  it('keeps its own message when the refusal carries no stated reason', async () => {
    vi.spyOn(eventTicketsApi, 'get').mockResolvedValue({ success: true, data: catalogue() });
    vi.spyOn(eventTicketsApi, 'allocateSelf').mockResolvedValue({
      success: false,
      code: 'EVENT_TICKET_VALIDATION_FAILED',
      error: 'Validation failed',
      errors: [{ code: 'EVENT_TICKET_VALIDATION_FAILED', message: 'Validation failed' }],
    });
    const user = userEvent.setup();

    renderEventComponent(
      <EventTicketsPanel eventId={1} eventStart="2030-01-02T10:00:00+00:00" eventTimezone="UTC" />,
    );
    await user.click(await screen.findByRole('button', { name: 'Reserve ticket' }));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalledTimes(1));
    expect(mockToast.error).not.toHaveBeenCalledWith('Validation failed');
  });

  it('keeps time-credit materialisation visibly unavailable', async () => {
    const value = catalogue();
    value.ticket_types[0] = {
      ...value.ticket_types[0],
      kind: 'time_credit',
      unit_price_credits: '2.00',
      availability: {
        ...value.ticket_types[0].availability,
        materialization_supported: false,
        gateway_status: 'unavailable',
      },
    };
    vi.spyOn(eventTicketsApi, 'get').mockResolvedValue({ success: true, data: value });

    renderEventComponent(
      <EventTicketsPanel eventId={1} eventStart="2030-01-02T10:00:00+00:00" eventTimezone="UTC" />,
    );

    expect(await screen.findByText('This ticket type cannot currently be reserved.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reserve ticket' })).toBeDisabled();
  });

  it('never offers a refund-like cancellation for a time-credit entitlement', async () => {
    const value = catalogue({
      own_entitlements: [{
        id: 20,
        ticket_type_id: 9,
        units: 1,
        kind: 'time_credit',
        unit_price_credits: '2.00',
        total_price_credits: '2.00',
        status: 'confirmed',
        version: 1,
        confirmed_at: '2030-01-01T08:00:00+00:00',
        cancelled_at: null,
      }],
    });
    vi.spyOn(eventTicketsApi, 'get').mockResolvedValue({ success: true, data: value });

    renderEventComponent(
      <EventTicketsPanel eventId={1} eventStart="2030-01-02T10:00:00+00:00" eventTimezone="UTC" />,
    );

    expect(await screen.findByText(
      'Time-credit ticket cancellation is unavailable in this free-only flow. No wallet action has been taken.',
    )).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel ticket' })).not.toBeInTheDocument();
  });

  it('runs a read-only reconciliation for finance-authorised organisers', async () => {
    vi.spyOn(eventTicketsApi, 'get').mockResolvedValue({
      success: true,
      data: catalogue({ permissions: { manage: true, reconcile: true, allocate_self: false } }),
    });
    const reconcile = vi.spyOn(eventTicketsApi, 'reconcile').mockResolvedValue({
      success: true,
      data: {
        event_id: 1,
        read_only: true,
        ticket_types: [{
          ticket_type_id: 9,
          kind: 'free',
          status: 'active',
          allocation_limit: 20,
          confirmed_units: 10,
          cancelled_units: 0,
          confirmed_entitlements: 10,
          cancelled_entitlements: 0,
          registration_mismatches: 1,
          price_snapshot_violations: 0,
          inventory_delta: 10,
          latest_inventory_after: 10,
          allocation_overrun: false,
          inventory_mismatch: false,
        }],
      },
    });
    const user = userEvent.setup();

    renderEventComponent(
      <EventTicketsPanel eventId={1} eventStart="2030-01-02T10:00:00+00:00" eventTimezone="UTC" />,
    );
    await user.click(await screen.findByRole('button', { name: 'Run reconciliation' }));

    await waitFor(() => expect(reconcile).toHaveBeenCalledWith(1));
    expect(mockToast.success).toHaveBeenCalledWith('Ticket reconciliation completed.');
  });
});
