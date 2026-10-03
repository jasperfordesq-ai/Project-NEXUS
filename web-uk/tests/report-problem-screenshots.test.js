// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Screenshots on the "Help & support" form (`/report-a-problem`).
 *
 * Laravel's `POST /api/v2/support/reports` accepts up to three PNG/JPEG/WebP
 * images of at most 10 MB as `screenshots[0..2]` in a multipart request, and
 * keeps accepting the original JSON body when there are none. Pinned here:
 *  - the form is multipart and renders the official GOV.UK file upload;
 *  - an attached image is forwarded as multipart with `screenshots[0]`;
 *  - too many files, a non-image and an oversized file are refused with the
 *    GOV.UK error-summary + inline-error pattern, keeping what was typed;
 *  - a request without files still sends exactly the JSON it always did;
 *  - a Laravel 422 about a screenshot lands next to the file field.
 *
 * The real router, upload middleware and API client run here; only `fetch` is
 * replaced, so the assertions are about what would reach Laravel.
 */

const path = require('node:path');
const express = require('express');
const nunjucks = require('nunjucks');
const request = require('supertest');

const mockFetch = jest.fn();
global.fetch = mockFetch;
process.env.API_BASE_URL = 'http://localhost:5000';

const { createTranslator } = require('../src/lib/localization');
const { characterCountMessages } = require('../src/lib/character-count-messages');
const { reportProblemUploadMiddleware, detectImageType } = require('../src/lib/support-screenshots');

const t = createTranslator('en');

const VIEW_PATHS = [
  path.join(__dirname, '..', 'src', 'views'),
  path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')
];
const templateEnv = nunjucks.configure(VIEW_PATHS, { autoescape: true, noCache: true });

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0x01)
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x02)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4, 0), Buffer.from('WEBP'), Buffer.alloc(64, 0x03)]);

const VALID_FIELDS = {
  request_type: 'broken',
  impact: 'minor',
  summary: 'The Accept button does nothing',
  description: 'I pressed Accept on an exchange and nothing happened at all.',
  page_url: '/exchanges'
};

function renderForm(context = {}) {
  return templateEnv.render('report-problem.njk', {
    t,
    urlFor: (pathname) => `/acme/accessible${pathname === '/' ? '' : pathname}`,
    isAuthenticated: true,
    tenantName: 'Acme Timebank',
    csrfToken: 'test-csrf',
    characterCountMessages: characterCountMessages(t, 'en'),
    pageUrl: '/exchanges',
    impacts: ['blocked', 'major', 'minor', 'cosmetic'],
    requestTypes: ['broken', 'how_to', 'account', 'suggestion'],
    status: '',
    reference: '',
    values: {},
    errors: {},
    ...context
  });
}

/**
 * The real contact/support router behind the same upload middleware server.js
 * mounts, with a shared session so a redirect's stored errors can be read back.
 */
function buildApp() {
  const session = {};
  const captured = { view: null, context: null };
  const app = express();

  app.use((req, res, next) => {
    req.session = session;
    req.signedCookies = { token: 'member-token' };
    res.locals.t = t;
    res.locals.urlFor = (pathname) => `/acme/accessible${pathname === '/' ? '' : pathname}`;
    res.render = (view, context) => {
      captured.view = view;
      captured.context = context;
      res.status(200).end();
    };
    next();
  });
  app.use('/report-a-problem', ...reportProblemUploadMiddleware);
  app.use(express.urlencoded({ extended: true }));
  // eslint-disable-next-line global-require
  app.use(require('../src/routes/contact-support'));
  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => res.status(500).json({ error: error.message }));

  return { app, session, captured };
}

function multipartPost(app) {
  const req = request(app).post('/report-a-problem');
  for (const [key, value] of Object.entries(VALID_FIELDS)) {
    req.field(key, value);
  }
  return req;
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body
  };
}

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue(jsonResponse({ data: { report: { reference: 'NXR-1', screenshots: 1 } } }));
});

