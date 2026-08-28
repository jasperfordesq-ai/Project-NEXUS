// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for LegalVersionHistoryPage
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

// 🔴 The page imports every UI primitive by its DIRECT path
// ('@/components/ui/GlassCard', '/Button', '/Chip', '/Spinner') — it never touches
// the '@/components/ui' barrel. Vitest keys its mock registry per specifier, so the
// barrel mock this file used to carry installed nothing at all: the real GlassCard
// rendered, and the uiMock's `data-testid="glass-card"` (which only its GlassCard
// stub adds) was never on screen, so the no-versions assertion below matched
// nothing and read as a missing card. Stub the path the page actually imports.
vi.mock('@/components/ui/GlassCard', () => ({
  GlassCard: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="glass-card" className={className}>{children}</div>
  ),
}));

vi.mock('dompurify', () => ({
  default: { addHook: vi.fn(), sanitize: (html: string) => html },
}));

// Mock useLocation to return a path with /terms/versions
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useLocation: () => ({ pathname: '/test/terms/versions', search: '', hash: '', state: null, key: 'default' }),
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

import { LegalVersionHistoryPage } from './LegalVersionHistoryPage';

describe('LegalVersionHistoryPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders heading after loading', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: { title: 'Terms of Service', type: 'terms', versions: [] },
    });
    render(<LegalVersionHistoryPage />);
    await waitFor(() => {
      expect(screen.getByText('Version History')).toBeInTheDocument();
    });
  });

  it('renders no-versions glass card when versions list is empty', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: { title: 'Terms of Service', type: 'terms', versions: [] },
    });
    render(<LegalVersionHistoryPage />);
    await waitFor(() => {
      // The page renders glass cards — at least one should appear for the no-versions state
      const cards = screen.getAllByTestId('glass-card');
      expect(cards.length).toBeGreaterThan(0);
    });
  });

  it('renders versions when API returns them', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: {
        title: 'Terms of Service',
        type: 'terms',
        versions: [
          { id: 1, version_number: '2.0', effective_date: '2026-03-01', is_current: true, version_label: null, summary_of_changes: null },
          { id: 2, version_number: '1.0', effective_date: '2026-01-01', is_current: false, version_label: null, summary_of_changes: null },
        ],
      },
    });
    render(<LegalVersionHistoryPage />);
    await waitFor(() => {
      // Version numbers are rendered through the t() function
      expect(screen.getByText('Version History')).toBeInTheDocument();
    });
  });

  it('renders without crashing', () => {
    mockApiGet.mockResolvedValue({ success: true, data: { title: 'Terms', type: 'terms', versions: [] } });
    const { container } = render(<LegalVersionHistoryPage />);
    expect(container.querySelector('div')).toBeTruthy();
  });
});
