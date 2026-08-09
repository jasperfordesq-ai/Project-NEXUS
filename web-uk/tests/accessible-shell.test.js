const {
  buildExploreLinks,
  buildFooterColumns,
  featureDefaults,
  buildNavItems,
  buildShellLocals,
  prefixLocalPath,
  resolveBackendAssetUrl
} = require('../src/lib/accessible-shell');
const { createTranslator } = require('../src/lib/localization');

describe('accessible shell tenant gating', () => {
  const tenant = {
    name: 'Acme Timebank',
    slug: 'acme',
    modules: {
      dashboard: false,
      feed: false,
      listings: true
    },
    features: {
      connections: false,
      events: false,
      volunteering: true,
      blog: false
    }
  };

  it('matches Laravel Blade service navigation module and feature gates', () => {
    expect(buildNavItems({ isAuthenticated: false, tenant }).map((item) => item.key))
      .toEqual(['home', 'listings', 'volunteering']);

    expect(buildNavItems({ isAuthenticated: true, tenant }).map((item) => item.key))
      .toEqual(['listings', 'volunteering', 'explore']);
  });

  it('matches Laravel Blade footer platform link gates', () => {
    const columns = buildFooterColumns({ tenant });

    expect(columns.map((column) => column.key)).toEqual(['platform', 'support', 'legal']);
    expect(columns.find((column) => column.key === 'platform').links.map((link) => link.key))
      .toEqual(['listings', 'volunteering']);
  });

  it('prefixes only enabled tenant links in shell locals', () => {
    const locals = buildShellLocals({
      query: {},
      path: '/events',
      originalUrl: '/acme/accessible/events',
      accessibleRouting: {
        tenant,
        tenantSlug: 'acme',
        prefix: '/acme/accessible'
      }
    }, false);

    expect(locals.alphaNavItems.map((item) => [item.key, item.href])).toEqual([
      ['home', '/acme/accessible'],
      ['listings', '/acme/accessible/listings'],
      ['volunteering', '/acme/accessible/volunteering']
    ]);
    expect(locals.alphaFooterColumns.find((column) => column.key === 'platform').links.map((link) => link.href))
      .toEqual(['/acme/accessible/listings', '/acme/accessible/volunteering']);
  });

  it('does not double-prefix paths that are already inside the active tenant mount', () => {
    const prefix = '/acme/accessible';

    expect(prefixLocalPath('/cookies', prefix)).toBe('/acme/accessible/cookies');
    expect(prefixLocalPath('/acme/accessible', prefix)).toBe('/acme/accessible');
    expect(prefixLocalPath('/acme/accessible/cookies?status=saved', prefix))
      .toBe('/acme/accessible/cookies?status=saved');
    expect(prefixLocalPath('/acme/accessible?locale=ar', prefix))
      .toBe('/acme/accessible?locale=ar');
  });

  it('resolves only configured-backend tenant logo assets', () => {
    expect(resolveBackendAssetUrl('/uploads/tenants/acme/logo.png'))
      .toBe('http://127.0.0.1:8088/uploads/tenants/acme/logo.png');
    expect(resolveBackendAssetUrl('https://untrusted.example/logo.png')).toBe('');
  });

  it('localizes the mandatory non-government header disclosure', () => {
    const english = buildShellLocals({ query: {}, locale: 'en', path: '/', originalUrl: '/' }, false);
    const arabic = buildShellLocals({ query: {}, locale: 'ar', path: '/', originalUrl: '/' }, false);

    expect(english.shellNotAffiliated).toBe('Not affiliated with GOV.UK');
    expect(arabic.shellNotAffiliated).toBe('غير تابع لـ GOV.UK');
  });

  it('exposes Laravel bootstrap logo variants and a safe shape to the shell', () => {
    const locals = buildShellLocals({
      query: {},
      path: '/',
      originalUrl: '/acme/accessible',
      accessibleRouting: {
        tenant: {
          ...tenant,
          branding: {
            logo_url: '/uploads/tenants/acme/light.png',
            logo_dark_url: '/uploads/tenants/acme/dark.png',
            logo_shape: 'wide'
          }
        },
        tenantSlug: 'acme',
        prefix: '/acme/accessible'
      }
    }, false);

    expect(locals.tenantLogoUrl).toBe('http://127.0.0.1:8088/uploads/tenants/acme/dark.png');
    expect(locals.tenantLogoShape).toBe('wide');
  });

  it('matches Laravel Blade Explore card feature gates from tenant bootstrap', () => {
    const locals = buildShellLocals({
      query: {},
      path: '/explore',
      originalUrl: '/acme/accessible/explore',
      accessibleRouting: {
        tenant: {
          ...tenant,
          modules: {
            ...tenant.modules,
            listings: false
          },
          features: {
            ...tenant.features,
            ai_chat: false,
            polls: true,
            search: false,
            groups: false,
            goals: false,
            resources: true,
            marketplace: false,
            job_vacancies: false,
            courses: true,
            podcasts: false,
            merchant_coupons: false,
            member_premium: false,
            ideation_challenges: true,
            federation: false
          }
        },
        tenantSlug: 'acme',
        prefix: '/acme/accessible'
      }
    }, true);

    expect(locals.alphaExploreLinks.map((item) => item.title)).toEqual([
      'Polls',
      'Search',
      'Skills directory',
      'Organisations',
      'Resources',
      'Courses',
      'Ideas'
    ]);
    expect(locals.alphaExploreLinks.map((item) => item.href)).toEqual([
      '/acme/accessible/polls',
      '/acme/accessible/search',
      '/acme/accessible/skills',
      '/acme/accessible/organisations',
      '/acme/accessible/resources',
      '/acme/accessible/courses',
      '/acme/accessible/ideation'
    ]);
  });

  it.each(['ga', 'ar'])('localizes every enabled Explore card from explicit Laravel keys in %s', (locale) => {
    const t = createTranslator(locale);
    const links = buildExploreLinks({
      tenant: {
        has_clubs: true,
        exchange_workflow: true,
        modules: { listings: true },
        features: Object.fromEntries(Object.keys(featureDefaults).map((key) => [key, true]))
      },
      t
    });

    expect(links).toHaveLength(19);
    for (const item of links) {
      expect(item.title).toBe(t(item.titleKey));
      expect(item.description).toBe(t(item.descriptionKey));
      expect(item.title).not.toBe(item.titleKey);
      expect(item.description).not.toBe(item.descriptionKey);
    }

    expect(links.find((item) => item.href === '/exchanges')).toMatchObject({
      title: t('exchanges.title'),
      description: t('exchanges.description')
    });
    expect(links.find((item) => item.href === '/chat')).toMatchObject({
      title: t('govuk_alpha_aichat.title'),
      description: t('govuk_alpha_aichat.description')
    });
    expect(links.find((item) => item.href === '/clubs')).toMatchObject({
      title: t('clubs.title'),
      description: t('clubs.description')
    });
  });
});
