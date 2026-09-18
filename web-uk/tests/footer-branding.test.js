// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const nunjucks = require('nunjucks');
const path = require('path');

const {
  buildShellLocals,
  resolveBrandingImageUrl
} = require('../src/lib/accessible-shell');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
const govukViewsDirectory = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const templateEnvironment = nunjucks.configure([viewsDirectory, govukViewsDirectory], {
  autoescape: true,
  noCache: true
});
require('../src/lib/template-filters').registerTemplateFilters(templateEnvironment);

function shellRequest(tenantConfig = {}) {
  return {
    query: {},
    path: '/listings',
    originalUrl: '/acme/accessible/listings',
    accessibleRouting: {
      tenant: {
        name: 'Acme Timebank',
        slug: 'acme',
        config: tenantConfig
      },
      tenantSlug: 'acme',
      prefix: '/acme/accessible'
    }
  };
}

function renderFooter(overrides = {}) {
  return templateEnvironment.render('partials/footer.njk', {
    alphaFooterColumns: [],
    csrfToken: 'test-csrf',
    isAuthenticated: false,
    t: createTranslator('en'),
    tc: createChoiceTranslator('en'),
    tenantName: 'Acme Timebank',
    tenantSlug: 'acme',
    urlFor: (pathname) => pathname,
    platformName: 'Project NEXUS',
    docsUrl: 'https://docs.project-nexus.ie/',
    ...overrides
  });
}

describe('footer branding locals', () => {
  it('falls back to the built-in powered-by badge and marketing URL', () => {
    const locals = buildShellLocals(shellRequest(), false);

    expect(locals.poweredByImageUrl).toBe('/images/powered-by-nexus-light.png');
    expect(locals.poweredByUrl).toBe('https://project-nexus.net');
  });

  it('🔴 uses the LIGHT badge even when a dark one is configured', () => {
    // govuk-footer is light grey and this frontend has no dark mode, so the dark
    // asset — artwork for a dark background — would fail contrast here. See the
    // comment block in accessible-shell.js.
    const locals = buildShellLocals(shellRequest({
      powered_by_image_light: '/uploads/branding/badge-light.png',
      powered_by_image_dark: '/uploads/branding/badge-dark.png'
    }), false);

    expect(locals.poweredByImageUrl).toContain('badge-light.png');
    expect(locals.poweredByImageUrl).not.toContain('badge-dark.png');
  });

  it('honours a community override of the badge URL and label', () => {
    const locals = buildShellLocals(shellRequest({
      powered_by_url: 'https://example.org/about',
      powered_by_label: 'Built by Acme'
    }), false);

    expect(locals.poweredByUrl).toBe('https://example.org/about');
    expect(locals.poweredByLabel).toBe('Built by Acme');
  });

  it('leaves the partner logo empty when the community has not set one', () => {
    const locals = buildShellLocals(shellRequest(), false);

    expect(locals.partnerLogoUrl).toBe('');
    expect(locals.partnerLogoLabel).toBe('');
    expect(locals.partnerLogoLinkUrl).toBe('');
  });

  it('carries the partner logo, label and link when configured', () => {
    const locals = buildShellLocals(shellRequest({
      partner_logo_url: '/uploads/branding/council.png',
      partner_logo_label: 'Coventry City Council',
      partner_logo_link_url: 'https://coventry.gov.uk'
    }), false);

    expect(locals.partnerLogoUrl).toContain('council.png');
    expect(locals.partnerLogoLabel).toBe('Coventry City Council');
    expect(locals.partnerLogoLinkUrl).toBe('https://coventry.gov.uk');
  });

  it('reads the platform version from the API bootstrap config', () => {
    const locals = buildShellLocals(shellRequest({ platform_version: '2.0.0' }), false);

    expect(locals.platformVersion).toBe('2.0.0');
  });

  it('leaves the platform version empty when the API did not supply one', () => {
    expect(buildShellLocals(shellRequest(), false).platformVersion).toBe('');
  });
});

describe('resolveBrandingImageUrl', () => {
  it('🔴 keeps a built-in default path local to this frontend', () => {
    // The regression this guards: resolving it against the API origin sends the
    // browser to the API host for a file that only exists in web-uk/public,
    // breaking the badge for every community that has not uploaded its own.
    expect(resolveBrandingImageUrl('/images/powered-by-nexus-light.png'))
      .toBe('/images/powered-by-nexus-light.png');
  });

  it('points an admin upload at the API origin', () => {
    expect(resolveBrandingImageUrl('/uploads/branding/badge.png'))
      .toMatch(/^https?:\/\/.+\/uploads\/branding\/badge\.png$/);
  });

  it('rejects an off-origin absolute URL', () => {
    // A tenant admin must not be able to aim the footer at a third-party host and
    // leak every viewer's IP address to it.
    expect(resolveBrandingImageUrl('https://tracker.example.com/pixel.png')).toBe('');
  });

  it('returns empty for no value', () => {
    expect(resolveBrandingImageUrl('')).toBe('');
    expect(resolveBrandingImageUrl(null)).toBe('');
    expect(resolveBrandingImageUrl(undefined)).toBe('');
  });
});

