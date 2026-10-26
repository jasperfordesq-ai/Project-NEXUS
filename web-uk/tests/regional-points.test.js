// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Regional points, the third currency (React `wallet/regional-points`).
 *
 * Pinned: balance and activity from Laravel; the "not enabled here" message when
 * Laravel refuses; the recipient is chosen from a search and confirmed by the
 * name Laravel returns for that id (F-225); the confirmation nonce is spent on
 * first use so a double submit cannot send twice; Laravel's refusal is shown.
 */

const request = require('supertest');
const { routeGatesForPath } = require('../src/middleware/tenant-feature-gates');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class extends Error {},
    getRegionalPointsSummary: jest.fn(),
    getRegionalPointsHistory: jest.fn(),
    transferRegionalPoints: jest.fn(),
    searchUsers: jest.fn(),
    getUser: jest.fn()
  };
});

const api = require('../src/lib/api');
const routes = require('../src/routes/regional-points');
const { PREFIX, createApp, t } = require('./react-parity-harness');

const BASE = `${PREFIX}/wallet/regional-points`;
const summary = {
  enabled: true,
  config: { label: 'Talente', symbol: 'TP', member_transfers_enabled: true },
  account: { user_id: 1, balance: 42.5, lifetime_earned: 50, lifetime_spent: 7.5 }
};

function mockSummary(data = summary) {
  api.getRegionalPointsSummary.mockResolvedValue({ data });
  api.getRegionalPointsHistory.mockResolvedValue({
    data: { items: [{ id: 3, type: 'transfer_out', direction: 'out', points: 5, balance_after: 42.5, description: 'Thanks', created_at: '2026-10-20T10:00:00Z' }] }
  });
}

describe('regional points', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is gated on caring_community, like React', () => {
    expect(routeGatesForPath('/wallet/regional-points').map((gate) => gate.featureKey)).toContain('caring_community');
  });

  it('shows the balance and recent activity', async () => {
    mockSummary();
    const res = await request(createApp('/wallet/regional-points', [routes])).get(BASE);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Talente');
    expect(res.text).toContain('42.5 TP');
    expect(res.text).toContain(t('govuk_alpha_wallet.regional_points.history.types.transfer_out'));
    expect(res.text).toContain('-5');
  });

  it('says the programme is not enabled when Laravel refuses', async () => {
    api.getRegionalPointsSummary.mockRejectedValue(new api.ApiError('off', 403));
    const res = await request(createApp('/wallet/regional-points', [routes])).get(BASE);

    expect(res.text).toContain(t('govuk_alpha_wallet.regional_points.unavailable.title'));
    expect(api.getRegionalPointsHistory).not.toHaveBeenCalled();
  });

  it('finds recipients by name, never listing the member themselves', async () => {
    mockSummary();
    api.searchUsers.mockResolvedValue({ data: [{ id: 1, name: 'Me Myself' }, { id: 5, name: 'Robin Neighbour' }] });

    const res = await request(createApp('/wallet/regional-points', [routes])).get(`${BASE}?q=rob`);

    expect(api.searchUsers).toHaveBeenCalledWith('test-token', 'rob', { limit: 8 });
    expect(res.text).toContain('recipient=5&amp;recipient_name=Robin%20Neighbour');
    expect(res.text).not.toContain('recipient=1&amp;');
  });

  it('confirms the recipient by the name Laravel returns, then sends once', async () => {
    mockSummary();
    api.getUser.mockResolvedValue({ data: { id: 5, name: 'Robin Neighbour' } });
    api.transferRegionalPoints.mockResolvedValue({ data: { ok: true } });
    const agent = request.agent(createApp('/wallet/regional-points', [routes]));

    const review = await agent.post(`${BASE}/review`).type('form')
      .send({ recipient_user_id: '5', points: '3', message: 'For the soup' });
    expect(review.status).toBe(200);
    expect(api.getUser).toHaveBeenCalledWith('test-token', 5);
    expect(review.text).toContain('Robin Neighbour');
    expect(api.transferRegionalPoints).not.toHaveBeenCalled();
    const nonce = /name="nonce" value="([^"]+)"/.exec(review.text)[1];

    const first = await agent.post(`${BASE}/transfer`).type('form')
      .send({ nonce, recipient_user_id: '5', points: '3', message: 'For the soup' });
    expect(first.headers.location).toBe(`${BASE}?status=sent`);
    expect(api.transferRegionalPoints).toHaveBeenCalledWith('test-token', { recipient_user_id: 5, points: 3, message: 'For the soup' });

    const second = await agent.post(`${BASE}/transfer`).type('form')
      .send({ nonce, recipient_user_id: '5', points: '3' });
    expect(second.headers.location).toBe(BASE);
    expect(api.transferRegionalPoints).toHaveBeenCalledTimes(1);
  });

  it('shows the searched full name only when it agrees with the profile name', async () => {
    mockSummary();
    api.getUser.mockResolvedValue({ data: { id: 5, name: 'Robin' } });
    const appInstance = createApp('/wallet/regional-points', [routes]);

    const agreed = await request(appInstance).post(`${BASE}/review`).type('form')
      .send({ recipient_user_id: '5', recipient_name: 'Robin Neighbour', points: '1' });
    expect(agreed.text).toContain('id="rp-confirm-recipient">Robin Neighbour<');

    const forged = await request(appInstance).post(`${BASE}/review`).type('form')
      .send({ recipient_user_id: '5', recipient_name: 'Someone Else', points: '1' });
    expect(forged.text).toContain('id="rp-confirm-recipient">Robin<');
  });

  it('refuses a bad amount or a missing recipient before the API', async () => {
    const appInstance = createApp('/wallet/regional-points', [routes]);
    const noRecipient = await request(appInstance).post(`${BASE}/review`).type('form').send({ points: '3' });
    expect(noRecipient.headers.location).toBe(`${BASE}?status=choose-recipient`);
    const badAmount = await request(appInstance).post(`${BASE}/review`).type('form').send({ recipient_user_id: '5', points: '-2' });
    expect(badAmount.headers.location).toBe(`${BASE}?status=invalid-amount`);
    expect(api.getUser).not.toHaveBeenCalled();
  });

  it('shows Laravel’s refusal when the transfer is declined', async () => {
    mockSummary();
    api.getUser.mockResolvedValue({ data: { id: 5, name: 'Robin Neighbour' } });
    api.transferRegionalPoints.mockRejectedValue(new api.ApiError('Insufficient regional points balance', 422));
    const agent = request.agent(createApp('/wallet/regional-points', [routes]));

    const review = await agent.post(`${BASE}/review`).type('form').send({ recipient_user_id: '5', points: '999' });
    const nonce = /name="nonce" value="([^"]+)"/.exec(review.text)[1];
    const sent = await agent.post(`${BASE}/transfer`).type('form').send({ nonce, recipient_user_id: '5', points: '999' });
    expect(sent.headers.location).toBe(`${BASE}?status=failed`);

    const page = await agent.get(sent.headers.location);
    expect(page.text).toContain('Insufficient regional points balance');
  });
});
