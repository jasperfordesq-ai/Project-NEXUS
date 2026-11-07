// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
'use strict';

/**
 * AWID report, Oct 2026, point 3: "the translation button doesn't translate
 * everything" — a profile's skills stayed in the member's language. They now
 * translate with the bio and tagline as companion fields: sent on the same
 * press, handed back separately, never deciding whether there is a result.
 */
jest.mock('../src/lib/api', () => ({ callUserSettingsApi: jest.fn(), callUgcTranslateApi: jest.fn() }));
const api = require('../src/lib/api');
const { translateFields } = require('../src/lib/ugc-translation');

const res = { locals: { locale: 'en' } };
const request = () => ({ session: {}, query: {}, accessibleRouting: { tenant: { id: 2 } } });
const spec = {
  type: 'profile_bio',
  id: 4,
  fields: { tagline: '', body: 'Me encanta ayudar a mis vecinos.' },
  companionFields: { skills: 'Jardinería\nCocina' }
};

beforeEach(() => {
  jest.resetAllMocks();
  api.callUserSettingsApi.mockResolvedValue({ data: { translation: {} } });
});

test('translates the skills on the same press and hands them back apart from the fields', async () => {
  api.callUgcTranslateApi.mockImplementation(async (token, body) => ({
    data: { translated_text: body.content_type === 'profile_bio_skills' ? 'Gardening\nCooking' : 'I love helping my neighbours.' }
  }));

  const result = await translateFields(request(), res, 'token', spec, true);

  expect(result.fields).toEqual({ body: 'I love helping my neighbours.' });
  expect(result.companion).toEqual({ skills: 'Gardening\nCooking' });
  expect(result.partial).toBe(false);
  expect(api.callUgcTranslateApi).toHaveBeenCalledWith('token', expect.objectContaining({
    content_type: 'profile_bio_skills', content_id: 4, source_text: 'Jardinería\nCocina'
  }));
});

test('a failed skills translation never marks the bio translation as partial', async () => {
  api.callUgcTranslateApi.mockImplementation(async (token, body) => {
    if (body.content_type === 'profile_bio_skills') throw new Error('quota');
    return { data: { translated_text: 'I love helping my neighbours.' } };
  });

  const result = await translateFields(request(), res, 'token', spec, true);

  expect(result.fields.body).toBe('I love helping my neighbours.');
  expect(result.companion).toEqual({});
  expect(result.partial).toBe(false);
});

test('skills alone are not a result', async () => {
  api.callUgcTranslateApi.mockImplementation(async (token, body) => (
    body.content_type === 'profile_bio_skills' ? { data: { translated_text: 'Gardening\nCooking' } } : { data: null }
  ));

  expect(await translateFields(request(), res, 'token', spec, true)).toBeNull();
});

test('a saved translation is not shown once the skills change', async () => {
  api.callUgcTranslateApi.mockResolvedValue({ data: { translated_text: 'Translated' } });
  const req = request();
  req.session.ugcTranslation = await translateFields(req, res, 'token', spec, true);
  const next = request();
  next.session = req.session;

  const changed = { ...spec, companionFields: { skills: 'Jardinería\nCocina\nCostura' } };
  expect(await translateFields(next, res, 'token', changed)).toBeNull();
});
