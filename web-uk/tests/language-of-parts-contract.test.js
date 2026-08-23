// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const nunjucks = require('nunjucks');
const path = require('path');

/**
 * WCAG 3.1.2 Language of Parts.
 *
 * The language switcher renders each language's ENDONYM (日本語, العربية,
 * Gaeilge…). On a page whose <html lang> is something else, a screen reader
 * pronounces them with the page language's phonetics — or skips them — unless
 * each option carries its own lang attribute. The event translation page has
 * the same obligation twice over: its target-language options AND its output,
 * which is by definition in a language other than the page's.
 */
const env = nunjucks.configure(
  [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);

const localeOptions = [
  ['en', 'English'],
  ['ga', 'Gaeilge'],
  ['ja', '日本語'],
  ['ar', 'العربية']
];

const shell = {
  t: (key) => key,
  urlFor: (pathname) => pathname,
  isAuthenticated: false,
  tenantName: 'Acme Timebank',
  serviceName: 'Project NEXUS Accessible',
  alphaNavItems: [],
  alphaFooterColumns: [],
  alphaLocaleOptions: localeOptions,
  alphaCurrentLocale: 'en',
  csrfToken: 'test-csrf'
};

describe('language of parts (WCAG 3.1.2)', () => {
  it('marks every language-switcher option with its own lang', () => {
    const html = env.render('layouts/base.njk', { ...shell });
    for (const [code] of localeOptions) {
      expect(html).toContain(`<option value="${code}" lang="${code}"`);
    }
    // Arabic is also right-to-left inside an LTR page.
    expect(html).toMatch(/<option value="ar" lang="ar" dir="rtl"/);
  });

  it('marks the event translation target options and the translated output', () => {
    const html = env.render('events/translate.njk', {
      ...shell,
      isAuthenticated: true,
      event: { id: 42, title: 'Garden day' },
      sourceText: 'Original text',
      languages: [
        { code: 'en', name: 'English', selected: false },
        { code: 'ja', name: '日本語', selected: true }
      ],
      translated: '翻訳されたテキスト',
      status: 'translate-done'
    });

    expect(html).toContain('<option value="ja" lang="ja"');
    // The translated block is in the TARGET language, not the page language.
    expect(html).toMatch(/<div class="govuk-body" lang="ja">\s*翻訳されたテキスト/);
  });
});
