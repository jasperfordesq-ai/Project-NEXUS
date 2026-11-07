// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID accessibility report, point 6: every photo a member sends can carry a
 * short description. The no-JS composer has one upload field for up to five
 * files, so it offers one description, used for each photo sent with it; a
 * received photo is read out with its sender's words.
 */
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const nunjucks = require('nunjucks');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
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
    callMessageApi: jest.fn(),
    uploadMessageAttachments: jest.fn(),
    getProfile: jest.fn(),
    getUser: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() }),
}));

const api = require('../src/lib/api');
const messagesRoutes = require('../src/routes/messages');

const ME = 1;
const OTHER = 22;
const t = createTranslator('en');

function mount(files = null) {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  environment.addFilter('formatBladeDateTime', (value) => String(value || ''));
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'message-photo-description-test-secret', resave: false, saveUninitialized: false }));
  app.use('/messages', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.flash = () => [];
    if (files) req.files = files();
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '', tenant: { id: 2, slug: 'test' } };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Test',
      isAuthenticated: true,
      csrfToken: 'csrf',
      t,
      tc: createChoiceTranslator('en'),
      htmlLang: 'en',
      htmlDirection: 'ltr',
      formatLocaleDate: () => '7 November 2026',
    });
    next();
  }, messagesRoutes);
  return app;
}

function conversation(messages = []) {
  api.callMessageApi.mockImplementation(async (token, method, apiPath) => {
    if (String(apiPath).startsWith('/restriction-status')) return { data: {} };
    if (String(apiPath).startsWith('/reactions/batch')) return { data: { reactions: {} } };
    if (method === 'GET') {
      return { data: messages, meta: { conversation: { other_user: { id: OTHER, name: 'Bea Smith' } } } };
    }
    return { data: {} };
  });
}

function tempFile(name) {
  const filepath = path.join(os.tmpdir(), `nexus-msg-photo-${process.pid}-${Math.random().toString(16).slice(2)}-${name}`);
  fs.writeFileSync(filepath, 'x');
  return filepath;
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: ME, name: 'Me' } });
  api.uploadMessageAttachments.mockResolvedValue({ data: { id: 900 } });
});

describe('describing a photo sent in a message', () => {
  it('offers one description box beside the file upload', async () => {
    conversation();
    const res = await request(mount()).get(`/messages/${OTHER}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('name="attachment_alt"');
    expect(res.text).toContain(t('govuk_alpha_messages.attachments.alt_label'));
  });

  it('sends the description with each photo, and none with a document', async () => {
    conversation();
    const app = mount(() => ({
      'attachments[]': [
        { filepath: tempFile('a.jpg'), originalFilename: 'a.jpg', mimetype: 'image/jpeg', size: 1 },
        { filepath: tempFile('b.pdf'), originalFilename: 'b.pdf', mimetype: 'application/pdf', size: 1 },
      ],
    }));

    await request(app).post(`/messages/${OTHER}`).type('form').send({ body: '', attachment_alt: '  Two cups of tea  ' });

    const [, data] = api.uploadMessageAttachments.mock.calls[0];
    expect(data.files.map((file) => file.alt)).toEqual(['Two cups of tea', '']);
  });

  it('reads a received photo out with its sender\'s description', async () => {
    conversation([{
      id: 501, body: '', sender_id: OTHER, created_at: '2026-11-07T10:00:00Z',
      attachments: [{ id: 1, url: '/api/v2/messages/501/attachments/1', name: 'IMG_2041.jpg', mime_type: 'image/jpeg', alt_text: 'A red bicycle' }],
    }]);

    const res = await request(mount()).get(`/messages/${OTHER}`);

    expect(res.text).toContain('alt="A red bicycle"');
  });

  it('keeps the generic wording, never the file name, when the sender wrote nothing', async () => {
    conversation([{
      id: 502, body: '', sender_id: OTHER, created_at: '2026-11-07T10:00:00Z',
      attachments: [{ id: 2, url: '/api/v2/messages/502/attachments/2', name: 'IMG_2042.jpg', mime_type: 'image/jpeg' }],
    }]);

    const res = await request(mount()).get(`/messages/${OTHER}`);

    expect(res.text).toContain(`alt="${t('govuk_alpha_messages.attachments.photo_alt')}"`);
    expect(res.text).not.toContain('alt="IMG_2042.jpg"');
  });
});
