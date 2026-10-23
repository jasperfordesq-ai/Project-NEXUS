// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { HelmetProvider } from 'react-helmet-async';
import { BrowserRouter } from 'react-router-dom';
import { PageMeta } from './PageMeta';

// PageMeta imports useTenant from '@/contexts/TenantContext' by its DIRECT path
// (PageMeta.tsx:26), so the override must target that specifier — a '@/contexts'
// barrel mock is never resolved here and the real provider-backed hook throws
// outside a TenantProvider. Partial mock so TenantProvider and the sibling
// hooks stay real.
vi.mock('@/contexts/TenantContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/contexts/TenantContext')>()),
  useTenant: vi.fn(() => ({
    branding: {
      name: 'Test Community',
      tagline: 'A test tagline',
    },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    isLoading: false,
    tenantPath: vi.fn((p: string) => `/test${p}`),
  })),
}));

function renderWithHelmet(ui: React.ReactElement) {
  return render(
    <HelmetProvider>
      <BrowserRouter>{ui}</BrowserRouter>
    </HelmetProvider>
  );
}

describe('PageMeta', () => {
  it('sets document title with site name suffix', async () => {
    renderWithHelmet(<PageMeta title="Dashboard" />);
    await waitFor(() => {
      expect(document.title).toBe('Dashboard | Test Community');
    });
  });

  it('uses only site name when title is not provided', async () => {
    renderWithHelmet(<PageMeta />);
    await waitFor(() => {
      expect(document.title).toBe('Test Community');
    });
  });

  it('sets meta description', async () => {
    renderWithHelmet(<PageMeta description="Custom description for the page" />);
    await waitFor(() => {
      const meta = document.querySelector('meta[name="description"]');
      expect(meta).not.toBeNull();
      expect(meta?.getAttribute('content')).toBe('Custom description for the page');
    });
  });

  it('falls back to branding tagline when no description provided', async () => {
    renderWithHelmet(<PageMeta title="Test" />);
    await waitFor(() => {
      const meta = document.querySelector('meta[name="description"]');
      expect(meta).not.toBeNull();
      expect(meta?.getAttribute('content')).toBe('A test tagline');
    });
  });

  it('sets keywords meta tag when provided', async () => {
    renderWithHelmet(<PageMeta keywords="timebanking, community" />);
    await waitFor(() => {
      const meta = document.querySelector('meta[name="keywords"]');
      expect(meta).not.toBeNull();
      expect(meta?.getAttribute('content')).toBe('timebanking, community');
    });
  });

  it('sets noindex robots meta when noIndex is true', async () => {
    renderWithHelmet(<PageMeta noIndex />);
    await waitFor(() => {
      const meta = document.querySelector('meta[name="robots"]');
      expect(meta).not.toBeNull();
      expect(meta?.getAttribute('content')).toBe('noindex, nofollow');
    });
  });

  it('sets Open Graph type meta tag', async () => {
    renderWithHelmet(<PageMeta type="article" />);
    await waitFor(() => {
      const meta = document.querySelector('meta[property="og:type"]');
      expect(meta).not.toBeNull();
      expect(meta?.getAttribute('content')).toBe('article');
    });
  });

  it('defaults Open Graph type to website', async () => {
    renderWithHelmet(<PageMeta />);
    await waitFor(() => {
      const meta = document.querySelector('meta[property="og:type"]');
      expect(meta).not.toBeNull();
      expect(meta?.getAttribute('content')).toBe('website');
    });
  });

  it('sets og:image and twitter card to summary_large_image when image provided', async () => {
    renderWithHelmet(<PageMeta image="https://example.com/image.png" />);
    await waitFor(() => {
      const ogImage = document.querySelector('meta[property="og:image"]');
      expect(ogImage).not.toBeNull();
      expect(ogImage?.getAttribute('content')).toBe('https://example.com/image.png');

      const twitterCard = document.querySelector('meta[name="twitter:card"]');
      expect(twitterCard?.getAttribute('content')).toBe('summary_large_image');
    });
  });

  it('sets twitter card to summary when no image provided', async () => {
    renderWithHelmet(<PageMeta />);
    await waitFor(() => {
      const twitterCard = document.querySelector('meta[name="twitter:card"]');
      expect(twitterCard).not.toBeNull();
      expect(twitterCard?.getAttribute('content')).toBe('summary');
    });
  });

  it('uses the browser pathname for canonical URLs so tenant slugs are preserved', async () => {
    const originalPath = window.location.pathname;
    const originalSearch = window.location.search;

    try {
      window.history.pushState({}, '', '/hour-timebank/about?utm_source=test');
      renderWithHelmet(<PageMeta title="About" />);

      await waitFor(() => {
        const canonical = document.querySelector('link[rel="canonical"]');
        expect(canonical?.getAttribute('href')).toBe('http://localhost:3000/hour-timebank/about');
      });
    } finally {
      window.history.pushState({}, '', `${originalPath}${originalSearch}`);
    }
  });

  // The tenant "Meta title" / "Meta description" on /admin/seo (tenants.meta_title,
  // tenants.meta_description) arrive on tenant.seo. Until 2026-10-22 the meta
  // title was used as the " | site name" suffix on EVERY page, and the home page
  // ignored the meta description, so the one page an admin was writing them for
  // got "Community Timebanking Platform | TimeBank Ireland | Swap Skills, …".
  describe('tenant meta title and description from /admin/seo', () => {
    const withTenantSeo = async () => {
      const mod = await import('@/contexts/TenantContext');
      vi.mocked(mod.useTenant).mockReturnValue({
        branding: { name: 'TimeBank Ireland', tagline: 'A test tagline' },
        tenant: {
          seo: {
            meta_title: 'TimeBank Ireland | Swap Skills, Earn Time Credits',
            meta_description: "Ireland's community timebank. Give an hour, earn an hour back.",
          },
        },
        hasFeature: vi.fn(() => true),
        hasModule: vi.fn(() => true),
        isLoading: false,
        tenantPath: vi.fn((p: string) => `/test${p}`),
      } as unknown as ReturnType<typeof mod.useTenant>);
    };

    it('home page: the meta title is the whole title and the meta description wins', async () => {
      await withTenantSeo();
      renderWithHelmet(
        <PageMeta tenantHome title="Community Timebanking Platform" description="Translated default" />,
      );
      await waitFor(() => {
        expect(document.title).toBe('TimeBank Ireland | Swap Skills, Earn Time Credits');
        expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
          "Ireland's community timebank. Give an hour, earn an hour back.",
        );
      });
    });

    it('other pages: the suffix is the community name, not the meta title', async () => {
      await withTenantSeo();
      renderWithHelmet(<PageMeta title="About TimeBank Ireland" description="About us" />);
      await waitFor(() => {
        expect(document.title).toBe('About TimeBank Ireland | TimeBank Ireland');
        expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('About us');
      });
    });

    it('home page without a tenant meta title keeps the translated default and suffix', async () => {
      const mod = await import('@/contexts/TenantContext');
      vi.mocked(mod.useTenant).mockReturnValue({
        branding: { name: 'TimeBank Ireland', tagline: 'A test tagline' },
        tenant: { seo: { meta_title: '', meta_description: '' } },
        hasFeature: vi.fn(() => true),
        hasModule: vi.fn(() => true),
        isLoading: false,
        tenantPath: vi.fn((p: string) => `/test${p}`),
      } as unknown as ReturnType<typeof mod.useTenant>);
      renderWithHelmet(
        <PageMeta tenantHome title="Community Timebanking Platform" description="Translated default" />,
      );
      await waitFor(() => {
        expect(document.title).toBe('Community Timebanking Platform | TimeBank Ireland');
        expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe(
          'Translated default',
        );
      });
    });
  });

  // The admin title suffix (seo_title_suffix on /admin/seo) is stored both with
  // a separator (" | My Timebank") and without ("Timebank Ireland", written by
  // the 2026-05-13 hour-timebank migration). It reached the site for the first
  // time on 2026-10-22; both forms must produce "Page | Name".
  describe('admin title suffix', () => {
    const withSuffix = async (suffix: string) => {
      const mod = await import('@/contexts/TenantContext');
      vi.mocked(mod.useTenant).mockReturnValue({
        branding: { name: 'TimeBank Ireland', tagline: 'A test tagline' },
        tenant: { settings: { seo_title_suffix: suffix }, seo: { meta_title: 'TimeBank Ireland | Swap Skills' } },
        hasFeature: vi.fn(() => true),
        hasModule: vi.fn(() => true),
        isLoading: false,
        tenantPath: vi.fn((p: string) => `/test${p}`),
      } as unknown as ReturnType<typeof mod.useTenant>);
    };

    it.each([
      ['Timebank Ireland', 'About | Timebank Ireland'],
      [' | Timebank Ireland', 'About | Timebank Ireland'],
      ['- Timebank Ireland', 'About | Timebank Ireland'],
      ['   ', 'About | TimeBank Ireland'],
    ])('suffix %j gives %j', async (suffix, expected) => {
      await withSuffix(suffix);
      renderWithHelmet(<PageMeta title="About" />);
      await waitFor(() => expect(document.title).toBe(expected));
    });

    it('does not change the home page, which uses the meta title as written', async () => {
      await withSuffix('Timebank Ireland');
      renderWithHelmet(<PageMeta tenantHome title="Community Timebanking Platform" />);
      await waitFor(() => expect(document.title).toBe('TimeBank Ireland | Swap Skills'));
    });
  });

  // 2026-10-22: a link to hour-timebank.ie shared on Facebook showed a badly
  // cropped platform picture. Every fallback was declared 1200x630, and the
  // last fallback was an SVG that Facebook, LinkedIn and X cannot show.
  describe('social sharing image', () => {
    const withBranding = async (branding: Record<string, unknown>) => {
      const mod = await import('@/contexts/TenantContext');
      vi.mocked(mod.useTenant).mockReturnValue({
        branding: { name: 'TimeBank Ireland', tagline: 't', ...branding },
        tenant: { settings: {}, seo: {} },
        hasFeature: vi.fn(() => true),
        hasModule: vi.fn(() => true),
        isLoading: false,
        tenantPath: vi.fn((p: string) => `/test${p}`),
      } as unknown as ReturnType<typeof mod.useTenant>);
    };
    const tags = (sel: string) => Array.from(document.querySelectorAll(sel)).map((m) => m.getAttribute('content'));

    it('uses the community sharing image as a wide card with its dimensions', async () => {
      await withBranding({ og_image_url: 'https://cdn.example/share.png', logo: 'https://cdn.example/logo.png' });
      renderWithHelmet(<PageMeta title="Home" />);
      await waitFor(() => {
        expect(tags('meta[property="og:image"]')).toEqual(['https://cdn.example/share.png']);
        expect(tags('meta[property="og:image:width"]')).toEqual(['1200']);
        expect(tags('meta[name="twitter:card"]')).toEqual(['summary_large_image']);
      });
    });

    it('falls back to the logo without claiming it is 1200x630', async () => {
      await withBranding({ og_image_url: '', logo: 'https://cdn.example/logo.png' });
      renderWithHelmet(<PageMeta title="Home" />);
      await waitFor(() => {
        expect(tags('meta[property="og:image"]')).toEqual(['https://cdn.example/logo.png']);
        expect(tags('meta[property="og:image:width"]')).toEqual([]);
        expect(tags('meta[name="twitter:card"]')).toEqual(['summary']);
      });
    });

    it('never offers an SVG: with no image or logo it uses the platform PNG', async () => {
      await withBranding({ og_image_url: '', logo: '' });
      renderWithHelmet(<PageMeta title="Home" />);
      await waitFor(() => {
        const [img] = tags('meta[property="og:image"]');
        expect(img).toMatch(/\/images\/project-nexus-logo\.png$/);
        expect(img).not.toMatch(/\.svg$/);
      });
    });
  });
});

