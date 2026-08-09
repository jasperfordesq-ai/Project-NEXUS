// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const nunjucks = require('nunjucks');
const path = require('path');

const { createTranslator } = require('../src/lib/localization');

const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
const govukViewsDirectory = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const templateEnvironment = new nunjucks.Environment(
  new nunjucks.FileSystemLoader([viewsDirectory, govukViewsDirectory], { noCache: true }),
  { autoescape: true }
);

function templateSource(name) {
  return fs.readFileSync(path.join(viewsDirectory, name), 'utf8');
}

function baseLocals(locale, extra = {}) {
  return {
    alphaFooterColumns: [],
    alphaLanguageQueryParams: [],
    alphaLocaleOptions: [],
    alphaNavItems: [],
    currentPath: '/marketplace',
    currentUrl: '/marketplace',
    htmlDirection: locale === 'ar' ? 'rtl' : 'ltr',
    htmlLang: locale,
    isAuthenticated: true,
    serviceName: 'Project NEXUS',
    t: createTranslator(locale),
    tenantName: 'Test Community',
    title: 'Marketplace',
    titleKey: 'marketplace.title',
    urlFor: (pathname) => pathname,
    ...extra
  };
}

describe('Laravel-first Marketplace template localization', () => {
  it('delegates shared Marketplace navigation and its accessible name to Laravel keys', () => {
    const source = templateSource('marketplace/_nav.njk');

    for (const translationKey of [
      'govuk_alpha_commerce.nav.heading',
      'govuk_alpha_commerce.nav.browse',
      'govuk_alpha_commerce.nav.saved',
      'govuk_alpha_commerce.nav.offers',
      'govuk_alpha_commerce.nav.orders',
      'govuk_alpha_commerce.nav.pickups',
      'govuk_alpha_commerce.nav.sales',
      'govuk_alpha_commerce.nav.mine',
      'govuk_alpha_commerce.nav.sell',
      'govuk_alpha_commerce.nav.slots',
      'govuk_alpha_commerce.nav.onboarding',
      'govuk_alpha_commerce.nav.coupons'
    ]) {
      expect(source).toContain(`t("${translationKey}")`);
    }

    expect(source).toContain('aria-label="{{ t("govuk_alpha_commerce.nav.heading") }}"');
    expect(source).not.toMatch(/>Browse<|>Saved<|>Offers<|>My orders<|>My collections<|>Sales<|>My listings<|>Sell an item<|>Pickup slots</);
  });

  it('matches Blade tab order and hides coupons when the tenant feature is disabled', () => {
    const enabledHtml = templateEnvironment.render('marketplace/_nav.njk', baseLocals('en', {
      activeTab: 'browse',
      marketplaceCouponsEnabled: true
    }));
    const disabledHtml = templateEnvironment.render('marketplace/_nav.njk', baseLocals('en', {
      activeTab: 'browse',
      marketplaceCouponsEnabled: false
    }));
    const orderedPaths = [
      '/marketplace',
      '/marketplace/saved',
      '/marketplace/offers',
      '/marketplace/orders',
      '/marketplace/pickups',
      '/marketplace/sales',
      '/marketplace/slots',
      '/marketplace/mine',
      '/marketplace/create',
      '/marketplace/onboarding',
      '/marketplace/coupons'
    ];

    let previousIndex = -1;
    for (const pathname of orderedPaths) {
      const currentIndex = enabledHtml.indexOf(`href="${pathname}"`);
      expect(currentIndex).toBeGreaterThan(previousIndex);
      previousIndex = currentIndex;
    }
    expect(disabledHtml).toContain('href="/marketplace/onboarding"');
    expect(disabledHtml).not.toContain('href="/marketplace/coupons"');
  });

  it('localizes error and notice headings in the shared status banner', () => {
    const source = templateSource('marketplace/_status-banner.njk');
    const translator = (key) => `translated:${key}`;
    const errorHtml = templateEnvironment.render('marketplace/_status-banner.njk', {
      status: { type: 'error', message: 'Example error' },
      t: translator
    });
    const successHtml = templateEnvironment.render('marketplace/_status-banner.njk', {
      status: { type: 'success', message: 'Example success' },
      t: translator
    });
    const exactSuccessHtml = templateEnvironment.render('marketplace/_status-banner.njk', {
      marketplaceStatusSuccessHeadingKey: 'states.success_title',
      status: { type: 'success', message: 'Example success' },
      t: translator
    });

    expect(source).toContain('t("govuk_alpha_commerce.common.error_title")');
    expect(source).toContain('marketplaceStatusSuccessHeadingKey or "govuk_alpha_commerce.common.notice_title"');
    expect(errorHtml).toContain('translated:govuk_alpha_commerce.common.error_title');
    expect(successHtml).toContain('translated:govuk_alpha_commerce.common.notice_title');
    expect(exactSuccessHtml).toContain('translated:states.success_title');
  });

  it('delegates the browse filter and navigation chrome to exact Laravel keys', () => {
    const source = templateSource('marketplace/index.njk');

    expect(source).toContain('{% include "marketplace/_nav.njk" %}');

    for (const translationKey of [
      'marketplace.caption',
      'polish_commerce.marketplace_filter_heading',
      'marketplace.search_hint',
      'polish_commerce.marketplace_category_label',
      'polish_commerce.marketplace_category_all',
      'polish_commerce.marketplace_filter_submit',
      'govuk_alpha_commerce.marketplace_advanced.title',
      'govuk_alpha_commerce.category.browse_heading'
    ]) {
      expect(source).toContain(`t("${translationKey}"`);
    }

    expect(source).not.toContain('>Filter listings<');
    expect(source).not.toContain('>Search by title.<');
    expect(source).not.toContain('>Apply filters<');
    expect(source).not.toContain('>Advanced search<');
    expect(source).not.toContain('>Browse by category<');
  });

  it('uses the shared Marketplace navigation on the listing form and exact Blade success headings', () => {
    const formSource = templateSource('marketplace/form.njk');
    expect(formSource).toContain('{% include "marketplace/_nav.njk" %}');
    for (const translationKey of [
      'govuk_alpha_commerce.common.back_to_my_listings',
      'govuk_alpha_commerce.common.error_title',
      'govuk_alpha_commerce.listing_form.caption',
      'govuk_alpha_commerce.listing_form.description',
      'govuk_alpha_commerce.listing_form.section_about',
      'govuk_alpha_commerce.listing_form.title_label',
      'govuk_alpha_commerce.listing_form.tagline_label',
      'govuk_alpha_commerce.listing_form.description_label',
      'govuk_alpha_commerce.listing_form.section_price',
      'govuk_alpha_commerce.listing_form.price_type_label',
      'govuk_alpha_commerce.listing_form.price_label',
      'govuk_alpha_commerce.listing_form.currency_label',
      'govuk_alpha_commerce.listing_form.time_credit_label',
      'govuk_alpha_commerce.listing_form.section_details',
      'govuk_alpha_commerce.listing_form.condition_label',
      'govuk_alpha_commerce.listing_form.category_label',
      'govuk_alpha_commerce.listing_form.delivery_label',
      'govuk_alpha_commerce.listing_form.location_label',
      'govuk_alpha_commerce.listing_form.quantity_label',
      'govuk_alpha_commerce.common.cancel'
    ]) {
      expect(formSource).toContain(`t("${translationKey}"`);
    }
    expect(formSource).not.toContain('enctype="multipart/form-data"');
    expect(formSource).not.toContain('name="image"');
    expect(formSource).not.toContain('group_exchanges.form_title_label');
    expect(formSource).not.toContain('jobs_t3.salary_type_none');
    expect(formSource).not.toContain('events.no_category');
    expect(formSource).not.toContain('polish_federation.transfer_cancel');

    for (const templateName of [
      'marketplace/slots.njk',
      'marketplace/slot-form.njk'
    ]) {
      expect(templateSource(templateName)).toContain(
        '{% set marketplaceStatusSuccessHeadingKey = "states.success_title" %}'
      );
    }

    for (const templateName of [
      'marketplace/onboarding.njk',
      'marketplace/coupons.njk',
      'marketplace/coupon-form.njk'
    ]) {
      const couponSource = templateSource(templateName);
      expect(couponSource).toContain('t("govuk_alpha.states.success_title")');
      expect(couponSource).toContain('t("govuk_alpha_commerce.common.error_title")');
      expect(couponSource).not.toContain('jobs_t3.');
      expect(couponSource).not.toContain('polish_federation.transfer_cancel');
    }
  });

  it.each([
    ['ga', 'ltr'],
    ['ar', 'rtl']
  ])('renders translated browse controls in %s with the correct direction', (locale, direction) => {
    const t = createTranslator(locale);
    const html = templateEnvironment.render('marketplace/index.njk', baseLocals(locale, {
      categories: [{ id: 9, name: 'Transport', slug: 'transport' }],
      categoryId: null,
      listings: [],
      query: '',
      status: null
    }));

    expect(html).toContain(`<html lang="${locale}" dir="${direction}" class="govuk-template">`);
    expect(html).toContain(t('polish_commerce.marketplace_filter_heading'));
    expect(html).toContain(t('polish_commerce.marketplace_category_label'));
    expect(html).toContain(t('polish_commerce.marketplace_filter_submit'));
    expect(html).toContain(t('marketplace.caption', { community: 'Test Community' }));
  });
});
