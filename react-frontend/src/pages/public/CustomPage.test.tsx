// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for CustomPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import React from 'react';

const mockApiGet = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: vi.fn().mockResolvedValue({ success: true }),
    put: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

const stableToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const stableTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  branding: { name: 'Test Community' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
  isLoading: false,
};

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => stableTenant),
  useAuth: vi.fn(() => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null })),
  useToast: vi.fn(() => stableToast),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));
vi.mock('@/components/navigation', () => ({
  Breadcrumbs: () => <nav aria-label="breadcrumb" />,
}));
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ slug: 'test-page' }),
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
  };
});

vi.mock('@/lib/motion', () => {
  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport']);
  const filterMotion = (props: Record<string, unknown>) => {
    const filtered: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) { if (!motionProps.has(k)) filtered[k] = v; }
    return filtered;
  };
  return {
    motion: {
      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children}</div>,
    },
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

vi.mock('dompurify', () => ({
  default: { addHook: vi.fn(), sanitize: (html: string) => html },
}));

// The dompurify stub above returns strings, not the DOM fragment the custom-page
// sanitiser walks; the sanitiser has its own tests, so pass custom HTML through.
vi.mock('@/lib/sanitize', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sanitize')>()),
  sanitizeCustomPageHtml: (html: string) => html,
}));

import { CustomPage } from './CustomPage';

describe('CustomPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders not-found state when API returns no data', async () => {
    mockApiGet.mockResolvedValue({ success: false, data: null });
    render(<CustomPage />);
    await waitFor(() => {
      expect(screen.getByText('Page Not Found')).toBeInTheDocument();
    });
  });

  it('renders page content when API returns data', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        id: 1,
        title: 'Test Custom Page',
        slug: 'test-page',
        content: '<p>Hello World</p>',
        meta_description: 'A test page',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    });
    render(<CustomPage />);
    await waitFor(() => {
      expect(screen.getByText('Test Custom Page')).toBeInTheDocument();
    });
  });

  it('renders Back to Home button on not-found', async () => {
    mockApiGet.mockResolvedValue({ success: false, data: null });
    render(<CustomPage />);
    await waitFor(() => {
      expect(screen.getByText('Back to Home')).toBeInTheDocument();
    });
  });

  it('renders not-found on API error', async () => {
    mockApiGet.mockRejectedValue(new Error('Network error'));
    render(<CustomPage />);
    await waitFor(() => {
      expect(screen.getByText('Page Not Found')).toBeInTheDocument();
    });
  });

  it.each(['html', 'builder'])('gives a %s page a heading named after the page for screen readers', async (format) => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        id: 2,
        title: 'Designed Page',
        slug: 'test-page',
        content: '<section><p>Body</p></section>',
        content_format: format,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      },
    });
    render(<CustomPage />);
    const heading = await screen.findByRole('heading', { level: 1, name: 'Designed Page' });
    expect(heading).toHaveClass('sr-only');
  });
});
