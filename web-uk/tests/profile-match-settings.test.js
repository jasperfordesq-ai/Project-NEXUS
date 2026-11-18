// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The matching part of the accessible settings page against Laravel's
 * GET/PUT /api/v2/users/me/match-preferences (17 Nov 2026 audit).
 *
 *  - "Every week" was offered although Laravel silently stores it as monthly.
 *  - there was no way to pause matching, set how far away matches may be, or
 *    set the lowest match score: three settings the API has always had.
 *
 * The page is rendered for real (Nunjucks + govuk-frontend), with a session, so
 * the refused-save round trip is the one a member would see.
 */

const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {},
  callProfileApi: jest.fn(),
  callUserSettingsApi: jest.fn(),
  callWebAuthnApi: jest.fn(),
  getProfile: jest.fn(),
  invalidateUserCache: jest.fn(),
  requestAccountDeletion: jest.fn(),
  switchToCoordinatorIntroductions: jest.fn(),
  uploadProfileAvatar: jest.fn()
}));

jest.mock('../src/middleware/auth', () => ({
  clearAuthCookies: jest.fn(),
  requireAuth: (req, res, next) => next()
}));

const api = require('../src/lib/api');
const profileRouter = require('../src/routes/profile');
const { PREFIX, createApp, t } = require('./react-parity-harness');

const K = 'govuk_alpha_connections.match_settings.';
const storedPrefs = {
  notification_frequency: 'fortnightly',
  notify_hot_matches: true,
  notify_mutual_matches: false,
  matching_paused: false,
  max_distance_km: 25,
  max_distance_limit_km: 60,
  min_match_score: 40,
  categories: [],
  availability: []
};

function stubApi(prefs = storedPrefs) {
  api.getProfile.mockResolvedValue({ data: { id: 42, first_name: 'Ada', preferred_language: 'en' } });
  api.callProfileApi.mockResolvedValue({ data: {} });
  api.callWebAuthnApi.mockResolvedValue({ data: [] });
  api.callUserSettingsApi.mockImplementation(async (token, method, pathValue) => {
    if (method === 'GET' && pathValue === '/match-preferences') return { data: prefs };
    return { data: {} };
  });
}

const app = () => createApp('/profile', [profileRouter]);
const writes = () => api.callUserSettingsApi.mock.calls.filter(([, method]) => method !== 'GET');
const fullForm = (overrides = {}) => ({
  matching_paused: '0',
  max_distance_km: '25',
  min_match_score: '40',
  notification_frequency: 'daily',
  notify_hot_matches: '1',
  ...overrides
});

/** The matching section of the rendered page, so other forms cannot satisfy a check. */
function matchSection(html) {
  const start = html.indexOf('<section id="match-preferences"');
  const end = html.indexOf('</section>', start);
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, end);
}

beforeEach(() => {
  jest.clearAllMocks();
  stubApi();
});

describe('match digest frequency', () => {
  it('does not offer "Every week"', async () => {
    const res = await request(app()).get(`${PREFIX}/profile/settings`);
    const section = matchSection(res.text);

    expect(res.status).toBe(200);
    expect(section).not.toContain('value="weekly"');
    expect(section).not.toContain(t('profile_settings.match.frequency.weekly'));
    for (const value of ['daily', 'fortnightly', 'monthly', 'never']) {
      expect(section).toContain(`<option value="${value}"`);
    }
    expect(section).toContain(`<option value="fortnightly" selected>${t('profile_settings.match.frequency.fortnightly')}</option>`);
  });

  it('shows a stored legacy "weekly" as monthly, which is what Laravel sends for it', async () => {
    stubApi({ ...storedPrefs, notification_frequency: 'weekly' });
    const res = await request(app()).get(`${PREFIX}/profile/settings`);

    expect(matchSection(res.text)).toContain(`<option value="monthly" selected>${t('profile_settings.match.frequency.monthly')}</option>`);
  });

  it('never sends "weekly", even if a stale page posts it', async () => {
    await request(app()).post(`${PREFIX}/profile/match-preferences`).type('form').send(fullForm({ notification_frequency: 'weekly' }));

    expect(writes()).toHaveLength(1);
    expect(writes()[0][3].notification_frequency).toBe('monthly');
  });
});

