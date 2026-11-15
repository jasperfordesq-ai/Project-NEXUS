// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Warmth phase 6, E8 (first-time half): when a member shares their very first
 * offer or request, the create response says so (`meta.celebrate:
 * "first_listing"`, App\Support\FirstTimeCelebration) and the React site
 * celebrates (components/feedback/CelebrationHost.tsx). Here the listing page
 * opens with a GOV.UK confirmation panel instead of the usual success banner.
 */

const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');
const { listingCreatedStatus } = require('../src/lib/first-time');
const { createTranslator } = require('../src/lib/localization');

describe('the status a new offer or request is shown with', () => {
  it('is "listing-created-first" only when the server says it is the first', () => {
    expect(listingCreatedStatus({ data: { id: 5 }, meta: { celebrate: 'first_listing' } })).toBe('listing-created-first');
    expect(listingCreatedStatus({ data: { id: 5 }, meta: {} })).toBe('listing-created');
    expect(listingCreatedStatus({ data: { id: 5 }, meta: { celebrate: 'first_event' } })).toBe('listing-created');
    expect(listingCreatedStatus({ data: { id: 5 } })).toBe('listing-created');
    expect(listingCreatedStatus(null)).toBe('listing-created');
  });

  it('is used by the create route', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'listings.js'), 'utf8');
    expect(source).toMatch(/\?status=\$\{listingCreatedStatus\(result\)\}/);
  });
});

describe('the confirmation panel', () => {
  const VIEWS = path.join(__dirname, '..', 'src', 'views');
  const environment = new nunjucks.Environment(
    new nunjucks.FileSystemLoader([VIEWS, path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')]),
    { autoescape: true }
  );
  const render = (status, locale = 'en') => environment.renderString(
    '{% include "partials/first-time-panel.njk" %}',
    { status, t: createTranslator(locale) }
  );

  it('thanks the member for their first offer or request, as a level-2 heading (the page has its own h1)', () => {
    const html = render('listing-created-first');
    expect(html).toContain('govuk-panel govuk-panel--confirmation');
    expect(html).toMatch(/<h2 class="govuk-panel__title">\s*Your first offer or request is up!\s*<\/h2>/);
    expect(html).toContain('Thank you for joining in. Your neighbours can now find it.');
  });

  it('is in every language', () => {
    for (const locale of ['ar', 'de', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt']) {
      const html = render('listing-created-first', locale);
      expect([locale, html.includes('Your first offer or request is up!')]).toEqual([locale, false]);
      expect([locale, html.includes('govuk-panel__title')]).toEqual([locale, true]);
    }
  });

  it('is not shown for any other status', () => {
    for (const status of ['listing-created', 'listing-updated', '', undefined]) {
      expect(render(status)).not.toContain('govuk-panel');
    }
  });

  it('replaces the success banner on the listing page', () => {
    const detail = fs.readFileSync(path.join(VIEWS, 'listings', 'detail.njk'), 'utf8');
    expect(detail).toContain('{% include "partials/first-time-panel.njk" %}');
  });
});
