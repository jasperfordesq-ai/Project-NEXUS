// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Legal document fidelity.
 *
 * Blade (`accessible-frontend/views/legal-document.blade.php`) is the reference
 * for the document page itself. Four things here go BEYOND Blade and are
 * deliberate improvements, recorded as such rather than smuggled in:
 *
 *  - a future `effective_date` is announced as not yet in force;
 *  - `summary_of_changes` is shown (the API returns it; both frontends dropped it);
 *  - published version history, with comparison (Blade has no such page);
 *  - a server-built table of contents for long documents.
 *
 * The defect this file exists to prevent: `formatDate` is a RELATIVE-time filter,
 * and a legal `effective_date` is routinely future-dated. A negative difference
 * lands in the "just now" branch, so a policy that does not yet apply renders as
 * though it started applying moments ago.
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
  getLegalDocument: jest.fn().mockResolvedValue({ data: null }),
  getLegalVersions: jest.fn().mockResolvedValue({ data: { title: '', versions: [] } }),
  getLegalVersion: jest.fn().mockResolvedValue({ data: null }),
  compareLegalVersions: jest.fn().mockResolvedValue({ data: null })
}));

const api = require('../src/lib/api');
const { sanitizeDiffHtml, withHeadingAnchors, sanitizeCmsHtml } = require('../src/lib/html-sanitizer');
const { createTranslator, formatLocaleDate } = require('../src/lib/localization');

const VIEW_PATHS = [
  path.join(__dirname, '..', 'src', 'views'),
  path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')
];

/**
 * A minimal host for the real legal router. The shared layout and locale
 * middleware are exercised in the shell suite; this keeps the assertions on the
 * legal pages themselves.
 */
function buildApp() {
  const app = express();
  const env = nunjucks.configure(VIEW_PATHS, { autoescape: true, noCache: true, express: app });
  const t = createTranslator('en');

  // Uses the app's own date formatter, not a lookalike — a stub with a different
  // locale convention would drift from what the server actually renders.
  env.addFilter('formatLegalDate', (dateStr) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return String(dateStr);
    return formatLocaleDate(date, 'en', { day: 'numeric', month: 'long', year: 'numeric' });
  });
  // Present so a template mistakenly reaching for it is caught by an assertion
  // rather than by a render crash.
  env.addFilter('formatDate', () => 'RELATIVE-TIME-FILTER-USED');

  app.set('view engine', 'njk');
  app.use((req, res, next) => {
    res.locals.t = t;
    res.locals.locale = 'en';
    res.locals.urlFor = (pathname) => pathname;
    res.locals.tenant = { name: 'Acme Timebank', slug: 'acme' };
    res.locals.isAuthenticated = false;
    res.locals.tenantName = 'Acme Timebank';
    res.locals.serviceName = 'Project NEXUS Accessible';
    res.locals.alphaNavItems = [];
    res.locals.alphaFooterColumns = [];
    res.locals.alphaLocaleOptions = [];
    res.locals.alphaCurrentLocale = 'en';
    res.locals.csrfToken = 'test-csrf';
    next();
  });

  // eslint-disable-next-line global-require
  app.use(require('../src/routes/legal'));
  return app;
}

const FUTURE = '2099-01-15T00:00:00Z';
const PAST = '2026-07-01T00:00:00Z';

function documentPayload(overrides = {}) {
  return {
    data: {
      id: 12,
      type: 'terms',
      title: 'Community Terms',
      content: '<p>Use time credits fairly.</p>',
      version_number: '2.1',
      effective_date: PAST,
      summary_of_changes: '',
      has_previous_versions: false,
      ...overrides
    }
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getLegalDocument.mockResolvedValue({ data: null });
  api.getLegalVersions.mockResolvedValue({ data: { title: '', versions: [] } });
  api.getLegalVersion.mockResolvedValue({ data: null });
  api.compareLegalVersions.mockResolvedValue({ data: null });
});

