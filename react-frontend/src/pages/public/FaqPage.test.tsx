// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for FaqPage
 *
 * Mocking notes
 * ─────────────
 * FaqPage imports `useTenant` from the '@/contexts' barrel, but it also renders
 * `PageMeta` from '@/components/seo/PageMeta' — and that module imports
 * `useTenant` from '@/contexts/TenantContext', the DIRECT path. Vitest resolves
 * mocks per specifier, so a mock of the '@/contexts' barrel never covered
 * PageMeta: the real TenantContext loaded and threw "useTenant must be used
 * within a TenantProvider" before anything rendered. (The '@/components/seo'
 * barrel stub in src/test/setup.ts is bypassed for the same reason.)
 *
 * Mocking '@/contexts/TenantContext' on its DIRECT path covers both callers,
 * because '@/contexts/index.ts' re-exports from './TenantContext'.
 * '@/contexts/AuthContext' is mocked the same way since the real barrel
 * re-exports from it and the real AuthContext imports named session events from
 * '@/lib/api' that this file's api stub does not provide.
 *
 * Both context mocks are total (no importOriginal): the real modules import
 * '@/i18n', which re-runs i18next `.init()` with the HTTP backend at module scope.
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
vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const motionKeys = new Set(["variants", "initial", "animate", "transition", "whileInView", "viewport", "layout", "exit", "whileHover", "whileTap"]);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { FaqPage } from './FaqPage';

describe('FaqPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders without crashing', () => {
    render(<FaqPage />);
    // Real English copy from public/locales/en/public.json (`faq.*`),
    // preloaded into i18next by src/test/setup.ts.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Frequently Asked Questions' })
    ).toBeInTheDocument();
    // The real SearchField renders a native search input.
    expect(
      screen.getByRole('searchbox', { name: 'Search questions...' })
    ).toBeInTheDocument();
    // Every category section rendered (not just the header card).
    for (const category of [
      'Getting Started',
      'Time Credits',
      'Exchanges & Safety',
      'Badges & Rewards',
      'Account & Privacy',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name: category })).toBeInTheDocument();
    }
    // The contact CTA closes the page, and the unfiltered list is not empty.
    expect(screen.getByRole('heading', { level: 3, name: 'Still have questions?' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact Support' })).toHaveAttribute('href', '/test/contact');
    expect(
      screen.queryByText('No matching questions found. Try a different search term.')
    ).not.toBeInTheDocument();
  });
});
