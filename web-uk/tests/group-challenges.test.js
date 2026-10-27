// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group challenges (deep React parity audit, 27 Oct 2026, item 6:
 * react-frontend/src/pages/groups/tabs/GroupChallengesTab.tsx +
 * api/challenges.ts). Members see active challenges and their progress and the
 * challenge history; group admins create challenges and cancel active ones
 * (after a confirmation page).
 */
const request = require('supertest');

jest.mock('../src/lib/api', () => require('./support/api-mock').apiMockFactory([
  'getGroup', 'getProfile', 'callGroupApi'
]));

const api = require('../src/lib/api');
const challengeRoutes = require('../src/routes/group-challenges');
const { groupMediaApp, t } = require('./support/group-media-app');

const app = groupMediaApp([challengeRoutes]);

const MEMBER = { data: { id: 974, name: 'Repair crew', viewer_membership: { status: 'active', role: 'member', is_admin: false } } };
const ADMIN = { data: { id: 974, name: 'Repair crew', viewer_membership: { status: 'active', role: 'admin', is_admin: true } } };

function challenge(overrides = {}) {
  return {
    id: 3,
    group_id: 974,
    title: 'Fifty posts in October',
    description: 'Share what you repaired this month.',
    metric: 'posts',
    target_value: 50,
    current_value: 20,
    reward_xp: 25,
    status: 'active',
    progress_percentage: 40,
    starts_at: '2026-10-01T00:00:00+00:00',
    ends_at: '2026-10-31T00:00:00+00:00',
    completed_at: null,
    creator: { id: 11, name: 'Ann Lee', avatar_url: null },
    ...overrides
  };
}

const VALID = {
  _csrf: 'csrf',
  title: 'Ten new members',
  description: 'Invite your neighbours to join.',
  metric: 'members',
  target_value: '10',
  reward_xp: '50',
  'ends_at-day': '15',
  'ends_at-month': '1',
  'ends_at-year': '2030'
};

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 11 } });
  api.getGroup.mockResolvedValue(MEMBER);
  api.callGroupApi.mockResolvedValue({ data: [] });
});

describe('the challenges page', () => {
  it('shows active challenges with progress and the history, without admin tools for a member', async () => {
    api.callGroupApi.mockResolvedValue({
      data: [
        challenge(),
        challenge({ id: 4, title: 'Spring clean files', metric: 'files', status: 'completed', current_value: 10, target_value: 10, progress_percentage: 100, completed_at: '2026-04-02T10:00:00+00:00' })
      ]
    });
    const res = await request(app).get('/groups/974/challenges');
    expect(res.status).toBe(200);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/challenges?all=1');
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.active_heading'));
    expect(res.text).toContain('Fifty posts in October');
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.progress_value', { current: 20, target: 50, percent: 40 }));
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.metric_posts'));
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.reward_value', { xp: 25 }));
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.history_heading'));
    expect(res.text).toContain('Spring clean files');
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.status_completed'));
    expect(res.text).not.toContain('href="/groups/974/challenges/new"');
    expect(res.text).not.toContain('/challenges/3/cancel');
  });

  it('gives a group admin the create and cancel tools (cancel only on active ones)', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    api.callGroupApi.mockResolvedValue({ data: [challenge(), challenge({ id: 4, status: 'completed' })] });
    const res = await request(app).get('/groups/974/challenges');
    expect(res.text).toContain('href="/groups/974/challenges/new"');
    expect(res.text).toContain('href="/groups/974/challenges/3/cancel"');
    expect(res.text).not.toContain('href="/groups/974/challenges/4/cancel"');
  });

  it('shows the empty state', async () => {
    const res = await request(app).get('/groups/974/challenges');
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.empty_title'));
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.empty_member'));
  });

  it('is not there when the community switched challenges off', async () => {
    const offApp = groupMediaApp([challengeRoutes], { tenant: { group_tabs: { tab_challenges: false } } });
    const res = await request(offApp).get('/groups/974/challenges');
    expect(res.status).toBe(404);
    expect(api.callGroupApi).not.toHaveBeenCalled();
  });

  it('refuses someone who is not a member', async () => {
    api.getGroup.mockResolvedValue({ data: { id: 974, name: 'Repair crew', viewer_membership: { status: 'pending', is_admin: false } } });
    const res = await request(app).get('/groups/974/challenges');
    expect(res.status).toBe(403);
  });
});

