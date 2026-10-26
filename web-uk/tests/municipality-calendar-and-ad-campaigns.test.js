// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Two small React-parity pages (26 Oct 2026):
 *
 * - the municipality events calendar (React `municipality-calendar`), one month
 *   as a list of days, gated on `caring_community`;
 * - a member's own ad campaigns (React `advertise/campaigns`), gated on
 *   `local_advertising`. A campaign is submitted for review; there is no
 *   payment step. Laravel reads `placement`, not React's `type`.
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
    getMunicipalityCalendar: jest.fn(),
    getMyAdCampaigns: jest.fn(),
    createMyAdCampaign: jest.fn()
  };
});

const api = require('../src/lib/api');
const calendarRoutes = require('../src/routes/municipality-calendar');
const adRoutes = require('../src/routes/advertise-campaigns');
const { PREFIX, createApp, t } = require('./react-parity-harness');

describe('municipality events calendar', () => {
  beforeEach(() => jest.clearAllMocks());
  const app = () => createApp('/municipality-calendar', [calendarRoutes]);

  it('is gated on caring_community, like React', () => {
    expect(routeGatesForPath('/municipality-calendar').map((gate) => gate.featureKey)).toContain('caring_community');
  });

  it('asks for a municipality code before loading anything', async () => {
    const res = await request(app()).get(`${PREFIX}/municipality-calendar`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_events.municipality_calendar.no_municipality'));
    expect(api.getMunicipalityCalendar).not.toHaveBeenCalled();
  });

  it('lists the month’s events by day, with month navigation', async () => {
    api.getMunicipalityCalendar.mockResolvedValue({
      data: {
        municipality_code: '8001',
        buckets: { '2026-11-14': [{ id: 31, title: 'Choir evening', start_time: '2026-11-14T18:00:00Z', organization_name: 'Singers Club' }] }
      }
    });

    const res = await request(app()).get(`${PREFIX}/municipality-calendar?code=8001&month=2026-11`);

    expect(api.getMunicipalityCalendar).toHaveBeenCalledWith('8001', '2026-11-01', '2026-12-01');
    expect(res.text).toContain('id="mc-month">November 2026<');
    expect(res.text).toContain(`href="${PREFIX}/events/31"`);
    expect(res.text).toContain('Choir evening');
    expect(res.text).toContain('Singers Club');
    expect(res.text).toContain('code=8001&amp;month=2026-10');
    expect(res.text).toContain('code=8001&amp;month=2026-12');
  });

  it('refuses a malformed code without calling the API', async () => {
    const res = await request(app()).get(`${PREFIX}/municipality-calendar?code=${encodeURIComponent('../x')}`);
    expect(api.getMunicipalityCalendar).not.toHaveBeenCalled();
    expect(res.text).toContain('govuk-input--error');
  });
});

describe('my ad campaigns', () => {
  beforeEach(() => jest.clearAllMocks());
  const app = () => createApp('/advertise/campaigns', [adRoutes]);

  it('is gated on local_advertising, like React', () => {
    expect(routeGatesForPath('/advertise/campaigns').map((gate) => gate.featureKey)).toContain('local_advertising');
  });

  it('lists the member’s own campaigns with status, budget and reach', async () => {
    api.getMyAdCampaigns.mockResolvedValue({
      data: [{ id: 4, name: 'Spring market', status: 'pending_review', placement: 'feed', budget_cents: 5000, start_date: '2026-11-01', end_date: '2026-11-30', impression_count: 200, click_count: 10 }]
    });

    const res = await request(app()).get(`${PREFIX}/advertise/campaigns`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('Spring market');
    expect(res.text).toContain(t('govuk_alpha_settings.advertise.status_pending'));
    expect(res.text).toContain('€50.00');
    expect(res.text).toContain('5%');
  });

  it('says advertising is unavailable when Laravel refuses', async () => {
    api.getMyAdCampaigns.mockRejectedValue(new api.ApiError('off', 403));
    const res = await request(app()).get(`${PREFIX}/advertise/campaigns`);
    expect(res.text).toContain(t('govuk_alpha_settings.advertise.feature_disabled'));
  });

  it('submits a campaign for review with the fields Laravel reads', async () => {
    api.createMyAdCampaign.mockResolvedValue({ data: { id: 9 } });

    const res = await request(app()).post(`${PREFIX}/advertise/campaigns/new`).type('form').send({
      name: 'Autumn fair',
      placement: 'discovery',
      'start_date-day': '1', 'start_date-month': '12', 'start_date-year': '2026',
      'end_date-day': '20', 'end_date-month': '12', 'end_date-year': '2026',
      budget: '75.50'
    });

    expect(api.createMyAdCampaign).toHaveBeenCalledWith('test-token', {
      name: 'Autumn fair',
      placement: 'discovery',
      start_date: '2026-12-01',
      end_date: '2026-12-20',
      budget_cents: 7550
    });
    expect(res.headers.location).toBe(`${PREFIX}/advertise/campaigns?status=created`);
  });

  it('shows field errors and keeps what was typed when the form is incomplete', async () => {
    const res = await request(app()).post(`${PREFIX}/advertise/campaigns/new`).type('form').send({
      name: '', placement: 'feed', budget: '0',
      'start_date-day': '5', 'start_date-month': '1', 'start_date-year': '2027',
      'end_date-day': '1', 'end_date-month': '1', 'end_date-year': '2027'
    });

    expect(res.status).toBe(422);
    expect(api.createMyAdCampaign).not.toHaveBeenCalled();
    expect(res.text).toContain('href="#ad-name"');
    expect(res.text).toContain(t('govuk_alpha_settings.advertise.validation_budget'));
    expect(res.text).toContain(t('govuk_alpha_settings.advertise.end_before_start'));
  });
});
