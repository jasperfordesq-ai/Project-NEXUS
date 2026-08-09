// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const nunjucks = require('nunjucks');
const path = require('path');

const { buildExploreLinks } = require('../src/lib/accessible-shell');
const { createTranslator } = require('../src/lib/localization');

const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
const govukViewsDirectory = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const templateEnvironment = nunjucks.configure([viewsDirectory, govukViewsDirectory], {
  autoescape: true,
  noCache: true
});

function renderExplore(locale) {
  const t = createTranslator(locale);
  const alphaExploreLinks = buildExploreLinks({
    tenant: {
      exchange_workflow: true,
      modules: { listings: true },
      features: { ai_chat: true, polls: true }
    },
    t
  }).filter((item) => ['/exchanges', '/chat', '/polls'].includes(item.href));

  return {
    html: templateEnvironment.render('explore.njk', {
      alphaExploreLinks,
      alphaFooterColumns: [],
      alphaLanguageQueryParams: [],
      alphaLocaleOptions: [],
      alphaNavItems: [],
      currentPath: '/explore',
      currentUrl: '/explore',
      htmlDirection: locale === 'ar' ? 'rtl' : 'ltr',
      htmlLang: locale,
      isAuthenticated: true,
      recentListings: [{
        href: '/listings/1',
        tagClass: 'govuk-tag--blue',
        title: 'Dynamic listing title',
        type: 'offer'
      }],
      serviceName: 'Project NEXUS',
      t,
      tenantName: 'Test Community',
      title: 'Explore',
      titleKey: 'explore.title',
      upcomingEvents: [{
        date: '',
        href: '/events/1',
        title: 'Dynamic event title'
      }],
      urlFor: (pathname) => pathname
    }),
    t
  };
}

describe('Laravel-first Explore localization', () => {
  it.each([
    ['ga', 'ltr'],
    ['ar', 'rtl']
  ])('renders the real Explore template in %s', (locale, direction) => {
    const { html, t } = renderExplore(locale);

    expect(html).toContain(`<html lang="${locale}" dir="${direction}" class="govuk-template">`);
    expect(html).toContain(`<title>${t('explore.title')} - Project NEXUS</title>`);
    expect(html).toContain(`<h1 class="govuk-heading-xl">${t('explore.title')}</h1>`);
    expect(html).toContain(t('explore.description'));
    expect(html).toContain(t('exchanges.description'));
    expect(html).toContain(t('govuk_alpha_aichat.description'));
    expect(html).toContain(t('polls.description'));
    expect(html).toContain(t('polish_discovery.explore_listings_title'));
    expect(html).toContain(t('polish_discovery.explore_view_all_listings'));
    expect(html).toContain(t('polish_discovery.explore_events_title'));
    expect(html).toContain(t('polish_discovery.explore_view_all_events'));
    expect(html).toContain(t('listings.offer'));
  });
});