describe('legal document dates', () => {
  it('never renders a legal date through the relative-time filter', async () => {
    api.getLegalDocument.mockResolvedValue(documentPayload());

    const response = await request(buildApp()).get('/legal/terms');

    expect(response.status).toBe(200);
    expect(response.text).not.toContain('RELATIVE-TIME-FILTER-USED');
    expect(response.text).toContain('1 July 2026');
  });

  it('carries the ISO date in a machine-readable time element', async () => {
    api.getLegalDocument.mockResolvedValue(documentPayload());

    const response = await request(buildApp()).get('/legal/terms');

    // This is exactly the value Blade prints (Str::before('T')), so nothing is
    // lost by showing a localised date to the reader.
    expect(response.text).toContain('<time datetime="2026-07-01">');
  });

  it('says a future-dated policy is not yet in force, and labels the date as such', async () => {
    api.getLegalDocument.mockResolvedValue(documentPayload({ effective_date: FUTURE }));

    const response = await request(buildApp()).get('/legal/terms');

    expect(response.text).toContain('This version is not yet in force');
    expect(response.text).toContain('Comes into effect');
    expect(response.text).not.toContain('Last updated');
    expect(response.text).toContain('govuk-warning-text');
  });

  it('treats a policy effective today as in force', async () => {
    const today = `${new Date().toISOString().slice(0, 10)}T00:00:00Z`;
    api.getLegalDocument.mockResolvedValue(documentPayload({ effective_date: today }));

    const response = await request(buildApp()).get('/legal/terms');

    expect(response.text).not.toContain('This version is not yet in force');
    expect(response.text).toContain('Last updated');
  });

  it('falls back to updated_at when no effective_date is set, without claiming a future date', async () => {
    api.getLegalDocument.mockResolvedValue(documentPayload({
      effective_date: null,
      updated_at: PAST
    }));

    const response = await request(buildApp()).get('/legal/terms');

    expect(response.text).toContain('1 July 2026');
    expect(response.text).not.toContain('This version is not yet in force');
  });
});

describe('legal document content', () => {
  it('keeps images, matching HtmlSanitizer::sanitizeCms', async () => {
    api.getLegalDocument.mockResolvedValue(documentPayload({
      content: '<p>Read this.</p><img src="https://cdn.example/how-it-works.png" alt="How an exchange works">'
    }));

    const response = await request(buildApp()).get('/legal/terms');

    // A diagram in a policy is an accessibility measure. web-uk was stripping it
    // on this frontend only.
    expect(response.text).toContain('src="https://cdn.example/how-it-works.png"');
    expect(response.text).toContain('alt="How an exchange works"');
  });

  it('still strips scripts and event handlers', async () => {
    api.getLegalDocument.mockResolvedValue(documentPayload({
      content: '<p onclick="alert(1)">Text</p><script>alert(2)</script><img src="javascript:alert(3)" alt="">'
    }));

    const response = await request(buildApp()).get('/legal/terms');

    expect(response.text).not.toContain('onclick=');
    expect(response.text).not.toContain('alert(2)');
    expect(response.text).not.toContain('javascript:');
  });

  it('shows the summary of changes the API already returns', async () => {
    api.getLegalDocument.mockResolvedValue(documentPayload({
      summary_of_changes: 'Clarified how credits are returned when an exchange is cancelled.'
    }));

    const response = await request(buildApp()).get('/legal/terms');

    expect(response.text).toContain('What has changed');
    expect(response.text).toContain('Clarified how credits are returned');
  });

  it('links to the version history only when previous versions exist', async () => {
    api.getLegalDocument.mockResolvedValue(documentPayload({ has_previous_versions: true }));
    const withHistory = await request(buildApp()).get('/legal/terms');

    api.getLegalDocument.mockResolvedValue(documentPayload({ has_previous_versions: false }));
    const withoutHistory = await request(buildApp()).get('/legal/terms');

    expect(withHistory.text).toContain('href="/legal/terms/versions"');
    expect(withoutHistory.text).not.toContain('/legal/terms/versions');
  });

  it('uses the hyphenated slug in the history link for underscored types', async () => {
    api.getLegalDocument.mockResolvedValue(documentPayload({
      type: 'community_guidelines',
      has_previous_versions: true
    }));

    const response = await request(buildApp()).get('/legal/community-guidelines');

    expect(response.text).toContain('href="/legal/community-guidelines/versions"');
    expect(response.text).not.toContain('/legal/community_guidelines/versions');
  });

  it('builds a contents list from the document headings, with working anchors', async () => {
    api.getLegalDocument.mockResolvedValue(documentPayload({
      content: [
        '<h2>Using this service</h2><p>a</p>',
        '<h3>Your account</h3><p>b</p>',
        '<h2>Time credits</h2><p>c</p>'
      ].join('')
    }));

    const response = await request(buildApp()).get('/legal/terms');

    expect(response.text).toContain('Contents');
    expect(response.text).toContain('href="#using-this-service"');
    expect(response.text).toContain('id="using-this-service"');
    expect(response.text).toContain('href="#time-credits"');
    // No JavaScript anywhere in it — the whole premise of this frontend.
    expect(response.text).not.toContain('onclick');
  });

  it('omits the contents list for a short document', async () => {
    api.getLegalDocument.mockResolvedValue(documentPayload({
      content: '<h2>Only heading</h2><p>Short.</p>'
    }));

    const response = await request(buildApp()).get('/legal/terms');

    expect(response.text).not.toContain('legal-contents-title');
  });
});

