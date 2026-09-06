// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn() },
  ApiResponseError: class ApiResponseError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, _errors?: unknown, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));
jest.mock('@/lib/constants', () => ({ API_V2: '/api/v2' }));
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));

import * as Sentry from '@sentry/react-native';
import { api } from '@/lib/api/client';
import {
  allocateFreeEventTicket,
  cancelEventTicket,
  getEventTickets,
} from './eventTickets';

const availability = {
  eligibility: { eligible: true, reasons: [] },
  allocation_remaining: 9,
  member_remaining: 2,
  sales_window_open: true,
  materialization_supported: true,
  gateway_status: 'free',
  attendance_reward_included: false,
  refund_policy: {
    cutoff_at: null,
    organizer_cancel_refundable: false,
    execution_status: 'not_applicable',
  },
};

const ticket = {
  id: 7,
  version: 1,
  name: 'Community ticket',
  description: 'Free admission',
  kind: 'free',
  unit_price_credits: '0.00',
  allocation_limit: 10,
  sales_opens_at: '2030-07-01T09:00:00Z',
  sales_closes_at: '2030-08-01T09:00:00Z',
  per_member_limit: 2,
  refund_cutoff_at: null,
  organizer_cancel_refundable: false,
  status: 'active',
  availability,
  eligibility_policy: null,
};

const entitlement = {
  id: 12,
  ticket_type_id: 7,
  units: 1,
  kind: 'free',
  unit_price_credits: '0.00',
  total_price_credits: '0.00',
  status: 'confirmed',
  version: 1,
  confirmed_at: '2030-07-02T09:00:00Z',
  cancelled_at: null,
};

function catalogue() {
  return {
    contract_version: 1,
    event_id: 4,
    currency: 'time_credit',
    payment_gateway: {
      free_supported: true,
      time_credit_supported: false,
      money_supported: false,
    },
    permissions: { manage: false, reconcile: false, allocate_self: true },
    ticket_types: [ticket],
    own_entitlements: [entitlement],
  };
}

describe('mobile event tickets API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads a strict catalogue with paid and time-credit gateways disabled', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: catalogue(), meta: { base_url: 'https://api.example.test' } });

    const result = await getEventTickets(4);

    expect(result.payment_gateway.time_credit_supported).toBe(false);
    expect(result.payment_gateway.money_supported).toBe(false);
    expect(result.ticket_types[0]?.availability.materialization_supported).toBe(true);
    expect(api.get).toHaveBeenCalledWith('/api/v2/events/4/tickets');
  });

  it('allocates only through the free endpoint with an idempotency header', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        entitlement,
        confirmed_units_after: 1,
        changed: true,
        idempotent_replay: false,
      },
      meta: { base_url: 'https://api.example.test' },
    });

    await allocateFreeEventTicket(4, 7, 1, 'mobile-ticket-allocate');

    expect(api.post).toHaveBeenCalledWith(
      '/api/v2/events/4/tickets/7/allocate',
      { units: 1 },
      { headers: { 'Idempotency-Key': 'mobile-ticket-allocate' } },
    );
  });

  it('cancels using optimistic versioning, a reason and an idempotency header', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        entitlement: { ...entitlement, status: 'cancelled', version: 2, cancelled_at: '2030-07-03T09:00:00Z' },
        confirmed_units_after: 0,
        changed: true,
        idempotent_replay: false,
      },
      meta: { base_url: 'https://api.example.test' },
    });

    await cancelEventTicket(4, 12, 1, 'Plans changed', 'mobile-ticket-cancel');

    expect(api.post).toHaveBeenCalledWith(
      '/api/v2/events/4/ticket-entitlements/12/cancel',
      { expected_version: 1, reason: 'Plans changed' },
      { headers: { 'Idempotency-Key': 'mobile-ticket-cancel' } },
    );
  });

  it('fails closed if a paid gateway appears without deliberate mobile support', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        ...catalogue(),
        payment_gateway: {
          free_supported: true,
          time_credit_supported: true,
          money_supported: false,
        },
      },
      meta: { base_url: 'https://api.example.test' },
    });

    await expect(getEventTickets(4)).rejects.toHaveProperty('code', 'EVENT_TICKETS_CONTRACT_DRIFT');
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Event tickets contract drift',
      expect.objectContaining({
        tags: { module: 'events', endpoint: '/api/v2/events/{id}/tickets' },
      }),
    );
  });
});
