// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * A member profile the API will not show is not automatically a member who does
 * not exist, and telling the viewer "Page not found" about a real person is a
 * lie the accessible frontend told for a long time.
 *
 * `handleApiError` renders errors/404 for EVERY ApiError with status 404, so four
 * unrelated outcomes arrived at the same page: a genuinely absent member, one who
 * has not finished setting up (PROFILE_INCOMPLETE), one who limits their profile
 * to their connections (PROFILE_PRIVATE), and — worse — a 403 because one of the
 * two has blocked the other, which nothing handled at all, so the request fell
 * through to the server-error page.
 *
 * The scale is why this is pinned. Measured on production 2026-08-23, 235 of 260
 * active members of one community were withheld by PROFILE_INCOMPLETE alone, and
 * every single one reported "Page not found".
 *
 * 🔴 The last case matters most: anything the API did NOT refuse deliberately —
 * a 500, a gateway error, the API being unreachable — must classify as null so it
 * keeps travelling to the error handler and to Sentry. Swallowing it here would
 * turn an outage into 260 members who all appear to have been deleted.
 */

const path = require('node:path');
const nunjucks = require('nunjucks');
const { ApiError } = require('../src/lib/api');
const { memberProfileRefusal } = require('../src/routes/members');

const VIEWS_DIRECTORY = path.join(__dirname, '..', 'src', 'views');

function renderUnavailable(context) {
  const environment = new nunjucks.Environment(
    new nunjucks.FileSystemLoader([
      VIEWS_DIRECTORY,
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')
    ]),
    { autoescape: true }
  );
  environment.addFilter('date', (value) => String(value));
  environment.addGlobal('t', (key) => key);
  environment.addGlobal('tc', (key) => key);
  environment.addGlobal('urlFor', (value) => value);
  environment.addGlobal('formatLocaleDate', (value) => String(value));

  return environment.render('members/unavailable.njk', {
    isAuthenticated: true,
    csrfToken: 'test-csrf',
    sessionTimeout: 30,
    t: (key) => key,
    tc: (key) => key,
    urlFor: (value) => value,
    ...context
  });
}

/** Build the error shape `request()` throws: JSON body on `error.data`. */
function apiError(status, code) {
  const body = code ? { errors: [{ code, message: 'refused' }], success: false } : { success: false };
  return new ApiError('refused', status, body);
}

describe('member profile refusal classification', () => {
  it('separates a profile still being set up from one that does not exist', () => {
    expect(memberProfileRefusal(apiError(404, 'PROFILE_INCOMPLETE'))).toBe('incomplete');
    expect(memberProfileRefusal(apiError(404, 'NOT_FOUND'))).toBe('missing');
  });

  it('separates a profile withheld by its owner from one that does not exist', () => {
    expect(memberProfileRefusal(apiError(404, 'PROFILE_PRIVATE'))).toBe('private');
  });

  it('treats a 403 as blocked rather than letting it reach the server-error page', () => {
    expect(memberProfileRefusal(apiError(403, 'FORBIDDEN'))).toBe('blocked');
    // The API does not always attach a code to a 403; the status alone is enough.
    expect(memberProfileRefusal(apiError(403, null))).toBe('blocked');
  });

  it('falls back to missing for a 404 carrying no usable code', () => {
    expect(memberProfileRefusal(apiError(404, null))).toBe('missing');
    expect(memberProfileRefusal(new ApiError('refused', 404, 'not json'))).toBe('missing');
    expect(memberProfileRefusal(new ApiError('refused', 404, null))).toBe('missing');
  });

  it('matches the code regardless of case or surrounding whitespace', () => {
    expect(memberProfileRefusal(apiError(404, ' profile_incomplete '))).toBe('incomplete');
    expect(memberProfileRefusal(apiError(404, 'profile_private'))).toBe('private');
  });

  it('refuses to classify a genuine fault, so it stays reportable', () => {
    expect(memberProfileRefusal(apiError(500, 'SERVER_ERROR'))).toBeNull();
    expect(memberProfileRefusal(apiError(502, null))).toBeNull();
    expect(memberProfileRefusal(apiError(422, 'VALIDATION_FAILED'))).toBeNull();
    expect(memberProfileRefusal(new Error('socket hang up'))).toBeNull();
    expect(memberProfileRefusal(null)).toBeNull();
  });

  it('renders the explanation on an ordinary page, not a stranded error page', () => {
    const html = renderUnavailable({
      heading: 'This profile is not ready yet',
      body: 'They are still a full member of the community.',
      membersHref: '/members',
      membersLinkText: 'Back to members'
    });

    expect(html).toContain('This profile is not ready yet');
    expect(html).toContain('They are still a full member of the community.');
    expect(html).toContain('href="/members"');
    expect(html).toContain('Back to members');

    // 🔴 The point of not reusing layouts/error.njk: that layout drops the
    // header and navigation on purpose, which left a signed-in member with no
    // way out except the browser Back button. Assert the shell is really here.
    expect(html).toContain('govuk-skip-link');
    expect(html).toContain('govuk-footer');
  });

  it('leaves 401 to the auth redirect rather than claiming a refusal', () => {
    // The route re-throws 401 before ever calling this, but if that guard were
    // removed, classifying it as "missing" would strand an expired session on a
    // 404 instead of sending the member to sign in again.
    expect(memberProfileRefusal(apiError(401, 'auth_required'))).toBeNull();
  });
});