describe('footer branding markup', () => {
  it('renders the powered-by badge as a link with an accessible name', () => {
    const html = renderFooter({
      poweredByImageUrl: '/images/powered-by-nexus-light.png',
      poweredByUrl: 'https://project-nexus.net'
    });

    expect(html).toContain('href="https://project-nexus.net"');
    expect(html).toContain('src="/images/powered-by-nexus-light.png"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toMatch(/alt="[^"]+"/);
  });

  it('🔴 never uses the GOV.UK crown copyright logo class', () => {
    // govuk-footer__copyright-logo::before sets background-image: govuk-crest.svg.
    // Reusing the class for our own badge would render the GOV.UK crown, which this
    // service is forbidden from displaying.
    const html = renderFooter({
      poweredByImageUrl: '/images/powered-by-nexus-light.png',
      poweredByUrl: 'https://project-nexus.net'
    });

    expect(html).not.toContain('govuk-footer__copyright-logo');
    expect(html).not.toContain('govuk-crest');
  });

  it('renders the partner logo with its label when configured', () => {
    const html = renderFooter({
      partnerLogoUrl: 'https://api.example.test/uploads/branding/council.png',
      partnerLogoLabel: 'Coventry City Council',
      partnerLogoLinkUrl: 'https://coventry.gov.uk'
    });

    expect(html).toContain('council.png');
    expect(html).toContain('Coventry City Council');
    expect(html).toContain('href="https://coventry.gov.uk"');
  });

  it('renders the partner logo unlinked when no link is configured', () => {
    const html = renderFooter({
      partnerLogoUrl: 'https://api.example.test/uploads/branding/council.png',
      partnerLogoLabel: 'Coventry City Council'
    });

    expect(html).toContain('council.png');
    expect(html).not.toContain('href="https://coventry.gov.uk"');
  });

  it('renders the empty-slot placeholder when there is no partner logo', () => {
    // Replicating the React footer, which draws the slot so a community can see
    // where its logo would go. It is plain text under the heading rather than a
    // decorative box, so it announces as "Community Partner — Your logo here".
    const html = renderFooter();

    expect(html).toContain('Your logo here');
    expect(html).toContain('nexus-alpha-footer__brand-plate--empty');
    expect(html).not.toContain('<img');
  });

  it('appends the platform version to the release stage', () => {
    const html = renderFooter({ platformVersion: '2.0.0' });

    expect(html).toContain('Generally Available');
    expect(html).toContain('(v2.0.0)');
    expect(html).toContain('Always evolving.');
  });

  it('🔴 omits only the version number, not the whole line, when none is available', () => {
    // A blank or stale number is worse than none, but the Features and
    // Documentation links are still worth having when the API hiccups.
    const html = renderFooter();

    expect(html).toContain('Generally Available');
    expect(html).not.toContain('(v)');
    expect(html).toContain('Always evolving.');
  });

  it('🔴 never bakes a version number into a translation', () => {
    // The React frontend puts the number inside its release_stage string, which is
    // why check-version-consistency.mjs has to police eleven locale files for it.
    // Composing it from the API value makes that class of drift impossible.
    const en = require('../src/lib/localization/generated/en.json');
    const stage = en.namespaces.govuk_alpha.release_status.stage;

    expect(stage).toBe('Generally Available');
    expect(stage).not.toMatch(/\d+\.\d+\.\d+/);
  });

  it('renders the three brand headings in React’s order', () => {
    const html = renderFooter({ poweredByImageUrl: '/images/powered-by-nexus-light.png' });

    const partner = html.indexOf('Community Partner');
    const openSource = html.indexOf('Open Source');
    const poweredBy = html.indexOf('Powered by');

    expect(partner).toBeGreaterThan(-1);
    expect(openSource).toBeGreaterThan(partner);
    expect(poweredBy).toBeGreaterThan(openSource);
  });

  it('renders the source repository as a named card, not a sentence', () => {
    const html = renderFooter();

    expect(html).toContain('Project NEXUS');
    expect(html).toContain('GitHub repo');
    expect(html).toContain('github.com/jasperfordesq-ai/Project-NEXUS');
    // The old wording stacked full sentences; those are what made the footer repeat
    // itself. They must not come back.
    expect(html).not.toContain('is built in the open');
    expect(html).not.toContain('See NOTICE for attribution');
  });

  it('🔴 keeps the AGPL Section 7(b) attribution', () => {
    // Required on every page. The wording is now the compact React one, but the
    // licence and the copyright holder must both still be named.
    const html = renderFooter();

    expect(html).toContain('Jasper Ford');
    expect(html).toContain('AGPL-3.0');
    expect(html).toContain('2024–2026');
  });

  it('shows the community copyright line, overridable by the community', () => {
    expect(renderFooter()).toContain('Acme Timebank — AGPL-3.0');
    expect(renderFooter({ tenantFooterText: 'Acme, a registered charity' }))
      .toContain('Acme, a registered charity');
  });

  it('🔴 links Features and Documentation but never Changelog', () => {
    // The accessible site has a Features page; it has no Changelog page yet, and a
    // footer link to a 404 on eleven live community sites is worse than no link.
    const html = renderFooter();

    expect(html).toContain('Features');
    expect(html).toContain('Documentation');
    expect(html).toContain('docs.project-nexus.ie');
    expect(html).not.toContain('Changelog');
    expect(html).not.toContain('/changelog');
  });

  it('🔴 links to cookie settings exactly once', () => {
    // It used to appear both in the inline help list and in the copyright strip.
    // Two identical links six lines apart is the duplication this rebuild removes.
    const html = renderFooter();
    const cookieLinks = html.match(/>Cookies</g) || [];

    expect(cookieLinks).toHaveLength(1);
  });

  it('keeps the WCAG 3.2.6 consistent-help link', () => {
    // A help mechanism must stay in the same relative place on every page.
    expect(renderFooter()).toContain('/report-a-problem');
  });

  it('opens only the external documentation link in a new tab, and says so', () => {
    const html = renderFooter();
    const newTabs = html.match(/target="_blank"/g) || [];

    expect(newTabs).toHaveLength(1);
    expect(html).toContain('Documentation (opens in a new tab)');
  });
});
