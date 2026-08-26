// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ContactPage
 *
 * Mocking notes
 * ─────────────
 * ContactPage imports `useTenant`/`useAuth` from the '@/contexts' barrel, but it
 * also renders `PageMeta` from '@/components/seo/PageMeta' — and that module
 * imports `useTenant` from '@/contexts/TenantContext', the DIRECT path. Vitest
 * resolves mocks per specifier, so a mock of the '@/contexts' barrel never
 * covered PageMeta: the real TenantContext loaded and threw "useTenant must be
 * used within a TenantProvider" before anything rendered. (The
 * '@/components/seo' barrel stub in src/test/setup.ts is bypassed for the same
 * reason.)
 *
 * Mocking '@/contexts/TenantContext' and '@/contexts/AuthContext' on their
 * DIRECT paths covers every caller, because '@/contexts/index.ts' re-exports
 * from both — the real barrel loads and hands out the stubbed hooks.
 *
 * Both context mocks are total (no importOriginal): the real modules import
 * '@/i18n', which re-runs i18next `.init()` with the HTTP backend at module scope.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import React from 'react';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ success: true, data: null }), post: vi.fn().mockResolvedValue({ success: true }) },
  tokenManager: { getTenantId: vi.fn(), getToken: vi.fn() },
}));

const mockTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  branding: { name: 'Test Community', logo_url: null, contact_email: 'test@test.com' },
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

import { ContactPage } from './ContactPage';

describe('ContactPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders without crashing', () => {
    render(<ContactPage />);
    // Real English copy from public/locales/en/public.json (`contact.*`),
    // preloaded into i18next by src/test/setup.ts. `subtitle` is interpolated
    // with the tenant branding name.
    expect(screen.getByRole('heading', { level: 1, name: 'Contact Us' })).toBeInTheDocument();
    expect(
      screen.getByText("Have a question about Test Community? We'd love to hear from you.")
    ).toBeInTheDocument();
    // The whole form rendered — labelled fields plus the submit button.
    expect(screen.getByRole('textbox', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Message' })).toBeInTheDocument();
    // Anonymous visitors get the log-in prompt, and nothing was submitted yet.
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/test/login');
    expect(screen.queryByText('Message Sent!')).not.toBeInTheDocument();
  });

  it('prefills the public account-deletion request form from the compliance URL', () => {
    window.history.pushState({}, '', '/contact?topic=account-deletion');
    render(<ContactPage />);

    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(
      'I want to permanently delete my Timebank Global account. The email address entered above is the address used for my account.',
    );
    expect(screen.getByRole('button', { name: 'Account deletion Subject' })).toBeInTheDocument();
  });
});