describe('pause, distance and lowest score', () => {
  it('shows the three settings with the stored values and the community limit', async () => {
    const res = await request(app()).get(`${PREFIX}/profile/settings`);
    const section = matchSection(res.text);

    expect(section).toContain(t(`${K}heading`));
    expect(section).toContain(t(`${K}pause_label`));
    expect(section).toContain('id="matching_paused" name="matching_paused" type="checkbox" value="1" aria-describedby="matching_paused-hint">');
    expect(section).toContain(t(`${K}distance_hint`, { max: 60 }));
    expect(section).toContain('id="max_distance_km" name="max_distance_km" type="text" inputmode="numeric" spellcheck="false" value="25" aria-describedby="max_distance_km-hint"');
    expect(section).toContain('id="min_match_score" name="min_match_score" type="text" inputmode="numeric" spellcheck="false" value="40" aria-describedby="min_match_score-hint"');
    // GOV.UK: whole numbers go in text boxes. No sliders, no type="number".
    expect(section).not.toContain('type="range"');
    expect(section).not.toContain('type="number"');
    expect(section).not.toContain('govuk-form-group--error');
  });

  it('ticks "Pause matching" when the member has paused it', async () => {
    stubApi({ ...storedPrefs, matching_paused: true });
    const res = await request(app()).get(`${PREFIX}/profile/settings`);

    expect(matchSection(res.text)).toContain('aria-describedby="matching_paused-hint" checked>');
  });

  it('saves all of them in one request', async () => {
    const res = await request(app())
      .post(`${PREFIX}/profile/match-preferences`)
      .type('form')
      // The hidden 0 and the ticked box both arrive: the ticked box wins.
      .send('matching_paused=0&matching_paused=1&max_distance_km=12&min_match_score=65&notification_frequency=never&notify_mutual_matches=1');

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${PREFIX}/profile/settings?status=match-prefs-saved#match-preferences`);
    expect(writes()).toEqual([['test-token', 'PUT', '/match-preferences', {
      notification_frequency: 'never',
      notify_hot_matches: false,
      notify_mutual_matches: true,
      matching_paused: true,
      max_distance_km: 12,
      min_match_score: 65
    }]]);
  });

  it('un-pauses when the box is left unticked', async () => {
    await request(app()).post(`${PREFIX}/profile/match-preferences`).type('form').send(fullForm());

    expect(writes()[0][3].matching_paused).toBe(false);
  });

  it('leaves out a setting the form did not offer, so Laravel keeps the stored one', async () => {
    await request(app())
      .post(`${PREFIX}/profile/match-preferences`)
      .type('form')
      .send({ notification_frequency: 'daily', notify_hot_matches: 'on' });

    expect(writes()).toEqual([['test-token', 'PUT', '/match-preferences', {
      notification_frequency: 'daily',
      notify_hot_matches: true,
      notify_mutual_matches: false
    }]]);
  });

  it.each([
    ['a distance beyond the community limit', { max_distance_km: '61' }, ['max_distance_km']],
    ['a distance of zero', { max_distance_km: '0' }, ['max_distance_km']],
    ['a blank distance', { max_distance_km: '' }, ['max_distance_km']],
    ['a distance that is not a whole number', { max_distance_km: '12.5' }, ['max_distance_km']],
    ['a score above 100', { min_match_score: '101' }, ['min_match_score']],
    ['a score that is not a number', { min_match_score: 'high' }, ['min_match_score']],
    ['both wrong at once', { max_distance_km: 'far', min_match_score: '-1' }, ['max_distance_km', 'min_match_score']]
  ])('refuses %s, writes nothing and names each box in the error summary', async (label, overrides, fields) => {
    const agent = request.agent(app());
    const refused = await agent.post(`${PREFIX}/profile/match-preferences`).type('form').send(fullForm(overrides));

    expect(refused.status).toBe(302);
    expect(refused.headers.location).toBe(`${PREFIX}/profile/settings?status=match-prefs-invalid#match-preferences`);
    expect(writes()).toHaveLength(0);

    const page = await agent.get(`${PREFIX}/profile/settings?status=match-prefs-invalid`);
    const section = matchSection(page.text);
    const messages = {
      max_distance_km: t(`${K}distance_error`, { max: 60 }),
      min_match_score: t(`${K}min_score_error`)
    };

    expect(page.status).toBe(200);
    expect(page.text).toContain('govuk-error-summary');
    for (const field of ['max_distance_km', 'min_match_score']) {
      const wrong = fields.includes(field);
      const summaryLink = `<a href="#${field}">${messages[field]}</a>`;
      if (wrong) {
        expect(page.text).toContain(summaryLink);
        expect(section).toContain(`id="${field}-error" class="govuk-error-message"`);
        expect(section).toContain(`${field}-hint ${field}-error"`);
      } else {
        expect(page.text).not.toContain(summaryLink);
        expect(section).not.toContain(`id="${field}-error"`);
      }
    }
    // What the member typed is kept, in the box and in the other choices.
    const typed = fullForm(overrides);
    expect(section).toContain(`name="max_distance_km" type="text" inputmode="numeric" spellcheck="false" value="${typed.max_distance_km}"`);
    expect(section).toContain(`name="min_match_score" type="text" inputmode="numeric" spellcheck="false" value="${typed.min_match_score}"`);
    expect(section).toContain('<option value="daily" selected>');

    // Shown once: a later visit goes back to what is stored.
    const later = matchSection((await agent.get(`${PREFIX}/profile/settings`)).text);
    expect(later).toContain('name="max_distance_km" type="text" inputmode="numeric" spellcheck="false" value="25"');
    expect(later).not.toContain('govuk-form-group--error');
  });

  it('accepts the community limit itself and zero as the lowest score', async () => {
    const res = await request(app())
      .post(`${PREFIX}/profile/match-preferences`)
      .type('form')
      .send(fullForm({ max_distance_km: '60', min_match_score: '0' }));

    expect(res.headers.location).toBe(`${PREFIX}/profile/settings?status=match-prefs-saved#match-preferences`);
    expect(writes()[0][3]).toMatchObject({ max_distance_km: 60, min_match_score: 0 });
  });

  it('says the save failed, and keeps what was typed, when Laravel refuses it', async () => {
    api.callUserSettingsApi.mockImplementation(async (token, method, pathValue) => {
      if (method === 'PUT') throw new api.ApiError('Server error', 500, {});
      if (pathValue === '/match-preferences') return { data: storedPrefs };
      return { data: {} };
    });
    const agent = request.agent(app());
    const res = await agent.post(`${PREFIX}/profile/match-preferences`).type('form').send(fullForm({ max_distance_km: '33' }));

    expect(res.headers.location).toBe(`${PREFIX}/profile/settings?status=match-prefs-failed#match-preferences`);
    const page = await agent.get(`${PREFIX}/profile/settings?status=match-prefs-failed`);
    expect(page.text).toContain(t('profile_settings.match.failed'));
    expect(matchSection(page.text)).toContain('spellcheck="false" value="33"');
  });
});

describe('the notifications form on the same page', () => {
  it('re-sends only the three match e-mail choices its endpoint accepts', async () => {
    await request(app()).post(`${PREFIX}/profile/notifications`).type('form').send({ email_messages: 'on', digest_frequency: 'daily' });

    const [, , pathValue, body] = writes()[0];
    expect(pathValue).toBe('/notification-settings');
    expect(body.match_preferences).toEqual({
      notification_frequency: 'fortnightly',
      notify_hot_matches: true,
      notify_mutual_matches: false
    });
  });
});
