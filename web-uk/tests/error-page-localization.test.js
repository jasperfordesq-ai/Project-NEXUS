// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const nunjucks = require('nunjucks');
const path = require('path');

const {
  SUPPORTED_LOCALES,
  catalogFor,
  createTranslator,
  translate,
  valueInCatalog
} = require('../src/lib/localization');

const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
const govukViewsDirectory = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const templateEnvironment = nunjucks.configure([viewsDirectory, govukViewsDirectory], {
  autoescape: true,
  noCache: true
});
const errorTemplates = [
  'errors/403.njk',
  'errors/404.njk',
  'errors/419.njk',
  'errors/429.njk',
  'errors/500.njk',
  'errors/503.njk',
  'error.njk'
];
const catalogErrorTemplates = errorTemplates.filter((name) => name !== 'error.njk');

function templateSource(name) {
  return fs.readFileSync(path.join(viewsDirectory, name), 'utf8');
}

function renderErrorTemplate(name, locale, overrides = {}) {
  return templateEnvironment.render(name, {
    errorDetails: null,
    heading: 'Safe dynamic heading',
    htmlDirection: locale === 'ar' ? 'rtl' : 'ltr',
    htmlLang: locale,
    message: 'Safe dynamic message',
    retryAfter: null,
    serviceName: 'Project NEXUS',
    t: createTranslator(locale),
    title: 'Error',
    urlFor: (pathname) => `/acme/accessible${pathname === '/' ? '' : pathname}`,
    ...overrides
  });
}

describe('Laravel-first error-page localization', () => {
  it('delegates shared status-page actions to the authoritative Laravel error catalog', () => {
    for (const templateName of catalogErrorTemplates) {
      const source = templateSource(templateName);
      expect(source).toContain('t("error_pages.home_link")');
      expect(source).not.toContain('>Go to the home page</a>');
    }
    expect(templateSource('error.njk')).toContain('t("nav.home")');
  });

  it('has direct shared error-page catalog values in all 11 Laravel locales', () => {
      const translationKeys = [
        'error_pages.home_link',
        'error_pages.403_title',
        'error_pages.404_title',
        'error_pages.419_title',
        'error_pages.429_title',
        'error_pages.503_title',
        'error_pages.generic_title'
      ];
      expect(SUPPORTED_LOCALES).toHaveLength(11);
      for (const locale of SUPPORTED_LOCALES) {
        for (const translationKey of translationKeys) {
          const directValue = valueInCatalog(catalogFor(locale), translationKey);
          expect(typeof directValue).toBe('string');
          expect(directValue).not.toBe('');
          expect(translate(locale, translationKey)).toBe(directValue);
        }
      }
  });

  it.each(['ga', 'ar', 'de'])(
    'renders the mapped Laravel copy for %s without changing error semantics',
    (locale) => {
      const t = createTranslator(locale);
      for (const templateName of catalogErrorTemplates) {
        const html = renderErrorTemplate(templateName, locale);

        expect(html).toContain(`<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}"`);
        expect(html).toContain(`>${t('error_pages.home_link')}</a>`);
        expect((html.match(/<main\b/g) || [])).toHaveLength(1);
        expect((html.match(/id="main-content"/g) || [])).toHaveLength(1);
        expect(html).not.toContain('nexus-alpha-header');
        expect(html).not.toContain('govuk-cookie-banner');
        expect(html).not.toContain('govuk-phase-banner');
        expect(html).not.toContain('/js/');
      }

      const genericHtml = renderErrorTemplate('error.njk', locale);
      expect(genericHtml).toContain(`>${t('nav.home')}</a>`);
      expect((genericHtml.match(/<main\b/g) || [])).toHaveLength(1);
      expect((genericHtml.match(/id="main-content"/g) || [])).toHaveLength(1);

      const serverErrorHtml = renderErrorTemplate('errors/500.njk', locale);
      expect(serverErrorHtml).toContain(`<h1 class="govuk-heading-xl">${t('error_pages.generic_title')}</h1>`);
      expect(serverErrorHtml).toContain(t('error_pages.generic_body'));
    }
  );

  it('preserves generic route copy but standardizes shared exception copy', () => {
    const genericHtml = renderErrorTemplate('error.njk', 'ga', {
      heading: 'Account access paused',
      message: 'Contact your community administrator.'
    });
    const forbiddenHtml = renderErrorTemplate('errors/403.njk', 'ar', {
      message: 'Signed-in access is required.'
    });

    expect(genericHtml).toContain('Account access paused');
    expect(genericHtml).toContain('Contact your community administrator.');
    expect(forbiddenHtml).toContain(createTranslator('ar')('error_pages.403_body'));
    expect(forbiddenHtml).not.toContain('Signed-in access is required.');
  });
});
