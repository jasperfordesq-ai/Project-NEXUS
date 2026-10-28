// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The Help Centre guides on the accessible site (26 Oct 2026).
 *
 * React has had built-in guides since 26 Sep 2026 (/help, /help/:audience,
 * /help/:audience/:section, /help/:audience/:section/:article); this frontend's
 * /help was only the community FAQ list. The guides are now generated from React's
 * own registries and locale files by scripts/build-help-guides.js.
 *
 * Pinned here:
 * - the generated copy matches React right now (fails when React changes and
 *   `npm --prefix web-uk run build:help` was not run);
 * - every path a guide links to has an explicit decision in the link map, and
 *   every accessible target in it is a real web-uk GET route;
 * - the pages render as GOV.UK pages, keep the community FAQ, apply the same
 *   feature / module / setting gates React applies, and render article bodies
 *   as escaped data with only HelpBody's constructs;
 * - a broker or admin guide about a panel this site lacks says it is done on the
 *   main website instead of linking to a missing page.
 */

const path = require('path');
const express = require('express');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

jest.mock('../src/lib/api', () => ({
  getHelpFaqs: jest.fn(),
  getExchangeConfig: jest.fn()
}));

const api = require('../src/lib/api');
const supportRoutes = require('../src/routes/support');
const { staleFiles } = require('../scripts/build-help-guides');
const { HELP_LINK_TARGETS, accessibleHelpLink } = require('../src/lib/help-guide-links');
const helpGuides = require('../src/lib/help-guides');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');

let currentTenant = {};
let signedInToken = null;

function createApp(locale = 'en') {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use((req, res, next) => {
    req.signedCookies = signedInToken ? { token: signedInToken } : {};
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'acme', tenant: currentTenant, prefix: '' };
    res.locals.urlFor = (value) => String(value || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: Boolean(signedInToken),
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: '/feedback',
      currentPath: req.path,
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      locale,
      htmlLang: locale,
      htmlDirection: locale === 'ar' ? 'rtl' : 'ltr',
      t: createTranslator(locale),
      tc: createChoiceTranslator(locale),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  }, supportRoutes);
  return app;
}

const en = require('../src/lib/generated/help-guides/en.json');
const ar = require('../src/lib/generated/help-guides/ar.json');

beforeEach(() => {
  currentTenant = {};
  signedInToken = null;
  api.getHelpFaqs.mockReset().mockResolvedValue({ data: [] });
  api.getExchangeConfig.mockReset().mockResolvedValue({ data: { exchange_workflow_enabled: true } });
});

describe('generated copy of the React guides', () => {
  it('is up to date with react-frontend (run `npm --prefix web-uk run build:help` if this fails)', () => {
    expect(staleFiles()).toEqual([]);
  });

  it('carries all three audiences in all eleven languages', () => {
    const { structure } = helpGuides;
    expect(structure.audiences).toEqual(['members', 'brokers', 'admins']);
    expect(structure.locales).toHaveLength(11);
    for (const audience of structure.audiences) {
      expect(structure.counts[audience].articles).toBeGreaterThan(0);
    }
  });
});

describe('link map', () => {
  it('has an explicit decision for every path a guide links to', () => {
    const missing = helpGuides.structure.linkPaths.filter(
      (reactPath) => !Object.prototype.hasOwnProperty.call(HELP_LINK_TARGETS, reactPath)
    );
    expect(missing).toEqual([]);
  });

  it('has no entry for a path no guide links to any more', () => {
    const used = new Set(helpGuides.structure.linkPaths);
    expect(Object.keys(HELP_LINK_TARGETS).filter((key) => !used.has(key))).toEqual([]);
  });

  it('points only at real web-uk GET routes', () => {
    jest.isolateModules(() => {
      const app = require('../src/server');
      const matches = (stack, target) => stack.some((layer) => {
        if (layer.route) return Boolean(layer.route.methods.get) && layer.match(target);
        if (layer.name === 'router' && layer.handle && layer.handle.stack && layer.match(target)) {
          return matches(layer.handle.stack, target.slice(layer.path.length) || '/');
        }
        return false;
      });
      // Control: the matcher must be able to say no.
      expect(matches(app._router.stack, '/definitely-not-a-page')).toBe(false);
      const targets = [...new Set(Object.values(HELP_LINK_TARGETS).filter(Boolean))];
      expect(targets.filter((target) => !matches(app._router.stack, target))).toEqual([]);
    });
  });

  it('never guesses a destination for an unknown path', () => {
    expect(accessibleHelpLink('/listings/create')).toBe('/listings/new');
    expect(accessibleHelpLink('/broker/members')).toBeNull();
    expect(accessibleHelpLink('/not-in-the-table')).toBeNull();
  });
});

