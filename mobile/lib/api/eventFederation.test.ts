// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { api, ApiResponseError } from './client';
import { getEventFederationStatus } from './eventFederation';
jest.mock('./client', () => {
  const actual = jest.requireActual('./client');
  return { ...actual, api: { get: jest.fn() } };
});
const summary = {
  contract_version: 1, event_id: 7, federation_version: 1, visibility: 'none',
  configured_partners: 0, recipient_partners: 0, health: 'not_configured',
  counts: { pending: 0, retry: 0, processing: 0, delivered: 0, dead_letter: 0 },
  partners: [], generated_at: null,
};
beforeEach(() => jest.clearAllMocks());
it('reads the canonical endpoint and removes unused response fields', async () => {
  jest.mocked(api.get).mockResolvedValue({ data: { ...summary, payload: 'must not reach the screen' }, meta: { base_url: '/api/v2' } });
  const response = await getEventFederationStatus(7);
  expect(api.get).toHaveBeenCalledWith('/api/v2/events/7/federation-status');
  expect(response).toEqual({ data: summary });
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid request identity %s before reading', async id => {
  await expect(getEventFederationStatus(id)).rejects.toBeInstanceOf(ApiResponseError);
  expect(api.get).not.toHaveBeenCalled();
});
it.each([
  { event_id: 8 }, { contract_version: 2 }, { counts: { ...summary.counts, pending: -1 } },
  { health: 'unexpected' }, { partners: [{}] },
])('rejects misleading identity or malformed diagnostics %j', async change => {
  jest.mocked(api.get).mockResolvedValue({ data: { ...summary, ...change } });
  await expect(getEventFederationStatus(7)).rejects.toMatchObject({ status: 422, code: 'EVENT_FEDERATION_CONTRACT_DRIFT' });
});
it('preserves authorization failures', async () => {
  const error = new ApiResponseError(403, 'Forbidden');
  jest.mocked(api.get).mockRejectedValue(error);
  await expect(getEventFederationStatus(7)).rejects.toBe(error);
});
