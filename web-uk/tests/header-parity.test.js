// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const nunjucks = require('nunjucks');
const path = require('path');

/**
 * Header parity with `accessible-frontend/views/layout.blade.php`.
 *
 * The two accessible frontends must present the same header. This renders the
 * real shared layout rather than asserting on the source, so a structural change
 * shows up here.
 */
const env = nunjucks.configure(
  [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);

const shell = {
  t: (key) => key,
  urlFor: (pathname) => `/acme/accessible${pathname === '/' ? '' : pathname}`,
  isAuthenticated: false,
  tenantName: 'Acme Timebank',
  serviceName: 'Project NEXUS Accessible',
  alphaNavItems: [],
  alphaFooterColumns: [],
  alphaLocaleOptions: [],
  alphaCurrentLocale: 'en',
  csrfToken: 'test-csrf'
};

function render(context = {}) {
  return env.render('layouts/base.njk', { ...shell, ...context });
}

describe('Accessible header parity', () => {
  it('renders the Blade element order: header > container > brand link > links nav', () => {
    const html = render();

    const order = [
      'class="nexus-alpha-header"',
      'nexus-alpha-header__container',
      'nexus-alpha-header__brand',
      'nexus-alpha-header__links'
    ].map((needle) => html.indexOf(needle));

    expect(order.every((index) => index > -1)).toBe(true);
    // Strictly increasing — the brand sits directly inside the container, with no
    // wrapper between them. The former `__identity` div existed only to pair the
    // brand with a disclosure that Blade never had.
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).not.toContain('nexus-alpha-header__identity');
  });

  it('carries no non-affiliation disclosure', () => {
    // Removed 2026-08-11 on the owner's decision: Blade never had it, and
    // govuk-frontend is MIT — attribution is required, disavowal is not.
    const html = render();

    expect(html).not.toContain('Not affiliated');
    expect(html).not.toContain('nexus-alpha-header__disclaimer');
  });

  it('falls back to the tenant name when the tenant has no logo', () => {
    const html = render({ tenantLogoUrl: null });

    expect(html).toContain('Acme Timebank');
    expect(html).not.toContain('nexus-alpha-header__logo');
  });

  it('renders an uploaded raster logo with the shape class and no hardcoded size', () => {
    const html = render({
      tenantLogoUrl: 'http://127.0.0.1:8090/uploads/tenants/acme/dark.png',
      tenantLogoShape: 'square'
    });

    expect(html).toContain('nexus-alpha-header__logo nexus-alpha-header__logo--square');
    expect(html).toContain('src="http://127.0.0.1:8090/uploads/tenants/acme/dark.png"');
    // Alt text is the service/tenant name, not the file name.
    expect(html).toContain('alt="Acme Timebank"');
    expect(html).toContain('decoding="async"');

    // 🔴 No width/height attributes: the CSS sizes by aspect-ratio bucket, and a
    // hardcoded dimension defeats that. Blade carries the same note.
    const img = html.match(/<img[^>]*nexus-alpha-header__logo[^>]*>/)?.[0] ?? '';
    expect(img).not.toMatch(/\bwidth=/);
    expect(img).not.toMatch(/\bheight=/);

    // Brand marks stay raster: never an inline or generated SVG, so light/dark
    // contrast uses the real uploaded asset.
    expect(img).not.toContain('<svg');
    expect(img).toMatch(/\.(png|jpe?g|webp)"/i);
  });

  it('keeps every government brand mark out of the header', () => {
    const html = render({ tenantLogoUrl: 'http://127.0.0.1:8090/uploads/tenants/acme/dark.png' });
    const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));

    expect(header).not.toMatch(/crown|crest|royal arms/i);
    expect(header).not.toContain('govuk-header');
    expect(header).not.toMatch(/govukHeader\s*\(/);
  });
});