describe('creating a challenge', () => {
  it('is for group admins only', async () => {
    const res = await request(app).get('/groups/974/challenges/new');
    expect(res.status).toBe(403);
    const post = await request(app).post('/groups/974/challenges/new').type('form').send(VALID);
    expect(post.status).toBe(403);
    expect(api.callGroupApi).not.toHaveBeenCalledWith('token:test', 'POST', expect.anything(), expect.anything());
  });

  it('shows the form with every metric and reward choice', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    const res = await request(app).get('/groups/974/challenges/new');
    expect(res.status).toBe(200);
    ['posts', 'discussions', 'members', 'files'].forEach((metric) => expect(res.text).toContain(`value="${metric}"`));
    ['0', '25', '50', '100'].forEach((reward) => expect(res.text).toContain(`value="${reward}"`));
    expect(res.text).toContain('name="ends_at-day"');
    expect(res.text).toContain('action="/groups/974/challenges/new"');
  });

  it('sends a valid challenge to the API and says it was created', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    api.callGroupApi.mockResolvedValue({ data: challenge({ id: 8 }) });
    const res = await request(app).post('/groups/974/challenges/new').type('form').send(VALID);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', '/974/challenges', {
      title: 'Ten new members',
      description: 'Invite your neighbours to join.',
      metric: 'members',
      target_value: 10,
      reward_xp: 50,
      ends_at: '2030-01-15'
    });
    expect(res.headers.location).toBe('/groups/974/challenges?status=created');
  });

  it('re-shows the form with linked errors and keeps what was typed', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    const res = await request(app).post('/groups/974/challenges/new').type('form').send({
      _csrf: 'csrf', title: 'Hi', description: 'short', metric: 'votes', target_value: '0', reward_xp: '7'
    });
    expect(res.status).toBe(422);
    expect(api.callGroupApi).not.toHaveBeenCalledWith('token:test', 'POST', expect.anything(), expect.anything());
    expect(res.text).toContain('govuk-error-summary');
    expect(res.text).toContain('href="#title"');
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.errors.title_length'));
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.errors.description_length'));
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.errors.metric_required'));
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.errors.target_invalid'));
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.errors.reward_invalid'));
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.errors.ends_required'));
    expect(res.text).toContain('value="Hi"');
    expect(res.text).toMatch(/<title>Error: /);
  });

  it('refuses an end date that is not after today', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    const res = await request(app).post('/groups/974/challenges/new').type('form').send({
      ...VALID, 'ends_at-day': '1', 'ends_at-month': '1', 'ends_at-year': '2020'
    });
    expect(res.status).toBe(422);
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.errors.ends_past'));
  });

  it('shows the API field error when Laravel refuses the challenge', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    api.callGroupApi.mockRejectedValue(new api.ApiError('Invalid date', 422, { errors: [{ code: 'VALIDATION_ERROR', message: 'Invalid date', field: 'ends_at' }] }));
    const res = await request(app).post('/groups/974/challenges/new').type('form').send(VALID);
    expect(res.status).toBe(422);
    expect(res.text).toContain('href="#ends_at-day"');
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.errors.ends_past'));
  });

  it('explains the active-challenge limit', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    api.callGroupApi.mockRejectedValue(new api.ApiError('Limit', 422, { errors: [{ code: 'CHALLENGE_LIMIT_REACHED', message: 'Limit' }] }));
    const res = await request(app).post('/groups/974/challenges/new').type('form').send(VALID);
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.states.limit'));
  });
});

describe('cancelling a challenge', () => {
  it('asks for confirmation, naming the challenge', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    api.callGroupApi.mockResolvedValue({ data: [challenge()] });
    const res = await request(app).get('/groups/974/challenges/3/cancel');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_group_media.challenges.cancel_title', { title: 'Fifty posts in October' }));
    expect(res.text).toContain('action="/groups/974/challenges/3/cancel"');
  });

  it('cancels on confirmation', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    api.callGroupApi.mockResolvedValue({ data: { changed: true } });
    const res = await request(app).post('/groups/974/challenges/3/cancel').type('form').send({ _csrf: 'csrf' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'DELETE', '/974/challenges/3');
    expect(res.headers.location).toBe('/groups/974/challenges?status=cancelled');
  });

  it('explains when a challenge can no longer be cancelled', async () => {
    api.getGroup.mockResolvedValue(ADMIN);
    api.callGroupApi.mockRejectedValue(new api.ApiError('Immutable', 409, { errors: [{ code: 'CHALLENGE_IMMUTABLE' }] }));
    const res = await request(app).post('/groups/974/challenges/3/cancel').type('form').send({ _csrf: 'csrf' });
    expect(res.headers.location).toBe('/groups/974/challenges?status=cancel-conflict');
  });

  it('is for group admins only', async () => {
    const res = await request(app).post('/groups/974/challenges/3/cancel').type('form').send({ _csrf: 'csrf' });
    expect(res.status).toBe(403);
  });
});
