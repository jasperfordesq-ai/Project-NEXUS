// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The podcast studio and episode page gaps left by the 2026-10-25 audit
 * (podcast-pages-audit.test.js covers the first pass):
 *
 * - Publish was offered for every non-published episode, including ones whose audio
 *   was still being scanned; the API refused and the page said only "could not be
 *   published". It is offered only when it can succeed, and the API's own reason is
 *   shown when something is refused.
 * - Moderation state and moderator feedback were never shown.
 * - There was no archive, and deleting a whole show happened straight from a button.
 * - Chapters had to be typed as raw JSON; plain "0:00 Title" lines are accepted.
 * - Scheduled times are UTC, and are sent to the API with the zone.
 * - Listen figures, subscriber count and the feed check were missing.
 * - The episode page had no like, report, chapter list or transcript download.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const flash = require('express-flash');
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
    callPodcastApi: jest.fn(),
    uploadPodcastArtwork: jest.fn(),
    uploadPodcastEpisode: jest.fn(),
    updatePodcastEpisode: jest.fn(),
    uploadPodcastEpisodeCover: jest.fn(),
    getProfile: jest.fn()
  };
});

const api = require('../src/lib/api');
const podcastRoutes = require('../src/routes/podcasts');
const podcastActionRoutes = require('../src/routes/podcast-actions');

const PREFIX = '/acme/accessible';
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');

function buildApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('nl2br', (value) => String(value || ''));
  env.addFilter('string', String);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'podcast-studio-gaps-test', resave: false, saveUninitialized: true }));
  app.use(flash());
  app.use(`${PREFIX}/podcasts`, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'acme', tenant: { id: 2, slug: 'acme' }, prefix: PREFIX };
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
      currentPath: `${PREFIX}/podcasts`,
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
  }, podcastRoutes, podcastActionRoutes);
  return app;
}

function episode(overrides = {}) {
  return {
    id: 9,
    show_id: 5,
    title: 'Ready draft',
    audio_url: 'https://cdn.example.test/a.mp3',
    status: 'draft',
    moderation_status: 'approved',
    visibility: 'inherit',
    hosted_audio: false,
    media_scan_status: 'not_required',
    media_processing_status: 'complete',
    ...overrides
  };
}

function mine(showOverrides = {}, episodes = [episode()]) {
  return {
    data: [{
      id: 5,
      slug: 'tests-show',
      title: 'Tests show',
      status: 'published',
      moderation_status: 'approved',
      visibility: 'public',
      subscriber_count: 3,
      episodes,
      ...showOverrides
    }],
    meta: { can_create_show: true, enable_private_shows: false, enable_transcripts: true, enable_chapters: true, enable_rss_feed: true }
  };
}

function routeApi({ mineResult = mine(), stats = { data: { enabled: false } }, other = {} } = {}) {
  api.callPodcastApi.mockImplementation(async (_token, method, apiPath, body) => {
    if (method === 'GET' && apiPath === '/mine') return mineResult;
    if (method === 'GET' && apiPath.startsWith('/5/stats')) return stats;
    const key = `${method} ${apiPath}`;
    if (other[key] instanceof Error) throw other[key];
    if (typeof other[key] === 'function') return other[key](body);
    if (other[key] !== undefined) return other[key];
    return { data: {} };
  });
}

const app = buildApp();

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 7, name: 'A Member' } });
});

