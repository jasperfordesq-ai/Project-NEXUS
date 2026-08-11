// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The legal acceptance interstitial.
 *
 * Laravel's `EnsureLegalAcceptance` is what actually refuses a write. This is the
 * page a blocked member sees instead of a bare 403, and the middleware that puts
 * them there.
 *
 * 🔴 Most of these tests are about NOT TRAPPING PEOPLE. An interstitial that can
 * strand somebody is worse than no interstitial: they can neither use the platform
 * nor leave it. The four loop-breakers each get their own cases —
 *
 *   1. GET/HTML only (a POST is never intercepted; it would be discarded);
 *   2. a PREFIX exempt list, so every document page and version page stays
 *      reachable — React's gate matches the LAST segment and blocked
 *      `/terms/versions`, meaning a member could not read what had changed;
 *   3. unauthenticated short-circuit before any API call;
 *   4. a session-cached verdict cleared the moment the member accepts, without
 *      which accepting sends them straight back here.
 */

const express = require('express');
const nunjucks = require('nunjucks');
const path = require('path');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {
    constructor(message = 'Unable to connect') {
      super(message);
      this.name = 'ApiOfflineError';
      this.status = 503;
    }
  },
  getLegalAcceptanceStatus: jest.fn(),
  acceptAllLegalDocuments: jest.fn()
}));

const api = require('../src/lib/api');
const { legalGate, isExempt, normalizeDocuments } = require('../src/middleware/legal-gate');
const { createTranslator } = require('../src/lib/localization');

const VIEW_PATHS = [
  path.join(__dirname, '..', 'src', 'views'),
  path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')
];

// 🔴 `enforcement_blocking: true` is REQUIRED for the gate to interpose, and it is
// deliberately part of this fixture rather than defaulted in the gate. It answers a
// different question from `has_pending`: "does this member owe an acceptance?" versus
// "will the platform actually refuse them?". Under `LEGAL_ENFORCEMENT_MODE=report`
// the first is true and the second is false, and the gate shipped reading only the
// first — so it blocked every member during what was supposed to be a
// block-nobody measurement week. See REPORT_MODE_PENDING below.
const PENDING = {
  data: {
    has_pending: true,
    enforcement_blocking: true,
    blocking_pending: true,
    documents: [
      {
        document_id: 12,
        document_type: 'terms',
        title: 'Community Terms',
        current_version_id: 91,
        current_version: '2.1',
        acceptance_status: 'outdated',
        accepted_at: '2026-01-05T00:00:00Z'
      },
      {
        document_id: 13,
        document_type: 'community_guidelines',
        title: 'Community guidelines',
        current_version_id: 44,
        current_version: '1.0',
        acceptance_status: 'not_accepted',
        accepted_at: null
      }
    ]
  }
};

const NOTHING_PENDING = { data: { has_pending: false, enforcement_blocking: true, blocking_pending: false, documents: [] } };

/**
 * A member who genuinely owes an acceptance, on a platform that is deliberately NOT
 * refusing requests — `LEGAL_ENFORCEMENT_MODE=report` or `off`.
 *
 * The documents are identical to PENDING. The ONLY difference is the server saying
 * it is not blocking. If the gate ever reverts to deciding for itself, these tests
 * fail and the ones above still pass, which is what makes the pair meaningful.
 */
const REPORT_MODE_PENDING = {
  data: {
    ...PENDING.data,
    enforcement_blocking: false
  }
};

/**
 * An older backend that predates the field entirely.
 *
 * 🔴 This must still BLOCK. Only an explicit `false` stands the gate down. Treating
 * absence as "not blocking" would mean a serialisation fault silently drops the
 * acceptance prompt on an obligation that is enforced by default — so absence keeps
 * today's behaviour instead. React applies the identical rule.
 */
const LEGACY_BACKEND_PENDING = {
  data: {
    has_pending: true,
    documents: PENDING.data.documents
  }
};

/**
 * Mounts the real gate and the real acceptance router in front of a stand-in for
 * the rest of the app, so an intercepted request is visibly different from one
 * that got through.
 */
