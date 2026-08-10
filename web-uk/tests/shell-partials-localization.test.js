// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const fs = require('fs');
const nunjucks = require('nunjucks');
const path = require('path');

const {
  SUPPORTED_LOCALES,
  createTranslator
} = require('../src/lib/localization');

const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
const templateEnvironment = nunjucks.configure(viewsDirectory, {
  autoescape: true,
  noCache: true
});

function templateSource(name) {
  return fs.readFileSync(path.join(viewsDirectory, 'partials', name), 'utf8');
}

function renderCookieBanner(locale, alphaCookieChoice = '') {
  const t = createTranslator(locale);
  return templateEnvironment.render('partials/cookie-banner.njk', {
    alphaCookieChoice,
    csrfToken: 'test-csrf',
    currentUrl: '/acme/accessible/login?locale=ga',
    showAlphaCookieBanner: true,
    t,
    tenantName: 'Acme Timebank',
    urlFor: (pathname) => `/acme/accessible${pathname}`
  });
}

function renderFooter(locale) {
  const t = createTranslator(locale);
  return templateEnvironment.render('partials/footer.njk', {
    alphaFooterColumns: [{
      heading: t('footer.columns.platform.heading'),
      links: [{
        href: '/acme/accessible/listings',
        label: t('footer.columns.platform.listings')
      }]
    }],
    csrfToken: 'test-csrf',
    isAuthenticated: true,
    tenantSlug: 'acme',
    t,
    urlFor: (pathname) => `/acme/accessible${pathname}`
  });
}

describe('Laravel-first shared partial localization', () => {
  it.each(SUPPORTED_LOCALES)('%s has native cookie and footer catalog values', (locale) => {
    const english = createTranslator('en');
    const t = createTranslator(locale);

    for (const key of [
      'cookie_banner.accept',
      'footer.meta_label',
      'report_problem.footer_link',
      'footer.sign_out'
    ]) {
      expect(t(key)).not.toBe(key);
      if (locale !== 'en') expect(t(key)).not.toBe(english(key));
    }
  });

  it.each(['ga', 'ar', 'de'])('renders localized cookie branches and footer output for %s', (locale) => {
    const t = createTranslator(locale);
    const initialBanner = renderCookieBanner(locale);
    const confirmedBanner = renderCookieBanner(locale, 'accepted');
    const footer = renderFooter(locale);

    expect(initialBanner).toContain(t('cookie_banner.aria_label', { service: 'Acme Timebank' }));
    expect(initialBanner).toContain(t('cookie_banner.heading', { service: 'Acme Timebank' }));
    expect(initialBanner).toContain(t('cookie_banner.intro'));
    expect(initialBanner).toContain(t('cookie_banner.analytics_intro'));
    expect(initialBanner).toContain(t('cookie_banner.accept'));
    expect(initialBanner).toContain(t('cookie_banner.reject'));
    expect(initialBanner).toContain(t('cookie_banner.view'));
    expect(initialBanner).toContain('action="/acme/accessible/cookie-consent"');

    expect(confirmedBanner).toContain(t('cookie_banner.confirm_accepted'));
    expect(confirmedBanner).toContain(t('cookie_banner.confirm_change_link'));
    expect(confirmedBanner).toContain(t('cookie_banner.confirm_change_suffix'));
    expect(confirmedBanner).toContain(t('cookie_banner.hide'));
    expect(confirmedBanner).not.toContain('role="button"');

    expect(footer).toContain(t('footer.nav_label'));
    expect(footer).toContain(t('footer.meta_label'));
    expect(footer).toContain(t('footer.columns.platform.heading'));
    expect(footer).toContain(t('footer.columns.platform.listings'));
    expect(footer).toContain(t('report_problem.footer_link'));
    expect(footer).toContain(t('cookie_settings.title'));
    expect(footer).toContain(t('footer.sign_out'));
    expect(footer).toContain(t('footer.licence'));
    expect(footer).toContain(t('footer.attribution'));
    expect(footer).toContain(t('footer.source'));
    expect(footer).toContain('href="/acme/accessible/report-a-problem"');
    expect(footer).toContain('href="/acme/accessible/cookies"');
    expect(footer).toContain('action="/acme/accessible/logout"');
  });

  it('delegates every static cookie and footer string to Laravel core keys', () => {
    const cookieSource = templateSource('cookie-banner.njk');
    const footerSource = templateSource('footer.njk');

    for (const key of [
      'cookie_banner.aria_label',
      'cookie_banner.confirm_accepted',
      'cookie_banner.confirm_rejected',
      'cookie_banner.confirm_change_link',
      'cookie_banner.confirm_change_suffix',
      'cookie_banner.hide',
      'cookie_banner.heading',
      'cookie_banner.intro',
      'cookie_banner.analytics_intro',
      'cookie_banner.accept',
      'cookie_banner.reject',
      'cookie_banner.view'
    ]) {
      expect(cookieSource).toContain(`t("${key}"`);
    }

    for (const key of [
      'footer.nav_label',
      'footer.meta_label',
      'report_problem.footer_link',
      'cookie_settings.title',
      'footer.sign_out',
      'footer.licence',
      'footer.attribution',
      'footer.source'
    ]) {
      expect(footerSource).toContain(`t("${key}"`);
    }
  });
});
