// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * What a signed-out visitor is told about pages that need a sign-in
 * (owner, 13 Nov 2026).
 *
 * Checked on the live site before this was written: the header menu and the
 * footer offered Feed, Listings, Members, Events, Volunteering and Knowledge
 * base with nothing to say they need a sign-in; the home page tagged five of
 * them "Available"; and the Listings page answered a visitor with "There is a
 * problem. Listings could not be loaded. Try again." — an error for what is a
 * rule, and advice that could never work.
 */

const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  ApiOfflineError: class ApiOfflineError extends Error {},
  getListings: jest.fn(),
  getListingCategories: jest.fn()
}));

const api = require('../src/lib/api');
const {
  buildFooterColumns,
  buildNavItems,
  buildShellLocals
} = require('../src/lib/accessible-shell');
const { buildHomeModules } = require('../src/lib/home-modules');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
const govukViewsDirectory = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const templateEnvironment = nunjucks.configure([viewsDirectory, govukViewsDirectory], {
  autoescape: true,
  noCache: true
});
require('../src/lib/template-filters').registerTemplateFilters(templateEnvironment);

const t = createTranslator('en');
const HIDDEN_WORDS = t('home.module_signin_hint');

const everythingOn = {
  name: 'Acme Timebank',
  slug: 'acme',
  modules: { dashboard: true, feed: true, listings: true, wallet: true },
  features: { connections: true, events: true, volunteering: true, blog: true, direct_messaging: true }
};

function shellRequest(tenant = everythingOn) {
  return {
    query: {},
    path: '/',
    originalUrl: '/acme/accessible',
    accessibleRouting: { tenant, tenantSlug: 'acme', prefix: '/acme/accessible' }
  };
}

function pageLocals(isAuthenticated, extra = {}) {
  return {
    ...buildShellLocals(shellRequest(), isAuthenticated),
    t,
    tc: createChoiceTranslator('en'),
    csrfToken: 'test-csrf',
    ...extra
  };
}

/** The `<a>` whose href is exactly `href`, with everything inside it. */
function linkTo(html, href) {
  const match = new RegExp(`<a[^>]*href="${href.replace(/[/?]/g, '\\$&')}"[^>]*>([\\s\\S]*?)</a>`).exec(html);
  return match ? match[0] : null;
}

const lockedKeys = (items) => items.filter((item) => item.locked).map((item) => item.key);

describe('which header links are locked for a visitor', () => {
  it('locks every member page a visitor is offered, and nothing a visitor can open', () => {
    const items = buildNavItems({ isAuthenticated: false, tenant: everythingOn });
    expect(items.map((item) => item.key)).toEqual(['home', 'feed', 'listings', 'members', 'events', 'volunteering']);
    expect(lockedKeys(items)).toEqual(['feed', 'listings', 'members', 'events', 'volunteering']);
  });

  it("leaves What's on unlocked: it is the open twin of Events", () => {
    const tenant = { ...everythingOn, features: { ...everythingOn.features, public_events: true } };
    const items = buildNavItems({ isAuthenticated: false, tenant });
    expect(items.map((item) => item.key)).toContain('whats_on');
    expect(lockedKeys(items)).not.toContain('whats_on');
    expect(lockedKeys(items)).not.toContain('home');
  });

  it('locks nothing for a signed-in member', () => {
    expect(lockedKeys(buildNavItems({ isAuthenticated: true, tenant: everythingOn }))).toEqual([]);
  });
});

describe('which footer links are locked for a visitor', () => {
  const column = (columns, key) => columns.find((entry) => entry.key === key);

  it('locks the member pages in the Platform column, and Blog stays open', () => {
    const columns = buildFooterColumns({ tenant: everythingOn, isAuthenticated: false });
    expect(lockedKeys(column(columns, 'platform').links)).toEqual(['listings', 'members', 'events', 'volunteering']);
  });

  it('locks Knowledge base and nothing else in Support; nothing in Legal', () => {
    const columns = buildFooterColumns({ tenant: everythingOn, isAuthenticated: false });
    expect(lockedKeys(column(columns, 'support').links)).toEqual(['kb']);
    expect(lockedKeys(column(columns, 'legal').links)).toEqual([]);
  });

  it('locks nothing for a signed-in member', () => {
    const columns = buildFooterColumns({ tenant: everythingOn, isAuthenticated: true });
    expect(columns.flatMap((entry) => lockedKeys(entry.links))).toEqual([]);
  });

  it('treats a caller that does not say who is looking as a visitor', () => {
    // The safe default: a padlock too many is a nuisance, a missing one is the bug.
    const columns = buildFooterColumns({ tenant: everythingOn });
    expect(lockedKeys(column(columns, 'platform').links)).toContain('members');
  });
});