describe('report-a-problem form markup', () => {
  it('posts multipart and renders the official GOV.UK file upload for screenshots', () => {
    const html = renderForm();

    expect(html).toMatch(/<form method="post" action="\/acme\/accessible\/report-a-problem" enctype="multipart\/form-data" novalidate>/);
    expect(html).toContain('class="govuk-file-upload-wrapper" data-module="govuk-file-upload"');
    expect(html).toMatch(/<input class="govuk-file-upload" id="screenshots" name="screenshots" type="file" multiple accept="image\/png,image\/jpeg,image\/webp" aria-describedby="screenshots-hint">/);
    expect(html).toContain('<label class="govuk-label govuk-label--s" for="screenshots">Screenshots (optional)</label>');
    // Nunjucks autoescapes the apostrophe in "anyone else's".
    expect(html).toContain(t('report_problem.screenshots.hint').replace(/'/g, '&#39;'));
    expect(t('report_problem.screenshots.hint')).toMatch(/3 images.*PNG, JPEG or WebP.*10 MB.*private details/);
    // The enhanced control's own strings come from the catalogue, with the
    // GOV.UK %{count} placeholder the component substitutes.
    expect(html).toContain('data-i18n.choose-files-button="Choose files"');
    expect(html).toContain('data-i18n.multiple-files-chosen.other="%{count} files chosen"');
    expect(html).not.toContain('govuk-file-upload--error');
  });

  it('shows a screenshot error in the error summary and inline, linked to the field', () => {
    const message = t('report_problem.screenshots.errors.too_many');
    const html = renderForm({ status: 'invalid', errors: { screenshots: message } });

    expect(html).toContain('govuk-error-summary');
    expect(html).toContain(`<li><a href="#screenshots">${message}</a></li>`);
    expect(html).toMatch(/<p id="screenshots-error" class="govuk-error-message"><span class="govuk-visually-hidden">Error:<\/span> Select no more than 3 files<\/p>/);
    expect(html).toContain('govuk-file-upload govuk-file-upload--error');
    expect(html).toContain('aria-describedby="screenshots-hint screenshots-error"');
  });
});

describe('report-a-problem screenshot submission', () => {
  it('forwards an attached image to Laravel as multipart screenshots[0]', async () => {
    const { app } = buildApp();

    const response = await multipartPost(app)
      .attach('screenshots', PNG, { filename: 'broken-button.png', contentType: 'image/png' })
      .expect(302);

    expect(response.headers.location).toBe('/acme/accessible/report-a-problem?return=%2Fexchanges&status=sent&ref=NXR-1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://localhost:5000/api/v2/support/reports');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer member-token');
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);

    const form = init.body;
    expect(form.get('request_type')).toBe('broken');
    expect(form.get('impact')).toBe('minor');
    expect(form.get('summary')).toBe(VALID_FIELDS.summary);
    expect(form.get('source')).toBe('accessible');
    expect(form.get('page_url')).toBe('/exchanges');
    const file = form.get('screenshots[0]');
    expect(file).toBeInstanceOf(Blob);
    expect(file.type).toBe('image/png');
    expect(file.name).toBe('broken-button.png');
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
    expect(form.get('screenshots[1]')).toBeNull();
  });

  it('forwards up to three images, typed by their content rather than their name', async () => {
    const { app } = buildApp();

    await multipartPost(app)
      .attach('screenshots', PNG, { filename: 'one.png', contentType: 'image/png' })
      .attach('screenshots', JPEG, { filename: 'two.jpg', contentType: 'image/jpeg' })
      .attach('screenshots', WEBP, { filename: 'three.png', contentType: 'image/png' })
      .expect(302);

    const form = mockFetch.mock.calls[0][1].body;
    expect(form.get('screenshots[0]').type).toBe('image/png');
    expect(form.get('screenshots[1]').type).toBe('image/jpeg');
    expect(form.get('screenshots[2]').type).toBe('image/webp');
  });

  it('still sends the original JSON body when no file is attached (urlencoded)', async () => {
    const { app } = buildApp();

    await request(app).post('/report-a-problem').type('form').send(VALID_FIELDS).expect(302);

    const init = mockFetch.mock.calls[0][1];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({
      request_type: 'broken',
      summary: VALID_FIELDS.summary,
      description: VALID_FIELDS.description,
      impact: 'minor',
      source: 'accessible',
      page_url: '/exchanges',
      route: '/report-a-problem'
    });
  });

  it('still sends JSON when the multipart form arrives with no file chosen', async () => {
    const { app } = buildApp();

    await multipartPost(app).expect(302);

    const init = mockFetch.mock.calls[0][1];
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body).summary).toBe(VALID_FIELDS.summary);
  });

  it('refuses more than three files with the GOV.UK error pattern and keeps the answers', async () => {
    const { app, session, captured } = buildApp();

    const response = await multipartPost(app)
      .attach('screenshots', PNG, { filename: '1.png', contentType: 'image/png' })
      .attach('screenshots', PNG, { filename: '2.png', contentType: 'image/png' })
      .attach('screenshots', PNG, { filename: '3.png', contentType: 'image/png' })
      .attach('screenshots', PNG, { filename: '4.png', contentType: 'image/png' })
      .expect(302);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(response.headers.location).toBe('/acme/accessible/report-a-problem?return=%2Fexchanges&status=invalid');
    expect(session.reportProblemForm.errors).toEqual({ screenshots: 'Select no more than 3 files' });
    expect(session.reportProblemForm.values.summary).toBe(VALID_FIELDS.summary);

    await request(app).get('/report-a-problem?return=%2Fexchanges&status=invalid').expect(200);
    expect(captured.view).toBe('report-problem');
    expect(captured.context.errors).toEqual({ screenshots: 'Select no more than 3 files' });
    expect(captured.context.values.description).toBe(VALID_FIELDS.description);
    const html = renderForm({ status: 'invalid', values: captured.context.values, errors: captured.context.errors });
    expect(html).toContain('<li><a href="#screenshots">Select no more than 3 files</a></li>');
  });

  it('refuses a file that is not a PNG, JPEG or WebP image, whatever its name says', async () => {
    const { app, session } = buildApp();

    await multipartPost(app)
      .attach('screenshots', Buffer.from('this is plain text, not a picture'), { filename: 'notes.png', contentType: 'image/png' })
      .expect(302);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(session.reportProblemForm.errors).toEqual({
      screenshots: 'Each selected file must be a PNG, JPEG or WebP image'
    });
  });

  it('refuses a file over 10 MB before anything is sent to Laravel', async () => {
    const { app, session } = buildApp();
    const oversized = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024, 0x00)]);

    await multipartPost(app)
      .attach('screenshots', oversized, { filename: 'huge.png', contentType: 'image/png' })
      .expect(302);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(session.reportProblemForm.errors).toEqual({
      screenshots: 'Each selected file must be smaller than 10 MB'
    });
  });

  it('stops a clearly abusive upload in the parser and still answers with the form error', async () => {
    const { app, session } = buildApp();
    let req = request(app).post('/report-a-problem').field('summary', 'Too many files');
    for (let index = 0; index < 8; index += 1) {
      req = req.attach('screenshots', PNG, { filename: `${index}.png`, contentType: 'image/png' });
    }

    const response = await req;

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/acme/accessible/report-a-problem?return=%2F&status=invalid');
    expect(mockFetch).not.toHaveBeenCalled();
    expect(session.reportProblemForm.errors).toEqual({ screenshots: 'Select no more than 3 files' });
  });

  it('shows a Laravel 422 about a screenshot next to the file field', async () => {
    const { app, session } = buildApp();
    mockFetch.mockResolvedValueOnce(jsonResponse({
      errors: [{ code: 'VALIDATION_FAILED', message: 'Screenshot 1 could not be read as an image.', field: 'screenshots.0' }]
    }, 422));

    const response = await multipartPost(app)
      .attach('screenshots', PNG, { filename: 'broken.png', contentType: 'image/png' })
      .expect(302);

    expect(response.headers.location).toBe('/acme/accessible/report-a-problem?return=%2Fexchanges&status=invalid');
    expect(session.reportProblemForm.errors).toEqual({
      screenshots: 'Screenshot 1 could not be read as an image.'
    });
    expect(session.reportProblemForm.values.summary).toBe(VALID_FIELDS.summary);
  });

  it('keeps the generic failure banner for a non-validation API failure', async () => {
    const { app, session } = buildApp();
    mockFetch.mockResolvedValueOnce(jsonResponse({ errors: [{ code: 'SERVER_ERROR', message: 'Oops' }] }, 500));

    const response = await multipartPost(app)
      .attach('screenshots', PNG, { filename: 'broken.png', contentType: 'image/png' })
      .expect(302);

    expect(response.headers.location).toBe('/acme/accessible/report-a-problem?return=%2Fexchanges&status=failed');
    expect(session.reportProblemForm.errors).toBeUndefined();
  });
});

describe('detectImageType', () => {
  it('recognises PNG, JPEG and WebP by their leading bytes only', () => {
    expect(detectImageType(PNG)).toBe('image/png');
    expect(detectImageType(JPEG)).toBe('image/jpeg');
    expect(detectImageType(WEBP)).toBe('image/webp');
    expect(detectImageType(Buffer.from('GIF89a-and-some-more-bytes'))).toBe('');
    expect(detectImageType(Buffer.alloc(4))).toBe('');
  });
});
