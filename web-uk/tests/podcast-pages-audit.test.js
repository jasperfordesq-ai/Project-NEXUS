// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Podcast pages on the accessible site, from the 2026-10-25 audit against the
 * website and the Laravel API.
 *
 * - The show page dropped every episode whose status was not "published", so a
 *   show's manager saw "No episodes" while the website listed the episode. Not-yet-
 *   live episodes (which the API returns only to the owner and admins) are now
 *   listed with the reason listeners cannot hear them.
 * - The show summary and the episode summary were never shown.
 * - The RSS link read an `rss_url` field the API does not send, so it never appeared.
 * - The owner was offered "Subscribe"; the website offers "Manage" instead.
 * - Editing an uploaded episode posted the platform's own media address back as
 *   `audio_url`, which the API treated as a replacement and deleted the upload.
 * - A mistyped schedule date cleared the existing schedule and reported "saved".
 * - A failed cover upload after a successful create said the episode had failed.
 */

const path = require('path');
const express = require('express');
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
const OWNER_ID = 41;

function buildApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('nl2br', (value) => String(value || ''));
  env.addFilter('string', String);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(`${PREFIX}/podcasts`, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank' },
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

function show(overrides = {}) {
  return {
    id: 5,
    slug: 'tests-show',
    title: 'Tests show',
    summary: 'A short summary of the show',
    description: 'Test description',
    owner_user_id: OWNER_ID,
    owner: { id: OWNER_ID, name: 'Timebank Ireland' },
    status: 'published',
    moderation_status: 'approved',
    visibility: 'public',
    rss_enabled: true,
    episodes: [],
    ...overrides
  };
}

function episode(overrides = {}) {
  return {
    id: 9,
    show_id: 5,
    title: 'Live episode',
    summary: 'Episode summary',
    description: 'Episode description',
    audio_url: 'https://cdn.example.test/live.mp3',
    status: 'published',
    moderation_status: 'approved',
    visibility: 'inherit',
    hosted_audio: false,
    media_scan_status: 'not_required',
    media_processing_status: 'complete',
    ...overrides
  };
}

const app = buildApp();

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 7, name: 'A Listener' } });
});

