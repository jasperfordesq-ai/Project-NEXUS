// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Batch render tests for Advanced admin modules:
 * - AiSettings, AlgorithmSettings, Error404Tracking, FeedAlgorithm,
 *   Redirects, SeoAudit, SeoOverview
 *
 * Smoke tests only — verify each component renders without crashing.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Common mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    post: vi.fn().mockResolvedValue({ success: true }),
    put: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn(), getAccessToken: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Admin', last_name: 'User', name: 'Admin User', role: 'admin', is_super_admin: true, tenant_id: 2 },
    isAuthenticated: true,
    logout: vi.fn(),
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    branding: { name: 'Test Community' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), showToast: vi.fn() })),
  useNotifications: vi.fn(() => ({ counts: { messages: 0, notifications: 0 } })),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url: string) => url || '/default.png'),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
  resolveAssetUrl: vi.fn((url: string) => url || ''),
}));

vi.mock('@/components/seo', () => ({
  PageMeta: () => null,
}));

// Mock admin API modules used by advanced components
vi.mock('../../api/adminApi', () => ({
  adminSettings: {
    get: vi.fn().mockResolvedValue({ success: true, data: {} }),
    update: vi.fn().mockResolvedValue({ success: true }),
    getAiConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
    updateAiConfig: vi.fn().mockResolvedValue({ success: true }),
    getFeedAlgorithm: vi.fn().mockResolvedValue({ success: true, data: {} }),
    updateFeedAlgorithm: vi.fn().mockResolvedValue({ success: true }),
    getAlgorithmConfig: vi.fn().mockResolvedValue({ success: true, data: {} }),
    updateAlgorithmConfig: vi.fn().mockResolvedValue({ success: true }),
    getAlgorithmHealth: vi.fn().mockResolvedValue({ success: true, data: null }),
    getSeoSettings: vi.fn().mockResolvedValue({ success: true, data: {} }),
    updateSeoSettings: vi.fn().mockResolvedValue({ success: true }),
    getSitemapStats: vi.fn().mockResolvedValue({ success: true, data: {} }),
    getSeoVerificationDns: vi.fn().mockResolvedValue({
      success: true,
      data: { applicable: false, google_found: false, google_found_on: null },
    }),
  },
  adminTools: {
    get404Errors: vi.fn().mockResolvedValue({ success: true, data: [] }),
    delete404Error: vi.fn().mockResolvedValue({ success: true }),
    getRedirects: vi.fn().mockResolvedValue({ success: true, data: [] }),
    createRedirect: vi.fn().mockResolvedValue({ success: true }),
    deleteRedirect: vi.fn().mockResolvedValue({ success: true }),
    getSeoAudit: vi.fn().mockResolvedValue({ success: true, data: { checks: [], score: 0 } }),
    runSeoAudit: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// ─── Wrapper ─────────────────────────────────────────────────────────────────

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test/admin']}>
        {children}
      </MemoryRouter>
    </>
  );
}

// ─── AiSettings ─────────────────────────────────────────────────────────────

import { AiSettings } from '../advanced/AiSettings';

describe('AiSettings', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><AiSettings /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── AlgorithmSettings ──────────────────────────────────────────────────────

import { AlgorithmSettings } from '../advanced/AlgorithmSettings';

describe('AlgorithmSettings', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><AlgorithmSettings /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── Error404Tracking ───────────────────────────────────────────────────────

import { Error404Tracking } from '../advanced/Error404Tracking';

describe('Error404Tracking', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><Error404Tracking /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('renders translated 404 tracking header copy', () => {
    render(<W><Error404Tracking /></W>);

    expect(screen.getByText('404 Error Tracking')).toBeInTheDocument();
    expect(screen.getByText('Track pages that return 404 errors so you can create redirects or fix broken links')).toBeInTheDocument();
  });
});

// ─── FeedAlgorithm ──────────────────────────────────────────────────────────

import { FeedAlgorithm } from '../advanced/FeedAlgorithm';

describe('FeedAlgorithm', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><FeedAlgorithm /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── Redirects ──────────────────────────────────────────────────────────────

import { Redirects } from '../advanced/Redirects';

describe('Redirects', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><Redirects /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── SeoAudit ───────────────────────────────────────────────────────────────

import { SeoAudit } from '../advanced/SeoAudit';

describe('SeoAudit', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><SeoAudit /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});

// ─── SeoOverview ────────────────────────────────────────────────────────────

import { SeoOverview } from '../advanced/SeoOverview';

describe('SeoOverview', () => {
  it('renders without crashing', () => {
    const { container } = render(<W><SeoOverview /></W>);
    expect(container.querySelector('div')).toBeTruthy();
  });
});
