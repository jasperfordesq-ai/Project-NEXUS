const request = require('supertest');

const {
  SUPPORTED_LOCALES,
  catalogFor,
  formatLocaleDate,
  formatLocaleNumber,
  formatLocaleRelativeTime,
  translate
} = require('../src/lib/localization');
const {
  localeFromAcceptLanguage,
  resolveRequestLocale
} = require('../src/middleware/localization');

function countStringLeaves(value) {
  if (typeof value === 'string') return 1;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  return Object.values(value).reduce((count, child) => count + countStringLeaves(child), 0);
}

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
  getTenantBootstrap: jest.fn().mockResolvedValue({
    data: {
      id: 2,
      name: 'Acme Timebank',
      slug: 'acme',
      modules: {},
      features: {}
    }
  }),
  getPlatformStats: jest.fn().mockResolvedValue({ data: {} }),
  getRegistrationInfo: jest.fn().mockResolvedValue({
    data: {
      registration_mode: 'open',
      requires_invite_code: false,
      is_closed: false,
      can_register: true
    }
  }),
  getProfile: jest.fn(),
  getNotificationUnreadCount: jest.fn(),
  getUnreadCount: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  invalidateUserCache: jest.fn(),
  register: jest.fn(),
  validateToken: jest.fn()
}));

process.env.COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';

describe('Laravel-first locale resolution', () => {
  it('keeps the exact 11 supported locale values aligned with Laravel', () => {
    expect(SUPPORTED_LOCALES).toEqual([
      'en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'
    ]);
  });

  it('honours a supported query first and persists it to the session', () => {
    const req = {
      query: { locale: 'ga' },
      session: { locale: 'ar' },
      headers: { 'accept-language': 'fr' }
    };

    expect(resolveRequestLocale(req)).toBe('ga');
    expect(req.session.locale).toBe('ga');
  });

  it('ignores an unsupported query and retains a supported session locale', () => {
    const req = {
      query: { locale: 'cy' },
      session: { locale: 'ar' },
      headers: { 'accept-language': 'ga' }
    };

    expect(resolveRequestLocale(req)).toBe('ar');
    expect(req.session.locale).toBe('ar');
  });

  it('seeds a safely available signed-in preference ahead of Accept-Language', () => {
    const req = {
      query: {},
      session: {},
      user: { preferred_language: 'ja' },
      headers: { 'accept-language': 'ar' }
    };

    expect(resolveRequestLocale(req)).toBe('ja');
    expect(req.session.locale).toBe('ja');
  });

  it('uses weighted Accept-Language values and their base language', () => {
    expect(localeFromAcceptLanguage('fr-CA;q=0.4, ar-EG;q=0.9, en;q=0.8')).toBe('ar');
    expect(localeFromAcceptLanguage('cy, ga-IE;q=0.8')).toBe('ga');
    expect(localeFromAcceptLanguage('cy, *;q=0.5')).toBeNull();
  });
});

