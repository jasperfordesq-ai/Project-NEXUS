// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const nunjucks = require('nunjucks');
const path = require('path');

const { createTranslator } = require('../src/lib/localization');

function source(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', ...segments), 'utf8');
}

const templateEnvironment = nunjucks.configure(
  [
    path.join(__dirname, '..', 'src', 'views'),
    path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')
  ],
  { autoescape: true, noCache: true }
);

/**
 * Render the exchanges list with no exchanges, so the empty state is exercised.
 * Rendered rather than grepped: a source assertion would still pass if the heading
 * sat inside a branch that never runs.
 */
function renderEmptyExchangeList(locale = 'en') {
  const t = createTranslator(locale);
  return templateEnvironment.render('exchanges/index.njk', {
    activeTab: 'all',
    alphaFooterColumns: [],
    alphaLanguageQueryParams: [],
    alphaLocaleOptions: [],
    alphaNavItems: [],
    currentPath: '/exchanges',
    currentUrl: '/exchanges',
    exchanges: [],
    htmlDirection: locale === 'ar' ? 'rtl' : 'ltr',
    htmlLang: locale,
    isAuthenticated: true,
    meta: {},
    serviceName: 'Project NEXUS',
    t,
    tc: (key, count, params) => t(key, { ...params, count }),
    tenantName: 'Test Community',
    title: 'Exchanges',
    titleKey: 'exchanges.title',
    urlFor: (target) => target,
    workflowAvailable: true,
    workflowEnabled: true
  });
}

describe('Laravel exchange workflow integration contract', () => {
  it('checks authoritative config and active exchange state from listing details', () => {
    const route = source('src', 'routes', 'listings.js');
    const template = source('src', 'views', 'listings', 'detail.njk');

    expect(route).toContain('checkExchangeForListing');
    expect(route).toContain('config.exchange_workflow_enabled === true');
    expect(route).not.toMatch(/getExchangeConfig\(token\)\.catch\([^\n]+exchange_workflow_enabled:\s*true/);
    expect(template).toContain("urlFor('/exchanges/' + (activeExchange.id | string))");
    expect(template).toContain("urlFor('/listings/' + (listing.id | string) + '/exchange-request')");
    expect(route).toContain("trimmed(req.body.prep_time) === ''");
  });

  it('keeps provider-only lifecycle actions aligned with Laravel Blade and React', () => {
    const route = source('src', 'routes', 'exchanges.js');

    expect(route).toContain("canStart: isProvider && status === 'accepted'");
    expect(route).toContain("canComplete: isProvider && status === 'in_progress'");
    expect(route).not.toContain("canStart: (isProvider || isRequester)");
    expect(route).not.toContain("canComplete: (isProvider || isRequester)");
  });

  it('requires an explicit no-JS disclosure before destructive exchange controls', () => {
    const template = source('src', 'views', 'exchanges', 'detail.njk');

    expect(template).toMatch(/<details[^>]*>[\s\S]*name="action" value="decline"[\s\S]*<\/details>/);
    expect(template).toMatch(/<details[^>]*>[\s\S]*name="action" value="cancel"[\s\S]*<\/details>/);
  });

  it('rejects malformed confirmation hours before calling the lifecycle API', () => {
    const route = source('src', 'routes', 'exchanges.js');

    expect(route).toContain("action === 'confirm' && hours === null");
    expect(route).toContain('status=exchange-hours-invalid#hours');
  });

  it('uses the current Laravel Blade catalogue for exchange list and detail states', () => {
    const route = source('src', 'routes', 'exchanges.js');
    const index = source('src', 'views', 'exchanges', 'index.njk');
    const detail = source('src', 'views', 'exchanges', 'detail.njk');

    expect(route).toContain("t(isRequester ? 'exchanges.role_requester' : 'exchanges.role_provider')");
    expect(route).toContain("res.locals.t('error_pages.503_body')");
    expect(route).not.toContain('Exchange items could not be loaded. Try again.');
    expect(index).toContain('t("exchanges.description")');
    expect(index).toContain('tc("exchanges.result_count"');
    expect(index).toContain('t("exchanges.empty")');
    expect(detail).toContain('t("exchanges.status_descriptions." + exchange.status)');
    expect(detail).toContain('t("exchanges.review_title")');
    expect(detail).toContain('t("exchanges.empty_timeline")');
    expect(detail).not.toContain('There are no timeline entries yet.');
  });

  it('gives the empty exchange list a heading, not just a sentence', () => {
    // 🔴 Behaviour divergence found by rendering both accessible frontends against one
    // Laravel: Blade's empty state has a heading and web-uk's had only a paragraph. A
    // screen-reader user navigating by heading had nothing to land on, and the state was
    // never named before being explained. React's ExchangesPage agrees a heading belongs.
    const html = renderEmptyExchangeList('en');
    const t = createTranslator('en');

    expect(html).toContain(t('exchanges.empty'));

    // Assert the HEADING ELEMENT, not merely the string: the wording also appears in
    // other empty states, so a substring check would pass without a heading present.
    const insetHeading = html.match(
      /<div class="govuk-inset-text">\s*<h2 class="govuk-heading-m">([^<]+)<\/h2>/
    );
    expect(insetHeading).not.toBeNull();
    expect(insetHeading[1].trim()).toBe(t('states.nothing_yet_title'));
  });

  it('translates the empty exchange list heading rather than hardcoding English', () => {
    // Arabic, because it shares no vocabulary with English: if the heading were a literal
    // it would survive the locale switch, and this assertion would fail.
    const html = renderEmptyExchangeList('ar');

    expect(html).toContain(createTranslator('ar')('states.nothing_yet_title'));
    expect(html).not.toContain(createTranslator('en')('states.nothing_yet_title'));
  });
});
