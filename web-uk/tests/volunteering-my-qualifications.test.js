// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Gap B15 (7 Oct 2026): a volunteer's own qualifications register on the accessible
 * site. Recorded, never uploaded, as on the website (QualificationsTab.tsx).
 */

const express = require('express');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  },
  callVolunteeringApi: jest.fn()
}));

const api = require('../src/lib/api');
const router = require('../src/routes/volunteering-my-qualifications');
const { createChoiceTranslator } = require('../src/lib/localization');

const T = {
  'govuk_alpha_volunteering.my_qualifications.heading': 'Qualifications',
  'govuk_alpha_volunteering.my_qualifications.types.first_aid': 'First aid',
  'govuk_alpha_volunteering.my_qualifications.types.other': 'Other',
  'govuk_alpha_volunteering.my_qualifications.errors.title_required': 'Give the qualification a name.',
  'govuk_alpha_volunteering.my_qualifications.errors.vetting': 'Police checks are not recorded here.',
  'govuk_alpha_volunteering.my_qualifications.errors.expiry_before_obtained': 'The expiry date is before the date obtained.',
  'govuk_alpha_volunteering.my_qualifications.form.type_placeholder': 'Choose a qualification',
  'govuk_alpha_volunteering.my_qualifications.form.edit_clears_confirmation': 'Changing a confirmed qualification removes its confirmation.',
  'govuk_alpha_volunteering.my_qualifications.form.saved': 'Qualification saved.',
  'govuk_alpha_volunteering.my_qualifications.status.confirmed': 'Confirmed',
  'govuk_alpha_volunteering.my_qualifications.groups.confirmed': 'Confirmed'
};

// Renders as JSON so the tests read exactly what the routes hand the template.
function makeApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'tok' };
    req.csrfToken = () => 'csrf';
    res.locals.t = (key, params = {}) => {
      let text = T[key] || key;
      for (const [name, value] of Object.entries(params)) text = text.replace(`:${name}`, value);
      return text;
    };
    res.locals.tc = createChoiceTranslator('en');
    res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  app.use('/volunteering', router);
  return app;
}

const REGISTER = {
  data: {
    items: [
      { id: 7, qualification_type: 'first_aid', title: null, issuer: 'Red Cross', reference_number: 'FA-1',
        obtained_at: '2025-01-10', expires_at: '2028-01-10', status: 'confirmed', is_expiring: false,
        confirmed_by: { id: 3, name: 'Org Admin' }, confirmed_at: '2025-02-01T00:00:00Z' }
    ],
    types: [{ code: 'first_aid', expiry_hint_years: 3 }, { code: 'professional_registration', expiry_hint_years: 1 }, { code: 'other', expiry_hint_years: null }],
    counts: { confirmed: 1 }
  }
};

const dateFields = (name, iso) => {
  const [year, month, day] = iso.split('-');
  return { [`${name}-day`]: day, [`${name}-month`]: month, [`${name}-year`]: year };
};