function buildApp({ signedIn = true } = {}) {
  const app = express();
  const env = nunjucks.configure(VIEW_PATHS, { autoescape: true, noCache: true, express: app });
  env.addFilter('formatLegalDate', (value) => String(value || ''));
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: false }));

  const sessions = new Map();

  app.use((req, res, next) => {
    req.signedCookies = signedIn ? { token: 'test-token' } : {};
    // One shared session object across requests in a test, so the verdict cache is
    // genuinely exercised rather than reset each time.
    if (!sessions.has('only')) sessions.set('only', {});
    req.session = sessions.get('only');
    res.locals.t = createTranslator('en');
    res.locals.locale = 'en';
    res.locals.urlFor = (pathname) => pathname;
    res.locals.tenant = { name: 'Acme Timebank', slug: 'acme' };
    res.locals.tenantName = 'Acme Timebank';
    res.locals.serviceName = 'Project NEXUS Accessible';
    res.locals.isAuthenticated = signedIn;
    res.locals.alphaNavItems = [];
    res.locals.alphaFooterColumns = [];
    res.locals.alphaLocaleOptions = [];
    res.locals.alphaCurrentLocale = 'en';
    res.locals.csrfToken = 'test-csrf';
    next();
  });

  app.use(legalGate);
  // eslint-disable-next-line global-require
  app.use(require('../src/routes/legal-acceptance'));

  // Stand-in for everything the gate protects.
  app.get('/dashboard', (req, res) => res.status(200).send('dashboard reached'));
  app.get('/legal/terms', (req, res) => res.status(200).send('terms document'));
  app.get('/legal/terms/versions', (req, res) => res.status(200).send('terms versions'));
  app.get('/logout', (req, res) => res.status(200).send('signed out'));
  app.post('/listings', (req, res) => res.status(200).send('listing created'));

  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getLegalAcceptanceStatus.mockResolvedValue(NOTHING_PENDING);
  api.acceptAllLegalDocuments.mockResolvedValue({ data: { accepted: ['terms'] } });
});

describe('the gate intercepts a blocked member', () => {
  it('sends a blocked member to the acceptance page, remembering where they were going', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);

    const response = await request(buildApp()).get('/dashboard');

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/legal-acceptance?return=%2Fdashboard');
  });

  it('lets a member with nothing pending straight through', async () => {
    const response = await request(buildApp()).get('/dashboard');

    expect(response.status).toBe(200);
    expect(response.text).toBe('dashboard reached');
  });

  it('trusts has_pending: false without inspecting the document list', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue({
      data: { has_pending: false, documents: PENDING.data.documents }
    });

    expect((await request(buildApp()).get('/dashboard')).status).toBe(200);
  });

  it('ignores documents already accepted at their current version', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue({
      data: {
        has_pending: true,
        documents: [{ document_id: 1, document_type: 'terms', title: 'Terms', acceptance_status: 'current' }]
      }
    });

    expect((await request(buildApp()).get('/dashboard')).status).toBe(200);
  });
});

