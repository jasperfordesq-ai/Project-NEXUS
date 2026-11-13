// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for AboutPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@/test/test-utils';
import React from 'react';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn().mockResolvedValue({ success: true, data: {} }) },
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({ user: null, isAuthenticated: false })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    branding: { name: 'Test Community', logo_url: null },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useToast: vi.fn(() => ({ showToast: vi.fn() })),
  useTheme: vi.fn(() => ({ theme: 'light', setTheme: vi.fn() })),
  useNotifications: vi.fn(() => ({ counts: {} })),
  usePusher: vi.fn(() => ({})),

  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
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
  return { motion: proxy, AnimatePresence: ({ children }: { children: React.ReactNode }) => children, useInView: () => true };
});

import { AboutPage } from './AboutPage';
import { PROJECT_NEXUS_REPO_URL } from '@/config/externalLinks';

describe('AboutPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders without crashing', () => {
    const { container } = render(<AboutPage />);
    expect(container.querySelector('div')).toBeTruthy();
  });

  // The Open Source card linked to two repositories until 2026-11-13. The
  // second (the former ASP.NET repository) is no longer public, so only the
  // one platform repository may be offered.
  it('links the Open Source card to the single public repository only', () => {
    const { container } = render(<AboutPage />);
    const sourceLinks = Array.from(container.querySelectorAll('a[href*="github.com"]'));

    expect(sourceLinks).toHaveLength(1);
    expect(sourceLinks[0]?.getAttribute('href')).toBe(PROJECT_NEXUS_REPO_URL);
    expect(container.querySelector('a[href*="api.project-nexus.net"]')).toBeNull();
  });
});
