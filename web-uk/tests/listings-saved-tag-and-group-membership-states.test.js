// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Three defects found by WALKING the listings and groups journeys on 2026-08-24.
 *
 * 1. SAVING A LISTING SHOWED UP ON EXACTLY ONE PAGE. The listings LIST decided
 *    which rows get a "Saved" tag by reading BOOKMARKS, while the listing's own
 *    Save button writes a FAVOURITE (POST /v2/listings/{id}/save ->
 *    user_saved_listings, gated by listing.enable_favourites). Two different
 *    features sharing one word: pressing Save flipped the button to "Unsave" and
 *    changed nothing on the list the member came from. Measured live — button
 *    said "unsave", list tag absent. The list payload already reports
 *    `is_favorited` per row, which is what the detail page and the React app use.
 *
 * 2. A NON-MEMBER WAS TOLD THEIR JOIN REQUEST WAS AWAITING APPROVAL. The group
 *    discussions page showed the pending-approval message to anyone who was not
 *    a member, so somebody who had never asked to join was told an admin was
 *    reviewing their request — which could stop them joining at all.
 *    `detail.njk` already guards that message with `isPending`.
 *
 * 3. REQUESTING TO JOIN AN APPROVAL-ONLY GROUP SAID "You have joined the group."
 *    The API is explicit — {"status":"pending","action":"requested"} — and it was
 *    discarded. The same page then told the member their request was waiting for
 *    an admin, so one screen said both.
 */
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const nunjucks = require('nunjucks');
const path = require('node:path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return new Proxy({
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getListings: jest.fn(),
    getListingCategories: jest.fn(),
    getBookmarks: jest.fn(),
    getGroup: jest.fn(),
    joinGroup: jest.fn(),
    callGroupApi: jest.fn(),
    getProfile: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() }),
}));

const api = require('../src/lib/api');
const listingsRoutes = require('../src/routes/listings');
const groupsRoutes = require('../src/routes/groups');

function mount(routes, base = '/') {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'listings-groups-test-secret-at-least-32-ch', resave: false, saveUninitialized: false }));
  app.use(base, (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.flash = () => [];
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '/test/accessible', tenant: { id: 2, slug: 'test' } };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Test',
      isAuthenticated: true,
      csrfToken: 'csrf',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      htmlLang: 'en',
      htmlDirection: 'ltr',
      formatLocaleDate: () => '24 August 2026',
    });
    next();
  }, routes);
  return app;
}

const listingsApp = mount(listingsRoutes);
const groupsApp = mount(groupsRoutes);
const t = createTranslator('en');

describe('the listings list agrees with the listing about what is saved', () => {
  const rows = (favorited) => ({
    data: [{ id: 524, title: 'Garden help', is_favorited: favorited, type: 'offer' }],
    meta: {},
  });

  beforeEach(() => {
    jest.clearAllMocks();
    api.getListingCategories.mockResolvedValue({ data: [] });
  });

  it('tags a row as saved when the listing reports it as a favourite', async () => {
    api.getListings.mockResolvedValue(rows(true));
    const res = await request(listingsApp).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('polish_listings.saved_tag'));
  });

  it('does not tag it when the listing is not a favourite', async () => {
    api.getListings.mockResolvedValue(rows(false));
    const res = await request(listingsApp).get('/');
    expect(res.text).not.toContain(t('polish_listings.saved_tag'));
  });

  it('no longer consults bookmarks to decide, because Save does not write one', async () => {
    api.getListings.mockResolvedValue(rows(true));
    await request(listingsApp).get('/');
    // Reading bookmarks here is what made the tag disagree with the button: the
    // Save button writes a favourite, never a bookmark.
    expect(api.getBookmarks).not.toHaveBeenCalled();
  });

  it('is not fooled by a bookmark that exists without a favourite', async () => {
    api.getListings.mockResolvedValue(rows(false));
    api.getBookmarks.mockResolvedValue({ data: [{ bookmarkable_id: 524 }] });
    const res = await request(listingsApp).get('/');
    expect(res.text).not.toContain(t('polish_listings.saved_tag'));
  });
});

describe('group membership states are told apart', () => {
  const group = (membership) => ({
    data: {
      id: 974,
      name: 'Repair crew',
      visibility: 'public',
      my_membership: membership,
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    api.callGroupApi.mockResolvedValue({ data: { items: [] } });
    api.getProfile.mockResolvedValue({ data: { id: 900015 } });
  });

  it('tells somebody who has never asked to join to join, not to wait', async () => {
    api.getGroup.mockResolvedValue(group(null));
    const res = await request(groupsApp).get('/974/discussions');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('groups_t1.discussions_members_only'));
    // The old wording claimed an admin was reviewing a request they never made.
    expect(res.text).not.toContain(t('groups.pending_member'));
  });

  it('still tells somebody with a real pending request that it is pending', async () => {
    api.getGroup.mockResolvedValue(group({ status: 'pending' }));
    const res = await request(groupsApp).get('/974/discussions');
    expect(res.text).toContain(t('groups.pending_member'));
    expect(res.text).not.toContain(t('groups_t1.discussions_members_only'));
  });

  it('shows neither message to a member', async () => {
    api.getGroup.mockResolvedValue(group({ status: 'active', role: 'member' }));
    const res = await request(groupsApp).get('/974/discussions');
    expect(res.text).not.toContain(t('groups.pending_member'));
    expect(res.text).not.toContain(t('groups_t1.discussions_members_only'));
  });

  it('the two messages are different sentences', () => {
    expect(t('groups_t1.discussions_members_only')).not.toBe(t('groups.pending_member'));
    expect(t('groups_t1.discussions_members_only')).not.toMatch(/approve|waiting/i);
  });
});

describe('joining a group reports what actually happened', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getProfile.mockResolvedValue({ data: { id: 900015 } });
  });

  it('says "requested" when the API answers pending', async () => {
    // The API's own words for an approval-only group.
    api.joinGroup.mockResolvedValue({ data: { status: 'pending', action: 'requested', membership: { status: 'pending' } } });
    const res = await request(groupsApp).post('/974/join').type('form').send({});
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=group-requested');
    expect(res.headers.location).not.toContain('status=group-joined');
  });

  it('recognises a pending membership even without the action field', async () => {
    api.joinGroup.mockResolvedValue({ data: { membership: { status: 'pending' } } });
    const res = await request(groupsApp).post('/974/join').type('form').send({});
    expect(res.headers.location).toContain('status=group-requested');
  });

  it('still says "joined" for an open group', async () => {
    api.joinGroup.mockResolvedValue({ data: { status: 'active', action: 'joined', membership: { status: 'active' } } });
    const res = await request(groupsApp).post('/974/join').type('form').send({});
    expect(res.headers.location).toContain('status=group-joined');
  });

  it('says "joined" when the API returns nothing useful, as before', async () => {
    api.joinGroup.mockResolvedValue({});
    const res = await request(groupsApp).post('/974/join').type('form').send({});
    expect(res.headers.location).toContain('status=group-joined');
  });

  it('the requested message does not claim membership', () => {
    const requested = t('groups.states.group-requested');
    expect(requested).toBeTruthy();
    expect(requested).not.toMatch(/have joined/i);
    expect(requested).not.toBe(t('groups.states.group-joined'));
  });
});
