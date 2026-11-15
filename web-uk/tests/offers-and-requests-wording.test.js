// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Warmth phase 6, E7: the accessible site says "Offers and requests", as the
 * React site does (react-frontend/public/locales/<lang>/listings.json
 * `title`), not "Listings", in its member-facing text — in all eleven
 * languages, using the React site's own word for it in each — and an empty
 * list of offers and requests points to the obvious next step.
 *
 * Deliberately NOT covered (still "listing"): marketplace text (a different
 * thing: items for sale), partner-community (federation) text, the feed's
 * type filter, owner-only analytics, the report and save flows, and other
 * namespaces (govuk_alpha_listings, _explore, _search, _saved, _settings,
 * _connections). Listed in the E7 report.
 */

const fs = require('fs');
const path = require('path');
const { createTranslator } = require('../src/lib/localization');

const LOCALES = ['en', 'ar', 'de', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt'];

// The React site's own "Offers and requests" in each language (listings.json title).
const REACT_TITLE = {
  en: 'Offers and requests',
  ar: 'العروض والطلبات',
  de: 'Angebote und Gesuche',
  es: 'Ofertas y solicitudes',
  fr: 'Offres et demandes',
  ga: 'Tairiscintí agus iarratais',
  it: 'Offerte e richieste',
  ja: '提供とリクエスト',
  nl: 'Aanbod en verzoeken',
  pl: 'Oferty i prośby',
  pt: 'Ofertas e pedidos'
};

const RENAMED = [
  'nav.listings', 'footer.columns.platform.listings', 'actions.back_to_listings', 'states.module_disabled',
  'dashboard.new_listing', 'dashboard.recent_listings_title', 'dashboard.empty_listings', 'dashboard.my_listings_title',
  'dashboard.my_listings_empty', 'dashboard.view_my_listings', 'dashboard.view_listings',
  'dashboard_panels.listings', 'dashboard_panels.all_listings',
  'listings.title', 'listings.detail_title', 'listings.filters_title', 'listings.search_label', 'listings.empty',
  'listings.error_detail', 'listings.module_disabled_detail', 'listings.pagination_label', 'listings.more_results_label',
  'listings.create.title', 'listings.create.auth_link', 'listings.create.intent_legend', 'listings.create.submit',
  'listings.create.created', 'listings.create.failed', 'listings.create.errors.failed',
  'listings.edit.title', 'listings.edit.updated', 'listings.edit.deleted',
  'guide.browse_listings', 'guide.getting_started_body',
  'matches.add_listing', 'matches.empty', 'matches.no_listings_title', 'matches.no_listings_description',
  'search.type_listing',
  'polish_discovery.explore_listings_title', 'polish_discovery.explore_listings_empty', 'polish_discovery.explore_view_all_listings',
  'profile.listings_title', 'profile.view_all_listings', 'profile.empty_listings',
  'own_records.open_listings', 'own_records.my_listings', 'own_records.my_listings_description', 'own_records.all_listings',
  'own_records.status_nav_label', 'own_records.my_listings_empty', 'own_records.my_listings_load_error'
];

describe('"Offers and requests", not "Listings"', () => {
  const en = createTranslator('en');

  it('uses the React site\'s own term for the section in every language', () => {
    for (const locale of LOCALES) {
      const t = createTranslator(locale);
      expect([locale, t('nav.listings')]).toEqual([locale, REACT_TITLE[locale]]);
      expect([locale, t('listings.title')]).toEqual([locale, REACT_TITLE[locale]]);
    }
  });

  it('never says "listing" in the English member-facing text it covers', () => {
    for (const key of RENAMED) {
      const value = String(en(key));
      expect([key, value === key]).toEqual([key, false]);
      expect([key, /listing/i.test(value)]).toEqual([key, false]);
    }
  });

  it('is translated, not copied from English, and keeps placeholders', () => {
    for (const locale of LOCALES.filter((l) => l !== 'en')) {
      const t = createTranslator(locale);
      for (const key of RENAMED) {
        const value = String(t(key));
        expect([locale, key, value === String(en(key))]).toEqual([locale, key, false]);
        expect([locale, key, /listing/i.test(value)]).toEqual([locale, key, false]);
        // The "?"-corruption seen in older strings ("Co to za zestawienie%").
        expect([locale, key, /%$/.test(value)]).toEqual([locale, key, false]);
      }
      expect(String(t('listings.module_disabled_detail', { community: 'X' }))).toContain('X');
    }
  });

  it('counts offers and requests with a usable plural message', () => {
    const tc = (locale, count) => {
      const message = String(createTranslator(locale)('listings.result_count'));
      expect(message.split('|')).toHaveLength(3);
      return message;
    };
    for (const locale of LOCALES) tc(locale, 2);
    expect(String(en('listings.result_count'))).toContain(':count offers and requests found');
  });
});

describe('empty lists point to the next step', () => {
  const VIEWS = path.join(__dirname, '..', 'src', 'views');
  const read = (file) => fs.readFileSync(path.join(VIEWS, file), 'utf8').replace(/\{#[\s\S]*?#\}/g, '');
  const SHARE_LINK = /href="\{\{ urlFor\('\/listings\/new'\) \}\}"[^>]*>\{\{ t\("listings\.create\.title"\) \}\}<\/a>/;

  function emptyBlock(source, marker) {
    const start = source.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    return source.slice(start, source.indexOf('{% else %}', start) > -1 ? source.indexOf('{% else %}', start) : start + 600);
  }

  it('your own empty list on the dashboard offers "Share an offer or request"', () => {
    expect(emptyBlock(read('dashboard/index.njk'), 't("dashboard.my_listings_empty")')).toMatch(SHARE_LINK);
  });

  it('the empty offers-and-requests page offers it when no filter is applied (with a filter, "Clear filters")', () => {
    const block = emptyBlock(read('listings/index.njk'), 't("listings.empty")');
    expect(block).toMatch(SHARE_LINK);
    expect(block).toMatch(/\{% if hasFilters %\}[\s\S]*clear_filters[\s\S]*\{% elif isAuthenticated %\}/);
  });

  it('your own profile with nothing posted offers it; another member\'s profile does not', () => {
    expect(emptyBlock(read('profile/index.njk'), 't("profile.empty_listings")')).toMatch(SHARE_LINK);
    expect(emptyBlock(read('members/profile.njk'), 't("profile.empty_listings")')).not.toMatch(SHARE_LINK);
  });

  it('English reads as a next step', () => {
    expect(createTranslator('en')('listings.create.title')).toBe('Share an offer or request');
  });
});
