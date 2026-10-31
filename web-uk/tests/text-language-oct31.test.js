// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Owner, 31 Oct 2026: no Translate button where the text is already in the
 * reader's language. This site uses the website's own detector (generated copy,
 * scripts/sync-text-language.mjs) and runs the same corpus, so both sites decide
 * alike. Doubt keeps the button.
 */

const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');

jest.mock('../src/lib/api', () => ({
  callUserSettingsApi: jest.fn(async () => ({ data: { translation: {} } })),
  callUgcTranslateApi: jest.fn(async () => ({ data: null }))
}));

const corpus = require('../src/lib/text-language/__fixtures__/corpus.json');
const { alreadyInLanguage, translationNeeded } = require('../src/lib/text-language');
const { detailTranslationLocals } = require('../src/lib/ugc-translation');
const { createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

const READERS = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'];
const ENGLISH = 'Please remember to log your hours after each exchange so the balance stays accurate.';
const SPANISH = 'Mi vecina mayor estaría encantada de recibir una llamada cada semana, ¿alguien tiene veinte minutos?';

describe('the shared detector on this site', () => {
  it('never hides the button wrongly on the shared corpus', () => {
    const wrong = [];
    for (const language of READERS) {
      for (const text of corpus[language]) {
        for (const reader of READERS) if (reader !== language && alreadyInLanguage([text], reader)) wrong.push(`${language}->${reader}: ${text}`);
      }
    }
    for (const [label, text] of corpus._other) {
      for (const reader of READERS) if (alreadyInLanguage([text], reader)) wrong.push(`${label}->${reader}: ${text}`);
    }
    expect(wrong).toEqual([]);
  });

  it('hides it for clear text in the reader\'s language, and keeps it otherwise', () => {
    expect(translationNeeded([ENGLISH], 'en')).toBe(false);
    expect(translationNeeded([SPANISH], 'en')).toBe(true);
    expect(translationNeeded([ENGLISH, 'Ayuda con jardinería en mi huerto'], 'en')).toBe(true);
    expect(translationNeeded(['Thanks so much!'], 'en')).toBe(true);
    expect(translationNeeded([ENGLISH], undefined)).toBe(true);
    expect(translationNeeded([ENGLISH], 'sv')).toBe(true);
  });
});

describe('templates offer Translate only when it is needed', () => {
  const viewsDir = path.join(__dirname, '..', 'src', 'views');
  const env = nunjucks.configure([viewsDir, path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')], { autoescape: true, noCache: true });
  registerTemplateFilters(env);
  const t = createTranslator('en');

  it('a listing in English shows no button to an English reader; a Spanish one does', () => {
    const source = fs.readFileSync(path.join(viewsDir, 'listings/detail.njk'), 'utf8');
    const start = source.indexOf('{# Translate the title and description');
    const end = source.indexOf('{% endif %}', source.indexOf('listing_button', start)) + '{% endif %}'.length;
    const block = source.slice(start, end);
    const render = (listing) => env.renderString(block, { t, locale: 'en', listing, isAuthenticated: true, csrfToken: 'c', urlFor: (v) => v });

    expect(render({ id: 1, title: 'Help with the garden this weekend', description: ENGLISH })).not.toContain('/translate"');
    expect(render({ id: 2, title: 'Ayuda en la casa', description: SPANISH })).toContain('action="/listings/2/translate"');
  });

  it('the feed\'s imported "Translate this post" form follows the reader\'s language', () => {
    const html = (content) => env.renderString('{% from "feed/_item-menu.njk" import translateForm %}{{ translateForm(item, "c", urlFor, t) }}', {
      t, urlFor: (v) => v, item: { type: 'post', id: 7, content }
    });
    expect(html(`<p>${ENGLISH}</p>`)).not.toContain('/translate');
    expect(html(`<p>${SPANISH}</p>`)).toContain('action="/feed/posts/7/translate"');
  });

  it('shared detail pages leave the button out for text already in the reader\'s language', async () => {
    const config = { href: (item) => `/jobs/${item.id}`, spec: (item) => ({ type: 'job', id: item.id, fields: { title: item.title, body: item.body } }) };
    const req = { locale: 'en', query: {}, session: {} };
    const res = { locals: { locale: 'en' } };
    const english = await detailTranslationLocals(req, res, 'token', { id: 1, title: 'Help wanted this weekend', body: ENGLISH }, config);
    const spanish = await detailTranslationLocals(req, res, 'token', { id: 2, title: 'Se busca ayuda', body: SPANISH }, config);
    expect(english.translationAvailable).toBe(false);
    expect(spanish.translationAvailable).toBe(true);
  });
});

// Found on the 31 Oct walkthrough: "Feed" (the page) had been machine-translated
// as feeding animals in nine languages ("alimentar", "Futter", "Nourrir", 飼料…).
describe('the feed is named as a page, not as animal feed', () => {
  it('no language calls it fodder', () => {
    const fodder = ['alimentar', 'Futter', 'Nourrir', 'Nutrire', 'Alimentação', 'Voer', 'Karmić', '飼料', 'تغذية'];
    for (const locale of ['ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar']) {
      const t = createTranslator(locale);
      for (const key of ['govuk_alpha.nav.feed', 'govuk_alpha.feed.title']) expect(fodder).not.toContain(t(key));
    }
  });
});
