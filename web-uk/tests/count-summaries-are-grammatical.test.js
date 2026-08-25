// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A count of exactly ONE must not be read out with a plural noun (2026-08-25).
 *
 * Found by walking My network as a member with one connection: the page said
 * "You have 1 connections, 1 requests waiting for your reply and 0 requests you
 * have sent." Wrong in English, and NOT fixable by pluralising the string —
 * Laravel's choice syntax (`{0}…|{1}…|[2,*]…`, the shape this repository uses
 * everywhere) selects on ONE count, and that sentence carried three.
 *
 * The fix is label-and-value pairs, which agree with nothing and are therefore
 * correct in all eleven languages while adding no new strings to translate.
 *
 * This RENDERS the real template with the real English catalogue rather than
 * asserting on source: the failure worth catching is prose that reads wrongly,
 * and only a render can show that.
 */

const nunjucks = require('nunjucks');
const path = require('path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

const env = nunjucks.configure(
  [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);
registerTemplateFilters(env);

const shell = {
  // The REAL catalogue, so a reintroduced prose sentence renders its real words.
  t: createTranslator('en'),
  tc: createChoiceTranslator('en'),
  urlFor: (pathname) => pathname,
  formatLocaleNumber: (value) => String(value),
  formatLocaleDate: (value) => String(value ?? ''),
  isAuthenticated: true,
  tenantName: 'Acme Timebank',
  serviceName: 'Project NEXUS Accessible',
  communityName: 'Acme Timebank',
  alphaNavItems: [],
  alphaFooterColumns: [],
  alphaLocaleOptions: [],
  alphaLanguageQueryParams: [],
  alphaCurrentLocale: 'en',
  htmlLang: 'en',
  htmlDirection: 'ltr',
  csrfToken: 'test-csrf'
};

function visibleText(html) {
  const main = /<main[\s\S]*?<\/main>/.exec(html);
  return (main ? main[0] : html)
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function renderNetwork(counts) {
  return env.render('connections/network.njk', {
    ...shell,
    activeTab: 'accepted',
    tabHrefs: {
      accepted: '/connections/network?tab=accepted',
      pending_received: '/connections/network?tab=pending_received',
      pending_sent: '/connections/network?tab=pending_sent'
    },
    countLabels: { accepted: String(counts.accepted), received: String(counts.received), sent: String(counts.sent) },
    sections: {
      accepted: { items: [], total: counts.accepted },
      pending_received: { items: [], total: counts.received },
      pending_sent: { items: [], total: counts.sent }
    }
  });
}

describe('My network states its counts without a plural disagreement', () => {
  it('never says "1 connections" or "1 requests"', () => {
    const text = visibleText(renderNetwork({ accepted: 1, received: 1, sent: 1 }));

    expect(text).not.toMatch(/\b1 connections\b/);
    expect(text).not.toMatch(/\b1 requests\b/);
    // The exact sentence that produced it, so a revert is caught by name.
    expect(text).not.toContain('You have 1 connections');
  });

  it('still reports all three counts, as labelled values', () => {
    const text = visibleText(renderNetwork({ accepted: 1, received: 4, sent: 0 }));

    // Label immediately followed by its value — the summary list.
    expect(text).toMatch(/My connections 1\b/);
    expect(text).toMatch(/Pending requests 4\b/);
    expect(text).toMatch(/Sent requests 0\b/);
  });

  it('reports zero counts too, rather than hiding the summary', () => {
    const text = visibleText(renderNetwork({ accepted: 0, received: 0, sent: 0 }));

    expect(text).toMatch(/My connections 0\b/);
    expect(text).toMatch(/Pending requests 0\b/);
    expect(text).toMatch(/Sent requests 0\b/);
  });

  it('uses labels from the catalogue, so every locale gets its own words', () => {
    const html = renderNetwork({ accepted: 1, received: 0, sent: 0 });

    // A raw key in the output means the template hardcoded or mistyped one.
    expect(html).not.toMatch(/govuk_alpha_connections\.[a-z_.]+/);
    expect(html).toContain('govuk-summary-list__key');
  });
});
