// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Per-page search metadata on the accessible frontend (second SEO pass, 23 Oct 2026).
 *
 * Before this pass every public page carried the SAME community-wide description,
 * every what's-on event page was titled "Event details", every legal history page
 * "Previous versions", the community home H1 read "Accessible" on every community,
 * /whats-on and /guide canonicalised to themselves although the main site serves
 * the same pages, there was no Event, BreadcrumbList or WebSite structured data,
 * and signed-out HTML did not say it varies by Accept-Language. Each block below
 * fails against that code.
 */

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
  login: jest.fn(),
  logout: jest.fn(),
  invalidateUserCache: jest.fn(),
  register: jest.fn(),
  validateToken: jest.fn(),
  getProfile: jest.fn(),
  getUnreadCount: jest.fn().mockResolvedValue({ count: 0 }),
  getNotificationUnreadCount: jest.fn().mockResolvedValue({ unread: 0 }),
  getTenants: jest.fn(),
  getTenantBootstrap: jest.fn(),
  getPlatformStats: jest.fn().mockResolvedValue({ data: {} }),
  getRegistrationInfo: jest.fn().mockResolvedValue({ data: {} }),
  getPublicEvents: jest.fn(),
  getPublicEvent: jest.fn(),
  getLegalDocument: jest.fn(),
  getLegalVersions: jest.fn(),
  getHelpFaqs: jest.fn().mockResolvedValue({ data: [] }),
  getBlogPosts: jest.fn(),
  getBlogPost: jest.fn()
}));

process.env.COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';
delete process.env.MAIN_FRONTEND_URL;

const {
  breadcrumbJsonLd,
  buildSeoLocals,
  eventDateTime,
  eventJsonLd,
  mainSitePathFor,
  pageDescription
} = require('../src/lib/seo-meta');
const { translate } = require('../src/lib/localization');

function tenant(overrides = {}) {
  return {
    id: 2,
    name: 'Acme Timebank',
    slug: 'acme',
    tagline: 'Neighbours helping neighbours',
    modules: { feed: true, listings: true, blog: true },
    features: { events: true, public_events: true, blog: true },
    branding: { tagline: 'Neighbours helping neighbours' },
    seo: {},
    settings: {},
    ...overrides
  };
}

function headOf(html) {
  return String(html).split('</head>')[0];
}

