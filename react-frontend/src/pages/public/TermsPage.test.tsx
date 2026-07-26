// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for TermsPage
 *
 * Mocking notes
 * ─────────────
 * TermsPage imports `useTenant` from the '@/contexts' barrel, but it also
 * renders `PageMeta` from '@/components/seo/PageMeta' — and that module imports
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
vi.mock('@/hooks/useLegalDocument', () => ({
  useLegalDocument: vi.fn(() => ({ document: null, loading: false })),
}));
vi.mock('@/components/legal/CustomLegalDocument', () => ({
  default: () => <div data-testid="custom-legal">Custom Legal Doc</div>,
  CustomLegalDocument: () => <div data-testid="custom-legal">Custom Legal Doc</div>,
}));
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

import { TermsPage } from './TermsPage';

describe('TermsPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders without crashing', () => {
    render(<TermsPage />);
    // Real English copy from public/locales/en/legal.json (`terms.*`),
    // preloaded into i18next by src/test/setup.ts.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Terms of Service' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('The rules and guidelines for using our platform')
    ).toBeInTheDocument();
    expect(screen.getByText('Last updated: February 2026')).toBeInTheDocument();
    // Section headings prove the whole default document rendered, not just the hero.
    // `welcome_title` is interpolated with the tenant branding name.
    expect(screen.getByRole('heading', { level: 2, name: 'Welcome to Test Community' })).toBeInTheDocument();
    // Numbered sections render a Chip with the section number inside the <h2>,
    // so the accessible name is "<n> <title>".
    expect(screen.getByRole('heading', { level: 2, name: /^1\s*Time Credit System$/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /^8\s*Changes to These Terms$/ })).toBeInTheDocument();
    // …and the tenant custom-document branch was NOT taken.
    expect(screen.queryByTestId('custom-legal')).not.toBeInTheDocument();
  });
});
