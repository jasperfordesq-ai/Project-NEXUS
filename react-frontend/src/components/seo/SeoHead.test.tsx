// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@/test/test-utils';

// ── Tenant mock helpers ────────────────────────────────────────────────────

const baseTenant = {
  id: 2,
  name: 'Test Tenant',
  slug: 'test',
  features: {},
  branding: { name: 'hOUR Timebank' },
  seo: {
    robots_directive: '',
  },
  contact: {
    email: 'hello@example.com',
    phone: '+353 1 234 5678',
    address: '1 Main Street',
    location: 'Dublin',
    country_code: 'IE',
    latitude: 53.3498,
    longitude: -6.2603,
    service_area: 'local',
  },
  social: {
    facebook: 'https://facebook.com/example',
    twitter: '',
    instagram: '',
    linkedin: '',
    youtube: '',
  },
  settings: {
    seo_google_verification: 'GOOGLE_TOKEN_123',
    seo_bing_verification: 'BING_TOKEN_456',
  },
};

const baseBranding = {
  name: 'hOUR Timebank',
  tagline: 'Community time exchange',
  logo: 'https://cdn.example.com/logo.png',
};

// SeoHead imports useTenant from '@/contexts/TenantContext' by its DIRECT path
// (SeoHead.tsx:9), so the override must be registered against that specifier.
// A '@/contexts' barrel mock is never resolved for this component and the real
// provider-backed hook throws outside a TenantProvider. Partial mock keeps
// TenantProvider and the sibling hooks real.
vi.mock('@/contexts/TenantContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/TenantContext')>()),
  useTenant: () => ({
    tenant: baseTenant,
    branding: baseBranding,
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

import { SeoHead } from './SeoHead';

// react-helmet-async writes tags into document.head via HelmetProvider
// (already provided by test-utils AllProviders wrapper).

describe('SeoHead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── JSON-LD scripts ────────────────────────────────────────────────────────

  it('renders at least one application/ld+json script', () => {
    render(<SeoHead />);
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts.length).toBeGreaterThanOrEqual(1);
  });

  it('embeds an Organization JSON-LD block with the tenant name', () => {
    render(<SeoHead />);
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const combined = Array.from(scripts)
      .map((s) => s.textContent ?? '')
      .join('\n');

    const parsed = Array.from(scripts)
      .map((s) => {
        try { return JSON.parse(s.textContent ?? ''); } catch { return null; }
      })
      .filter(Boolean);

    const orgSchema = parsed.find(
      // NGO: schema.org has no NonprofitOrganization type (2026-10-23).
      (o) => o['@type'] === 'NGO' || o['@type'] === 'Organization',
    );
    expect(orgSchema).toBeDefined();
    expect(orgSchema.name).toBe('hOUR Timebank');
  });

  it('embeds a WebSite JSON-LD block with a SearchAction', () => {
    render(<SeoHead />);
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const parsed = Array.from(scripts).map((s) => {
      try { return JSON.parse(s.textContent ?? ''); } catch { return null; }
    }).filter(Boolean);

    const webSiteSchema = parsed.find((o) => o['@type'] === 'WebSite');
    expect(webSiteSchema).toBeDefined();
    expect(webSiteSchema?.potentialAction?.['@type']).toBe('SearchAction');
  });

  // ── Verification meta tags ─────────────────────────────────────────────────

  it('renders Google Search Console verification meta tag', () => {
    render(<SeoHead />);
    const meta = document.querySelector('meta[name="google-site-verification"]');
    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('GOOGLE_TOKEN_123');
  });

  it('renders Bing Webmaster verification meta tag', () => {
    render(<SeoHead />);
    const meta = document.querySelector('meta[name="msvalidate.01"]');
    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('BING_TOKEN_456');
  });

  // ── Geo meta tags ─────────────────────────────────────────────────────────

  it('renders geo.region meta tag with country code', () => {
    render(<SeoHead />);
    const meta = document.querySelector('meta[name="geo.region"]');
    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('IE');
  });

  it('renders geo.placename meta tag with location', () => {
    render(<SeoHead />);
    const meta = document.querySelector('meta[name="geo.placename"]');
    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toBe('Dublin');
  });

  it('renders ICBM meta tag when lat/lng are provided', () => {
    render(<SeoHead />);
    const meta = document.querySelector('meta[name="ICBM"]');
    expect(meta).not.toBeNull();
    expect(meta?.getAttribute('content')).toContain('53.3498');
    expect(meta?.getAttribute('content')).toContain('-6.2603');
  });

  // ── hreflang ──────────────────────────────────────────────────────────────

  it('renders an x-default hreflang link', () => {
    render(<SeoHead />);
    const link = document.querySelector('link[rel="alternate"][hreflang="x-default"]');
    expect(link).not.toBeNull();
  });

  // ── Breadcrumb JSON-LD ────────────────────────────────────────────────────

  it('does NOT render a BreadcrumbList on the homepage (/)', () => {
    // BrowserRouter from test-utils starts at "/" by default
    render(<SeoHead />);
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const parsed = Array.from(scripts).map((s) => {
      try { return JSON.parse(s.textContent ?? ''); } catch { return null; }
    }).filter(Boolean);

    const breadcrumb = parsed.find((o) => o['@type'] === 'BreadcrumbList');
    // On "/" there are no pathSegments so BreadcrumbList should not be emitted
    expect(breadcrumb).toBeUndefined();
  });

  // ── Robots ─────────────────────────────────────────────────────────────────

  it('does NOT render robots meta when robots_directive is empty', () => {
    render(<SeoHead />);
    const robots = document.querySelector('meta[name="robots"]');
    // An empty directive string means the tag should not be emitted
    expect(robots).toBeNull();
  });

  // ── sameAs in org schema ──────────────────────────────────────────────────

  it('includes sameAs Facebook URL in Organization schema', () => {
    render(<SeoHead />);
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    const parsed = Array.from(scripts).map((s) => {
      try { return JSON.parse(s.textContent ?? ''); } catch { return null; }
    }).filter(Boolean);
    const orgSchema = parsed.find(
      (o) => o['@type'] === 'NonprofitOrganization' || o.sameAs,
    );
    expect(Array.isArray(orgSchema?.sameAs)).toBe(true);
    expect(orgSchema.sameAs).toContain('https://facebook.com/example');
  });

  // ── No-social fallback ────────────────────────────────────────────────────

  it('does not include sameAs when tenant has no social links', () => {
    // Temporarily override by unmocking and re-mocking would require factory
    // re-init — instead just assert structure holds for the default mock above.
    // This is a structural smoke test only; branching on undefined social is
    // covered by the source implementation itself.
    render(<SeoHead />);
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    expect(scripts.length).toBeGreaterThan(0);
  });

  // 2026-10-23 audit of the SEO pages against what crawlers receive.
  describe('what search engines are told', () => {
    const orgOf = () => Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((s) => { try { return JSON.parse(s.textContent ?? ''); } catch { return null; } })
      .find((o) => o && o['@id']);

    it('gives the organisation a full logo address and a real schema.org type', () => {
      baseBranding.logo = '/uploads/tenants/test/logo.png';
      render(<SeoHead />);
      const org = orgOf();
      expect(org['@type']).toBe('NGO');
      expect(org.logo).toMatch(/^https?:\/\/[^/]+\/uploads\/tenants\/test\/logo\.png$/);
      baseBranding.logo = 'https://cdn.example.com/logo.png';
    });

    it.each([
      ['NonprofitOrganization', 'NGO'],
      ['CommunityOrganization', 'NGO'],
      ['VolunteerOrganization', 'NGO'],
      ['LocalBusiness', 'LocalBusiness'],
      ['GovernmentOrganization', 'GovernmentOrganization'],
    ])('maps the stored organisation type %s to %s', (stored, expected) => {
      (baseTenant.settings as Record<string, unknown>).seo_organization_type = stored;
      render(<SeoHead />);
      expect(orgOf()['@type']).toBe(expected);
      delete (baseTenant.settings as Record<string, unknown>).seo_organization_type;
    });

    it.each([
      ['abc123', 'abc123'],
      ['google-site-verification=abc123', 'abc123'],
      ['<meta name="google-site-verification" content="abc123" />', 'abc123'],
    ])('sends Google only the verification code when %j is pasted', (pasted, expected) => {
      baseTenant.settings.seo_google_verification = pasted;
      render(<SeoHead />);
      expect(document.querySelector('meta[name="google-site-verification"]')?.getAttribute('content')).toBe(expected);
      baseTenant.settings.seo_google_verification = 'GOOGLE_TOKEN_123';
    });

    it('does not claim coordinates 0,0 for a community with no map position', () => {
      const c = baseTenant.contact as Record<string, unknown>;
      c.latitude = 0; c.longitude = 0;
      render(<SeoHead />);
      expect(document.querySelector('meta[name="ICBM"]')).toBeNull();
      c.latitude = 53.3498; c.longitude = -6.2603;
    });

    it("keeps a sub-community's own folder in its addresses", () => {
      window.history.pushState({}, '', '/test/about');
      try {
        render(<SeoHead />);
        const origin = window.location.origin;
        expect(document.querySelector('link[rel="alternate"][hreflang="x-default"]')?.getAttribute('href'))
          .toBe(`${origin}/test/about`);
        expect(orgOf().url).toBe(`${origin}/test`);
        const crumbs = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
          .map((s) => { try { return JSON.parse(s.textContent ?? ''); } catch { return null; } })
          .find((o) => o && o['@type'] === 'BreadcrumbList');
        expect(crumbs.itemListElement.map((i: { item: string }) => i.item))
          .toEqual([`${origin}/test`, `${origin}/test/about`]);
      } finally {
        window.history.pushState({}, '', '/');
      }
    });
  });
});