describe('studio episode list', () => {
  it('offers Publish only when the API will accept it, and says why not otherwise', async () => {
    routeApi({
      mineResult: mine({}, [
        episode(),
        episode({ id: 10, title: 'Scanning draft', hosted_audio: true, media_scan_status: 'pending', media_processing_status: 'pending' }),
        episode({ id: 11, title: 'Pending review', status: 'published', moderation_status: 'pending', moderation_feedback: 'Please trim the intro.' }),
        episode({ id: 12, title: 'Live one', status: 'published' })
      ])
    });

    const response = await request(app).get(`${PREFIX}/podcasts/studio/5`);

    expect(response.status).toBe(200);
    expect(response.text).toContain(`action="${PREFIX}/podcasts/studio/5/episodes/9/publish"`);
    expect(response.text).not.toContain(`action="${PREFIX}/podcasts/studio/5/episodes/10/publish"`);
    expect(response.text).not.toContain(`action="${PREFIX}/podcasts/studio/5/episodes/11/publish"`);
    expect(response.text).not.toContain(`action="${PREFIX}/podcasts/studio/5/episodes/12/publish"`);
    expect(response.text).toMatch(/>\s*Audio still being checked\s*</);
    expect(response.text).toMatch(/>\s*Awaiting review\s*</);
    expect(response.text).toContain('Moderator feedback: Please trim the intro.');
    expect(response.text).toContain(`href="${PREFIX}/podcasts/studio/5/episodes/12/archive"`);
  });

  it('links to confirmation pages for deleting and archiving the show, and to the feed check', async () => {
    routeApi();

    const response = await request(app).get(`${PREFIX}/podcasts/studio/5`);

    expect(response.text).toContain(`href="${PREFIX}/podcasts/studio/5/delete"`);
    expect(response.text).not.toContain(`action="${PREFIX}/podcasts/studio/5/delete"`);
    expect(response.text).toContain(`href="${PREFIX}/podcasts/studio/5/archive"`);
    expect(response.text).toContain(`href="${PREFIX}/podcasts/studio/5/feed-check"`);
  });

  it('shows listen figures and the subscriber count', async () => {
    routeApi({
      stats: {
        data: {
          enabled: true,
          days: 30,
          totals: { listens: 42, unique_listeners: 17, completion_rate: 61, subscribers: 3 },
          top_episodes: [{ title: 'Live one', listen_count: 40 }]
        }
      }
    });

    const response = await request(app).get(`${PREFIX}/podcasts/studio/5`);

    expect(api.callPodcastApi).toHaveBeenCalledWith('test-token', 'GET', '/5/stats?days=30');
    expect(response.text).toContain('Listens and listeners cover the last 30 days.');
    expect(response.text).toMatch(/Different listeners<\/dt>\s*<dd class="govuk-summary-list__value">17</);
    expect(response.text).toContain('61%');
    expect(response.text).toContain('Live one — 40 listens');
  });

  it('still shows the subscriber count when listen analytics are off', async () => {
    routeApi();

    const response = await request(app).get(`${PREFIX}/podcasts/studio/5`);

    expect(response.text).toMatch(/Subscribers<\/dt>\s*<dd class="govuk-summary-list__value">3</);
    expect(response.text).not.toContain('Different listeners');
  });

  it('does not put the summary into the Description box of the edit form', async () => {
    // The box used the display fallback (description, else summary), so saving any edit
    // copied the summary into the description and the episode page showed it twice.
    routeApi({ mineResult: mine({}, [episode({ summary: 'Only a summary', description: null })]) });

    const response = await request(app).get(`${PREFIX}/podcasts/studio/5`);

    expect(response.text).toMatch(/name="episode_description" rows="3">\s*<\/textarea>/);
    expect(response.text).toContain('value="Only a summary"');
  });

  it('shows chapters for editing as plain lines', async () => {
    routeApi({ mineResult: mine({}, [episode({ chapters: [{ title: 'Introduction', starts_at_seconds: 0 }, { title: 'Questions', starts_at_seconds: 3750 }] })]) });

    const response = await request(app).get(`${PREFIX}/podcasts/studio/5`);

    expect(response.text).toContain('0:00 Introduction\n1:02:30 Questions');
  });
});

