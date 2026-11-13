// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The welcome steps obey the community's own settings (13 Nov 2026).
 *
 * A community's admin chooses, on Admin → Welcome steps, a welcome message, a
 * safeguarding introduction, and whether the profile step asks for a photo and
 * for a few words of a minimum length. This site showed neither text and made
 * none of the checks: a member was only told at "Finish", by the API, and for a
 * bio that was too short was told to "add a short bio" they had already added.
 * Now:
 *  - the community's welcome and safeguarding introduction replace ours;
 *  - the profile step asks for exactly what the community asks for, and says
 *    how many characters are needed;
 *  - a community that asks for neither lets the member straight through;
 *  - when the settings cannot be read the step does not block (the API still
 *    makes the final check);
 *  - a community that has switched the welcome steps off shows them to nobody.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');
const { nl2br } = require('../src/lib/nl2br');

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
    getOnboardingCategories: jest.fn(),
    getOnboardingSafeguardingOptions: jest.fn(),
    completeOnboarding: jest.fn(),
    uploadProfileAvatar: jest.fn(),
    updateProfile: jest.fn(),
    saveOnboardingSafeguarding: jest.fn(),
    getUserSkills: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn()
  };
});

const api = require('../src/lib/api');
const onboardingRoutes = require('../src/routes/onboarding-posts');
const { welcomeStepsSwitchedOn } = require('../src/lib/welcome-steps');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');

function buildApp(locale = 'en', tenantSettings = {}) {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('nl2br', nl2br);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({
    extended: true,
    verify: (req, res, buffer) => { req.rawUrlencodedBody = buffer.toString('utf8'); }
  }));
  app.use(session({ secret: 'onboarding-community-settings-test', resave: false, saveUninitialized: true }));
  app.use('/onboarding', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.accessibleRouting = {
      mode: 'shared', tenantSlug: 'acme', prefix: '', tenant: { id: 2, slug: 'acme', settings: tenantSettings }
    };
    res.locals.urlFor = (value) => String(value || '/');
    Object.assign(res.locals, {
      t: createTranslator(locale),
      tc: createChoiceTranslator(locale),
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: locale,
      htmlDirection: locale === 'ar' ? 'rtl' : 'ltr',
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  }, onboardingRoutes);
  return app;
}

function community(settings = {}) {
  return {
    data: {
      steps: [
        { slug: 'welcome', required: false },
        { slug: 'profile', required: true },
        { slug: 'safeguarding', required: false },
        { slug: 'confirm', required: true }
      ],
      config: { avatar_required: true, bio_required: true, bio_min_length: 10, ...settings }
    }
  };
}

const postProfile = (body) => request(buildApp()).post('/onboarding/profile').type('form').send(body);

beforeEach(() => {
  jest.clearAllMocks();
  api.getOnboardingStatus.mockResolvedValue({ data: { onboarding_completed: false } });
  api.getOnboardingConfig.mockResolvedValue(community());
  api.getOnboardingSafeguardingOptions.mockResolvedValue({
    data: [{ id: 9, option_key: 'none_apply', option_type: 'checkbox', label: 'None of these apply to me' }]
  });
  api.updateProfile.mockResolvedValue({ data: {} });
  api.getProfile.mockResolvedValue({ data: { id: 7, bio: 'Hello there, neighbours', avatar_url: '/a.png' } });
});

describe("the community's own words", () => {
  it('shows our welcome when the community wrote none', async () => {
    const res = await request(buildApp()).get('/onboarding/welcome');

    expect(res.status).toBe(200);
    expect(res.text).toContain(createTranslator('en')('onboarding.welcome.body'));
  });

  it("shows the community's welcome in place of ours, keeping its line breaks", async () => {
    api.getOnboardingConfig.mockResolvedValue(community({ welcome_text: 'We meet on Thursdays.\nCome and say hello.' }));

    const res = await request(buildApp()).get('/onboarding/welcome');

    expect(res.text).toContain('We meet on Thursdays.<br>Come and say hello.');
    expect(res.text).not.toContain(createTranslator('en')('onboarding.welcome.body'));
  });

  it('never renders markup an admin typed into the welcome', async () => {
    api.getOnboardingConfig.mockResolvedValue(community({ welcome_text: '<script>alert(1)</script> hello' }));

    const res = await request(buildApp()).get('/onboarding/welcome');

    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt; hello');
  });

  it("shows the community's safeguarding introduction in place of ours", async () => {
    api.getOnboardingConfig.mockResolvedValue(community({ safeguarding_intro_text: 'Our safeguarding lead is Maeve.' }));

    const res = await request(buildApp()).get('/onboarding/safeguarding');

    expect(res.text).toContain('Our safeguarding lead is Maeve.');
    expect(res.text).not.toContain(createTranslator('en')('onboarding.safeguarding.intro'));
  });
});