describe('legal version history', () => {
  const versionRow = (overrides = {}) => ({
    id: 91,
    version_number: '2.1',
    version_label: null,
    effective_date: PAST,
    published_at: '2026-06-20T09:00:00Z',
    is_current: true,
    summary_of_changes: 'Clarified credit returns.',
    ...overrides
  });

  it('lists published versions newest first, marking the current one in text', async () => {
    api.getLegalVersions.mockResolvedValue({
      data: {
        title: 'Community Terms',
        type: 'terms',
        versions: [versionRow(), versionRow({ id: 90, version_number: '2.0', is_current: false })]
      }
    });

    const response = await request(buildApp()).get('/legal/terms/versions');

    expect(response.status).toBe(200);
    expect(api.getLegalVersions).toHaveBeenCalledWith('terms');
    expect(response.text).toContain('Previous versions');
    // A tag with words in it, not a colour.
    expect(response.text).toContain('Current version');
    expect(response.text).toContain('href="/legal/terms/versions/90"');
    expect(response.text).toContain('Clarified credit returns.');
  });

  it('translates the underscored type from the hyphenated URL segment', async () => {
    api.getLegalVersions.mockResolvedValue({ data: { title: 'Guidelines', versions: [] } });

    await request(buildApp()).get('/legal/community-guidelines/versions');

    expect(api.getLegalVersions).toHaveBeenCalledWith('community_guidelines');
  });

  it('says so plainly when nothing earlier has been published', async () => {
    const response = await request(buildApp()).get('/legal/terms/versions');

    expect(response.status).toBe(200);
    expect(response.text).toContain('No earlier versions have been published.');
  });

  it('offers a comparison only when there are two versions to compare', async () => {
    api.getLegalVersions.mockResolvedValue({
      data: { title: 'Community Terms', versions: [versionRow()] }
    });
    const single = await request(buildApp()).get('/legal/terms/versions');

    api.getLegalVersions.mockResolvedValue({
      data: {
        title: 'Community Terms',
        versions: [versionRow(), versionRow({ id: 90, version_number: '2.0', is_current: false })]
      }
    });
    const pair = await request(buildApp()).get('/legal/terms/versions');

    expect(single.text).not.toContain('/versions/compare');
    expect(pair.text).toContain('/legal/terms/versions/compare?v1=90&amp;v2=91');
  });

  it('refuses an unknown document type', async () => {
    const response = await request(buildApp()).get('/legal/not-a-document/versions');

    expect(response.status).toBe(404);
    expect(api.getLegalVersions).not.toHaveBeenCalled();
  });

  it('refuses version history for the accessibility statement, which has no version pages', async () => {
    const response = await request(buildApp()).get('/legal/accessibility/versions');

    expect(response.status).toBe(404);
    expect(api.getLegalVersions).not.toHaveBeenCalled();
  });
});

