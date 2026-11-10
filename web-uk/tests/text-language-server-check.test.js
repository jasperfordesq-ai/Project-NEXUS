// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Owner, 9 Nov 2026: "if my language is set to English and the text is
 * English, there's no need for a translate button. If … text anywhere on the
 * site is in a different language, then there should be a translate button."
 *
 * When the word check cannot be sure (short texts such as "Media Test Group"),
 * the accessible site asks POST /api/v2/ugc-language as the React site does:
 * with the member's token, once per page, never for private messages, and
 * keeping the button whenever the answer is not known.
 */

const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const nunjucks = require('nunjucks');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({ detectContentLanguages: jest.fn() }));

const api = require('../src/lib/api');
const {
  forgetTextLanguages,
  installTextLanguageRender,
  needsTranslation,
  needsTranslationForItems,
  writtenInReaderLanguage
} = require('../src/lib/text-language/server-check');

const SHORT = 'Media Test Group';
const OTHER_SHORT = 'Garden swap Friday';
const ENGLISH_PARAGRAPH = 'I can help with your garden this weekend. I have all the tools we need and I would be happy to show you how to look after the plants yourself.';

let viewsDir;
beforeAll(() => {
  viewsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webuk-lang-'));
  const page = '{% for text in texts %}[{{ text }}:{{ "button" if needsTranslation([text], "en") else "none" }}]{% endfor %}';
  fs.writeFileSync(path.join(viewsDir, 'page.njk'), page);
  fs.mkdirSync(path.join(viewsDir, 'messages'));
  fs.writeFileSync(path.join(viewsDir, 'messages', 'conversation.njk'), page);
});
afterAll(() => fs.rmSync(viewsDir, { recursive: true, force: true }));

beforeEach(() => {
  jest.clearAllMocks();
  forgetTextLanguages();
});

function createApp({ token = 'member-token', tenant = { id: 7 } } = {}) {
  const app = express();
  const env = nunjucks.configure(viewsDir, { autoescape: true, express: app });
  require('../src/lib/template-filters').registerTemplateFilters(env);
  app.set('view engine', 'njk');
  app.use((req, res, next) => {
    req.signedCookies = token ? { token } : {};
    req.accessibleRouting = { tenant };
    installTextLanguageRender(req, res);
    next();
  });
  app.get('/page', (req, res) => res.render('page', { texts: [].concat(req.query.t || []) }));
  app.get('/private', (req, res) => res.render('messages/conversation', { texts: [].concat(req.query.t || []) }));
  return app;
}

const answer = (language, confidence = 0.95) => ({ language, confidence });

describe('Translate: server language check', () => {
  it('outside a member page it is the word check alone', () => {
    expect(needsTranslation([ENGLISH_PARAGRAPH], 'en')).toBe(false);
    expect(needsTranslation([SHORT], 'en')).toBe(true);
    expect(api.detectContentLanguages).not.toHaveBeenCalled();
  });

  it('hides the button when the server says the text is in the reader\'s language, asking once per page', async () => {
    api.detectContentLanguages.mockResolvedValue({ data: { detections: [answer('en'), answer('fr')] } });
    const response = await request(createApp()).get('/page').query({ t: [SHORT, OTHER_SHORT, ENGLISH_PARAGRAPH] });
    expect(response.text).toBe(`[${SHORT}:none][${OTHER_SHORT}:button][${ENGLISH_PARAGRAPH}:none]`);
    expect(api.detectContentLanguages).toHaveBeenCalledTimes(1);
    // Only what the word check could not settle is sent, with the member's token.
    expect(api.detectContentLanguages.mock.calls[0][0]).toBe('member-token');
    expect(api.detectContentLanguages.mock.calls[0][1]).toEqual([SHORT, OTHER_SHORT]);
  });

  it('remembers answers, so the next page does not ask again', async () => {
    api.detectContentLanguages.mockResolvedValue({ data: { detections: [answer('en')] } });
    const app = createApp();
    await request(app).get('/page').query({ t: SHORT });
    const again = await request(app).get('/page').query({ t: SHORT });
    expect(again.text).toBe(`[${SHORT}:none]`);
    expect(api.detectContentLanguages).toHaveBeenCalledTimes(1);
  });

  it('keeps the button when the answer is not known, and does not remember a failure', async () => {
    api.detectContentLanguages.mockResolvedValueOnce({ data: { detections: [null] } });
    expect((await request(createApp()).get('/page').query({ t: SHORT })).text).toBe(`[${SHORT}:button]`);

    forgetTextLanguages();
    api.detectContentLanguages.mockRejectedValueOnce(new Error('timeout'));
    const app = createApp();
    expect((await request(app).get('/page').query({ t: SHORT })).text).toBe(`[${SHORT}:button]`);
    api.detectContentLanguages.mockResolvedValueOnce({ data: { detections: [answer('en')] } });
    expect((await request(app).get('/page').query({ t: SHORT })).text).toBe(`[${SHORT}:none]`);
  });

  it('takes an unsure answer only when the words are the reader\'s everyday words', () => {
    expect(writtenInReaderLanguage(['Garden help this weekend'], [answer('en', 0.3)], 'en')).toBe(true);
    expect(writtenInReaderLanguage(['Jardinería en mi huerto'], [answer('en', 0.3)], 'en')).toBe(false);
    expect(writtenInReaderLanguage([SHORT], [answer('en-GB', 0.9)], 'en')).toBe(true);
    expect(writtenInReaderLanguage([SHORT], [answer('ga', 0.9)], 'en')).toBe(false);
    expect(writtenInReaderLanguage([SHORT, OTHER_SHORT], [answer('en'), null], 'en')).toBe(false);
  });

  it('never sends private messages', async () => {
    const response = await request(createApp()).get('/private').query({ t: SHORT });
    expect(response.text).toBe(`[${SHORT}:button]`);
    expect(api.detectContentLanguages).not.toHaveBeenCalled();
  });

  it('never asks for a signed-out visitor, or where the community switched translation off', async () => {
    await request(createApp({ token: null })).get('/page').query({ t: SHORT });
    await request(createApp({ tenant: { id: 7, translation: { enabled: false } } })).get('/page').query({ t: SHORT });
    expect(api.detectContentLanguages).not.toHaveBeenCalled();
  });

  it('answers many items before rendering with one request', async () => {
    api.detectContentLanguages.mockResolvedValue({ data: { detections: [answer('en'), answer('de')] } });
    const req = { signedCookies: { token: 'member-token' }, accessibleRouting: { tenant: { id: 7 } } };
    const decisions = await needsTranslationForItems(req, { locals: {} }, [
      { parts: [SHORT], locale: 'en' },
      { parts: [ENGLISH_PARAGRAPH], locale: 'en' },
      { parts: [SHORT, OTHER_SHORT], locale: 'en' }
    ]);
    expect(decisions).toEqual([false, false, true]);
    expect(api.detectContentLanguages).toHaveBeenCalledTimes(1);
  });

  it('uses the shared template global everywhere', () => {
    const filters = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'template-filters.js'), 'utf8');
    expect(filters).toContain("env.addGlobal('needsTranslation', (parts, locale) => needsTranslation(parts, locale))");
    const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
    expect(server).toContain('installTextLanguageRender(req, res);');
  });
});
