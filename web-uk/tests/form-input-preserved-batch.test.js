// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The remaining forms that lost typed input on a failure: group exchanges, saved
 * collections, appreciations, group file uploads, insurance certificates and the
 * account-deletion reason.
 *
 * Two rules this file pins as much as the refilling itself:
 *
 * - A PASSWORD is never restored. profile/delete has five failure exits, and a stashed
 *   password would sit in the session on most of them.
 * - A FILE input is never restored, because a browser forbids setting its value. On the
 *   two forms that mix a file with typed fields, that is exactly why the surrounding text
 *   has to survive — the member must re-pick the file either way.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    callGroupExchangeApi: jest.fn(),
    getSavedCollections: jest.fn(),
    createSavedCollection: jest.fn(),
    callSavedApi: jest.fn(),
    getUserV2: jest.fn(),
    getBookmarks: jest.fn(),
    getUserPublicCollections: jest.fn(),
    getUserAppreciations: jest.fn(),
    toggleBookmark: jest.fn(),
    reactToAppreciation: jest.fn(),
    sendAppreciation: jest.fn(),
    callGroupApi: jest.fn(),
    getGroup: jest.fn(),
    uploadGroupFile: jest.fn(),
    callUserSettingsApi: jest.fn(),
    uploadInsuranceCertificate: jest.fn(),
    requestAccountDeletion: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn()
  };
});

const api = require('../src/lib/api');

const PREFIX = '/acme/accessible';
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');

function createApp(mountPath, routers) {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  env.addFilter('string', String);

  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: 'batch-replay-test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'batch-replay-test.sid'
  }));

  app.use(mountPath, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      // `compliance.insurance_enabled` gates the insurance page; without it it 404s.
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank', compliance: { insurance_enabled: true } },
      prefix: PREFIX
    };
    res.locals.urlFor = (value) => {
      const target = String(value || '/');
      return target.startsWith(PREFIX) ? target : `${PREFIX}${target.startsWith('/') ? target : `/${target}`}`;
    };
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: `${PREFIX}/feedback`,
      currentPath: mountPath,
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: 'en',
      htmlDirection: 'ltr',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  }, ...routers);

  return app;
}

// `(?![-\w])` so `id="title"` does not also match inside `id="title-hint"`.
function valueOf(html, id) {
  const match = new RegExp(`id="${id}"(?![-\\w])[^>]*\\svalue="([^"]*)"`).exec(html);
  return match ? match[1] : null;
}

function textareaValue(html, id) {
  const match = new RegExp(`id="${id}"(?![-\\w])[^>]*>([\\s\\S]*?)</textarea>`).exec(html);
  return match ? match[1].trim() : null;
}

function isChecked(html, id) {
  return new RegExp(`id="${id}"(?![-\\w])[^>]*\\schecked`).test(html);
}

// --------------------------------------------------------------------------------------
// group exchanges
// --------------------------------------------------------------------------------------

