// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group Q&A (deep React parity audit 27 Oct 2026, item: questions/answers/vote/accept).
 * React: pages/groups/api/qa.ts, tabs/GroupQATab.tsx, section rule `qa` (tab_qa +
 * membership) in groupSections.ts.
 */
const request = require('supertest');

jest.mock('../src/lib/api', () => require('./support/group-tools-app').apiMockFactory());

const api = require('../src/lib/api');
const { mountGroupTools, MEMBER_GROUP, ADMIN_GROUP, OUTSIDER_GROUP } = require('./support/group-tools-app');
const { createTranslator } = require('../src/lib/localization');
const router = require('../src/routes/group-qa');

const t = createTranslator('en');
const app = mountGroupTools(router);

const QUESTION = {
  id: 31, group_id: 974, title: 'Where are the ladders kept?', body: 'Need one on Saturday.',
  vote_count: 2, user_vote: 0, answer_count: 1, has_accepted_answer: false,
  author: { id: 5, name: 'Ann Lee', avatar: null }, created_at: '2026-10-20T10:00:00Z'
};
const ANSWER = {
  id: 81, question_id: 31, body: 'In the shed.', vote_count: 1, user_vote: 1, is_accepted: false,
  author: { id: 9, name: 'Bo Kim', avatar: null }, created_at: '2026-10-21T10:00:00Z'
};

beforeEach(() => {
  jest.clearAllMocks();
  app.locals.groupTabs = {};
  api.getProfile.mockResolvedValue({ data: { id: 5 } });
  api.getGroup.mockResolvedValue(MEMBER_GROUP);
  api.callGroupApi.mockResolvedValue({ data: { items: [], cursor: null, has_more: false } });
});

describe('Q&A list', () => {
  it('lists questions with the default sort and offers asking one', async () => {
    api.callGroupApi.mockResolvedValue({ data: { items: [QUESTION], cursor: 'c2', has_more: true } });
    const res = await request(app).get('/groups/974/qa');
    expect(res.status).toBe(200);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/questions?sort=newest&per_page=20');
    expect(res.text).toContain('Where are the ladders kept?');
    expect(res.text).toContain('href="/groups/974/qa/31"');
    expect(res.text).toContain('href="/groups/974/qa/ask"');
    expect(res.text).toContain('href="/groups/974/qa?sort=newest&amp;cursor=c2"');
    expect(res.text).toContain('method="get"');
  });

  it('searches and sorts with a GET filter', async () => {
    await request(app).get('/groups/974/qa?sort=unanswered&q=ladder');
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/questions?sort=unanswered&per_page=20&q=ladder');
  });

  it('ignores an unknown sort', async () => {
    await request(app).get('/groups/974/qa?sort=evil');
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/questions?sort=newest&per_page=20');
  });

  it('shows an empty state', async () => {
    const res = await request(app).get('/groups/974/qa');
    expect(res.text).toContain(t('govuk_alpha_group_tools.qa.empty_title'));
  });

  it('answers 404 when the community switched Q&A off', async () => {
    app.locals.groupTabs = { tab_qa: false };
    const res = await request(app).get('/groups/974/qa');
    expect(res.status).toBe(404);
    expect(api.callGroupApi).not.toHaveBeenCalled();
  });

  it('refuses someone who is not a member', async () => {
    api.getGroup.mockResolvedValue(OUTSIDER_GROUP);
    const res = await request(app).get('/groups/974/qa');
    expect(res.status).toBe(403);
    expect(api.callGroupApi).not.toHaveBeenCalled();
  });

  it('refuses posting a question when the community switched Q&A off', async () => {
    app.locals.groupTabs = { tab_qa: '0' };
    const res = await request(app).post('/groups/974/qa/ask').type('form').send({ title: 'x', body: 'y' });
    expect(res.status).toBe(404);
    expect(api.callGroupApi).not.toHaveBeenCalled();
  });
});