describe('a single archived version', () => {
  const version = (overrides = {}) => ({
    data: {
      id: 90,
      document_type: 'terms',
      title: 'Community Terms',
      version_number: '2.0',
      version_label: null,
      content: '<p>The older wording.</p>',
      effective_date: '2026-01-01T00:00:00Z',
      published_at: '2025-12-20T09:00:00Z',
      is_current: false,
      summary_of_changes: 'First published version.',
      ...overrides
    }
  });

  it('warns that an archived version is not the one that applies, before its text', async () => {
    api.getLegalVersion.mockResolvedValue(version());

    const response = await request(buildApp()).get('/legal/terms/versions/90');

    expect(response.status).toBe(200);
    expect(api.getLegalVersion).toHaveBeenCalledWith('90');
    expect(response.text).toContain('This is an earlier version, kept for reference');
    expect(response.text).toContain('View the version that applies today');
    // 🔴 Ordering matters: somebody arriving from a search result must be told
    // before they start reading, not after.
    expect(response.text.indexOf('kept for reference')).toBeLessThan(
      response.text.indexOf('The older wording.')
    );
  });

  it('refuses a version belonging to a different document type', async () => {
    api.getLegalVersion.mockResolvedValue(version({ document_type: 'privacy' }));

    const response = await request(buildApp()).get('/legal/terms/versions/90');

    // Version ids are global, so without this check a privacy version would
    // render under the terms heading and back links.
    expect(response.status).toBe(404);
  });

  it('refuses a non-numeric version id without calling the API', async () => {
    const response = await request(buildApp()).get('/legal/terms/versions/abc');

    expect(response.status).toBe(404);
    expect(api.getLegalVersion).not.toHaveBeenCalled();
  });

  it('turns a 404 from the API into a not-found page', async () => {
    const { ApiError } = api;
    api.getLegalVersion.mockRejectedValue(new ApiError('Not found', 404, {}));

    const response = await request(buildApp()).get('/legal/terms/versions/90');

    expect(response.status).toBe(404);
  });
});

describe('version comparison', () => {
  const comparison = (overrides = {}) => ({
    data: {
      version1: { id: 90, version_number: '2.0', effective_date: '2026-01-01T00:00:00Z', is_current: false },
      version2: { id: 91, version_number: '2.1', effective_date: PAST, is_current: true },
      diff_html: '<div class="diff-unified"><div class="diff-line diff-removed"><span class="diff-indicator">−</span> <del>Old line.</del></div><div class="diff-line diff-added"><span class="diff-indicator">+</span> <ins>New line.</ins></div></div>',
      changes_count: 2,
      ...overrides
    }
  });

  it('renders the comparison with ins and del intact', async () => {
    api.compareLegalVersions.mockResolvedValue(comparison());

    const response = await request(buildApp()).get('/legal/terms/versions/compare?v1=90&v2=91');

    expect(response.status).toBe(200);
    expect(api.compareLegalVersions).toHaveBeenCalledWith('90', '91');
    // 🔴 These two elements carry the meaning to assistive technology. The CMS
    // sanitiser strips both, which would leave colour as the only signal — a
    // WCAG 1.4.1 failure that looks fine in a browser.
    expect(response.text).toContain('<del>Old line.</del>');
    expect(response.text).toContain('<ins>New line.</ins>');
    expect(response.text).toContain('Added');
    expect(response.text).toContain('Removed');
  });

  it('registers compare before the version-id route, so the word is not read as an id', async () => {
    api.compareLegalVersions.mockResolvedValue(comparison());

    await request(buildApp()).get('/legal/terms/versions/compare?v1=90&v2=91');

    expect(api.getLegalVersion).not.toHaveBeenCalled();
  });

  it('degrades rather than erroring when the pair spans two documents', async () => {
    const { ApiError } = api;
    api.compareLegalVersions.mockRejectedValue(new ApiError('Bad pair', 400, {}));

    const response = await request(buildApp()).get('/legal/terms/versions/compare?v1=90&v2=91');

    expect(response.status).toBe(200);
    expect(response.text).toContain('This comparison is temporarily unavailable');
  });

  it('degrades when the comparison rate limit trips', async () => {
    const { ApiError } = api;
    // The API allows 30 comparisons per 10 minutes.
    api.compareLegalVersions.mockRejectedValue(new ApiError('Too many', 429, {}));

    const response = await request(buildApp()).get('/legal/terms/versions/compare?v1=90&v2=91');

    expect(response.status).toBe(200);
    expect(response.text).toContain('This comparison is temporarily unavailable');
  });

  it('refuses non-numeric version parameters without calling the API', async () => {
    const response = await request(buildApp()).get('/legal/terms/versions/compare?v1=abc&v2=91');

    expect(response.status).toBe(404);
    expect(api.compareLegalVersions).not.toHaveBeenCalled();
  });

  it('refuses a comparison with no parameters at all', async () => {
    const response = await request(buildApp()).get('/legal/terms/versions/compare');

    expect(response.status).toBe(404);
    expect(api.compareLegalVersions).not.toHaveBeenCalled();
  });
});

