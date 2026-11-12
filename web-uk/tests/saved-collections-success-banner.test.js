// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A success banner on the saved-collections pages must not be headed
 * "There is a problem". Both pages headed their green "Collection created" /
 * "Item removed" banners with the error summary's title, so a screen reader
 * announced a problem for every success. The thank-you notes page had the same
 * fault and was fixed on 12 Nov 2026; these two pages were found in the
 * Warmth Phase 5 audit (12 Nov 2026).
 */

const path = require('path');
const nunjucks = require('nunjucks');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');

function render(view, context) {
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader([VIEWS, GOVUK]), { autoescape: true });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  return env.render(view, {
    urlFor: (value) => value,
    serviceName: 'Project NEXUS',
    tenantName: 'Acme Timebank',
    tenant: { id: 2, slug: 'acme', name: 'Acme Timebank' },
    isAuthenticated: true,
    csrfToken: 'test-csrf-token',
    alphaNavItems: [],
    feedbackUrl: '/feedback',
    currentPath: '/me/collections',
    alphaLocaleOptions: [],
    alphaLanguageQueryParams: [],
    htmlLang: 'en',
    htmlDirection: 'ltr',
    t,
    tc: createChoiceTranslator('en'),
    formatLocaleNumber: (value) => String(value ?? ''),
    formatLocaleDate: (value) => String(value ?? ''),
    ...context
  });
}

const PROBLEM = t('govuk_alpha_saved.errors.summary_title');
const SUCCESS = t('states.success_title');

describe('saved collections: success banners say success', () => {
  test.each([
    ['collection-created', 'govuk_alpha_saved.status.collection_created'],
    ['collection-updated', 'govuk_alpha_saved.status.collection_updated'],
    ['collection-deleted', 'govuk_alpha_saved.status.collection_deleted']
  ])('the collections list, status %s', (status, key) => {
    const html = render('saved-collections/index.njk', {
      title: 'Collections',
      collections: [],
      collectionForm: null,
      status
    });

    expect(html).toContain('govuk-notification-banner--success');
    expect(html).toContain(t(key));
    expect(html).toContain(`id="saved-collections-status-title">${SUCCESS}<`);
    expect(html).not.toContain(PROBLEM);
  });

  test.each([
    ['item-removed', 'govuk_alpha_saved.status.item_removed'],
    ['collection-updated', 'govuk_alpha_saved.status.collection_updated']
  ])('a collection, status %s', (status, key) => {
    const html = render('saved-collections/detail.njk', {
      title: 'Garden',
      collection: { id: 4, name: 'Garden', description: '', isPublic: false, itemsCount: 0, userId: 77 },
      items: [],
      meta: { last_page: 1 },
      currentPage: 1,
      lastPage: 1,
      isOwner: true,
      status
    });

    expect(html).toContain('govuk-notification-banner--success');
    expect(html).toContain(t(key));
    expect(html).toContain(`id="saved-detail-status-title">${SUCCESS}<`);
    expect(html).not.toContain(PROBLEM);
  });

  test('a real problem on the list is still headed "There is a problem"', () => {
    const html = render('saved-collections/index.njk', {
      title: 'Collections',
      collections: [],
      collectionForm: null,
      status: 'collection-failed'
    });

    expect(html).toContain('govuk-error-summary');
    expect(html).toContain(PROBLEM);
  });
});