describe('group exchange create form keeps title, hours and description', () => {
  const MOUNT = `${PREFIX}/group-exchanges`;
  const DESCRIPTION = 'Four of us clearing the community garden beds over two Saturdays in March.';

  function buildApp() {
    const groupExchangeRoutes = require('../src/routes/group-exchanges');
    const groupExchangeActionRoutes = require('../src/routes/group-exchange-actions');
    return createApp(MOUNT, [groupExchangeActionRoutes, groupExchangeRoutes]);
  }

  beforeEach(() => {
    api.callGroupExchangeApi.mockReset();
    api.getProfile.mockReset();
    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
    api.callGroupExchangeApi.mockResolvedValue({ data: { items: [] } });
  });

  it('refills the form after the title/hours check rejects it', async () => {
    const agent = request.agent(buildApp());
    const post = await agent
      .post(`${MOUNT}/new`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', title: '', description: DESCRIPTION, total_hours: '6' });
    expect(post.headers.location).toContain('status=create-invalid');

    const page = await agent.get(`${MOUNT}/new?status=create-invalid`);
    expect(page.status).toBe(200);
    expect(textareaValue(page.text, 'description')).toBe(DESCRIPTION);
    expect(valueOf(page.text, 'total_hours')).toBe('6');
  });

  it('refills the form after the API refuses it', async () => {
    api.callGroupExchangeApi.mockRejectedValueOnce(new api.ApiError('exchanges unavailable', 503, {}));
    const agent = request.agent(buildApp());
    await agent
      .post(`${MOUNT}/new`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', title: 'Garden clearing', description: DESCRIPTION, total_hours: '6' });

    const page = await agent.get(`${MOUNT}/new?status=create-failed`);
    expect(valueOf(page.text, 'title')).toBe('Garden clearing');
    expect(textareaValue(page.text, 'description')).toBe(DESCRIPTION);
  });

  it('consumes the stash once', async () => {
    const agent = request.agent(buildApp());
    await agent.post(`${MOUNT}/new`).type('form')
      .send({ _csrf: 'test-csrf-token', title: '', description: DESCRIPTION });
    await agent.get(`${MOUNT}/new?status=create-invalid`);
    const second = await agent.get(`${MOUNT}/new`);
    expect(textareaValue(second.text, 'description')).toBe('');
  });
});

// --------------------------------------------------------------------------------------
// saved collections
// --------------------------------------------------------------------------------------

describe('saved collection form keeps name and description', () => {
  const MOUNT = `${PREFIX}/me/collections`;
  const DESCRIPTION = 'Listings I want to come back to when the workshop reopens.';

  function buildApp() {
    const savedCollectionRoutes = require('../src/routes/saved-collections');
    return createApp(MOUNT, [savedCollectionRoutes]);
  }

  beforeEach(() => {
    api.getSavedCollections.mockReset();
    api.createSavedCollection.mockReset();
    api.getProfile.mockReset();
    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
    api.getSavedCollections.mockResolvedValue({ data: [] });
    api.createSavedCollection.mockRejectedValue(new api.ApiError('collections unavailable', 503, {}));
  });

  it('refills the form after the API refuses it', async () => {
    const agent = request.agent(buildApp());
    const post = await agent
      .post(MOUNT)
      .type('form')
      .send({ _csrf: 'test-csrf-token', name: 'Workshop wishlist', description: DESCRIPTION, is_public: '1' });
    expect(post.headers.location).toContain('status=collection-failed');

    const page = await agent.get(`${MOUNT}?status=collection-failed`);
    expect(page.status).toBe(200);
    expect(valueOf(page.text, 'collection-name')).toBe('Workshop wishlist');
    expect(textareaValue(page.text, 'collection-description')).toBe(DESCRIPTION);
    expect(isChecked(page.text, 'collection-public')).toBe(true);
  });

  it('consumes the stash once', async () => {
    const agent = request.agent(buildApp());
    await agent.post(MOUNT).type('form')
      .send({ _csrf: 'test-csrf-token', name: 'Workshop wishlist', description: DESCRIPTION });
    await agent.get(`${MOUNT}?status=collection-failed`);
    const second = await agent.get(MOUNT);
    expect(valueOf(second.text, 'collection-name')).toBe('');
    expect(textareaValue(second.text, 'collection-description')).toBe('');
  });
});

// --------------------------------------------------------------------------------------
// group file upload
// --------------------------------------------------------------------------------------

describe('group file upload keeps the folder and description', () => {
  const MOUNT = `${PREFIX}/groups`;
  const DESCRIPTION = 'Minutes of the March meeting, including the vote on the new opening hours.';

  function buildApp() {
    const groupRoutes = require('../src/routes/groups');
    return createApp(MOUNT, [groupRoutes]);
  }

  beforeEach(() => {
    api.getProfile.mockReset();
    api.getGroup.mockReset();
    api.callGroupApi.mockReset();
    api.uploadGroupFile.mockReset();

    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
    api.getGroup.mockResolvedValue({
      data: { id: 42, name: 'Bantry Repair Cafe', owner_id: 7, membership: { role: 'member', status: 'active' } }
    });
    api.callGroupApi.mockResolvedValue({ data: { items: [] } });
  });

  // No file is attached, so the route takes the `insurance-file-required` equivalent exit.
  it('refills the folder and description when no file was chosen', async () => {
    const agent = request.agent(buildApp());
    const post = await agent
      .post(`${MOUNT}/42/files`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', folder: 'Meetings', description: DESCRIPTION });
    expect(post.status).toBe(302);

    const page = await agent.get(`${MOUNT}/42/files?status=file-missing`);
    expect(page.status).toBe(200);
    expect(valueOf(page.text, 'file-folder')).toBe('Meetings');
    expect(textareaValue(page.text, 'file-description')).toBe(DESCRIPTION);
    // A file input cannot carry a value, and must not appear to.
    expect(page.text).not.toMatch(/id="file-input"[^>]*\svalue=/);
  });

  it('consumes the stash once', async () => {
    const agent = request.agent(buildApp());
    await agent.post(`${MOUNT}/42/files`).type('form')
      .send({ _csrf: 'test-csrf-token', folder: 'Meetings', description: DESCRIPTION });
    await agent.get(`${MOUNT}/42/files?status=file-missing`);
    const second = await agent.get(`${MOUNT}/42/files`);
    expect(valueOf(second.text, 'file-folder')).toBe('');
    expect(textareaValue(second.text, 'file-description')).toBe('');
  });
});

// --------------------------------------------------------------------------------------
// insurance certificate — the largest single loss on the frontend
// --------------------------------------------------------------------------------------

describe('insurance certificate form keeps every field around the unrecoverable file', () => {
  const MOUNT = `${PREFIX}/settings`;
  const NOTES = 'Renewed through the community broker; the policy number changed this year.';

  function buildApp() {
    const settingsRoutes = require('../src/routes/settings');
    return createApp(MOUNT, [settingsRoutes]);
  }

  beforeEach(() => {
    api.callUserSettingsApi.mockReset();
    api.uploadInsuranceCertificate.mockReset();
    api.getProfile.mockReset();
    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
    api.callUserSettingsApi.mockResolvedValue({
      data: { items: [], insurance_enabled: true, settings: { insurance_enabled: true } }
    });
  });

  it('refills all ten fields when no certificate file was chosen', async () => {
    const agent = request.agent(buildApp());
    const post = await agent
      .post(`${MOUNT}/insurance`)
      .type('form')
      .send({
        _csrf: 'test-csrf-token',
        insurance_type: 'public_liability',
        provider_name: 'West Cork Mutual',
        policy_number: 'WCM-2026-0041',
        coverage_amount: '2000000',
        notes: NOTES,
        'start_date-day': '1',
        'start_date-month': '4',
        'start_date-year': '2026',
        'expiry_date-day': '31',
        'expiry_date-month': '3',
        'expiry_date-year': '2027'
      });
    expect(post.status).toBe(302);
    expect(post.headers.location).toContain('status=insurance-file-required');

    const page = await agent.get(`${MOUNT}/insurance?status=insurance-file-required`);
    expect(page.status).toBe(200);
    expect(valueOf(page.text, 'provider_name')).toBe('West Cork Mutual');
    expect(valueOf(page.text, 'policy_number')).toBe('WCM-2026-0041');
    expect(valueOf(page.text, 'coverage_amount')).toBe('2000000');
    expect(textareaValue(page.text, 'insurance_notes')).toBe(NOTES);
    expect(valueOf(page.text, 'start_date-day')).toBe('1');
    expect(valueOf(page.text, 'start_date-year')).toBe('2026');
    expect(valueOf(page.text, 'expiry_date-day')).toBe('31');
    expect(valueOf(page.text, 'expiry_date-year')).toBe('2027');
    expect(page.text).toContain('<option value="public_liability" selected');
    // The certificate itself cannot be restored and must not pretend to be.
    expect(page.text).not.toMatch(/id="certificate_file"[^>]*\svalue=/);
  });

  it('consumes the stash once', async () => {
    const agent = request.agent(buildApp());
    await agent.post(`${MOUNT}/insurance`).type('form')
      .send({ _csrf: 'test-csrf-token', insurance_type: 'public_liability', provider_name: 'West Cork Mutual', notes: NOTES });
    await agent.get(`${MOUNT}/insurance?status=insurance-file-required`);
    const second = await agent.get(`${MOUNT}/insurance`);
    expect(valueOf(second.text, 'provider_name')).toBe('');
    expect(textareaValue(second.text, 'insurance_notes')).toBe('');
  });
});

// --------------------------------------------------------------------------------------
// account deletion reason — and the password that must NOT come back
// --------------------------------------------------------------------------------------

describe('account deletion keeps the reason but never the password', () => {
  const MOUNT = `${PREFIX}/profile`;
  const REASON = 'Moving abroad in June, so I will not be able to take part any more.';

  function buildApp() {
    const profileRoutes = require('../src/routes/profile');
    return createApp(MOUNT, [profileRoutes]);
  }

  beforeEach(() => {
    api.requestAccountDeletion.mockReset();
    api.getProfile.mockReset();
    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
  });

  it('refills the reason after the confirmation box was not ticked', async () => {
    const agent = request.agent(buildApp());
    const post = await agent
      .post(`${MOUNT}/delete-account`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', password: 'correct-horse', reason: REASON });
    expect(post.headers.location).toContain('status=delete-confirm-required');

    const page = await agent.get(`${MOUNT}/delete-account?status=delete-confirm-required`);
    expect(page.status).toBe(200);
    expect(textareaValue(page.text, 'reason')).toBe(REASON);
  });

  // 🔴 The important half of this fix is what it does NOT do.
  it('never puts the password back into the page', async () => {
    const agent = request.agent(buildApp());
    await agent
      .post(`${MOUNT}/delete-account`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', password: 'correct-horse', reason: REASON });

    const page = await agent.get(`${MOUNT}/delete-account?status=delete-confirm-required`);
    expect(page.text).not.toContain('correct-horse');
    expect(valueOf(page.text, 'password')).toBe(null);
  });

  it('consumes the stash once', async () => {
    const agent = request.agent(buildApp());
    await agent.post(`${MOUNT}/delete-account`).type('form')
      .send({ _csrf: 'test-csrf-token', password: 'correct-horse', reason: REASON });
    await agent.get(`${MOUNT}/delete-account?status=delete-confirm-required`);
    const second = await agent.get(`${MOUNT}/delete-account`);
    expect(textareaValue(second.text, 'reason')).toBe('');
  });
});

// --------------------------------------------------------------------------------------
// appreciations — six of seven failures are server-side, and none was the member's fault
// --------------------------------------------------------------------------------------

describe('appreciation form keeps the message and the public/private choice', () => {
  const MOUNT = PREFIX;
  const MESSAGE = 'Thank you for driving me to the hospital in February. It made a hard week easier.';

  function buildApp() {
    const savedSocialRoutes = require('../src/routes/saved-social');
    return createApp(MOUNT, [savedSocialRoutes]);
  }

  beforeEach(() => {
    api.getUserV2.mockReset();
    api.getUserAppreciations.mockReset();
    api.sendAppreciation.mockReset();
    api.getProfile.mockReset();

    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
    api.getUserV2.mockResolvedValue({ data: { id: 88, name: 'Mary Casey' } });
    api.getUserAppreciations.mockResolvedValue({ data: [], meta: { current_page: 1, last_page: 1 } });
    api.sendAppreciation.mockRejectedValue(new api.ApiError('rate limited', 429, {}));
  });

  it('refills the message after a server-side refusal', async () => {
    const agent = request.agent(buildApp());
    const post = await agent
      .post(`${MOUNT}/users/88/appreciations`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', message: MESSAGE, is_public: '1' });
    expect(post.status).toBe(302);

    const page = await agent.get(`${MOUNT}/users/88/appreciations?status=appreciation-rate-limited`);
    expect(page.status).toBe(200);
    expect(textareaValue(page.text, 'appreciation-message')).toBe(MESSAGE);
    expect(isChecked(page.text, 'appreciation-public')).toBe(true);
  });

  // 🔴 The `checked` attribute was hardcoded, so a deliberate "keep this private" flipped
  // back to public on every failure — the opposite of what the member chose.
  it('keeps an unticked public box unticked after a failure', async () => {
    const agent = request.agent(buildApp());
    await agent
      .post(`${MOUNT}/users/88/appreciations`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', message: MESSAGE, is_public: '0' });

    const page = await agent.get(`${MOUNT}/users/88/appreciations?status=appreciation-rate-limited`);
    expect(textareaValue(page.text, 'appreciation-message')).toBe(MESSAGE);
    expect(isChecked(page.text, 'appreciation-public')).toBe(false);
  });

  it('consumes the stash once, and defaults back to public', async () => {
    const agent = request.agent(buildApp());
    await agent.post(`${MOUNT}/users/88/appreciations`).type('form')
      .send({ _csrf: 'test-csrf-token', message: MESSAGE, is_public: '0' });
    await agent.get(`${MOUNT}/users/88/appreciations?status=appreciation-rate-limited`);
    const second = await agent.get(`${MOUNT}/users/88/appreciations`);
    expect(textareaValue(second.text, 'appreciation-message')).toBe('');
    expect(isChecked(second.text, 'appreciation-public')).toBe(true);
  });
});
