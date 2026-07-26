// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for AccessibilityPage
 *
 * Mocking notes
 * ─────────────
 * AccessibilityPage imports `useTenant` from the '@/contexts' barrel, but it
 * also calls `useLegalDocument` ('@/hooks/useLegalDocument') and renders
 * `PageMeta` ('@/components/seo/PageMeta') — and BOTH of those modules import
 * `useTenant` from '@/contexts/TenantContext', the DIRECT path. Vitest resolves
 * mocks per specifier, so a mock of the '@/contexts' barrel never covered them:
 * the real TenantContext loaded and threw "useTenant must be used within a
 * TenantProvider" from inside useLegalDocument before anything rendered. (The
 * '@/components/seo' barrel stub in src/test/setup.ts is bypassed for the same
 * reason.)
 *
 * Mocking '@/contexts/TenantContext' on its DIRECT path covers all three
 * callers, because '@/contexts/index.ts' re-exports from './TenantContext'.
 * '@/contexts/AuthContext' is mocked the same way since the real barrel
 * re-exports from it and the real AuthContext imports named session events from
 * '@/lib/api' that this file's api stub does not provide.
 *
 * Both context mocks are total (no importOriginal): the real modules import
 * '@/i18n', which re-runs i18next `.init()` with the HTTP backend at module scope.
 *
 * `useLegalDocument` is deliberately left REAL here so the legal-document fetch
 * is exercised; the api stub resolves with no custom document, which is what
 * drives the default-content branch asserted below.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import React from 'react';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ success: true, data: null }) },
  tokenManager: { getTenantId: vi.fn(), getToken: vi.fn() },
}));

const mockTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  branding: { name: 'Test Community', logo_url: null, tagline: 'A test community' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: () => true,
  hasModule: () => true,
  isLoading: false,
  error: null,
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

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/motion', () => {
  const proxy = new Proxy({}, {
    get: (_t: object, prop: string | symbol) => {
      return ({ children, ref, ...p }: Record<string, unknown> & { ref?: React.Ref<HTMLElement> }) => {
        const c: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(p)) {
          if (!['variants','initial','animate','exit','transition','whileHover','whileTap','whileInView','layout','viewport'].includes(k)) c[k] = v;
        }
        return React.createElement(typeof prop === 'string' ? prop : 'div', { ...c, ref }, children);
      };
    },
  });
  return { motion: proxy, AnimatePresence: ({ children }: { children: React.ReactNode }) => children };
});

import { AccessibilityPage } from './AccessibilityPage';
import { api } from '@/lib/api';

describe('AccessibilityPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders without crashing', async () => {
    render(<AccessibilityPage />);

    // The page starts in useLegalDocument's loading branch, then renders the
    // default statement once the (empty) custom-document lookup resolves.
    // Real English copy from public/locales/en/legal.json (`accessibility.*`).
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Accessibility Statement' })
    ).toBeInTheDocument();
    // `subtitle` is interpolated with the tenant branding name.
    expect(
      screen.getByText('Test Community is committed to ensuring digital accessibility for people of all abilities.')
    ).toBeInTheDocument();
    // Section headings prove the whole statement rendered, not just the hero.
    expect(screen.getByRole('heading', { level: 2, name: 'Our Commitment' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Conformance Status' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Feedback' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Technical Specifications' })).toBeInTheDocument();
    // Tenant-scoped CTA links resolve through tenantPath().
    expect(screen.getByRole('link', { name: 'Report an Issue' })).toHaveAttribute('href', '/test/contact');
    expect(screen.getByRole('link', { name: 'Help Center' })).toHaveAttribute('href', '/test/help');
    // The real useLegalDocument hook actually queried the tenant's document.
    expect(api.get).toHaveBeenCalledWith('/v2/legal/accessibility', { skipAuth: true });
    // The loading branch is finished.
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });
});