describe('studio actions', () => {
  it('shows the API’s own reason when it refuses to publish', async () => {
    const agent = request.agent(app);
    routeApi({
      other: {
        'POST /5/episodes/9/publish': new api.ApiError('Conflict', 409, {
          errors: [{ code: 'MEDIA_NOT_READY', message: 'The audio is still being checked for safety.' }]
        })
      }
    });

    const publish = await agent.post(`${PREFIX}/podcasts/studio/5/episodes/9/publish`);
    expect(publish.headers.location).toBe(`${PREFIX}/podcasts/studio/5?status=episode-publish-failed`);

    const page = await agent.get(`${PREFIX}/podcasts/studio/5?status=episode-publish-failed`);
    expect(page.text).toContain('Sorry, your episode could not be published. Please try again.');
    expect(page.text).toContain('The audio is still being checked for safety.');
  });

  it('archives a show and an episode through the API', async () => {
    routeApi();

    const show = await request(app).post(`${PREFIX}/podcasts/studio/5/archive`);
    const ep = await request(app).post(`${PREFIX}/podcasts/studio/5/episodes/9/archive`);

    expect(api.callPodcastApi).toHaveBeenCalledWith('test-token', 'POST', '/5/archive');
    expect(api.callPodcastApi).toHaveBeenCalledWith('test-token', 'POST', '/5/episodes/9/archive');
    expect(show.headers.location).toBe(`${PREFIX}/podcasts/studio/5?status=show-archived`);
    expect(ep.headers.location).toBe(`${PREFIX}/podcasts/studio/5?status=episode-archived`);
  });

  it('asks before archiving or deleting the whole show', async () => {
    const archive = await request(app).get(`${PREFIX}/podcasts/studio/5/archive`);
    const remove = await request(app).get(`${PREFIX}/podcasts/studio/5/delete`);

    expect(archive.text).toContain('Archive this podcast?');
    expect(archive.text).toContain(`action="${PREFIX}/podcasts/studio/5/archive"`);
    expect(remove.text).toContain('Delete this show?');
    expect(remove.text).toContain(`action="${PREFIX}/podcasts/studio/5/delete"`);
    expect(api.callPodcastApi).not.toHaveBeenCalledWith('test-token', 'DELETE', '/5');
  });

  it('saves chapters typed as lines, and sends the schedule as UTC', async () => {
    let sent = null;
    routeApi({ other: { 'PUT /5/episodes/9': (body) => { sent = body; return { data: {} }; } } });

    const response = await request(app)
      .post(`${PREFIX}/podcasts/studio/5/update`)
      .type('form')
      .send({
        episode_id: '9',
        episode_title: 'Ready draft',
        chapters_json: '0:00 Introduction\n12:05 Main part\n1:02:30 Questions',
        'scheduled_for-day': '2',
        'scheduled_for-month': '1',
        'scheduled_for-year': '2027',
        'scheduled_for-time': '09:30'
      });

    expect(response.headers.location).toBe(`${PREFIX}/podcasts/studio/5?status=episode-saved`);
    expect(sent.chapters).toEqual([
      { title: 'Introduction', starts_at_seconds: 0, position: 0 },
      { title: 'Main part', starts_at_seconds: 725, position: 1 },
      { title: 'Questions', starts_at_seconds: 3750, position: 2 }
    ]);
    expect(sent.scheduled_for).toBe('2027-01-02T09:30:00Z');
  });

  it('refuses a chapter line with no start time', async () => {
    routeApi();

    const response = await request(app)
      .post(`${PREFIX}/podcasts/studio/5/update`)
      .type('form')
      .send({ episode_id: '9', episode_title: 'Ready draft', chapters_json: 'Introduction without a time' });

    expect(response.headers.location).toBe(`${PREFIX}/podcasts/studio/5?status=episode-chapters-invalid`);
    expect(api.callPodcastApi.mock.calls.filter(([, method]) => method !== 'GET')).toEqual([]);
  });

  it('explains what podcast apps need on the feed check page', async () => {
    routeApi({
      other: {
        'GET /5/validate-feed': {
          data: { valid: false, errors: ['show_not_public', 'episode_12_missing_audio_url', 'episode_13_missing_audio_url'], warnings: ['missing_artwork'], skipped_episode_count: 2 }
        }
      }
    });

    const response = await request(app).get(`${PREFIX}/podcasts/studio/5/feed-check`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('cannot read this podcast’s feed yet');
    expect(response.text).toContain('The podcast must be public, published and approved.');
    expect((response.text.match(/An episode has no working audio link\./g) || []).length).toBe(1);
    expect(response.text).toContain('Add artwork for the podcast.');
    expect(response.text).toContain('2 episodes will be left out of the feed until their audio is fixed.');
  });
});

describe('episode page', () => {
  function episodeResponse(overrides = {}) {
    return {
      data: {
        ...episode({ status: 'published' }),
        slug: 'ready-draft',
        show: { id: 5, title: 'Tests show' },
        reactions_enabled: true,
        viewer_has_reacted: false,
        reaction_count: 2,
        transcript: 'Hello listeners.',
        chapters: [{ title: 'Introduction', starts_at_seconds: 0 }, { title: 'Questions', starts_at_seconds: 125 }],
        ...overrides
      }
    };
  }

  it('offers like, report, the chapter list and the transcript download', async () => {
    routeApi({ other: { 'GET /5/9': episodeResponse() } });

    const response = await request(app).get(`${PREFIX}/podcasts/5/episodes/9`);

    expect(response.text).toContain(`action="${PREFIX}/podcasts/5/episodes/9/like"`);
    expect(response.text).toContain('name="active" value="1"');
    expect(response.text).toContain('Like this episode');
    expect(response.text).toContain('2 likes');
    expect(response.text).toContain(`href="${PREFIX}/podcasts/5/episodes/9/report"`);
    expect(response.text).toMatch(/2:05<\/span> Questions/);
    expect(response.text).toContain(`href="${PREFIX}/podcasts/5/episodes/9/transcript.txt"`);
  });

  it('hides likes when the community has switched them off', async () => {
    routeApi({ other: { 'GET /5/9': episodeResponse({ reactions_enabled: false }) } });

    const response = await request(app).get(`${PREFIX}/podcasts/5/episodes/9`);

    expect(response.text).not.toContain('/like"');
    expect(response.text).toContain('Report this episode');
  });

  it('sends the like state the member asked for', async () => {
    routeApi();

    const response = await request(app).post(`${PREFIX}/podcasts/5/episodes/9/like`).type('form').send({ active: '0' });

    expect(api.callPodcastApi).toHaveBeenCalledWith('test-token', 'POST', '/episodes/9/reaction', { reaction: 'like', active: false });
    expect(response.headers.location).toBe(`${PREFIX}/podcasts/5/episodes/9?status=unliked`);
  });

  it('asks for a reason before sending a report, then sends it', async () => {
    routeApi();

    const missing = await request(app).post(`${PREFIX}/podcasts/5/episodes/9/report`).type('form').send({ details: 'x' });
    expect(missing.status).toBe(422);
    expect(missing.text).toContain('Select why you are reporting this episode');
    expect(api.callPodcastApi).not.toHaveBeenCalled();

    const sent = await request(app).post(`${PREFIX}/podcasts/5/episodes/9/report`).type('form').send({ reason: 'rights', details: 'My song at 2:00' });
    expect(api.callPodcastApi).toHaveBeenCalledWith('test-token', 'POST', '/episodes/9/report', { reason: 'rights', details: 'My song at 2:00' });
    expect(sent.headers.location).toBe(`${PREFIX}/podcasts/5/episodes/9?status=reported`);
  });

  it('serves the transcript as a text file', async () => {
    routeApi({ other: { 'GET /5/9': episodeResponse() } });

    const response = await request(app).get(`${PREFIX}/podcasts/5/episodes/9/transcript.txt`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.headers['content-disposition']).toBe('attachment; filename="ready-draft-transcript.txt"');
    expect(response.text).toBe('Hello listeners.');
  });
});