function jsonLdBlocks(html) {
  return [...headOf(html).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((match) => JSON.parse(match[1]));
}

function blockOfType(html, type) {
  return jsonLdBlocks(html).find((block) => block['@type'] === type);
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const EVENT = {
  id: 41,
  title: 'Repair café',
  description: 'Bring a broken lamp &\n we will fix it together.',
  start_time: '2026-12-14 18:00:00',
  end_time: '2026-12-14 20:00:00',
  timezone: 'Europe/Dublin',
  all_day: false,
  attendance_mode: 'in_person',
  location: 'Town Hall, Main Street',
  operational_status: 'scheduled',
  image_url: 'https://cdn.example.test/repair.jpg'
};

describe('seo-meta: canonical mapping added in the second pass', () => {
  it('maps what\'s on, the guide and the policy histories to the main site\'s same pages', () => {
    expect(mainSitePathFor('/whats-on')).toBe('/whats-on');
    expect(mainSitePathFor('/whats-on/41')).toBe('/whats-on/41');
    expect(mainSitePathFor('/whats-on/abc')).toBeNull();
    expect(mainSitePathFor('/guide')).toBe('/timebanking-guide');
    // Not a web-uk route; the dead alternative is gone from the list.
    expect(mainSitePathFor('/timebanking-guide')).toBeNull();
    expect(mainSitePathFor('/legal/terms/versions')).toBe('/terms/versions');
    expect(mainSitePathFor('/legal/community-guidelines/versions')).toBe('/community-guidelines/versions');
    // React has no page at a single version's or a comparison's own address.
    expect(mainSitePathFor('/legal/terms/versions/12')).toBeNull();
    expect(mainSitePathFor('/legal/terms/versions/compare')).toBeNull();
  });
});

describe('seo-meta pageDescription', () => {
  it('strips tags, decodes entities and collapses whitespace', () => {
    expect(pageDescription('<p>Fish &amp; chips&nbsp;<b>tonight</b></p>\n\n  &#8212; &#x41;')).toBe('Fish & chips tonight — A');
    expect(pageDescription('<script>alert(1)</script>Plain')).toBe('Plain');
    expect(pageDescription('')).toBe('');
    expect(pageDescription(null)).toBe('');
  });

  it('cuts at a word boundary near 160 characters with an ellipsis', () => {
    const long = `${'word '.repeat(60)}end`;
    const cut = pageDescription(long);
    expect(Array.from(cut).length).toBeLessThanOrEqual(160);
    expect(cut.endsWith('word…')).toBe(true);
    expect(pageDescription('Short and sweet.')).toBe('Short and sweet.');
  });

  it('cuts text with no spaces (Japanese) at the limit instead', () => {
    const cut = pageDescription('時'.repeat(300));
    expect(Array.from(cut)).toHaveLength(160);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('seo-meta structured data builders', () => {
  const context = {
    pageUrl: 'https://app.project-nexus.ie/acme/whats-on/41',
    imageUrl: 'https://cdn.example.test/repair.jpg',
    organizer: { name: 'Acme Timebank', url: 'https://app.project-nexus.ie/acme' }
  };

  it('writes event times in the event\'s own zone with its offset', () => {
    expect(eventDateTime('2026-12-14 18:00:00', 'Europe/Dublin')).toBe('2026-12-14T18:00:00+00:00');
    expect(eventDateTime('2026-07-14 18:00:00', 'Europe/Dublin')).toBe('2026-07-14T19:00:00+01:00');
    expect(eventDateTime('2026-07-14T18:00:00Z', 'America/New_York')).toBe('2026-07-14T14:00:00-04:00');
    expect(eventDateTime('2026-07-14 23:30:00', 'Asia/Tokyo', true)).toBe('2026-07-15');
    expect(eventDateTime('2026-07-14 18:00:00', 'Not/AZone')).toBe('2026-07-14T18:00:00Z');
    expect(eventDateTime('', 'UTC')).toBeUndefined();
  });

  it('describes an in-person event with its venue, status, mode, image and organiser', () => {
    const data = JSON.parse(eventJsonLd(EVENT, context));
    expect(data).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: 'Repair café',
      url: context.pageUrl,
      startDate: '2026-12-14T18:00:00+00:00',
      endDate: '2026-12-14T20:00:00+00:00',
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: { '@type': 'Place', name: 'Town Hall, Main Street', address: 'Town Hall, Main Street' },
      image: ['https://cdn.example.test/repair.jpg'],
      description: 'Bring a broken lamp & we will fix it together.',
      organizer: { '@type': 'Organization', name: 'Acme Timebank', url: 'https://app.project-nexus.ie/acme' }
    });
  });

  it('gives an online event the public page as its virtual location, and a hybrid one both', () => {
    const online = JSON.parse(eventJsonLd({ ...EVENT, attendance_mode: 'online', location: '' }, context));
    expect(online.location).toEqual({ '@type': 'VirtualLocation', url: context.pageUrl });
    expect(online.eventAttendanceMode).toBe('https://schema.org/OnlineEventAttendanceMode');

    const hybrid = JSON.parse(eventJsonLd({ ...EVENT, attendance_mode: 'hybrid', operational_status: 'postponed', latitude: 51.9, longitude: -8.47 }, context));
    expect(hybrid.location).toHaveLength(2);
    expect(hybrid.location[0].geo).toEqual({ '@type': 'GeoCoordinates', latitude: 51.9, longitude: -8.47 });
    expect(hybrid.location[1]['@type']).toBe('VirtualLocation');
    expect(hybrid.eventStatus).toBe('https://schema.org/EventPostponed');
  });

  it('emits NO block for an in-person event with no venue, no name or no start', () => {
    expect(eventJsonLd({ ...EVENT, location: '' }, context)).toBe('');
    expect(eventJsonLd({ ...EVENT, location: '   ' }, context)).toBe('');
    expect(eventJsonLd({ ...EVENT, title: '' }, context)).toBe('');
    expect(eventJsonLd({ ...EVENT, start_time: null }, context)).toBe('');
  });

  it('leaves out what it does not know rather than emitting an invalid value', () => {
    const data = JSON.parse(eventJsonLd({ ...EVENT, end_time: null, description: '' }, { pageUrl: context.pageUrl, imageUrl: 'relative.jpg', organizer: { name: 'Acme' } }));
    expect(data).not.toHaveProperty('endDate');
    expect(data).not.toHaveProperty('description');
    expect(data).not.toHaveProperty('image');
    expect(data).not.toHaveProperty('organizer');
  });

  it('cannot be closed early by an event title', () => {
    const json = eventJsonLd({ ...EVENT, title: 'Party </script><script>alert(1)</script>' }, context);
    expect(json).not.toContain('</script>');
    expect(JSON.parse(json).name).toContain('Party');
  });

  it('builds a breadcrumb trail only when every crumb is complete', () => {
    const json = breadcrumbJsonLd([
      { name: 'Home', url: 'https://app.project-nexus.ie/acme' },
      { name: 'Blog </script>', url: 'https://app.project-nexus.ie/acme/blog' }
    ]);
    expect(json).not.toContain('</script>');
    expect(JSON.parse(json).itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://app.project-nexus.ie/acme' },
      { '@type': 'ListItem', position: 2, name: 'Blog </script>', item: 'https://app.project-nexus.ie/acme/blog' }
    ]);
    expect(breadcrumbJsonLd([{ name: 'Home', url: 'https://x.test/' }])).toBe('');
    expect(breadcrumbJsonLd([{ name: 'Home', url: 'https://x.test/' }, { name: '', url: 'https://x.test/a' }])).toBe('');
    expect(breadcrumbJsonLd([{ name: 'Home', url: 'https://x.test/' }, { name: 'A', url: 'javascript:alert(1)' }])).toBe('');
  });

  it('describes the community WebSite on its home page only, with no search box', () => {
    const t = (key) => key;
    const home = buildSeoLocals({ tenant: tenant({ domain: 'acme.example' }), t, routePath: '/' });
    expect(JSON.parse(home.seoWebsiteJsonLd)).toEqual({
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': 'https://acme.example/#website',
      name: 'Acme Timebank',
      url: 'https://acme.example/',
      publisher: { '@id': 'https://acme.example/#org' }
    });
    expect(home.seoWebsiteJsonLd).not.toContain('SearchAction');
    expect(buildSeoLocals({ tenant: tenant(), t, routePath: '/about' }).seoWebsiteJsonLd).toBe('');
    expect(buildSeoLocals({ tenant: {}, t, routePath: '/' }).seoWebsiteJsonLd).toBe('');
  });
});

describe('per-page search metadata on rendered pages', () => {
  let app;
  let api;
  const t = (key, replacements) => translate('en', key, replacements);
  const descriptionOf = (html) => {
    const match = headOf(html).match(/<meta name="description" content="([^"]*)">/);
    return match ? match[1] : null;
  };
  const titleOf = (html) => (headOf(html).match(/<title>([^<]*)<\/title>/) || [])[1];

  beforeAll(() => {
    app = require('../src/server');
    api = require('../src/lib/api');
  });

  beforeEach(() => {
    api.getTenants.mockResolvedValue({ data: [{ id: 2, name: 'Acme Timebank', slug: 'acme' }] });
    api.getTenantBootstrap.mockResolvedValue({ data: tenant() });
    api.getLegalDocument.mockReset().mockRejectedValue(new api.ApiError('Not found', 404, {}));
    api.getPublicEvents.mockReset().mockResolvedValue({ data: [], meta: { has_more: false } });
    api.getPublicEvent.mockReset().mockResolvedValue({ data: EVENT });
    api.getBlogPosts.mockReset().mockResolvedValue({ data: { items: [], categories: [] } });
  });

  it.each([
    ['/about', () => t('about.description', { name: 'Acme Timebank' })],
    ['/guide', () => t('guide.intro')],
    ['/faq', () => t('faq.intro')],
    ['/changelog', () => t('changelog.intro')],
    ['/contact', () => t('contact.subtitle', { name: 'Acme Timebank' })],
    ['/help', () => t('help.subtitle', { name: 'Acme Timebank' })],
    ['/trust-and-safety', () => t('trust_safety.subtitle', { name: 'Acme Timebank' })],
    ['/accessibility', () => t('accessibility.intro', { name: 'Acme Timebank' })],
    ['/legal/privacy', () => t('legal.documents.privacy.summary')],
    ['/blog', () => t('blog.subtitle', { name: 'Acme Timebank' })],
    ['/whats-on', () => t('govuk_alpha_whats_on.index.intro')]
  ])('%s describes itself, not the community-wide default', async (path, expected) => {
    const response = await request(app).get(`/acme/accessible${path}`);
    expect(response.status).toBe(200);
    const description = descriptionOf(response.text);
    expect(description).toBe(escapeHtml(pageDescription(expected())));
    expect(description).not.toBe('Neighbours helping neighbours');
    expect(Array.from(pageDescription(expected())).length).toBeLessThanOrEqual(160);
  });

  it('describes the features page with the lead paragraph it shows', async () => {
    const response = await request(app).get('/acme/accessible/features');
    expect(response.status).toBe(200);
    expect(descriptionOf(response.text)).not.toBe('Neighbours helping neighbours');
    expect(descriptionOf(response.text)).toBeTruthy();
  });

  it('titles and describes a what\'s-on event by the event itself, with Event and breadcrumb data', async () => {
    const response = await request(app).get('/acme/accessible/whats-on/41');
    expect(response.status).toBe(200);
    expect(titleOf(response.text)).toBe('Repair café - Acme Timebank');
    expect(descriptionOf(response.text)).toBe('Bring a broken lamp &amp; we will fix it together.');
    expect(headOf(response.text)).toContain('<link rel="canonical" href="https://app.project-nexus.ie/acme/whats-on/41">');

    const event = blockOfType(response.text, 'Event');
    expect(event.url).toBe('https://app.project-nexus.ie/acme/whats-on/41');
    expect(event.startDate).toBe('2026-12-14T18:00:00+00:00');
    expect(event.organizer).toEqual({ '@type': 'Organization', name: 'Acme Timebank', url: 'https://app.project-nexus.ie/acme' });

    const trail = blockOfType(response.text, 'BreadcrumbList').itemListElement;
    expect(trail.map((item) => item.name)).toEqual(['Home', t('govuk_alpha_whats_on.index.title'), 'Repair café']);
    expect(trail.map((item) => item.item)).toEqual([
      'https://app.project-nexus.ie/acme',
      'https://app.project-nexus.ie/acme/whats-on',
      'https://app.project-nexus.ie/acme/whats-on/41'
    ]);
  });

  it('renders no Event block for an in-person event with no venue', async () => {
    api.getPublicEvent.mockResolvedValue({ data: { ...EVENT, location: null } });
    const response = await request(app).get('/acme/accessible/whats-on/41');
    expect(response.status).toBe(200);
    expect(blockOfType(response.text, 'Event')).toBeUndefined();
    expect(blockOfType(response.text, 'BreadcrumbList')).toBeDefined();
  });

  it('canonicalises the what\'s-on list and the guide to the main site\'s pages', async () => {
    const list = await request(app).get('/acme/accessible/whats-on?when=past');
    expect(headOf(list.text)).toContain('<link rel="canonical" href="https://app.project-nexus.ie/acme/whats-on">');
    const guide = await request(app).get('/acme/accessible/guide');
    expect(headOf(guide.text)).toContain('<link rel="canonical" href="https://app.project-nexus.ie/acme/timebanking-guide">');
  });

  it('names the document in the policy history title and canonicalises it to the main site', async () => {
    api.getLegalVersions.mockResolvedValue({ data: { title: 'Terms of Service', versions: [] } });
    const response = await request(app).get('/acme/accessible/legal/terms/versions');
    expect(response.status).toBe(200);
    expect(titleOf(response.text)).toBe(`${t('legal.versions_title')} - Terms of Service - Acme Timebank`);
    expect(headOf(response.text)).toContain('<link rel="canonical" href="https://app.project-nexus.ie/acme/terms/versions">');
    const trail = blockOfType(response.text, 'BreadcrumbList').itemListElement;
    expect(trail.map((item) => item.item)).toEqual([
      'https://app.project-nexus.ie/acme',
      'https://app.project-nexus.ie/acme/legal',
      'https://app.project-nexus.ie/acme/terms',
      'https://app.project-nexus.ie/acme/terms/versions'
    ]);
  });

  it('titles a legal document and the accessibility statement by the community\'s own published title', async () => {
    api.getLegalDocument.mockImplementation(async (type) => ({
      data: { type, title: type === 'accessibility' ? 'Our accessibility promise' : 'Acme privacy notice', content: '<p>Text</p>' }
    }));
    const privacy = await request(app).get('/acme/accessible/legal/privacy');
    expect(titleOf(privacy.text)).toBe('Acme privacy notice - Acme Timebank');
    expect(privacy.text).toContain('<h1 class="govuk-heading-xl">Acme privacy notice</h1>');

    const statement = await request(app).get('/acme/accessible/accessibility');
    expect(titleOf(statement.text)).toBe('Our accessibility promise - Acme Timebank');
    expect(statement.text).toContain('<h1 class="govuk-heading-xl">Our accessibility promise</h1>');
  });

  it('keeps the translated titles when the community has published nothing', async () => {
    const statement = await request(app).get('/acme/accessible/accessibility');
    expect(titleOf(statement.text)).toBe(`${t('accessibility.title')} - Acme Timebank`);
  });

  it('gives the blog Article its canonical address, page and publisher logo', async () => {
    api.getTenantBootstrap.mockResolvedValue({
      data: tenant({ branding: { tagline: 'Neighbours helping neighbours', logo_url: '/uploads/acme/logo.png' } })
    });
    api.getBlogPost.mockResolvedValue({ data: { id: 5, slug: 'news', title: 'Big news', content: '<p>Hello</p>', published_at: '2026-10-01T10:00:00Z' } });
    const response = await request(app).get('/acme/accessible/blog/news');
    expect(response.status).toBe(200);
    const article = blockOfType(response.text, 'Article');
    expect(article.url).toBe('https://app.project-nexus.ie/acme/blog/news');
    expect(article.mainEntityOfPage).toEqual({ '@type': 'WebPage', '@id': 'https://app.project-nexus.ie/acme/blog/news' });
    expect(article.publisher.logo).toEqual({ '@type': 'ImageObject', url: 'http://127.0.0.1:8090/uploads/acme/logo.png' });
    const trail = blockOfType(response.text, 'BreadcrumbList').itemListElement;
    expect(trail.map((item) => item.name)).toEqual(['Home', t('blog.title'), 'Big news']);
  });

  it('describes the WebSite and Organization on the community home page, whose H1 is the community name', async () => {
    const response = await request(app).get('/acme/accessible');
    expect(response.status).toBe(200);
    expect(blockOfType(response.text, 'WebSite').url).toBe('https://app.project-nexus.ie/acme');
    expect(response.text).toContain('<h1 class="govuk-heading-xl">Acme Timebank</h1>');
    expect(response.text).toContain(`<span class="govuk-caption-xl">${t('home.title')}</span>`);
  });

  it('adds breadcrumbs to simple public pages', async () => {
    const response = await request(app).get('/acme/accessible/faq');
    const trail = blockOfType(response.text, 'BreadcrumbList').itemListElement;
    expect(trail).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://app.project-nexus.ie/acme' },
      { '@type': 'ListItem', position: 2, name: t('faq.title'), item: 'https://app.project-nexus.ie/acme/faq' }
    ]);
  });

  it('says signed-out HTML varies by Accept-Language', async () => {
    const response = await request(app).get('/acme/accessible/about').set('Accept-Language', 'de');
    expect(response.status).toBe(200);
    expect(String(response.headers.vary || '')).toMatch(/Accept-Language/i);
  });

  it('loads the session-timeout script only for signed-in pages', async () => {
    const response = await request(app).get('/acme/accessible/about');
    expect(response.text).not.toContain('/js/timeout-warning.js');
  });
});