describe('loop-breaker 5 — the server decides whether anything is enforced', () => {
  it('does NOT interpose in report mode, even with documents pending', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue(REPORT_MODE_PENDING);

    const response = await request(buildApp()).get('/dashboard');

    // The whole point of report mode: Laravel counts who WOULD be blocked and
    // blocks nobody. An interstitial here would make that count measure a
    // frontend that was already blocking.
    expect(response.status).toBe(200);
    expect(response.text).toContain('dashboard reached');
  });

  it('STILL interposes when the backend omits the field — only explicit false stands down', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue(LEGACY_BACKEND_PENDING);

    const response = await request(buildApp()).get('/dashboard');

    // Deliberate: absence keeps today's behaviour rather than silently dropping the
    // prompt. Acceptance is enforced by default, so a missing field must not be the
    // thing that quietly switches the interstitial off.
    expect(response.status).toBe(303);
  });

  it('still interposes when the server says it IS blocking', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);

    const response = await request(buildApp()).get('/dashboard');

    // The control for the two tests above. Without this, "never interposes" would
    // pass just as happily as "interposes correctly".
    expect(response.status).toBe(303);
    expect(response.headers.location).toContain('/legal-acceptance');
  });

  it('does NOT interpose when every pending document is display-only', async () => {
    // 🔴 A community can set `acceptance_required_for` so a document is SHOWN but
    // never gates. The server honours that; the display query the interstitial reads
    // deliberately does not (changing it would alter what React shows). So this gate
    // blocked every page over a document the API itself would never refuse — the two
    // halves disagreeing about who is blocked.
    api.getLegalAcceptanceStatus.mockResolvedValue({
      data: { ...PENDING.data, enforcement_blocking: true, blocking_pending: false }
    });

    const response = await request(buildApp()).get('/dashboard');

    expect(response.status).toBe(200);
  });

  it('caches the not-blocking verdict without turning it into a block', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue(REPORT_MODE_PENDING);
    const app = buildApp();

    await request(app).get('/dashboard');
    const second = await request(app).get('/dashboard');

    expect(second.status).toBe(200);
    expect(api.getLegalAcceptanceStatus).toHaveBeenCalledTimes(1);
  });
});

describe('loop-breaker 1 — GET and HTML only', () => {
  it('never intercepts a POST, which would silently discard it', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);

    const response = await request(buildApp()).post('/listings').type('form').send({ title: 'x' });

    expect(response.status).toBe(200);
    expect(response.text).toBe('listing created');
  });

  it('never intercepts a request that did not ask for HTML', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);

    const response = await request(buildApp()).get('/dashboard').set('Accept', 'application/json');

    expect(response.status).toBe(200);
  });

  it('treats a missing Accept header as a page request', async () => {
    // Some browsers omit it on a plain navigation, and a member on one of those
    // must still see the page rather than being waved through to a 403.
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);

    const response = await request(buildApp()).get('/dashboard').set('Accept', '');

    expect(response.status).toBe(303);
  });
});

describe('loop-breaker 2 — the prefix exempt list', () => {
  it('leaves every legal document page reachable', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);
    const app = buildApp();

    expect((await request(app).get('/legal/terms')).status).toBe(200);
  });

  it('leaves the version history reachable', async () => {
    // 🔴 React's gate matches the LAST path segment, so /terms/versions was
    // blocked there — a member could not read what had changed before agreeing.
    // Matching /legal as a PREFIX covers every sub-page in one rule.
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);

    expect((await request(buildApp()).get('/legal/terms/versions')).status).toBe(200);
  });

  it('always leaves signing out reachable', async () => {
    // "I do not accept" has to have an answer, or the page is a trap.
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);

    expect((await request(buildApp()).get('/logout')).status).toBe(200);
  });

  it('exempts the acceptance page itself without exempting everything under /legal', () => {
    expect(isExempt('/legal-acceptance')).toBe(true);
    expect(isExempt('/legal')).toBe(true);
    expect(isExempt('/legal/terms/versions/compare')).toBe(true);
    expect(isExempt('/terms')).toBe(true);
    expect(isExempt('/logout')).toBe(true);
    expect(isExempt('/css/main.css')).toBe(true);
    // Not a prefix match on a lookalike path.
    expect(isExempt('/legalish')).toBe(false);
    expect(isExempt('/dashboard')).toBe(false);
  });
});

describe('loop-breaker 3 — signed-out visitors', () => {
  it('never calls the API for a signed-out visitor', async () => {
    const response = await request(buildApp({ signedIn: false })).get('/dashboard');

    expect(response.status).toBe(200);
    expect(api.getLegalAcceptanceStatus).not.toHaveBeenCalled();
  });
});