describe('volunteer qualifications register (gap B15)', () => {
  beforeEach(() => {
    api.callVolunteeringApi.mockReset();
  });

  it('lists the volunteer’s qualifications in groups', async () => {
    api.callVolunteeringApi.mockResolvedValue(REGISTER);
    const res = await request(makeApp()).get('/volunteering/qualifications?status=saved');

    expect(api.callVolunteeringApi).toHaveBeenCalledWith('tok', 'GET', '/qualifications');
    expect(res.body.view).toBe('volunteering/my-qualifications');
    const [group] = res.body.locals.groups;
    expect(group.key).toBe('confirmed');
    expect(group.items[0]).toMatchObject({ id: 7, label: 'First aid', issuer: 'Red Cross', status: 'confirmed' });
    expect(res.body.locals.outcome).toEqual({ type: 'success', message: 'Qualification saved.' });
  });

  it('offers the community’s qualification types and asks for no file', async () => {
    api.callVolunteeringApi.mockResolvedValue(REGISTER);
    const res = await request(makeApp()).get('/volunteering/qualifications/new');

    expect(res.body.view).toBe('volunteering/my-qualification-form');
    expect(res.body.locals.options.map((o) => o.code)).toEqual(['first_aid', 'professional_registration', 'other']);
    // One year is singular (it read "Usually valid for 1 years").
    expect(res.body.locals.options.map((o) => o.hint)).toEqual(['Usually valid for 3 years', 'Usually valid for 1 year', '']);
    expect(JSON.stringify(res.body.locals)).not.toMatch(/file|upload/i);
  });

  it('adds a qualification with the dates joined back into one value', async () => {
    api.callVolunteeringApi.mockResolvedValue({ data: { id: 8 } });
    const res = await request(makeApp()).post('/volunteering/qualifications').type('form')
      .send({ qualification_type: 'first_aid', issuer: 'St John', ...dateFields('obtained', '2026-01-05'), ...dateFields('expires', '2029-01-05') });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/volunteering/qualifications?status=saved');
    expect(api.callVolunteeringApi).toHaveBeenCalledWith('tok', 'POST', '/qualifications', {
      qualification_type: 'first_aid', title: null, issuer: 'St John', reference_number: null,
      obtained_at: '2026-01-05', expires_at: '2029-01-05', notes: null
    });
  });

  it('checks the form before sending it and keeps what was typed', async () => {
    api.callVolunteeringApi.mockResolvedValue(REGISTER);
    const res = await request(makeApp()).post('/volunteering/qualifications').type('form')
      .send({ qualification_type: 'other', issuer: 'Somewhere', ...dateFields('obtained', '2026-05-01'), ...dateFields('expires', '2026-01-01') });

    expect(res.status).toBe(422);
    expect(api.callVolunteeringApi).not.toHaveBeenCalledWith('tok', 'POST', '/qualifications', expect.anything());
    expect(res.body.locals.fieldErrors.title.message).toBe('Give the qualification a name.');
    expect(res.body.locals.fieldErrors.expires.message).toBe('The expiry date is before the date obtained.');
    expect(res.body.locals.form.issuer).toBe('Somewhere');
  });

  it('puts the API’s refusal on the field it concerns', async () => {
    api.callVolunteeringApi
      .mockRejectedValueOnce(new api.ApiError('refused', 422, { errors: [{ code: 'VETTING_NOT_A_QUALIFICATION', field: 'qualification_type' }] }))
      .mockResolvedValue(REGISTER);
    const res = await request(makeApp()).post('/volunteering/qualifications').type('form')
      .send({ qualification_type: 'first_aid' });

    expect(res.status).toBe(422);
    expect(res.body.locals.fieldErrors.qualification_type.message).toBe('Police checks are not recorded here.');
  });

  it('warns that editing a confirmed qualification clears the confirmation, then saves with PUT', async () => {
    api.callVolunteeringApi.mockResolvedValue(REGISTER);
    const form = await request(makeApp()).get('/volunteering/qualifications/7/edit');
    expect(form.body.locals.editing).toEqual({ id: 7, wasConfirmed: true });
    expect(form.body.locals.form).toMatchObject({ qualification_type: 'first_aid', issuer: 'Red Cross', obtained: { day: '10', month: '1', year: '2025' } });

    api.callVolunteeringApi.mockResolvedValue({ data: {} });
    const saved = await request(makeApp()).post('/volunteering/qualifications/7').type('form')
      .send({ qualification_type: 'first_aid', issuer: 'Red Cross', was_confirmed: '1' });
    expect(saved.headers.location).toBe('/volunteering/qualifications?status=saved');
    expect(api.callVolunteeringApi).toHaveBeenLastCalledWith('tok', 'PUT', '/qualifications/7', expect.objectContaining({ issuer: 'Red Cross' }));
  });

  it('withdraws with the chosen reason', async () => {
    api.callVolunteeringApi.mockResolvedValue(REGISTER);
    const page = await request(makeApp()).get('/volunteering/qualifications/7/withdraw');
    expect(page.body.locals.reasons.map((r) => r.value)).toEqual(['volunteer_request', 'no_longer_held', 'entered_in_error', 'replaced']);

    api.callVolunteeringApi.mockResolvedValue({ data: {} });
    const done = await request(makeApp()).post('/volunteering/qualifications/7/withdraw').type('form').send({ reason: 'no_longer_held' });
    expect(done.headers.location).toBe('/volunteering/qualifications?status=withdrawn');
    expect(api.callVolunteeringApi).toHaveBeenLastCalledWith('tok', 'POST', '/qualifications/7/withdraw', { reason: 'no_longer_held' });
  });

  it('refuses to edit someone else’s or an unknown qualification', async () => {
    api.callVolunteeringApi.mockResolvedValue(REGISTER);
    const res = await request(makeApp()).get('/volunteering/qualifications/999/edit');
    expect(res.status).toBe(404);
  });
});
