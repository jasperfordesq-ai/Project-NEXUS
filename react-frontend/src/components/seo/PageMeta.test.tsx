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
});
