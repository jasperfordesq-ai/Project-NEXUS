// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * 31 Oct 2026 walkthrough: when a community has no translation key the API
 * answers TRANSLATION_NOT_SET_UP (since 30 Oct). Every Translate button on this
 * site treated that as a passing fault and said "try again later". It is
 * permanent until an administrator acts, so it must read as "not available".
 */

const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

jest.mock('../src/lib/api', () => ({
  callUserSettingsApi: jest.fn(async () => ({ data: { translation: {} } })),
  callUgcTranslateApi: jest.fn()
}));

const api = require('../src/lib/api');
const { translationFailureStatus } = require('../src/lib/translate-failure');
const { translateFields, detailTranslationLocals } = require('../src/lib/ugc-translation');
const { createTranslator } = require('../src/lib/localization');

const t = createTranslator('en');
const refusal = (code) => Object.assign(new Error(code), { status: 422, data: { errors: [{ code }] } });

describe('translation failure wording', () => {
  it('treats a community without translation as permanent, and a provider hiccup as passing', () => {
    expect(translationFailureStatus(refusal('TRANSLATION_NOT_SET_UP'))).toBe('translate-unavailable');
    expect(translationFailureStatus(refusal('TRANSLATION_DISABLED'))).toBe('translate-unavailable');
    expect(translationFailureStatus(refusal('TRANSLATION_FAILED'))).toBe('translate-failed');
    expect(translationFailureStatus(new Error('socket hang up'))).toBe('translate-failed');
  });

  it('marks a detail-page translation as unavailable, not failed, when it is not set up', async () => {
    api.callUgcTranslateApi.mockRejectedValue(refusal('TRANSLATION_NOT_SET_UP'));
    const req = { session: {}, query: {}, locale: 'en' };
    const res = { locals: {} };

    const result = await translateFields(req, res, 'token', { type: 'event', id: 4, fields: { body: 'Hola' } }, true);

    expect(result).toBeNull();
    expect(req.translationUnavailable).toBe(true);

    const locals = await detailTranslationLocals({ query: { translationStatus: 'unavailable' }, session: {} }, { locals: {} }, 'token', { id: 4 }, {
      href: () => '/events/4', spec: () => ({ type: 'event', id: 4, fields: { body: 'Hola' } })
    });
    expect(locals.translationFailed).toBe('unavailable');
  });

  it('shows the not-available message instead of "try again later"', () => {
    const viewsDir = path.join(__dirname, '..', 'src', 'views');
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader(viewsDir), { autoescape: true });
    const source = fs.readFileSync(path.join(viewsDir, 'partials', 'ugc-translation.njk'), 'utf8');
    const render = (failed) => env.renderString(`${source}{{ ugcTranslation(null, '/x/translate', '/x', true, failed) }}`, { t, failed, urlFor: (v) => v, csrfToken: 'c' });

    expect(render('unavailable')).toContain(t('govuk_alpha_feed.translate.unavailable'));
    expect(render('unavailable')).not.toContain(t('govuk_alpha_feed.translate.text_failed'));
    expect(render(true)).toContain(t('govuk_alpha_feed.translate.text_failed'));
  });
});
