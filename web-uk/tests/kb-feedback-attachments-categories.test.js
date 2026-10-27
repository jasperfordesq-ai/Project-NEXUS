// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Knowledge base parity with React (KBArticlePage, KnowledgeBasePage), 27 Oct
 * 2026 (deep audit B, items K1 to K3).
 *
 * a. "Was this helpful?" with the yes / no counts, posted to POST /v2/kb/{id}/feedback.
 * b. Article attachments, downloaded through web-uk.
 * c. Category choices on the index, filtering through ?category_id.
 */
const express = require('express');
const request = require('supertest');
const nunjucks = require('nunjucks');
const path = require('node:path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    getKnowledgeBaseArticles: jest.fn(),
    getKnowledgeBaseArticle: jest.fn(),
    submitKnowledgeBaseFeedback: jest.fn(),
    downloadKnowledgeBaseAttachment: jest.fn(),
  };
});

const api = require('../src/lib/api');
const kbRoutes = require('../src/routes/kb');

const t = createTranslator('en');

function mount() {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS', tenantName: 'Test', isAuthenticated: true, csrfToken: 'csrf',
      t, tc: createChoiceTranslator('en'), htmlLang: 'en', htmlDirection: 'ltr', tenant: { name: 'Test' },
    });
    next();
  });
  app.use('/kb', kbRoutes);
  return app;
}

const app = mount();

const ARTICLE = {
  id: 42, title: 'How credits work', content: '<p>Hello</p>', helpful_yes: 7, helpful_no: 2, my_feedback: null,
  attachments: [{ id: 3, file_name: 'guide.pdf', file_url: '/uploads/kb/guide.pdf', mime_type: 'application/pdf', file_size: 20480 }],
  children: []
};

beforeEach(() => {
  jest.clearAllMocks();
  api.getKnowledgeBaseArticle.mockResolvedValue({ data: ARTICLE });
  api.getKnowledgeBaseArticles.mockResolvedValue({ data: [], meta: {} });
});

describe('a. was this helpful', () => {
  it('asks the question with the current counts', async () => {
    const res = await request(app).get('/kb/42');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_kb.feedback_question'));
    expect(res.text).toContain(t('govuk_alpha_kb.feedback_yes', { count: 7 }));
    expect(res.text).toContain(t('govuk_alpha_kb.feedback_no', { count: 2 }));
    expect(res.text).toContain('action="/kb/42/feedback"');
  });

  it('shows the answer the member already gave', async () => {
    api.getKnowledgeBaseArticle.mockResolvedValue({ data: { ...ARTICLE, my_feedback: true } });
    const res = await request(app).get('/kb/42');
    expect(res.text).toContain(t('govuk_alpha_kb.feedback_given_yes'));
  });

  it('posts the answer', async () => {
    api.submitKnowledgeBaseFeedback.mockResolvedValue({ data: {} });
    const res = await request(app).post('/kb/42/feedback').type('form').send({ helpful: 'no' });
    expect(api.submitKnowledgeBaseFeedback).toHaveBeenCalledWith('token:test', 42, false);
    expect(res.headers.location).toBe('/kb/42?status=feedback-saved#feedback');
  });

  it('ignores an answer that is neither yes nor no', async () => {
    const res = await request(app).post('/kb/42/feedback').type('form').send({ helpful: 'maybe' });
    expect(api.submitKnowledgeBaseFeedback).not.toHaveBeenCalled();
    expect(res.headers.location).toBe('/kb/42?status=feedback-failed#feedback');
  });

  it('thanks the member, or says it failed', async () => {
    const saved = await request(app).get('/kb/42?status=feedback-saved');
    expect(saved.text).toContain(t('govuk_alpha_kb.feedback_thanks'));
    api.submitKnowledgeBaseFeedback.mockRejectedValue(new api.ApiError('no', 500));
    const post = await request(app).post('/kb/42/feedback').type('form').send({ helpful: 'yes' });
    expect(post.headers.location).toBe('/kb/42?status=feedback-failed#feedback');
    const failed = await request(app).get('/kb/42?status=feedback-failed');
    expect(failed.text).toContain(t('govuk_alpha_kb.feedback_failed'));
  });
});

describe('b. attachments', () => {
  it('lists the attachments with links through web-uk', async () => {
    const res = await request(app).get('/kb/42');
    expect(res.text).toContain(t('govuk_alpha_kb.attachments_heading'));
    expect(res.text).toContain('href="/kb/42/attachments/3"');
    expect(res.text).toContain('guide.pdf');
  });

  it('streams the attachment from the API', async () => {
    api.downloadKnowledgeBaseAttachment.mockResolvedValue({
      status: 200,
      body: Buffer.from('PDF'),
      headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="guide.pdf"' }
    });
    const res = await request(app).get('/kb/42/attachments/3');
    expect(api.downloadKnowledgeBaseAttachment).toHaveBeenCalledWith('token:test', 42, 3);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('guide.pdf');
  });

  it('answers 404 for an attachment the API does not have', async () => {
    api.downloadKnowledgeBaseAttachment.mockRejectedValue(new api.ApiError('gone', 404));
    const res = await request(app).get('/kb/42/attachments/9');
    expect(res.status).toBe(404);
  });
});

describe('c. categories on the index', () => {
  const ARTICLES = [
    { id: 1, title: 'A', category_id: 5, category_name: 'Getting started' },
    { id: 2, title: 'B', category_id: 5, category_name: 'Getting started' },
    { id: 3, title: 'C', category_id: 6, category_name: 'Wallet' },
    { id: 4, title: 'D', category_id: null, category_name: null },
  ];

  it('offers each category with its count, and "all"', async () => {
    api.getKnowledgeBaseArticles.mockResolvedValue({ data: ARTICLES, meta: {} });
    const res = await request(app).get('/kb');
    expect(res.text).toContain(t('govuk_alpha_kb.categories_label'));
    expect(res.text).toContain('href="/kb?category=5"');
    expect(res.text).toContain('href="/kb?category=6"');
    expect(res.text).toContain('>Getting started</a>');
    expect(res.text).toContain(t('govuk_alpha_kb.all_categories'));
  });

  it('filters by the chosen category and marks it current', async () => {
    api.getKnowledgeBaseArticles.mockImplementation(async (token, params) => (
      params.category_id ? { data: [ARTICLES[2]], meta: {} } : { data: ARTICLES, meta: {} }
    ));
    const res = await request(app).get('/kb?category=6');
    expect(api.getKnowledgeBaseArticles).toHaveBeenCalledWith('token:test', expect.objectContaining({ category_id: 6 }));
    expect(res.text).toMatch(/href="\/kb\?category=6" aria-current="page"/);
    expect(res.text).toContain('href="/kb/3"');
    expect(res.text).not.toContain('href="/kb/1"');
  });

  it('keeps the category on the next-page link', async () => {
    api.getKnowledgeBaseArticles.mockImplementation(async (token, params) => (
      params.category_id ? { data: [ARTICLES[2]], meta: { has_more: true, cursor: 'abc' } } : { data: ARTICLES, meta: {} }
    ));
    const res = await request(app).get('/kb?category=6');
    expect(res.text).toContain('href="/kb?category=6&amp;cursor=abc"');
  });

  it('shows no category choice when there is only one category', async () => {
    api.getKnowledgeBaseArticles.mockResolvedValue({ data: [ARTICLES[0]], meta: {} });
    const res = await request(app).get('/kb');
    expect(res.text).not.toContain(t('govuk_alpha_kb.categories_label'));
  });
});