describe('the profile step asks for what the community asks for', () => {
  it('moves on when the photo and the few words are both there', async () => {
    const res = await postProfile({ bio: 'Hello there, neighbours' });

    expect(res.headers.location).toBe('/onboarding/safeguarding');
  });

  it('stays put, with the bio saved, when the few words are shorter than the minimum', async () => {
    api.getOnboardingConfig.mockResolvedValue(community({ bio_min_length: 40 }));

    const res = await postProfile({ bio: 'Too short.' });

    expect(api.updateProfile).toHaveBeenCalledWith('token:test', { bio: 'Too short.' });
    expect(res.headers.location).toBe('/onboarding/profile?status=bio-min-length');
  });

  it('says how many characters are needed', async () => {
    api.getOnboardingConfig.mockResolvedValue(community({ bio_min_length: 40 }));

    const res = await request(buildApp()).get('/onboarding/profile?status=bio-min-length');

    expect(res.text).toContain('govuk-error-summary');
    expect(res.text).toContain('Write at least 40 characters about yourself before continuing.');
    expect(res.text).toMatch(/id="bio-error" class="govuk-error-message"/);
  });

  it('gives a member reading Irish that message in Irish', async () => {
    api.getOnboardingConfig.mockResolvedValue(community({ bio_min_length: 40 }));

    const res = await request(buildApp('ga')).get('/onboarding/profile?status=bio-min-length');

    expect(res.text).toContain('Scríobh 40 carachtar ar a laghad fút féin');
  });

  it('asks for a bio when there is none at all', async () => {
    const res = await postProfile({ bio: '   ' });

    expect(res.headers.location).toBe('/onboarding/profile?status=bio-too-short');
  });

  it('asks for a photo when the community wants one and there is none', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 7, bio: 'Hello there, neighbours', avatar_url: null } });

    const res = await postProfile({ bio: 'Hello there, neighbours' });

    expect(res.headers.location).toBe('/onboarding/profile?status=avatar-required');
  });

  it('lets a member through with no photo and no words when the community asks for neither', async () => {
    api.getOnboardingConfig.mockResolvedValue(community({ avatar_required: false, bio_required: false }));
    api.getProfile.mockResolvedValue({ data: { id: 7, bio: null, avatar_url: null } });

    const res = await postProfile({ bio: '' });

    expect(res.headers.location).toBe('/onboarding/safeguarding');
  });

  it('does not block when the settings cannot be read (the API still checks at Finish)', async () => {
    api.getOnboardingConfig.mockRejectedValue(new Error('offline'));
    api.getProfile.mockResolvedValue({ data: { id: 7, bio: null, avatar_url: null } });

    const res = await postProfile({ bio: '' });

    expect(res.status).toBe(302);
    expect(res.headers.location).not.toContain('status=');
  });
});

describe('a community that has switched the welcome steps off', () => {
  const off = () => buildApp('en', { onboarding_enabled: false });

  it('sends anyone who opens them straight to the dashboard', async () => {
    const start = await request(off()).get('/onboarding');
    const step = await request(off()).get('/onboarding/profile');

    expect(start.headers.location).toBe('/dashboard');
    expect(step.headers.location).toBe('/dashboard');
    expect(api.getOnboardingConfig).not.toHaveBeenCalled();
  });

  it('still shows them while they are switched on, or when the setting is missing', async () => {
    const on = await request(buildApp('en', { onboarding_enabled: true })).get('/onboarding');
    const unset = await request(buildApp()).get('/onboarding');

    expect(on.headers.location).toBe('/onboarding/welcome');
    expect(unset.headers.location).toBe('/onboarding/welcome');
  });

  it('reads "off" only from a literal false in the community settings', () => {
    expect(welcomeStepsSwitchedOn({ settings: { onboarding_enabled: false } })).toBe(false);
    expect(welcomeStepsSwitchedOn({ settings: { onboarding_enabled: true } })).toBe(true);
    expect(welcomeStepsSwitchedOn({ settings: {} })).toBe(true);
    expect(welcomeStepsSwitchedOn({})).toBe(true);
    expect(welcomeStepsSwitchedOn(null)).toBe(true);
  });
});