describe('loop-breaker 4 — the cached verdict', () => {
  it('checks once and reuses the answer for the next request', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);
    const app = buildApp();

    await request(app).get('/dashboard');
    await request(app).get('/dashboard');

    expect(api.getLegalAcceptanceStatus).toHaveBeenCalledTimes(1);
  });

  it('accepting clears the cache, so the member is not sent straight back', async () => {
    // 🔴 THE test. Without the clear this is accept → blocked → accept, with no way
    // out but waiting for the cache to expire.
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);
    const app = buildApp();

    expect((await request(app).get('/dashboard')).status).toBe(303);

    const accepted = await request(app)
      .post('/legal-acceptance')
      .type('form')
      .send({ _csrf: 'test-csrf', return: '/dashboard' });

    expect(accepted.status).toBe(303);
    expect(accepted.headers.location).toBe('/dashboard');

    // Nothing pending any more, and the cache was cleared, so the next request
    // asks again and gets through.
    api.getLegalAcceptanceStatus.mockResolvedValue(NOTHING_PENDING);
    const after = await request(app).get('/dashboard');

    expect(after.status).toBe(200);
    expect(after.text).toBe('dashboard reached');
  });

  it('becoming clear ELSEWHERE also breaks the loop, not just accepting here', async () => {
    // 🔴 The gap the accept-here test above could not see. The member accepts on
    // their phone, or in the React app, or an admin deactivates the document. The
    // session cache still says "pending" for up to 60 seconds while the server says
    // "clear", so: gate redirects here → this page reads fresh status, sees nothing
    // pending, redirects back → gate redirects here again. The browser gives up with
    // ERR_TOO_MANY_REDIRECTS. Fixed by clearing the cache on that redirect.
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);
    const app = buildApp();

    // Warm the cache with a "pending" verdict.
    expect((await request(app).get('/dashboard')).status).toBe(303);

    // Now the member is clear, but WITHOUT posting the form on this page.
    api.getLegalAcceptanceStatus.mockResolvedValue(NOTHING_PENDING);

    const landed = await request(app).get('/legal-acceptance?return=%2Fdashboard');
    expect(landed.status).toBe(302);
    expect(landed.headers.location).toBe('/dashboard');

    // The cache must be gone. If it is not, this is a 303 straight back to the
    // acceptance page and the member is in the loop.
    const after = await request(app).get('/dashboard');
    expect(after.status).toBe(200);
    expect(after.text).toBe('dashboard reached');
  });
});

describe('the gate fails open', () => {
  it('lets the member through when the status call errors', async () => {
    // Laravel still refuses the actual write. An unreachable status endpoint must
    // not become an unavoidable wall in front of the whole platform.
    const { ApiError } = api;
    api.getLegalAcceptanceStatus.mockRejectedValue(new ApiError('Server error', 500, {}));

    expect((await request(buildApp()).get('/dashboard')).status).toBe(200);
  });

  it('lets the member through when the API is unreachable', async () => {
    const { ApiOfflineError } = api;
    api.getLegalAcceptanceStatus.mockRejectedValue(new ApiOfflineError());

    expect((await request(buildApp()).get('/dashboard')).status).toBe(200);
  });
});

describe('the acceptance page', () => {
  it('names every pending document and links to it', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);

    const response = await request(buildApp()).get('/legal-acceptance?return=%2Fdashboard');

    expect(response.status).toBe(200);
    expect(response.text).toContain('Community Terms');
    expect(response.text).toContain('Community guidelines');
    // A list of titles with a button underneath is not consent — the member must
    // be able to read the document.
    expect(response.text).toContain('href="/legal/terms"');
    // 🔴 Hyphenated. The API returns the underscored type, which matches no route.
    expect(response.text).toContain('href="/legal/community-guidelines"');
    expect(response.text).not.toContain('/legal/community_guidelines');
  });

  it('distinguishes a new document from an updated one', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);

    const response = await request(buildApp()).get('/legal-acceptance');

    // "Updated" on something a member has never seen is simply wrong.
    expect(response.text).toContain('New');
    expect(response.text).toContain('Updated');
  });

  it('offers a way out', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);

    const response = await request(buildApp()).get('/legal-acceptance');

    expect(response.text).toContain('href="/logout"');
  });

  it('works without JavaScript: one plain form with a CSRF token', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);

    const response = await request(buildApp()).get('/legal-acceptance');

    expect(response.text).toContain('<form method="post" action="/legal-acceptance"');
    expect(response.text).toContain('name="_csrf"');
    // No inline handler anywhere on the page.
    expect(response.text).not.toMatch(/on(click|submit|change)=/);
  });

  it('sends a member with nothing pending onward instead of showing an empty form', async () => {
    const response = await request(buildApp()).get('/legal-acceptance?return=%2Fdashboard');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/dashboard');
  });

  it('redirects a signed-out visitor to login', async () => {
    const response = await request(buildApp({ signedIn: false })).get('/legal-acceptance');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/login?status=auth-required');
  });
});