describe('asking a question', () => {
  it('renders the form', async () => {
    const res = await request(app).get('/groups/974/qa/ask');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="title"');
    expect(res.text).toContain('name="body"');
    expect(res.text).toContain('name="_csrf"');
  });

  it('posts title and body, then opens the new question', async () => {
    api.callGroupApi.mockResolvedValue({ data: { id: 32, title: 'Ladders?' } });
    const res = await request(app).post('/groups/974/qa/ask').type('form').send({ title: ' Ladders? ', body: 'Where?' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', '/974/questions', { title: 'Ladders?', body: 'Where?' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/groups/974/qa/32?status=question-asked');
  });

  it('shows errors for empty fields without calling the API', async () => {
    const res = await request(app).post('/groups/974/qa/ask').type('form').send({ title: '', body: '' });
    expect(res.status).toBe(422);
    expect(api.callGroupApi).not.toHaveBeenCalled();
    expect(res.text).toContain(t('govuk_alpha_group_tools.qa.title_required'));
    expect(res.text).toContain(t('govuk_alpha_group_tools.qa.body_required'));
    expect(res.text).toContain('href="#title"');
  });
});

describe('a question and its answers', () => {
  beforeEach(() => {
    api.callGroupApi.mockImplementation(async (token, method, pathValue) => {
      if (method === 'GET' && pathValue === '/974/questions/31') return { data: { ...QUESTION, answers: [ANSWER] } };
      return { data: {} };
    });
  });

  it('shows the question, answers, vote forms and an answer form', async () => {
    const res = await request(app).get('/groups/974/qa/31');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Where are the ladders kept?');
    expect(res.text).toContain('In the shed.');
    expect(res.text).toContain('action="/groups/974/qa/31/vote"');
    expect(res.text).toContain('name="target_id" value="81"');
    expect(res.text).toContain('action="/groups/974/qa/31/answers"');
  });

  it('lets the question author accept an answer', async () => {
    const res = await request(app).get('/groups/974/qa/31');
    expect(res.text).toContain('action="/groups/974/qa/31/answers/81/accept"');
  });

  it('does not offer accepting to another member', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 77 } });
    const res = await request(app).get('/groups/974/qa/31');
    expect(res.text).not.toContain('/answers/81/accept');
  });

  it('offers accepting to a group admin', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 77 } });
    api.getGroup.mockResolvedValue(ADMIN_GROUP);
    const res = await request(app).get('/groups/974/qa/31');
    expect(res.text).toContain('action="/groups/974/qa/31/answers/81/accept"');
  });

  it('posts an answer', async () => {
    const res = await request(app).post('/groups/974/qa/31/answers').type('form').send({ body: 'Behind the hall.' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', '/974/questions/31/answers', { body: 'Behind the hall.' });
    expect(res.headers.location).toBe('/groups/974/qa/31?status=answer-posted#answers');
  });

  it('refuses an empty answer', async () => {
    const res = await request(app).post('/groups/974/qa/31/answers').type('form').send({ body: ' ' });
    expect(res.headers.location).toBe('/groups/974/qa/31?status=answer-required#answer-form');
    expect(api.callGroupApi).not.toHaveBeenCalledWith('token:test', 'POST', expect.anything(), expect.anything());
  });

  it('votes on an answer', async () => {
    const res = await request(app).post('/groups/974/qa/31/vote').type('form').send({ type: 'answer', target_id: '81', vote: '-1' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', '/974/qa/vote', { type: 'answer', target_id: 81, vote: -1 });
    expect(res.headers.location).toBe('/groups/974/qa/31?status=voted');
  });

  it('rejects a malformed vote', async () => {
    const res = await request(app).post('/groups/974/qa/31/vote').type('form').send({ type: 'poll', target_id: '81', vote: '5' });
    expect(res.headers.location).toBe('/groups/974/qa/31?status=vote-failed');
    expect(api.callGroupApi).not.toHaveBeenCalledWith('token:test', 'POST', '/974/qa/vote', expect.anything());
  });

  it('accepts an answer', async () => {
    const res = await request(app).post('/groups/974/qa/31/answers/81/accept').type('form').send({});
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', '/974/answers/81/accept');
    expect(res.headers.location).toBe('/groups/974/qa/31?status=accepted');
  });

  it('reports a refused accept', async () => {
    api.callGroupApi.mockRejectedValue(new api.ApiError('Forbidden', 403, {}));
    const res = await request(app).post('/groups/974/qa/31/answers/81/accept').type('form').send({});
    expect(res.headers.location).toBe('/groups/974/qa/31?status=accept-failed');
  });

  it('shows the success banner', async () => {
    const res = await request(app).get('/groups/974/qa/31?status=accepted');
    expect(res.text).toContain(t('govuk_alpha_group_tools.qa.accept_success'));
  });
});

describe('translations', () => {
  it('renders no raw translation keys', async () => {
    api.callGroupApi.mockImplementation(async (token, method, pathValue) => (
      pathValue === '/974/questions/31' ? { data: { ...QUESTION, answers: [ANSWER] } } : { data: { items: [QUESTION] } }
    ));
    for (const url of ['/groups/974/qa', '/groups/974/qa/ask', '/groups/974/qa/31?status=voted']) {
      const res = await request(app).get(url);
      expect(res.text).not.toMatch(/govuk_alpha_group_tools\.|govuk_alpha_groups\.common|web_uk\./);
    }
  });
});