describe('podcast show page', () => {
  it('lists every episode the API returns to a manager, labelled with why listeners cannot hear it', async () => {
    api.getProfile.mockResolvedValue({ data: { id: OWNER_ID, name: 'Timebank Ireland' } });
    api.callPodcastApi.mockResolvedValueOnce({
      data: show({
        episodes: [
          episode(),
          episode({ id: 10, title: 'Draft episode', status: 'draft' }),
          episode({ id: 11, title: 'Pending episode', moderation_status: 'pending' }),
          episode({ id: 12, title: 'Scheduled episode', scheduled_for: '2999-01-02T09:30:00Z' }),
          episode({ id: 13, title: 'Scanning episode', hosted_audio: true, media_scan_status: 'pending' })
        ]
      })
    });

    const response = await request(app).get(`${PREFIX}/podcasts/5`);

    expect(response.status).toBe(200);
    expect(api.callPodcastApi).toHaveBeenCalledWith('test-token', 'GET', '/5');
    for (const title of ['Live episode', 'Draft episode', 'Pending episode', 'Scheduled episode', 'Scanning episode']) {
      expect(response.text).toContain(title);
    }
    expect(response.text).not.toContain('No episodes have been published yet.');
    expect(response.text).toContain('Episodes with a label are not available to listeners yet.');
    // govukTag puts the label on its own line inside the <strong>.
    expect(response.text).toMatch(/>\s*Draft\s*<\/strong>/);
    expect(response.text).toMatch(/>\s*Awaiting review\s*<\/strong>/);
    // In UTC and named as such (api-instant.js).
    expect(response.text).toMatch(/>\s*Scheduled for 2 January 2999 at 09:30 UTC\s*<\/strong>/);
    expect(response.text).toMatch(/>\s*Audio still being checked\s*<\/strong>/);
    // One label per not-yet-live episode; the live one has none.
    expect((response.text.match(/<strong class="govuk-tag govuk-tag--(yellow|red)/g) || []).length).toBe(4);
    // The owner manages; the website does not offer them "Subscribe".
    expect(response.text).toContain(`href="${PREFIX}/podcasts/studio/5"`);
    expect(response.text).toContain('Manage this podcast');
    expect(response.text).not.toContain('Subscribe to this podcast');
  });

  it('shows a listener the summary, the subscribe button and the feed link, with no manager notice', async () => {
    api.callPodcastApi.mockResolvedValueOnce({ data: show({ episodes: [episode()] }) });

    const response = await request(app).get(`${PREFIX}/podcasts/5`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('A short summary of the show');
    expect(response.text).toContain('Test description');
    expect(response.text).toContain('Subscribe to this podcast');
    expect(response.text).not.toContain('Manage this podcast');
    expect(response.text).not.toContain('Episodes with a label');
    expect(response.text).toContain('href="http://127.0.0.1:8090/api/v2/podcasts/feed/2/tests-show.xml"');
  });

  it('offers no feed link when the API says the feed is off', async () => {
    api.callPodcastApi.mockResolvedValueOnce({ data: show({ rss_enabled: false, episodes: [episode()] }) });

    const response = await request(app).get(`${PREFIX}/podcasts/5`);

    expect(response.text).not.toContain('/feed/');
  });
});

describe('podcast episode page', () => {
  it('shows the summary as well as the description', async () => {
    api.callPodcastApi.mockResolvedValueOnce({ data: { ...episode(), show: { id: 5, title: 'Tests show' } } });

    const response = await request(app).get(`${PREFIX}/podcasts/5/episodes/9`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('Episode summary');
    expect(response.text).toContain('Episode description');
    expect(response.text).not.toContain('Listeners cannot see this episode yet.');
  });

  it('tells a manager that a not-yet-live episode is hidden from listeners', async () => {
    api.callPodcastApi.mockResolvedValueOnce({
      data: { ...episode({ moderation_status: 'rejected' }), show: { id: 5, title: 'Tests show' } }
    });

    const response = await request(app).get(`${PREFIX}/podcasts/5/episodes/9`);

    expect(response.text).toMatch(/govuk-tag--red">\s*Not approved\s*<\/strong>/);
    expect(response.text).toContain('Listeners cannot see this episode yet.');
  });
});

describe('podcast studio', () => {
  function mine(episodes) {
    return {
      data: [show({ episodes })],
      meta: { can_create_show: true, enable_private_shows: false, enable_transcripts: false, enable_chapters: false }
    };
  }

  it('never puts an uploaded episode’s own media address in the edit form', async () => {
    api.callPodcastApi.mockResolvedValueOnce(mine([
      episode({ id: 20, title: 'Uploaded', hosted_audio: true, audio_url: 'https://api.example.test/api/v2/podcasts/media/2/20/audio?expires=1&signature=x' }),
      episode({ id: 21, title: 'Linked', audio_url: 'https://cdn.example.test/linked.mp3' })
    ]));

    const response = await request(app).get(`${PREFIX}/podcasts/studio/5`);

    expect(response.status).toBe(200);
    expect(response.text).not.toContain('id="audio_url-20"');
    expect(response.text).not.toContain('/api/v2/podcasts/media/2/20/audio');
    expect(response.text).toContain('id="audio_url-21"');
    expect(response.text).toContain('value="https://cdn.example.test/linked.mp3"');
  });

  it('refuses a mistyped schedule date instead of clearing the schedule', async () => {
    api.callPodcastApi.mockResolvedValueOnce(mine([]));

    const response = await request(app)
      .post(`${PREFIX}/podcasts/studio/5/update`)
      .type('form')
      .send({
        episode_id: '9',
        episode_title: 'Live episode',
        'scheduled_for-day': '32',
        'scheduled_for-month': '13',
        'scheduled_for-year': '2027',
        'scheduled_for-time': '10:00'
      });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`${PREFIX}/podcasts/studio/5?status=episode-schedule-invalid`);
    const writes = api.callPodcastApi.mock.calls.filter(([, method]) => method !== 'GET');
    expect(writes).toEqual([]);
  });

  it('names the schedule problem on the studio page', async () => {
    api.callPodcastApi.mockResolvedValueOnce(mine([]));

    const response = await request(app).get(`${PREFIX}/podcasts/studio/5?status=episode-schedule-invalid`);

    expect(response.text).toContain('Enter a valid scheduled publication date and time.');
  });

  it('says the episode was added when only its cover upload failed', async () => {
    api.callPodcastApi.mockResolvedValueOnce(mine([]));

    const response = await request(app).get(`${PREFIX}/podcasts/studio/5?status=episode-cover-failed`);

    expect(response.text).toContain('Your episode was added, but its cover image could not be uploaded.');
  });
});
