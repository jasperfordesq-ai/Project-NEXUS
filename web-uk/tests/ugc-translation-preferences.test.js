// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
'use strict';
jest.mock('../src/lib/api', () => ({ callUserSettingsApi: jest.fn(), callUgcTranslateApi: jest.fn() }));
const api = require('../src/lib/api');
const { translateFields } = require('../src/lib/ugc-translation');
const spec = { type: 'profile_bio', id: 4, fields: { tagline: 'Hello', body: '' } };
const res = { locals: { locale: 'en' } };
const request = () => ({ session: {}, query: {}, accessibleRouting: { tenant: { id: 2 } } });
beforeEach(() => {
  jest.resetAllMocks();
  api.callUserSettingsApi.mockResolvedValue({ data: { translation: { auto_translate_ugc: true, auto_translate_target_locale: 'es' } } });
  api.callUgcTranslateApi.mockResolvedValue({ data: { translated_text: 'Hola' } });
});
test('cache-only automatic display follows the saved target and skips empty fields', async () => {
  const req = request();
  expect(await translateFields(req, res, 'token', spec)).toMatchObject({ fields: { tagline: 'Hola' }, locale: 'es' });
  expect(api.callUgcTranslateApi).toHaveBeenCalledTimes(1);
  expect(api.callUgcTranslateApi).toHaveBeenCalledWith('token', expect.objectContaining({ cache_only: true, target_locale: 'es', content_type: 'profile_bio_tagline' }));
});
test('disabled preferences make no provider request; manual translation remains available', async () => {
  api.callUserSettingsApi.mockResolvedValue({ data: { translation: { auto_translate_ugc: false } } });
  expect(await translateFields(request(), res, 'token', spec)).toBeNull();
  expect(api.callUgcTranslateApi).not.toHaveBeenCalled();
  await translateFields(request(), res, 'token', spec, true);
  expect(api.callUgcTranslateApi.mock.calls[0][1]).not.toHaveProperty('cache_only');
});
test('a cache miss or provider failure leaves the original available', async () => {
  api.callUgcTranslateApi.mockResolvedValueOnce({ data: null }).mockRejectedValueOnce(new Error('quota'));
  expect(await translateFields(request(), res, 'token', spec)).toBeNull();
  expect(await translateFields(request(), res, 'token', spec, true)).toBeNull();
});
test.each(['text', 'language', 'account', 'tenant', 'id'])('never displays a saved translation after a %s change', async change => {
  const req = request();
  req.session.ugcTranslation = await translateFields(req, res, 'token', spec, true);
  const next = request(); next.session = req.session;
  const changed = { ...spec, fields: { ...spec.fields } };
  if (change === 'text') changed.fields.tagline = 'Edited';
  if (change === 'id') changed.id = 5;
  if (change === 'tenant') next.accessibleRouting.tenant.id = 3;
  if (change === 'language') next.locale = 'fr';
  api.callUserSettingsApi.mockResolvedValue({ data: { translation: { auto_translate_ugc: false } } });
  // Original saved target was es; use es here so each other invalidation is independently exercised.
  if (change !== 'language') next.locale = 'es';
  expect(await translateFields(next, res, change === 'account' ? 'other-token' : 'token', changed)).toBeNull();
});
test('Show original suppresses automatic display and the community switch suppresses requests', async () => {
  const req = request(); req.query.translation = 'original';
  expect(await translateFields(req, res, 'token', spec)).toBeNull();
  req.accessibleRouting.tenant.translation = { enabled: false };
  expect(await translateFields(req, res, 'token', spec, true)).toBeNull();
  expect(api.callUgcTranslateApi).not.toHaveBeenCalled();
});

test('translated content is escaped in the no-JavaScript form, including partial results', () => {
  const path = require('node:path');
  const nunjucks = require('nunjucks');
  const env = nunjucks.configure(path.join(__dirname, '../src/views'), { autoescape: true });
  env.addFilter('nl2br', require('../src/lib/nl2br').nl2br);
  const html = env.renderString('{% from "partials/ugc-translation.njk" import ugcTranslation with context %}{{ ugcTranslation(result, "/items/4/translate", "/items/4", true) }}', {
    result: { fields: { title: '<script>alert(1)</script>', body: 'line one\nline two' }, locale: 'es', partial: true },
    t: key => key, urlFor: value => value, csrfToken: 'synthetic-csrf'
  });
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('name="_csrf" value="synthetic-csrf"');
  expect(html).toContain('action="/items/4/translate"');
  expect(html).toContain('?translation=original');
});

test('partial translations preserve successful fields and report missing fields', async () => {
  api.callUgcTranslateApi.mockResolvedValueOnce({ data: { translated_text: 'Hola' } }).mockRejectedValueOnce(new Error('quota'));
  const result = await translateFields(request(), res, 'token', { ...spec, fields: { title: 'Hello', body: 'Long body' } }, true);
  expect(result).toMatchObject({ fields: { title: 'Hola' }, partial: true });
});

test('old form results are bound to source, account, tenant, locale and Show original', async () => {
  const { translationBinding, validSavedTranslation } = require('../src/lib/ugc-translation');
  const req = request();
  const fields = { body: 'Original comment' };
  const saved = { binding: await translationBinding(req, res, 'token', 'comment', 7, fields) };
  expect(await validSavedTranslation(req, res, 'token', saved, 'comment', 7, fields)).toBe(true);
  expect(await validSavedTranslation(req, res, 'token', saved, 'comment', 7, { body: 'Edited comment' })).toBe(false);
  expect(await validSavedTranslation(req, res, 'other-token', saved, 'comment', 7, fields)).toBe(false);
  req.accessibleRouting.tenant.id = 3;
  expect(await validSavedTranslation(req, res, 'token', saved, 'comment', 7, fields)).toBe(false);
  req.accessibleRouting.tenant.id = 2; req.query.translation = 'original';
  expect(await validSavedTranslation(req, res, 'token', saved, 'comment', 7, fields)).toBe(false);
});