describe('the accessibility statement', () => {
  it('renders a tenant-published statement when one exists', async () => {
    api.getLegalDocument.mockImplementation(async (type) => (
      type === 'accessibility'
        ? { data: { type: 'accessibility', title: 'Our accessibility statement', content: '<p>Local commitments.</p>', version_number: '1.0', effective_date: PAST } }
        : { data: null }
    ));

    const response = await request(buildApp()).get('/accessibility');

    expect(response.status).toBe(200);
    expect(response.text).toContain('Our accessibility statement');
    expect(response.text).toContain('Local commitments.');
  });

  it('falls back to the standard statement when none is published', async () => {
    const response = await request(buildApp()).get('/accessibility');

    expect(response.status).toBe(200);
    expect(api.getLegalDocument).toHaveBeenCalledWith('accessibility');
    // What every community sees today, so nothing changes for anyone who has not
    // published their own.
    expect(response.text).toContain('WCAG 2.2 Level AA');
    expect(response.text).toContain('Known limitations');
  });
});

describe('legacy legal paths', () => {
  it('redirects /terms and /privacy permanently to their legal paths', async () => {
    const app = buildApp();

    const terms = await request(app).get('/terms');
    const privacy = await request(app).get('/privacy');

    // LegalDocumentService::notifyUsersOfUpdate() emits React-shaped /terms links
    // in the notification bell; those already-sent links used to dead-end here.
    expect(terms.status).toBe(301);
    expect(terms.headers.location).toBe('/legal/terms');
    expect(privacy.status).toBe(301);
    expect(privacy.headers.location).toBe('/legal/privacy');
  });
});

describe('the diff sanitiser', () => {
  it('keeps ins and del, which the CMS sanitiser strips', () => {
    const input = '<div class="diff-line diff-added"><span class="diff-indicator">+</span> <ins>New.</ins></div>';

    expect(sanitizeDiffHtml(input)).toContain('<ins>New.</ins>');
    expect(sanitizeCmsHtml(input)).not.toContain('<ins>');
  });

  it('removes anything that could execute or navigate', () => {
    const input = '<div onclick="alert(1)"><a href="https://evil.example">link</a><script>alert(2)</script><ins>ok</ins></div>';
    const output = sanitizeDiffHtml(input);

    expect(output).toContain('<ins>ok</ins>');
    expect(output).not.toContain('onclick');
    expect(output).not.toContain('<a');
    expect(output).not.toContain('alert(2)');
  });

  it('keeps the class names the stylesheet needs', () => {
    const output = sanitizeDiffHtml('<div class="diff-line diff-removed"><del>x</del></div>');

    expect(output).toContain('class="diff-line diff-removed"');
  });
});

describe('heading anchors', () => {
  it('generates unique ids for repeated heading text', () => {
    const { html, headings } = withHeadingAnchors('<h2>Scope</h2><h2>Scope</h2>');

    expect(headings.map((heading) => heading.id)).toEqual(['scope', 'scope-2']);
    expect(html).toContain('id="scope"');
    expect(html).toContain('id="scope-2"');
  });

  it('keeps an id the document already had', () => {
    const { html, headings } = withHeadingAnchors('<h2 id="existing">Scope</h2>');

    expect(headings[0].id).toBe('existing');
    expect(html).toContain('id="existing"');
    expect(html).not.toContain('id="scope"');
  });

  it('takes the label from the text, ignoring inline markup', () => {
    const { headings } = withHeadingAnchors('<h2>Using <strong>time credits</strong></h2>');

    expect(headings[0].label).toBe('Using time credits');
    expect(headings[0].id).toBe('using-time-credits');
  });

  it('skips an empty heading rather than making a blank contents entry', () => {
    const { headings } = withHeadingAnchors('<h2></h2><h2>Real</h2>');

    expect(headings).toHaveLength(1);
    expect(headings[0].label).toBe('Real');
  });

  it('records the level so the contents list can indent subsections', () => {
    const { headings } = withHeadingAnchors('<h2>Top</h2><h3>Under</h3>');

    expect(headings.map((heading) => heading.level)).toEqual([2, 3]);
  });

  it('cannot introduce an id containing anything but a slug', () => {
    const { html } = withHeadingAnchors('<h2>A "quoted" &amp; odd <heading></h2>');

    expect(html).toMatch(/id="[a-z0-9-]+"/);
    expect(html).not.toContain('id="a-"quoted"');
  });
});
