// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for LegalHubPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import React from 'react';

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    branding: { name: 'Test Community' },
    tenantPath: (p: string) => `/test${p}`,
  })),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
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

import { LegalHubPage } from './LegalHubPage';

describe('LegalHubPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders without crashing', () => {
    const { container } = render(<LegalHubPage />);
    expect(container.querySelector('div')).toBeTruthy();
  });

  // Warmth phase 5: the terms and cookies cards were a fixed blue and amber
  // although both pages open in the community colour.
  it("gives the community's own documents the community colour", () => {
    render(<LegalHubPage />);
    const tile = (path: string) =>
      screen.getAllByTestId('legal-doc-icon').find((el) => el.getAttribute('data-doc-path') === path)!;

    for (const path of ['/privacy', '/terms', '/cookies', '/accessibility', '/community-guidelines', '/acceptable-use']) {
      expect(tile(path).className, path).toContain('from-accent/20');
      expect(tile(path).className, path).toContain('to-companion/20');
      expect(tile(path).querySelector('svg')?.getAttribute('class'), path).toContain('text-accent');
    }
    expect(tile('/terms').className).not.toMatch(/blue-|cyan-/);
    expect(tile('/cookies').className).not.toMatch(/amber-|orange-/);
  });

  it('keeps the colours that carry a meaning', () => {
    render(<LegalHubPage />);
    const tile = (path: string) =>
      screen.getAllByTestId('legal-doc-icon').find((el) => el.getAttribute('data-doc-path') === path)!;

    expect(tile('/account-deletion').className).toContain('from-red-500/20');
    expect(tile('/child-safety').className).toContain('from-rose-500/20');
  });
});