describe('Help Centre pages', () => {
  it('shows the guides on /help and keeps the community FAQ', async () => {
    api.getHelpFaqs.mockResolvedValue({
      data: [{ category: 'Account help', faqs: [{ id: 1, question: 'How do I reset my password?', answer: '<p>Use the link.</p>' }] }]
    });
    const response = await request(createApp()).get('/help');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<h1 class="govuk-heading-xl">Help centre</h1>');
    expect(response.text).toContain(en.centre.sections_heading);
    expect(response.text).toContain(`href="/help/members/getting_started"`);
    expect(response.text).toContain(en.guides.members.getting_started.title);
    // Audience choice, with the current one marked.
    expect(response.text).toContain('href="/help/brokers"');
    expect(response.text).toContain('href="/help/admins"');
    expect(response.text).toMatch(/href="\/help" aria-current="page"/);
    // The community's own questions are still here.
    expect(response.text).toContain(en.centre.community_faqs_heading);
    expect(response.text).toContain('How do I reset my password?');
  });

  it('shows broker guides to anyone, as React does, without the community FAQ', async () => {
    const response = await request(createApp()).get('/help/brokers');
    expect(response.status).toBe(200);
    expect(response.text).toContain(`<h1 class="govuk-heading-xl">${en.centre.audience.brokers.title}</h1>`);
    expect(response.text).toContain('class="govuk-breadcrumbs"');
    expect(response.text).toContain('href="/help/brokers/broker_members"');
    expect(api.getHelpFaqs).not.toHaveBeenCalled();
  });

  it('sends /help/members and an unknown audience to the Help Centre home', async () => {
    const app = createApp();
    for (const target of ['/help/members', '/help/visitors']) {
      const response = await request(app).get(target);
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/help');
    }
  });

  it('lists a topic\'s guides on its section page', async () => {
    const response = await request(createApp()).get('/help/members/listings');
    expect(response.status).toBe(200);
    expect(response.text).toContain(`<h1 class="govuk-heading-xl">${en.guides.members.listings.title}</h1>`);
    expect(response.text).toContain('href="/help/members/listings/create_listing"');
    expect(response.text).toContain('href="/help"');
  });

  it('renders an article body as GOV.UK markup and maps its links', async () => {
    const response = await request(createApp()).get('/help/members/listings/create_listing');
    const article = en.guides.members.listings.articles.create_listing;

    expect(response.status).toBe(200);
    expect(response.text).toContain(`<h1 class="govuk-heading-xl">${article.title}</h1>`);
    expect(response.text).toContain('<ol class="govuk-list govuk-list--number">');
    expect(response.text).toContain('<strong>Create Listing</strong>');
    // [Listings](/listings) inside the body, and the "Go to this page" button,
    // which React points at /listings/create — here /listings/new.
    expect(response.text).toContain('<a class="govuk-link" href="/listings">Listings</a>');
    expect(response.text).toMatch(new RegExp(`href="/listings/new"[^>]*>${en.centre.open_page}</a>`));
    expect(response.text).toContain('class="govuk-pagination');
    expect(response.text).toContain(en.centre.in_this_section);
  });

  it('builds a contents list from the article headings and drops links to pages this site lacks', async () => {
    const response = await request(createApp()).get('/help/members/getting_started/using_on_your_phone');
    expect(response.status).toBe(200);
    expect(response.text).toContain('class="nexus-alpha-toc"');
    expect(response.text).toContain('href="#guide-section-1"');
    expect(response.text).toContain('id="guide-section-1"');
    // [Get the app](/install-app): no such page here, so plain words, no link and
    // no "Go to this page" button.
    expect(response.text).not.toContain('/install-app');
    expect(response.text).toContain('Get the app');
    expect(response.text).not.toContain(en.centre.open_page);
  });

  it('says a broker task is done on the main website rather than linking to the Broker Panel', async () => {
    const response = await request(createApp()).get('/help/brokers/broker_members/broker_approve_new_members');
    expect(response.status).toBe(200);
    expect(response.text).toContain('This is done on the main website.');
    expect(response.text).not.toMatch(/href="\/broker/);
  });

  it('hides guides for a feature the community has switched off', async () => {
    currentTenant = { features: { events: false } };
    const app = createApp();

    const home = await request(app).get('/help');
    expect(home.text).not.toContain('href="/help/members/events"');
    const section = await request(app).get('/help/members/events');
    expect(section.status).toBe(404);
    expect(section.text).toContain(en.centre.not_found_body);
    const article = await request(app).get('/help/members/events/events_finding');
    expect(article.status).toBe(404);

    currentTenant = { features: { events: true } };
    const shown = await request(createApp()).get('/help/members/events/events_finding');
    expect(shown.status).toBe(200);
  });

  it('applies the exchange workflow setting for a signed-in member, and treats it as on when unknown', async () => {
    // React's exchanges topic needs the exchange_workflow feature AND the Broker
    // Panel setting of the same name.
    const section = helpGuides.structure.registry.members.find((entry) => entry.id === 'exchanges');
    expect(JSON.stringify(section.gate)).toContain('"setting":"exchange_workflow"');
    const target = '/help/members/exchanges';

    expect((await request(createApp()).get(target)).status).toBe(200);
    expect(api.getExchangeConfig).not.toHaveBeenCalled();

    signedInToken = 'member-token';
    api.getExchangeConfig.mockResolvedValue({ data: { exchange_workflow_enabled: false } });
    expect((await request(createApp()).get(target)).status).toBe(404);
    expect(api.getExchangeConfig).toHaveBeenCalledWith('member-token');

    api.getExchangeConfig.mockRejectedValue(new Error('offline'));
    expect((await request(createApp()).get(target)).status).toBe(200);
  });

  it('searches the guides and the community questions together', async () => {
    const response = await request(createApp()).get('/help?q=create%20listing');
    expect(response.status).toBe(200);
    expect(response.text).toContain('href="/help/members/listings/create_listing"');
    expect(api.getHelpFaqs).toHaveBeenCalledWith({ q: 'create listing' });
  });

  it('serves the guides in the reader\'s language', async () => {
    const response = await request(createApp('ar')).get('/help/members/listings/create_listing');
    expect(response.status).toBe(200);
    expect(response.text).toContain(ar.guides.members.listings.articles.create_listing.title);
    expect(response.text).toContain(ar.centre.open_page);
  });
});

describe('article body format', () => {
  it('turns text into escaped data, never HTML', async () => {
    const blocks = helpGuides.renderableBody('Hi <script>alert(1)</script> **bold** [x](https://evil.example) [y](/wallet)\n\n> tip\n- one\n- two');
    expect(blocks[0].tokens).toEqual([
      { type: 'text', text: 'Hi <script>alert(1)</script> ' },
      { type: 'bold', text: 'bold' },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'x' },
      { type: 'text', text: ' ' },
      { type: 'link', text: 'y', href: '/wallet' }
    ]);
    expect(blocks[1].kind).toBe('tip');
    expect(blocks[2]).toEqual({ kind: 'bullet', items: [[{ type: 'text', text: 'one' }], [{ type: 'text', text: 'two' }]] });

    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader([VIEWS, GOVUK]), { autoescape: true });
    registerTemplateFilters(env);
    const t = createTranslator('en');
    const html = env.render('support/help-article.njk', {
      t,
      tc: createChoiceTranslator('en'),
      urlFor: (value) => value,
      ct: (key) => key,
      crumbs: [],
      sectionTitle: 'Section',
      article: { title: 'T', summary: 'S', body: blocks, headings: [], link: null, mainWebsiteOnly: false },
      others: [],
      alphaNavItems: [],
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: []
    });
    expect(html).toContain('Hi &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('evil.example');
    expect(html).toContain('<div class="govuk-inset-text">tip</div>');
  });
});