describe('the padlock as a visitor meets it', () => {
  it('is drawn beside each locked footer link, with words for a screen reader', () => {
    const html = templateEnvironment.render('partials/footer.njk', pageLocals(false));

    for (const page of ['listings', 'members', 'events', 'volunteering', 'kb']) {
      const link = linkTo(html, `/acme/accessible/${page}`);
      expect(link).not.toBeNull();
      expect(link).toContain('nexus-alpha-lock');
      expect(link).toContain('aria-hidden="true"');
      // The leading space is the pause between the label and the words.
      expect(link).toContain(`<span class="govuk-visually-hidden"> ${HIDDEN_WORDS}</span>`);
      // No space between the label and the padlock: it would be underlined.
      expect(link).toMatch(/[^\s>]<svg class="nexus-alpha-lock"/);
    }
  });

  it('is absent from the footer links a visitor can open', () => {
    const html = templateEnvironment.render('partials/footer.njk', pageLocals(false));

    for (const page of ['blog', 'help', 'contact', 'about', 'legal/terms', 'accessibility']) {
      const link = linkTo(html, `/acme/accessible/${page}`);
      expect(link).not.toBeNull();
      expect(link).not.toContain('nexus-alpha-lock');
    }
  });

  it('is drawn beside each locked header link and not beside Home, Sign in or Register', () => {
    const html = templateEnvironment.render('home.njk', pageLocals(false, {
      modules: [], communityName: 'Acme Timebank', networkCommunities: [], stats: {}
    }));
    const menu = html.slice(html.indexOf('id="alpha-navigation"'), html.indexOf('</nav>', html.indexOf('id="alpha-navigation"')));

    for (const page of ['feed', 'listings', 'members', 'events', 'volunteering']) {
      const link = linkTo(menu, `/acme/accessible/${page}`);
      expect(link).not.toBeNull();
      expect(link).toContain('nexus-alpha-lock');
      expect(link).toContain(HIDDEN_WORDS);
    }
    for (const page of ['', '/login', '/register']) {
      const link = linkTo(menu, `/acme/accessible${page}`);
      expect(link).not.toBeNull();
      expect(link).not.toContain('nexus-alpha-lock');
    }
  });

  it('never appears for a signed-in member, in the header or the footer', () => {
    const html = templateEnvironment.render('home.njk', pageLocals(true, {
      modules: [], communityName: 'Acme Timebank', networkCommunities: [], stats: {}
    }));
    expect(html).toContain('/acme/accessible/members');
    expect(html).not.toContain('nexus-alpha-lock');
  });
});

describe('the home page cards', () => {
  const card = (modules, key) => modules.find((module) => module.key === key);

  it('no longer call a members-only page "Available" to a visitor', () => {
    const modules = buildHomeModules(everythingOn, false, t);

    for (const key of ['feed', 'listings', 'members', 'events', 'volunteering']) {
      expect(card(modules, key)).toMatchObject({ available: false, needsSignIn: true, linked: true });
      expect(card(modules, key).href).toBe('/login?status=auth-required');
    }
  });

  it('call them Available, at their own address, once the member has signed in', () => {
    const modules = buildHomeModules(everythingOn, true, t);

    for (const key of ['feed', 'listings', 'members', 'events', 'volunteering']) {
      expect(card(modules, key)).toMatchObject({ available: true, needsSignIn: false, href: `/${key}` });
    }
  });

  it('still say "Not available" for a page the community has switched off', () => {
    const tenant = { ...everythingOn, features: { ...everythingOn.features, events: false } };
    expect(card(buildHomeModules(tenant, false, t), 'events')).toMatchObject({ available: false, needsSignIn: false, linked: false });
  });
});

describe('the Listings page for a visitor', () => {
  function listingsApp({ token = '' } = {}) {
    const app = express();
    app.use((req, res, next) => {
      req.accessibleRouting = { tenantSlug: 'acme', tenant: everythingOn };
      req.signedCookies = token ? { token } : {};
      res.locals.t = (key) => key;
      res.locals.locale = 'en';
      res.locals.isAuthenticated = Boolean(token);
      res.render = (view, locals) => res.json({ view, locals });
      next();
    });
    app.use('/listings', require('../src/routes/listings'));
    return app;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not ask the server for a list it will be refused, and reports no error', async () => {
    const response = await request(listingsApp()).get('/listings');

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('listings/index');
    expect(api.getListings).not.toHaveBeenCalled();
    expect(api.getListingCategories).not.toHaveBeenCalled();
    expect(response.body.locals).toMatchObject({ requiresAuth: true, loadError: false, isAuthenticated: false });
  });

  it('says "sign in", not "there is a problem", and offers no search that cannot work', () => {
    const html = templateEnvironment.render('listings/index.njk', pageLocals(false, {
      listings: [], categories: [], pagination: { total: 0 }, nextHref: null,
      filters: { search: '', type: '', categoryId: null, hours: 'any', service: 'any', posted: 'any', sort: 'newest', near: 'any' },
      hasFilters: false, currentUser: {}, requiresAuth: true, loadError: false, status: ''
    }));
    const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));

    expect(main).toContain(t('states.auth_required'));
    expect(main).toContain(t('states.important'));
    expect(main).toContain('href="/acme/accessible/login"');
    expect(main).toContain('href="/acme/accessible/register"');
    expect(main).not.toContain(t('states.error_title'));
    expect(main).not.toContain(t('listings.error_detail'));
    expect(main).not.toContain('govuk-error-summary');
    expect(main).not.toContain('<form');
    expect(main).not.toContain(t('states.empty_title'));
  });
});

describe('the Feed page for a visitor', () => {
  it('asks for a sign-in under "Important", not "There is a problem"', () => {
    const html = templateEnvironment.render('feed/index.njk', pageLocals(false, {
      communityName: 'Acme Timebank', requiresAuth: true, posts: [], items: [], filters: {}, pagination: {}
    }));
    const start = html.indexOf('feed-auth-required-title');
    const banner = html.slice(html.lastIndexOf('<div class="govuk-notification-banner"', start), html.indexOf('govuk-button-group', start));

    expect(banner).toContain(t('states.auth_required'));
    expect(banner).toContain(t('states.important'));
    expect(banner).not.toContain(t('states.error_title'));
  });
});