describe('the return path is validated, not trusted', () => {
  it('refuses an absolute URL to another site', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);

    const response = await request(buildApp())
      .get('/legal-acceptance?return=https%3A%2F%2Fevil.example%2Fsteal');

    // Uses the app's existing hardened validateReturnUrl rather than a second
    // implementation of the same decision.
    expect(response.text).not.toContain('evil.example');
    expect(response.text).toContain('value="/"');
  });

  it('refuses a protocol-relative URL on accept', async () => {
    const response = await request(buildApp())
      .post('/legal-acceptance')
      .type('form')
      .send({ _csrf: 'test-csrf', return: '//evil.example/steal' });

    expect(response.status).toBe(303);
    expect(response.headers.location).toBe('/');
  });
});

describe('a failed accept is never reported as success', () => {
  it('returns to the page with an error rather than pretending it worked', async () => {
    // 🔴 The API records acceptances in a transaction and 500s if any failed, so a
    // failure here means the member's agreement may not be recorded. Telling them
    // it was is the one lie this page must never tell.
    const { ApiError } = api;
    api.acceptAllLegalDocuments.mockRejectedValue(new ApiError('Failed', 500, {}));

    const response = await request(buildApp())
      .post('/legal-acceptance')
      .type('form')
      .send({ _csrf: 'test-csrf', return: '/dashboard' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toContain('status=failed');
    expect(response.headers.location).toContain('return=%2Fdashboard');
  });

  it('shows the error message on the way back', async () => {
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);

    const response = await request(buildApp()).get('/legal-acceptance?status=failed');

    expect(response.text).toContain('govuk-error-summary');
    expect(response.text).toContain('Nothing has been accepted');
  });

  it('keeps the member blocked after a failed accept', async () => {
    const { ApiError } = api;
    api.getLegalAcceptanceStatus.mockResolvedValue(PENDING);
    api.acceptAllLegalDocuments.mockRejectedValue(new ApiError('Failed', 500, {}));
    const app = buildApp();

    await request(app)
      .post('/legal-acceptance')
      .type('form')
      .send({ _csrf: 'test-csrf', return: '/dashboard' });

    // The verdict cache must NOT have been cleared — clearing it on failure would
    // let one request through on a document that was never accepted.
    expect((await request(app).get('/dashboard')).status).toBe(303);
  });
});

describe('normalizeDocuments', () => {
  it('hyphenates the underscored document type for use in a URL', () => {
    const [document] = normalizeDocuments({
      documents: [{ document_id: 1, document_type: 'acceptable_use', title: 'Acceptable use', acceptance_status: 'not_accepted' }]
    });

    expect(document.slug).toBe('acceptable-use');
    expect(document.type).toBe('acceptable_use');
  });

  it('marks never-seen documents as new and changed ones as updated', () => {
    const documents = normalizeDocuments({
      documents: [
        { document_id: 1, document_type: 'terms', title: 'T', acceptance_status: 'not_accepted' },
        { document_id: 2, document_type: 'privacy', title: 'P', acceptance_status: 'outdated' }
      ]
    });

    expect(documents.map((document) => document.isNew)).toEqual([true, false]);
  });

  it('returns an empty list for a malformed payload rather than throwing', () => {
    expect(normalizeDocuments(null)).toEqual([]);
    expect(normalizeDocuments({})).toEqual([]);
    expect(normalizeDocuments({ documents: 'nope' })).toEqual([]);
  });
});
