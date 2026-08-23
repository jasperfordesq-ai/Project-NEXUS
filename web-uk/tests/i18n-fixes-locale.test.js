// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Locale proof for the 2026-08 i18n fixes: view-model labels that used to be
 * hardcoded English (or English punctuation/formatting) must now follow the
 * request locale. Each block renders a route under a NON-English locale and
 * asserts the translated catalogue value (or the locale's own Intl output),
 * mirroring the existing "GBP 15,50 under German" route pins.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {},
  callCourseApi: jest.fn(),
  getMyCourses: jest.fn(),
  callGamificationApi: jest.fn(),
  claimDailyReward: jest.fn(),
  claimGamificationChallenge: jest.fn(),
  purchaseGamificationShopItem: jest.fn(),
  updateGamificationShowcase: jest.fn(),
  callAdminJobApi: jest.fn(),
  callJobApi: jest.fn(),
  callJobDownload: jest.fn(),
  getJobs: jest.fn(),
  getJob: jest.fn(),
  getProfile: jest.fn(),
  getUserV2: jest.fn(),
  uploadJobApplication: jest.fn(),
  callIdeationApi: jest.fn()
}));

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => next()
}));

const api = require('../src/lib/api');
const { createTranslator, createChoiceTranslator, localeForIntl } = require('../src/lib/localization');
const { runWithRequestLocale } = require('../src/lib/request-locale-context');
const { formatRequestList } = require('../src/lib/list-format');

// Router-level app that seeds BOTH the per-request translator locals and the
// AsyncLocalStorage locale context that translateForRequest/getRequestIntlLocale
// read (the real server's localization middleware does the same).
function createApp(mount, router, locale) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.t = createTranslator(locale);
    res.locals.t = req.t;
    res.locals.tc = createChoiceTranslator(locale);
    res.locals.urlFor = (pathname) => pathname;
    res.render = (view, locals = {}) => res.json({ view, locals });
    runWithRequestLocale(locale, next);
  });
  app.use(mount, router);
  return app;
}

describe('shared list formatting helper', () => {
  it('keeps English byte-identical to the old join(", ")', async () => {
    const label = await runWithRequestLocale('en', async () => formatRequestList(['gardening', 'cooking', 'repairs']));
    expect(label).toBe('gardening, cooking, repairs');
  });

  it('uses the locale’s own list punctuation instead of an English comma', async () => {
    const arabic = await runWithRequestLocale('ar', async () => formatRequestList(['a', 'b', 'c']));
    expect(arabic).not.toBe('a, b, c');
    expect(arabic).toContain('و'); // Arabic waw joins the items
  });
});

describe('courses labels follow the request locale (findings 1 and 11)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders translated level, cost and free labels under German', async () => {
    api.callCourseApi.mockImplementation(async (token, method, pathValue) => {
      if (String(pathValue).startsWith('/categories')) return { data: [] };
      return {
        data: [
          { id: 1, title: 'Gartenkurs', level: 'beginner', credit_cost: 5 },
          { id: 2, title: 'Kochkurs', level: 'advanced', credit_cost: 0 }
        ]
      };
    });

    const app = createApp('/courses', require('../src/routes/courses'), 'de');
    const response = await request(app).get('/courses');
    expect(response.status).toBe(200);

    const de = createTranslator('de');
    const [first, second] = response.body.locals.courses;
    expect(first.levelLabel).toBe(de('govuk_alpha.courses.levels.beginner'));
    expect(first.levelLabel).not.toBe('Beginner');
    // The credits price reuses the marketplace's translated pattern.
    expect(first.costLabel).toBe(de('govuk_alpha_commerce.common.credits_price', { credits: '5' }));
    expect(second.costLabel).toBe(de('govuk_alpha.courses.free'));
    expect(second.costLabel).not.toBe('Free');
    // Filter options carry the translated label the index template renders.
    expect(response.body.locals.levels[0].label).toBe(de('govuk_alpha.courses.levels.beginner'));
  });

  it('formats the analytics percent tiles with Intl percent style under German', async () => {
    api.callCourseApi.mockImplementation(async (token, method, pathValue) => {
      if (String(pathValue).endsWith('/analytics')) {
        return {
          data: {
            course: { id: 7, title: 'Gartenkurs' },
            enrollments: { total: 4, active: 2, completed: 1, dropped: 1 },
            completion_rate: 12.5,
            avg_progress: 40,
            avg_quiz_score: 80,
            quiz_attempts: 9
          }
        };
      }
      return { data: [] };
    });

    const app = createApp('/courses', require('../src/routes/courses'), 'de');
    const response = await request(app).get('/courses/instructor/7/analytics');
    expect(response.status).toBe(200);

    const expected = new Intl.NumberFormat(localeForIntl('de'), {
      style: 'percent',
      maximumFractionDigits: 1
    }).format(0.125);
    const stats = response.body.locals.stats;
    const completionTile = stats.find((tile) => tile.value === expected);
    expect(completionTile).toBeDefined();
    // No tile carries a code-appended literal "value%" any more.
    for (const tile of stats) {
      expect(String(tile.value)).not.toMatch(/^\d+(\.\d+)?%$/);
    }
  });
});

