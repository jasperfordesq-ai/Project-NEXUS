// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Finishing onboarding must say what is missing (2026-08-25).
 *
 * Found by registering a member and walking the wizard. On the last step,
 * "Finish and go to my dashboard" returned:
 *
 *     Something went wrong. Please try again.
 *
 * Retrying could never work. The API had said exactly what was wrong —
 * `{"errors":[{"field":"avatar_url","message":"Profile photo is required to
 * complete onboarding"}]}` — and completeFailureRedirect() looked for it in the
 * wrong place: `error.data.field`, when v2 endpoints nest it at
 * `data.errors[].field`. Its message fallbacks could not rescue it either,
 * because they test for "avatar" and "bio" while the API says "Profile photo"
 * and "about yourself".
 *
 * 🔴 Onboarding that never completes is not cosmetic. A member whose onboarding
 * is incomplete is hidden from the member directory, so this stops them being
 * found at all — which is the whole point of joining.
 *
 * Separately, all six of this wizard's status messages were hardcoded English
 * while translated copies had always existed at
 * `govuk_alpha.onboarding.states.*`.
 */

const express = require('express');
const session = require('express-session');
const request = require('supertest');
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
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getOnboardingStatus: jest.fn(),
    getOnboardingConfig: jest.fn(),
    completeOnboarding: jest.fn(),
    uploadProfileAvatar: jest.fn(),
    updateProfile: jest.fn(),
    saveOnboardingSafeguarding: jest.fn(),
    getInterests: jest.fn(),
    getSkills: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn()
  };
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const onboardingRoutes = require('../src/routes/onboarding-posts');

const PREFIX = '/acme/accessible';

function buildApp(locale = 'en') {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: 'onboarding-completion-failure-test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'onboarding-failure.sid'
  }));
  app.use('/onboarding', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.accessibleRouting = {
      mode: 'shared', tenantSlug: 'acme', prefix: PREFIX,
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank' }
    };
    res.locals.urlFor = (value) => String(value || '/');
    Object.assign(res.locals, {
      t: createTranslator(locale),
      tc: createChoiceTranslator(locale),
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      htmlLang: locale,
      htmlDirection: locale === 'ar' ? 'rtl' : 'ltr'
    });
    next();
  }, onboardingRoutes);
  return app;
}

/** The exact envelope every v2 endpoint returns on a validation failure. */
function validationError(field, message) {
  return new api.ApiError(message, 422, {
    errors: [{ code: 'VALIDATION_REQUIRED_FIELD', message, field }]
  });
}

async function finish(app) {
  return request(app).post('/onboarding/confirm').type('form').send({ _csrf: 'test-csrf-token' });
}

describe('finishing onboarding points at the thing that is missing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getOnboardingStatus.mockResolvedValue({ data: { onboarding_completed: false } });
  });

  it('sends the member to the photo step when the photo is what is missing', async () => {
    api.completeOnboarding.mockRejectedValue(
      validationError('avatar_url', 'Profile photo is required to complete onboarding')
    );

    const res = await finish(buildApp());

    expect(res.status).toBe(302);
    // 🔴 NOT '/onboarding/confirm?status=complete-failed', which is what a member
    // used to get: an unactionable "Something went wrong" on a page where
    // pressing the button again could never succeed.
    expect(res.headers.location).toBe('/onboarding/profile?status=avatar-required');
  });

  it('sends the member to the bio step when the bio is what is missing', async () => {
    api.completeOnboarding.mockRejectedValue(
      validationError('bio', 'Tell us a little about yourself before finishing')
    );

    const res = await finish(buildApp());

    expect(res.headers.location).toBe('/onboarding/profile?status=bio-too-short');
  });

  it('still recognises the field from a flat data.field, for any caller that sends one', async () => {
    api.completeOnboarding.mockRejectedValue(
      new api.ApiError('Nope', 422, { field: 'avatar_url' })
    );

    const res = await finish(buildApp());

    expect(res.headers.location).toBe('/onboarding/profile?status=avatar-required');
  });

  it('falls back to the message when the API sends no field at all', async () => {
    api.completeOnboarding.mockRejectedValue(
      new api.ApiError('Profile photo is required', 422, {})
    );

    const res = await finish(buildApp());

    expect(res.headers.location).toBe('/onboarding/profile?status=avatar-required');
  });

  it('keeps the generic failure for a genuinely unknown problem', async () => {
    api.completeOnboarding.mockRejectedValue(new api.ApiError('Server exploded', 500, {}));

    const res = await finish(buildApp());

    expect(res.headers.location).toBe('/onboarding/confirm?status=complete-failed');
  });

  it('completes normally when nothing is missing', async () => {
    api.completeOnboarding.mockResolvedValue({ data: { onboarding_completed: true } });

    const res = await finish(buildApp());

    expect(res.headers.location).toBe('/dashboard?status=onboarding-complete');
  });
});

describe('onboarding status messages come from the catalogue', () => {
  const { onboardingStatusBanner } = require('../src/routes/onboarding-posts');

  it.each([
    ['bio-too-short', 'error', 'bio'],
    ['avatar-required', 'error', 'avatar'],
    ['avatar-failed', 'error', 'avatar'],
    ['safeguarding-failed', 'error', null],
    ['complete-failed', 'error', null],
    ['avatar-saved', 'success', undefined]
  ])('%s resolves its message and keeps its anchor', (status, type, anchor) => {
    const banner = onboardingStatusBanner(status, createTranslator('en'));

    expect(banner).not.toBeNull();
    expect(banner.type).toBe(type);
    expect(banner.anchor).toBe(anchor);
    // A raw key means the lookup path is wrong; the member would read
    // "govuk_alpha.onboarding.states.avatar-required" on the page.
    expect(banner.message).not.toContain('onboarding.states');
    expect(banner.message.length).toBeGreaterThan(5);
  });

  it('gives a member reading Irish an Irish message, not an English one', () => {
    const english = onboardingStatusBanner('avatar-required', createTranslator('en'));
    const irish = onboardingStatusBanner('avatar-required', createTranslator('ga'));

    // 🔴 These were English literals in the route, so every locale got English.
    expect(irish.message).not.toBe(english.message);
  });

  it('returns null for a status it does not know', () => {
    expect(onboardingStatusBanner('not-a-real-status', createTranslator('en'))).toBeNull();
    expect(onboardingStatusBanner('', createTranslator('en'))).toBeNull();
  });
});
