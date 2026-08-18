const {
  buildExploreLinks,
  buildFooterColumns,
  featureDefaults,
  buildNavItems,
  buildShellLocals,
  buildLanguageQueryParams,
  prefixLocalPath,
  resolveBackendAssetUrl,
  resolveBackendMediaUrl
} = require('../src/lib/accessible-shell');
const { createTranslator } = require('../src/lib/localization');

describe('language switcher preserves the current query (no-JS form)', () => {
  it('keeps scalar params and drops only locale', () => {
    const params = buildLanguageQueryParams({ locale: 'en', q: 'plumber', page: '2' });
    expect(params).toContainEqual({ name: 'q', value: 'plumber' });
    expect(params).toContainEqual({ name: 'page', value: '2' });
    expect(params.some((p) => p.name === 'locale')).toBe(false);
  });

  it('🔴 preserves ARRAY params (e.g. a half-built group message) instead of dropping them', () => {
    // The regression: switching language used to silently drop `members[]`, wiping
    // every selected recipient. Each element must survive as its own bracketed input
    // so Express's extended qs re-reads it back into an array.
    const params = buildLanguageQueryParams({ locale: 'ga', name: 'Local helpers', 'members': ['44', '55'] });
    const memberInputs = params.filter((p) => p.name === 'members[]').map((p) => p.value);
    expect(memberInputs).toEqual(['44', '55']);
    expect(params).toContainEqual({ name: 'name', value: 'Local helpers' });
  });

  it('preserves nested-object params (e.g. filter[status])', () => {
    const params = buildLanguageQueryParams({ filter: { status: 'open' } });
    expect(params).toContainEqual({ name: 'filter[status]', value: 'open' });
  });
});

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
      .toBe('http://127.0.0.1:8090/uploads/tenants/acme/logo.png');
    expect(resolveBackendAssetUrl('https://untrusted.example/logo.png')).toBe('');
  });

  /**
   * 🔴 Regression guard added 2026-08-18. Reported on the accessible feed: no
   * avatars and no post photos loaded at all, on every accessible domain.
   *
   * Cause: member-content image URLs were rendered EXACTLY as the API returned
   * them. The API returns a relative path (`/uploads/...`, and the Laravel
   * default avatar `/assets/img/defaults/default_avatar.png`), which the browser
   * resolves against the ACCESSIBLE host — where nothing under /uploads or
   * /assets exists. Verified against production: both 404 on
   * accessible.project-nexus.ie and 200/403 on api.project-nexus.ie.
   *
   * The header logo was correct because it went through resolveBackendAssetUrl,
   * and feed COMMENT avatars were correct for the same reason, while post
   * avatars and photos beside them were not — the inconsistency that hid this.
   *
   * The two resolvers differ ONLY on off-origin absolute URLs, and that
   * difference is deliberate in both directions, so assert both here.
   */
  it('resolves relative member-content assets and leaves off-origin ones alone', () => {
    // The reported bug: a relative path must become browser-reachable.
    expect(resolveBackendMediaUrl('/uploads/feed/photo.jpg'))
      .toBe('http://127.0.0.1:8090/uploads/feed/photo.jpg');
    expect(resolveBackendMediaUrl('/assets/img/defaults/default_avatar.png'))
      .toBe('http://127.0.0.1:8090/assets/img/defaults/default_avatar.png');

    // Already browser-reachable: unchanged.
    expect(resolveBackendMediaUrl('http://127.0.0.1:8090/uploads/feed/photo.jpg'))
      .toBe('http://127.0.0.1:8090/uploads/feed/photo.jpg');

    // 🔴 Off-origin member content is PASSED THROUGH, matching resolveAssetUrl in
    // react-frontend, which keeps partner URLs so a federated member's avatar
    // loads from the server that actually holds it. Blanking it here would
    // delete the image instead of fixing it.
    expect(resolveBackendMediaUrl('https://cdn.example.test/feed/full.png'))
      .toBe('https://cdn.example.test/feed/full.png');
    // ...whereas tenant BRANDING stays strict, so a tenant cannot point the site
    // header at a third-party host. Asserted together so the split is not
    // "simplified" back into one helper.
    expect(resolveBackendAssetUrl('https://cdn.example.test/feed/full.png')).toBe('');

    expect(resolveBackendMediaUrl('')).toBe('');
    expect(resolveBackendMediaUrl(null)).toBe('');
  });

  /**
   * 🔴 Mirrors AlphaController::feedbackUrl(). Regression guard added 2026-08-13.
   *
   * "Give feedback" was a module-level mailto constant, so on every community site
   * it opened a mail client instead of the community's own contact form as Blade
   * does — dead for anyone without a configured mail client (disproportionately
   * this frontend's audience), routing community feedback to the platform inbox,
   * and bypassing the Turnstile protection on /contact.
   *
   * Both branches are asserted: the mailto is still correct for the tenant-agnostic
   * pages, so a fix in one direction cannot silently break the other.
   */
  it('sends feedback to the community contact form, and only falls back to the platform mailto for tenant-agnostic pages', () => {
    const shellFor = (routing) => buildShellLocals({
      query: {},
      path: '/',
      originalUrl: '/',
      accessibleRouting: routing
    }, false);

    // A real community tenant → its own contact form, prefixed to the tenant mount.
    expect(shellFor({
      tenant: { ...tenant, id: 2 },
      tenantSlug: 'acme',
      prefix: '/acme/accessible'
    }).feedbackUrl).toBe('/acme/accessible/contact');

    // The host tenant (id <= 1) renders the tenant chooser → platform mailto.
    expect(shellFor({
      tenant: { ...tenant, id: 1 },
      tenantSlug: 'acme',
      prefix: '/acme/accessible'
    }).feedbackUrl).toMatch(/^mailto:/);

    // No routed tenant at all → platform mailto.
    expect(shellFor({}).feedbackUrl).toMatch(/^mailto:/);

    // An unusable id must not produce a contact link for a tenant we cannot name.
    expect(shellFor({
      tenant: { ...tenant, id: undefined },
      tenantSlug: 'acme',
      prefix: '/acme/accessible'
    }).feedbackUrl).toMatch(/^mailto:/);
  });

  /**
   * 🔴 Inverted on 2026-08-11 (owner decision). The header disclosure was
   * removed: Laravel Blade — the source of truth for the browser experience —
   * never had it, and `govuk-frontend` is MIT, which requires the licence notice
   * be retained rather than a visible statement disclaiming affiliation.
   *
   * This asserts it stays GONE, so it cannot creep back in as an unexplained
   * string. The real brand limits are enforced separately by
   * `scripts/brand-check.js` and are untouched.
   */
  it('exposes no non-government header disclosure', () => {
    const english = buildShellLocals({ query: {}, locale: 'en', path: '/', originalUrl: '/' }, false);
    const arabic = buildShellLocals({ query: {}, locale: 'ar', path: '/', originalUrl: '/' }, false);

    expect(english.shellNotAffiliated).toBeUndefined();
    expect(arabic.shellNotAffiliated).toBeUndefined();
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

    expect(locals.tenantLogoUrl).toBe('http://127.0.0.1:8090/uploads/tenants/acme/dark.png');
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