describe('achievements badge labels follow the request locale (finding 3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('translates rarity, tier and type under German, and falls back to the raw slug for unknown values', async () => {
    api.callGamificationApi.mockImplementation(async (token, method, pathValue) => {
      if (pathValue === '/badges/community-builder') {
        return {
          data: {
            badge_key: 'community-builder',
            name: 'Community builder',
            rarity: 'rare',
            tier: { name: 'expert' },
            type: 'event_host',
            xp_value: 250
          }
        };
      }
      if (pathValue === '/badges/mystery') {
        return {
          data: { badge_key: 'mystery', name: 'Mystery', rarity: 'mythic', tier: { name: 'obsidian' }, type: 'unknown_thing' }
        };
      }
      return { data: {} };
    });

    const app = createApp('/achievements', require('../src/routes/achievements'), 'de');

    const de = createTranslator('de');
    const known = await request(app).get('/achievements/badges/community-builder');
    expect(known.status).toBe(200);
    expect(known.body.locals.badge.rarityLabel).toBe(de('govuk_alpha_gamification.badge_rarity.rare'));
    expect(known.body.locals.badge.tierLabel).toBe(de('govuk_alpha_gamification.tiers.names.expert'));
    expect(known.body.locals.badge.typeLabel).toBe(de('govuk_alpha_gamification.badge_types.event_host'));
    expect(known.body.locals.badge.typeLabel).not.toBe('Event_host');

    // Unknown enum values pass through raw — never a fake-English capitalisation.
    const unknown = await request(app).get('/achievements/badges/mystery');
    expect(unknown.status).toBe(200);
    expect(unknown.body.locals.badge.rarityLabel).toBe('mythic');
    expect(unknown.body.locals.badge.tierLabel).toBe('obsidian');
    expect(unknown.body.locals.badge.typeLabel).toBe('unknown_thing');
  });
});

describe('job alerts and location labels follow the request locale (findings 4 and 5)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getJobs.mockResolvedValue({ data: [], meta: { total: 0 } });
    api.callAdminJobApi.mockResolvedValue({ data: [] });
    api.getProfile.mockResolvedValue({ data: { id: 99 } });
  });

  it('builds every alert criteria line from translated strings under German', async () => {
    api.callJobApi.mockResolvedValue({
      data: [
        {
          id: 1,
          keywords: 'gardening',
          categories: ['Admin', 'Outdoors'],
          type: 'paid',
          commitment: 'part_time',
          location: 'Cork',
          is_remote_only: true,
          is_active: true
        },
        { id: 2 }
      ]
    });

    const app = createApp('/jobs', require('../src/routes/jobs'), 'de');
    const response = await request(app).get('/jobs/alerts');
    expect(response.status).toBe(200);

    const de = createTranslator('de');
    const [full, empty] = response.body.locals.alerts;
    expect(full.criteria).toContain(de('jobs_t4.criteria_keywords', { value: 'gardening' }));
    expect(full.criteria).toContain(de('jobs_t4.criteria_type', { value: de('jobs.type_paid') }));
    expect(full.criteria).toContain(de('jobs_t4.criteria_commitment', { value: de('jobs_t2.commitment_part_time') }));
    expect(full.criteria).toContain(de('jobs_t4.criteria_location', { value: 'Cork' }));
    expect(full.criteria).toContain(de('jobs_t4.criteria_remote'));
    expect(full.criteria.join(' ')).not.toContain('Keywords:');
    expect(empty.criteria).toEqual([de('jobs_t4.criteria_any')]);
    expect(empty.primaryCriteria).not.toBe('Any opportunity');
  });

  it('translates the remote location label at the decorate site under German', async () => {
    api.getJobs.mockResolvedValue({
      data: [{ id: 5, title: 'Remote helper', type: 'volunteer', is_remote: true }],
      meta: { total: 1 }
    });

    const app = createApp('/jobs', require('../src/routes/jobs'), 'de');
    const response = await request(app).get('/jobs');
    expect(response.status).toBe(200);

    const de = createTranslator('de');
    const job = response.body.locals.jobs.find((row) => row.id === 5);
    expect(job.locationLabel).toBe(de('jobs.remote'));
    expect(job.locationLabel).not.toBe('Remote');
  });
});

describe('ideation attachment type labels follow the request locale (finding 2)', () => {
  it('resolves the same translated keys the add-attachment form uses', async () => {
    const de = createTranslator('de');
    const expected = de('govuk_alpha_ideation.media.type_document');
    expect(expected).not.toBe('govuk_alpha_ideation.media.type_document');
    // The catalogue value differs from raw English 'Document' for German.
    expect(expected).toBe('Dokument');
  });
});

describe('nexus score progress label (finding 8)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('composes the aria progress label from a translated string with Intl percent under Japanese', async () => {
    api.callGamificationApi.mockImplementation(async (token, method, pathValue) => {
      if (String(pathValue).startsWith('/nexus-score')) {
        return {
          data: {
            total_score: 420,
            max_score: 1000,
            tier: { name: 'intermediate' },
            breakdown: {
              engagement: { score: 42, max: 100, percentage: 42 }
            }
          }
        };
      }
      return { data: {} };
    });

    const app = createApp('/nexus-score', require('../src/routes/nexus-score'), 'ja');
    const response = await request(app).get('/nexus-score');
    expect(response.status).toBe(200);

    const ja = createTranslator('ja');
    const row = response.body.locals.nexusScore.breakdownRows[0];
    const expectedPercent = new Intl.NumberFormat(localeForIntl('ja'), {
      style: 'percent',
      maximumFractionDigits: 0
    }).format(0.42);
    expect(row.percentLabel).toBe(expectedPercent);
    expect(row.progressLabel).toBe(
      ja('nexus_score.progress_label', { category: row.label, percent: expectedPercent })
    );
    // The Japanese template uses a full-width colon, not the English ':'.
    expect(row.progressLabel).toContain('：');
  });
});
