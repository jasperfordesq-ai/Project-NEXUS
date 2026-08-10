// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const {
  DEFAULT_VISUAL_SPOTCHECKS,
  normalizeVisibleText,
  resolveOptions,
  runBladeVisualSpotcheck
} = require('../scripts/blade-visual-spotcheck');

describe('Laravel Blade visual spotcheck helper', () => {
  it('normalizes visible text from rendered HTML', () => {
    const html = `
      <html>
        <head><style>.x { color: red; }</style><script>window.x = 1</script></head>
        <body>
          <h1>Accessible&nbsp;home</h1>
          <p>Exchange &amp; connect</p>
        </body>
      </html>
    `;

    expect(normalizeVisibleText(html)).toBe('Accessible home Exchange & connect');
  });

  it('defaults to Blade tenant-home, host-root, and public/auth/support page checks', () => {
    const options = resolveOptions({
      laravelBaseUrl: 'http://laravel.test',
      webBaseUrl: 'http://web.test'
    }, {});

    expect(options.checks.map((check) => check.name)).toEqual([
      'tenant-home-hour-timebank',
      'master-domain-root',
      'cluster-domain-root',
      'public-login',
      'public-register',
      'public-forgot-password',
      'public-reset-password',
      'public-contact',
      'public-cookie-settings',
      'public-about',
      'public-guide',
      'public-features',
      'public-faq',
      'public-help',
      'public-trust-safety',
      'public-accessibility',
      'public-legal-hub',
      'public-privacy-policy',
      'public-report-problem'
    ]);
    expect(DEFAULT_VISUAL_SPOTCHECKS[0]).toEqual(expect.objectContaining({
      laravel: { path: '/hour-timebank/accessible' },
      web: { path: '/hour-timebank/accessible' },
      webForbiddenHtml: ['/alpha']
    }));
    expect(DEFAULT_VISUAL_SPOTCHECKS[1]).toEqual(expect.objectContaining({
      laravelBootstrap: { host: 'project-nexus.ie' },
      web: { host: 'project-nexus.ie', path: '/' },
      bootstrapMarkerPaths: ['seo.h1_headline'],
      webForbiddenHtml: ['/alpha', '/accessible']
    }));
    expect(DEFAULT_VISUAL_SPOTCHECKS[2]).toEqual(expect.objectContaining({
      laravelBootstrap: { host: 'timebank.global' },
      web: { host: 'timebank.global', path: '/' },
      bootstrapMarkerPaths: ['seo.h1_headline'],
      webForbiddenHtml: ['/alpha', '/accessible']
    }));
    expect(DEFAULT_VISUAL_SPOTCHECKS[3]).toEqual(expect.objectContaining({
      laravel: { path: '/hour-timebank/accessible/login' },
      web: { path: '/hour-timebank/accessible/login' },
      markers: ['Sign in', 'Email address', 'Password'],
      webForbiddenHtml: ['/hour-timebank/alpha']
    }));
    expect(DEFAULT_VISUAL_SPOTCHECKS[18]).toEqual(expect.objectContaining({
      laravel: { path: '/hour-timebank/accessible/report-a-problem' },
      web: { path: '/hour-timebank/accessible/report-a-problem' },
      markers: ['Contact Us'],
      webForbiddenHtml: ['/hour-timebank/alpha']
    }));
  });

  it('compares required Blade markers and bootstrap-sourced host-scoped Web UK responses', async () => {
    const requests = [];
    const fetchImpl = async (url, options = {}) => {
      requests.push({ url, host: options.hostHeader || '' });
      const parsed = new URL(url);
      const key = `${options.hostHeader || parsed.host}${parsed.pathname}`;
      const fixtures = {
        'laravel.test/tenant/accessible': '<h1>Accessible</h1><p>Hour Timebank</p><a href="/tenant/accessible/login">Sign in</a>',
        'web.test/tenant/accessible': '<h1>Accessible</h1><p>Hour Timebank</p><a href="/tenant/accessible/login">Sign in</a>',
        'project-nexus.ie/api/v2/tenant/bootstrap': JSON.stringify({
          data: { seo: { h1_headline: 'Build Thriving Communities with NEXUS' } }
        }),
        'timebank.global/api/v2/tenant/bootstrap': JSON.stringify({
          data: { seo: { h1_headline: 'Exchange Skills Across Borders' } }
        }),
        'project-nexus.ie/': '<h1>Build Thriving Communities with NEXUS</h1><a href="/about">About</a>',
        'timebank.global/': '<h1>Exchange Skills Across Borders</h1><a href="/hour-timebank/login">Sign in</a>'
      };

      return {
        status: 200,
        ok: true,
        headers: { get: () => key.includes('/api/v2/tenant/bootstrap') ? 'application/json' : 'text/html' },
        text: async () => fixtures[key] || '<h1>Missing</h1>'
      };
    };

    const result = await runBladeVisualSpotcheck({
      laravelBaseUrl: 'http://laravel.test',
      webBaseUrl: 'http://web.test',
      fetchImpl,
      checks: [
        {
          name: 'tenant',
          laravel: { path: '/tenant/accessible' },
          web: { path: '/tenant/accessible' },
          markers: ['Accessible', 'Hour Timebank'],
          webForbiddenHtml: ['/tenant/alpha']
        },
        {
          name: 'master',
          laravelBootstrap: { host: 'project-nexus.ie' },
          web: { host: 'project-nexus.ie', path: '/' },
          bootstrapMarkerPaths: ['seo.h1_headline'],
          webForbiddenHtml: ['/alpha', '/accessible']
        },
        {
          name: 'cluster',
          laravelBootstrap: { host: 'timebank.global' },
          web: { host: 'timebank.global', path: '/' },
          bootstrapMarkerPaths: ['seo.h1_headline'],
          webForbiddenHtml: ['/alpha', '/accessible']
        }
      ]
    });

    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.name)).toEqual(['tenant', 'master', 'cluster']);
    expect(requests).toEqual([
      { url: 'http://laravel.test/tenant/accessible', host: '' },
      { url: 'http://web.test/tenant/accessible', host: '' },
      { url: 'http://laravel.test/api/v2/tenant/bootstrap', host: 'project-nexus.ie' },
      { url: 'http://web.test/', host: 'project-nexus.ie' },
      { url: 'http://laravel.test/api/v2/tenant/bootstrap', host: 'timebank.global' },
      { url: 'http://web.test/', host: 'timebank.global' }
    ]);
    expect(result.checks[1].markers).toEqual(['Build Thriving Communities with NEXUS']);
    expect(result.checks[2].markers).toEqual(['Exchange Skills Across Borders']);
  });

  it('fails when Web UK misses a Blade marker or leaks a legacy public slug', async () => {
    const fetchImpl = async (url) => {
      const parsed = new URL(url);
      const html = parsed.host === 'laravel.test'
        ? '<h1>Accessible</h1><p>Hour Timebank</p>'
        : '<h1>Accessible</h1><a href="/tenant/alpha/login">Sign in</a>';
      return {
        status: 200,
        ok: true,
        text: async () => html
      };
    };

    const result = await runBladeVisualSpotcheck({
      laravelBaseUrl: 'http://laravel.test',
      webBaseUrl: 'http://web.test',
      fetchImpl,
      checks: [
        {
          name: 'tenant',
          laravel: { path: '/tenant/alpha' },
          web: { path: '/tenant/accessible' },
          markers: ['Accessible', 'Hour Timebank'],
          webForbiddenHtml: ['/tenant/alpha']
        }
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.checks[0]).toEqual(expect.objectContaining({
      name: 'tenant',
      ok: false,
      missingInWeb: ['Hour Timebank'],
      forbiddenInWeb: ['/tenant/alpha']
    }));
  });
});
