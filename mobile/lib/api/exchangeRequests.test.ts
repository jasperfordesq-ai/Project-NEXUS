// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The exchange workflow client, and the rules for who may do what.
 *
 * 🔴 Two things here are worth more than the usual coverage.
 *
 * **Provider-only actions.** The server answers 403 when a requester tries to accept their
 * own request. A button that appears and then fails is a defect of its own, so
 * `exchangeRequestActions` decides visibility from the same rules — and if it drifts, this
 * test is what says so.
 *
 * **The cancel reason travels in the QUERY STRING.** `api.delete()` takes request options
 * as its second argument and sends no body, so a `{ reason }` object passed there is
 * dropped without a word: the cancellation still succeeds and the reason silently
 * disappears. The assertion below is on the URL for exactly that reason.
 */

// 🔴 The mock functions are created INSIDE the factory, not captured from an outer
// `const`. jest hoists `jest.mock` above the imports, and the module under test is imported
// during that hoisted phase — before an outer `const` has been initialised — so referencing
// one gives `api === undefined` and every call fails with "Cannot read properties of
// undefined". That is a trap in the test, not a defect in the client.
jest.mock('./client', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
  ApiResponseError: class ApiResponseError extends Error {},
}));

import { api } from './client';

const mockApi = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  patch: jest.Mock;
  delete: jest.Mock;
};

import {
  acceptExchangeRequest,
  cancelExchangeRequest,
  confirmExchangeRequest,
  exchangeRequestActions,
  listExchangeRequests,
  type ExchangeRequest,
} from './exchangeRequests';

const PROVIDER = 674;
const REQUESTER = 675;

function exchange(overrides: Partial<ExchangeRequest> = {}): ExchangeRequest {
  return {
    id: 61,
    listing_id: 513,
    requester_id: REQUESTER,
    provider_id: PROVIDER,
    listing: { id: 513, title: 'Gardening help', type: 'offer' },
    requester: { id: REQUESTER, name: 'E2E UserB', avatar: null },
    provider: { id: PROVIDER, name: 'E2E UserA', avatar: null },
    proposed_hours: 1,
    prep_time: null,
    final_hours: null,
    status: 'pending_provider',
    risk_level: null,
    message: null,
    requester_confirmed_at: null,
    requester_confirmed_hours: null,
    provider_confirmed_at: null,
    provider_confirmed_hours: null,
    broker_notes: null,
    created_at: '2026-08-21 20:21:12',
    ...overrides,
  };
}

describe('exchange request client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApi.get.mockResolvedValue({ data: [] });
    mockApi.post.mockResolvedValue({ data: exchange() });
    mockApi.delete.mockResolvedValue({ data: {} });
  });

  it('lists exchanges from the workflow endpoint, not the listings endpoint', async () => {
    await listExchangeRequests({ perPage: 50 });

    // 🔴 `/v2/exchanges` and `/v2/listings` are different records. lib/api/exchanges.ts
    // posts listings to `/v2/listings` under the name "exchange"; this file must not.
    expect(mockApi.get).toHaveBeenCalledWith('/api/v2/exchanges', { per_page: '50' });
  });

  it('accepts by id', async () => {
    await acceptExchangeRequest(61);
    expect(mockApi.post).toHaveBeenCalledWith('/api/v2/exchanges/61/accept', {});
  });

  it('sends the hours as a body on confirm', async () => {
    await confirmExchangeRequest(61, 1.5);
    expect(mockApi.post).toHaveBeenCalledWith('/api/v2/exchanges/61/confirm', { hours: 1.5 });
  });

  it('puts the cancellation reason in the query string, where DELETE can carry it', async () => {
    await cancelExchangeRequest(61, 'no longer needed');

    const [url] = mockApi.delete.mock.calls[0] as [string];
    expect(url).toBe('/api/v2/exchanges/61?reason=no%20longer%20needed');
  });

  it('omits the query entirely when no reason is given', async () => {
    await cancelExchangeRequest(61);
    expect(mockApi.delete).toHaveBeenCalledWith('/api/v2/exchanges/61');
  });
});

describe('who may act on an exchange', () => {
  it('offers accept and decline to the provider only', () => {
    const pending = exchange({ status: 'pending_provider' });

    const asProvider = exchangeRequestActions(pending, PROVIDER);
    expect(asProvider.canAccept).toBe(true);
    expect(asProvider.canDecline).toBe(true);

    // The server answers 403 here. Showing the button would produce a dead tap.
    const asRequester = exchangeRequestActions(pending, REQUESTER);
    expect(asRequester.canAccept).toBe(false);
    expect(asRequester.canDecline).toBe(false);
    // Either side may still walk away.
    expect(asRequester.canCancel).toBe(true);
  });

  it('offers nothing at all to somebody who is neither party', () => {
    const actions = exchangeRequestActions(exchange(), 999);
    expect(Object.values(actions).some(Boolean)).toBe(false);
  });

  it('offers nothing when nobody is signed in', () => {
    const actions = exchangeRequestActions(exchange(), null);
    expect(Object.values(actions).some(Boolean)).toBe(false);
  });

  it('walks the state machine: accepted → start, in_progress → complete or confirm', () => {
    const accepted = exchangeRequestActions(exchange({ status: 'accepted' }), PROVIDER);
    expect(accepted.canStart).toBe(true);
    expect(accepted.canComplete).toBe(false);

    const inProgress = exchangeRequestActions(exchange({ status: 'in_progress' }), PROVIDER);
    expect(inProgress.canComplete).toBe(true);
    // The server accepts `confirm` straight from in_progress, so it is offered here too.
    expect(inProgress.canConfirm).toBe(true);
  });

  it('stops offering confirm to a member who has already confirmed, and says why', () => {
    const half = exchange({
      status: 'pending_confirmation',
      provider_confirmed_at: '2026-08-21 20:30:00',
      provider_confirmed_hours: 1,
    });

    const provider = exchangeRequestActions(half, PROVIDER);
    expect(provider.canConfirm).toBe(false);
    expect(provider.awaitingOtherConfirmation).toBe(true);

    // The other side still has to confirm — that second confirmation moves the credits.
    const requester = exchangeRequestActions(half, REQUESTER);
    expect(requester.canConfirm).toBe(true);
    expect(requester.awaitingOtherConfirmation).toBe(false);
  });

  it('offers nothing on a finished or abandoned exchange', () => {
    for (const status of ['completed', 'cancelled', 'expired'] as const) {
      const actions = exchangeRequestActions(exchange({ status }), PROVIDER);
      expect(Object.values(actions).some(Boolean)).toBe(false);
    }
  });

  it('hands a disputed exchange to a coordinator rather than re-confirming', () => {
    const actions = exchangeRequestActions(exchange({ status: 'disputed' }), PROVIDER);
    expect(actions.canConfirm).toBe(false);
    expect(actions.canCancel).toBe(true);
  });
});
