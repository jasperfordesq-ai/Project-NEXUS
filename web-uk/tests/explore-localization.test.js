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
      activeTab: 'all',
      tabs: ['all', 'for_you', 'listings'].map((key) => ({
        key,
        href: key === 'all' ? '/explore' : `/explore?tab=${key}`,
        label: t(`govuk_alpha_explore.tabs.${key}`)
      })),
      sections: [{
        key: 'popular_listings',
        title: t('govuk_alpha_explore.sections.popular_listings.title'),
        subtitle: t('govuk_alpha_explore.sections.popular_listings.subtitle'),
        seeAllHref: '/listings?sort=popular',
        items: [{ href: '/listings/1', title: 'Dynamic listing title', tag: { type: 'offer', tagClass: 'govuk-tag--blue' }, meta: [] }]
      }, {
        key: 'upcoming_events',
        title: t('govuk_alpha_explore.sections.upcoming_events.title'),
        subtitle: t('govuk_alpha_explore.sections.upcoming_events.subtitle'),
        seeAllHref: '/events',
        items: [{ href: '/events/1', title: 'Dynamic event title', tag: null, meta: [] }]
      }],
      serviceName: 'Project NEXUS',
      t,
      tenantName: 'Test Community',
      title: 'Explore',
      titleKey: 'explore.title',
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
    expect(html).toContain(t('govuk_alpha_explore.sections.popular_listings.title'));
    expect(html).toContain(t('govuk_alpha_explore.sections.upcoming_events.title'));
    expect(html).toContain(t('govuk_alpha_explore.see_all'));
    expect(html).toContain(t('govuk_alpha_explore.tabs.for_you'));
    expect(html).toContain(t('listings.offer'));
  });
});
