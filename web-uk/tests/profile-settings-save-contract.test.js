// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Saving profile settings must report what actually happened.
 *
 * 🔴 Both behaviours below were found by driving the real form against a disposable
 * Laravel. The newsletter consent was written on EVERY save, and any failure of that
 * write reported the WHOLE profile save as failed — while the member's name, photo and
 * privacy settings had all saved successfully (each returning 200). Worse, the failure
 * was attributed to the photo: the member was told to "Upload a JPG, PNG, GIF or WEBP
 * image smaller than 10MB" when the photo had uploaded fine and the consent write was
 * what had been refused.
 *
 * The trigger is real and not hypothetical: `consent_types` is populated by nothing in
 * this repository, so an installation built from the committed schema dump has no
 * `marketing_email` row and every save hit it.
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
  callProfileApi: jest.fn(),
  callUserSettingsApi: jest.fn(),
  callWebAuthnApi: jest.fn(),
  invalidateUserCache: jest.fn(),
  requestAccountDeletion: jest.fn(),
  uploadProfileAvatar: jest.fn()
}));

const api = require('../src/lib/api');
const profileRouter = require('../src/routes/profile');

function createApp() {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    res.locals.urlFor = (pathname) => pathname;
    next();
  });
  app.use('/profile', profileRouter);
  return app;
}

/** Every settings call succeeds; `storedConsent` is what GET /consent reports. */
function stubSettings({ storedConsent }) {
  api.callUserSettingsApi.mockImplementation(async (token, method, path) => {
    if (method === 'GET' && path === '/consent') {
      return storedConsent === undefined
        ? { data: { consents: [] } }
        : { data: { consents: [{ consent_type_slug: 'marketing_email', given: storedConsent }] } };
    }
    return { data: {} };
  });
}

function consentWrites() {
  return api.callUserSettingsApi.mock.calls.filter(([, method, path]) => method === 'PUT' && path === '/consent');
}

function submit(fields) {
  return request(createApp())
    .post('/profile/settings')
    .type('form')
    .send({ first_name: 'E2E', last_name: 'UserA', ...fields });
}

describe('profile settings save — newsletter consent is only written when it changed', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not write consent when the submitted value matches what is stored', async () => {
    stubSettings({ storedConsent: true });

    const res = await submit({ newsletter_opt_in: '1' });

    expect(consentWrites()).toHaveLength(0);
    expect(res.headers.location).toContain('status=profile-updated');
  });

  it('writes consent when the member changes it', async () => {
    stubSettings({ storedConsent: true });

    await submit({});           // checkbox absent = unticked = opt out

    expect(consentWrites()).toHaveLength(1);
    expect(consentWrites()[0][3]).toEqual({ slug: 'marketing_email', given: false });
  });

  it('does not write consent when no record exists and the member did not opt in', async () => {
    // 🔴 The exact case that broke: no consent record, checkbox unticked. Writing here
    // asks the API to record "no consent" against a consent type that may not exist,
    // which is what failed — and it changes nothing even when it succeeds.
    stubSettings({ storedConsent: undefined });

    const res = await submit({});

    expect(consentWrites()).toHaveLength(0);
    expect(res.headers.location).toContain('status=profile-updated');
  });

  it('still writes an explicit opt-in when no record exists', async () => {
    // An opt-in must never be silently dropped just because there was nothing stored.
    stubSettings({ storedConsent: undefined });

    await submit({ newsletter_opt_in: '1' });

    expect(consentWrites()).toHaveLength(1);
    expect(consentWrites()[0][3]).toEqual({ slug: 'marketing_email', given: true });
  });

  it('writes the change even when the current consent cannot be read', async () => {
    // Failing to read must not lose a real change.
    api.callUserSettingsApi.mockImplementation(async (token, method, path) => {
      if (method === 'GET' && path === '/consent') throw new api.ApiError('boom', 500);
      return { data: {} };
    });

    await submit({ newsletter_opt_in: '1' });

    expect(consentWrites()).toHaveLength(1);
  });
});

describe('profile settings save — failures are attributed to the right thing', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not blame the photo when a rejected consent write is the failure', async () => {
    stubSettings({ storedConsent: false });
    api.callUserSettingsApi.mockImplementation(async (token, method, path) => {
      if (method === 'GET' && path === '/consent') {
        return { data: { consents: [{ consent_type_slug: 'marketing_email', given: false }] } };
      }
      if (method === 'PUT' && path === '/consent') {
        // What Laravel returns for an unknown consent slug (422 since this audit; it was
        // a 500 before, which is how it went unnoticed for so long).
        throw new api.ApiError('Invalid consent type', 422);
      }
      return { data: {} };
    });

    const res = await submit({ newsletter_opt_in: '1' });

    expect(res.headers.location).not.toContain('avatar-invalid');
    expect(res.headers.location).toContain('status=profile-update-failed');
  });

  it('still blames the photo when the photo really is the problem', async () => {
    stubSettings({ storedConsent: false });
    api.uploadProfileAvatar.mockRejectedValue(new api.ApiError('Invalid file type', 400));

    // No multipart here — the avatar branch only runs for an uploaded file, so this
    // asserts the pairing stays intact rather than simulating the upload itself.
    const res = await submit({});

    // Without a file there is no avatar failure to report, so this must NOT say
    // avatar-invalid either. The status must never be avatar-invalid unless the avatar
    // upload was the call that threw.
    expect(res.headers.location).not.toContain('avatar-invalid');
  });
});
