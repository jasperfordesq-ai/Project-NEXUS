// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for HomePage
 *
 * HomePage imports `useTenant` from its DIRECT path ('@/contexts/TenantContext')
 * while the landing sections it renders (LandingPageRenderer, HeroSection,
 * CtaSection) import `useTenant`/`useAuth` from the '@/contexts' barrel. A
 * barrel mock only covers the second group, which is why every test here died
 * on "useTenant must be used within a TenantProvider".
 *
 * Mocking the two context modules on their DIRECT paths covers both groups:
 * '@/contexts/index.ts' re-exports from './TenantContext' and './AuthContext',
 * and those specifiers resolve to the same module ids that are mocked here — so
 * the real barrel loads and hands out the stubbed hooks. Because the barrel
 * re-exports more than the hooks, each mock supplies every key the barrel
 * names, otherwise the barrel's own re-export throws "No <X> export is defined
 * on the mock".
 *
 * The mocks are deliberately total (no importOriginal): the real TenantContext
 * and AuthContext modules both import '@/i18n', which unconditionally
 * re-initialises i18next with the HTTP/localStorage backends and would wipe the
 * English locale resources src/test/setup.ts preloads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import React from 'react';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: { members: 100, hours_exchanged: 500, listings: 50, communities: 5 } }),
    post: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

const mockTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  branding: { name: 'Test Community', logo_url: null, tagline: 'A test community' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: () => true,
  hasModule: () => true,
  isLoading: false,
  error: null,
  landingPageConfig: {
    sections: [
      { id: 'hero', type: 'hero', enabled: true, order: 0 },
      { id: 'stats', type: 'stats', enabled: true, order: 1 },
    ],
  },
};

const mockAuth = { user: null, isAuthenticated: false };

vi.mock('@/contexts/TenantContext', () => ({
  TenantProvider: ({ children }: { children: React.ReactNode }) => children,
  useTenant: () => mockTenant,
  useFeature: () => true,
  useModule: () => true,
}));

vi.mock('@/contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => mockAuth,
  useAuthOptional: () => mockAuth,
}));

vi.mock('@/lib/logger', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/logger')>()),
  logError: vi.fn(),
}));
vi.mock('@/lib/motion', () => {
  const motionProxy = new Proxy({}, {
    get: (_target, prop) => {
      return ({ children, ref, ...props }: Record<string, unknown> & { ref?: React.Ref<HTMLElement> }) => {
        const clean = { ...props };
        delete clean.variants; delete clean.initial; delete clean.animate;
        delete clean.exit; delete clean.transition; delete clean.whileHover;
        delete clean.whileTap; delete clean.whileInView; delete clean.layout;
        delete clean.viewport;
        const Tag = typeof prop === 'string' ? prop : 'div';
        return React.createElement(Tag, { ...clean, ref }, children);
      };
    },
  });
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
    MotionConfig: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    useAnimation: () => ({ start: vi.fn() }),
    useInView: () => true,
  };
});

import { HomePage } from './HomePage';
import { api } from '@/lib/api';

describe('HomePage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders the hero section with a level-1 heading', () => {
    render(<HomePage />);
    // public.home.headline_1 / headline_2 — real English copy from
    // public/locales/en, so an empty or key-only <h1> now fails.
    expect(
      screen.getByRole('heading', { level: 1, name: /Exchange Skills,\s*Build Community/ })
    ).toBeInTheDocument();
  });

  it('calls the platform stats API on mount', async () => {
    render(<HomePage />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/platform/stats');
    });
  });

  it('renders stat values after the API resolves', async () => {
    render(<HomePage />);
    await waitFor(() => {
      // members: 100 → formatStatNumber(100) = '100'
      expect(screen.getByText('100')).toBeInTheDocument();
    });
    // …under the real "Active Members" label (public.home.stats.active_members),
    // so the value is proven to land in the members tile, not just anywhere.
    expect(screen.getByText('Active Members')).toBeInTheDocument();
    expect(screen.getByText('100').parentElement).toContainElement(
      screen.getByText('Active Members')
    );
  });
});