describe('translation and formatter foundation', () => {
  it('resolves the nested Laravel federation v2 catalogue', () => {
    expect(translate('en', 'fed2.reviews.reputation_label', { score: '4.8' }))
      .toBe('4.8 out of 5');
  });

  it('interpolates Laravel catalogue values that use double-brace placeholders', () => {
    expect(translate('en', 'event_registration.settings.revision', { revision: 3 }))
      .toBe('Revision 3');
    expect(translate('en', 'event_registration.forms.version', { version: 4 }))
      .toBe('Version 4');
  });

  it('loads authoritative translated output for every offered locale', () => {
    const englishLogin = translate('en', 'auth.login_title');
    for (const locale of SUPPORTED_LOCALES) {
      expect(translate(locale, 'auth.login_title')).not.toBe('auth.login_title');
      expect(translate(locale, 'header.language_label')).not.toBe('header.language_label');
      if (locale !== 'en') {
        expect(translate(locale, 'auth.login_title')).not.toBe(englishLogin);
      }
    }
  });

  it('keeps every generated locale structurally aligned with Laravel English', () => {
    const english = catalogFor('en');
    const expectedNamespaces = Object.keys(english.namespaces);
    const expectedLeafCount = countStringLeaves(english.namespaces);

    expect(expectedNamespaces).toHaveLength(36);
    expect(expectedNamespaces).toContain('safeguarding');
    expect(expectedLeafCount).toBeGreaterThan(8500);
    for (const locale of SUPPORTED_LOCALES) {
      const catalog = catalogFor(locale);
      expect(catalog._meta.locale).toBe(locale);
      expect(Object.keys(catalog.namespaces)).toEqual(expectedNamespaces);
      expect(countStringLeaves(catalog.namespaces)).toBe(expectedLeafCount);
    }
  });

  it('provides locale-aware number and date helpers', () => {
    expect(formatLocaleNumber(1234.5, 'ga')).toBe(new Intl.NumberFormat('ga-IE').format(1234.5));
    expect(formatLocaleDate('2026-07-10T12:00:00Z', 'ar', { timeZone: 'UTC' }))
      .toBe(new Intl.DateTimeFormat('ar', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(new Date('2026-07-10T12:00:00Z')));
    expect(formatLocaleRelativeTime('2026-07-05T12:00:00Z', 'en', '2026-07-12T12:00:00Z'))
      .toBe('1 week ago');
    expect(formatLocaleRelativeTime('2026-07-12T13:00:00Z', 'fr', '2026-07-12T12:00:00Z'))
      .toBe(new Intl.RelativeTimeFormat('fr', { numeric: 'always' }).format(1, 'hour'));
  });
});

describe('localized accessible document shell', () => {
  let app;

  beforeAll(() => {
    app = require('../src/server');
  });

  it.each([
    { locale: 'ga', direction: 'ltr' },
    { locale: 'ar', direction: 'rtl' }
  ])('renders $locale document titles and primary headings for the public browser gate', async ({ locale, direction }) => {
    const mountPath = '/acme/accessible';
    const pages = [
      { path: '', key: 'home.title' },
      { path: '/about', key: 'about.title', replacements: { name: 'Acme Timebank' } },
      { path: '/guide', key: 'guide.title' },
      { path: '/faq', key: 'faq.title' },
      { path: '/login', key: 'auth.login_title' },
      { path: '/register', key: 'auth.register_title' },
      { path: '/contact', key: 'contact.title' },
      { path: '/legal', key: 'legal.hub_title' },
      { path: '/accessibility', key: 'accessibility.title' }
    ];

    for (const page of pages) {
      const expectedIdentity = translate(locale, page.key, page.replacements);
      const response = await request(app).get(`${mountPath}${page.path}?locale=${locale}`);

      expect(response.status).toBe(200);
      expect(response.headers['content-language']).toBe(locale);
      expect(response.text).toContain(`<html lang="${locale}" dir="${direction}" class="govuk-template">`);
      expect(response.text).toContain(`<title>${expectedIdentity} - `);
      expect(response.text).toContain(`<h1 class="govuk-heading-xl">${expectedIdentity}</h1>`);
    }
  });

  it('renders and persists the Irish shell with exactly one main landmark', async () => {
    const agent = request.agent(app);
    const selected = await agent
      .get('/acme/accessible/login?locale=ga')
      .set('Accept-Language', 'en');

    expect(selected.status).toBe(200);
    expect(selected.headers['content-language']).toBe('ga');
    expect(selected.text).toContain('<html lang="ga" dir="ltr" class="govuk-template">');
    expect(selected.text).toContain('Roghnaigh teanga');
    expect(selected.text).toContain('Sínigh isteach');
    expect(selected.text).toContain('Tabhair aiseolas');
    expect(selected.text).toContain('<input type="hidden" name="tenant_slug" value="acme">');
    expect(selected.text).not.toContain('Community code');
    expect((selected.text.match(/<main\b/g) || [])).toHaveLength(1);
    expect((selected.text.match(/id="main-content"/g) || [])).toHaveLength(1);

    const persisted = await agent
      .get('/acme/accessible/login')
      .set('Accept-Language', 'ar');

    expect(persisted.status).toBe(200);
    expect(persisted.text).toContain('<html lang="ga" dir="ltr" class="govuk-template">');
    expect(persisted.text).toContain('Roghnaigh teanga');
  });

  it('renders the Arabic shell in an RTL document', async () => {
    const response = await request(app).get('/acme/accessible/login?locale=ar');

    expect(response.status).toBe(200);
    expect(response.headers['content-language']).toBe('ar');
    expect(response.text).toContain('<html lang="ar" dir="rtl" class="govuk-template">');
    expect(response.text).toContain('اختر لغة');
    expect(response.text).toContain('تسجيل الدخول');
    expect(response.text).toContain('تقديم ردود الفعل');
  });

  it('uses Accept-Language when no explicit or session choice exists', async () => {
    const response = await request(app)
      .get('/acme/accessible/login')
      .set('Accept-Language', 'cy;q=1, ar-EG;q=0.9');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<html lang="ar" dir="rtl" class="govuk-template">');
  });

  it('ignores an unsupported query value and renders the negotiated German catalog', async () => {
    const response = await request(app)
      .get('/acme/accessible/login?locale=cy')
      .set('Accept-Language', 'de-DE');

    expect(response.status).toBe(200);
    expect(response.text).toContain('<html lang="de" dir="ltr" class="govuk-template">');
    expect(response.text).toContain('Wählen Sie eine Sprache');
    expect(response.text).toContain('Melden Sie sich an');
    expect(response.text).not.toContain('<option value="cy"');
  });

  it('seeds a real signed-in profile preference once and then uses the session', async () => {
    const cookieSignature = require('cookie-signature');
    const api = require('../src/lib/api');
    const signedToken = `s:${cookieSignature.sign('locale-profile-token', process.env.COOKIE_SECRET)}`;
    api.getProfile.mockResolvedValueOnce({ data: { preferred_language: 'ja' } });

    const agent = request.agent(app);
    const selected = await agent
      .get('/acme/accessible/accessibility')
      .set('Cookie', `token=${encodeURIComponent(signedToken)}`)
      .set('Accept-Language', 'ar');

    expect(selected.status).toBe(200);
    expect(selected.headers['content-language']).toBe('ja');
    expect(selected.text).toContain('<html lang="ja" dir="ltr" class="govuk-template">');
    expect(api.getProfile).toHaveBeenCalledTimes(1);

    const persisted = await agent
      .get('/acme/accessible/accessibility')
      .set('Cookie', `token=${encodeURIComponent(signedToken)}`)
      .set('Accept-Language', 'ar');

    expect(persisted.status).toBe(200);
    expect(persisted.headers['content-language']).toBe('ja');
    expect(persisted.text).toContain('<html lang="ja" dir="ltr" class="govuk-template">');
    expect(api.getProfile).toHaveBeenCalledTimes(1);
  });
});
