// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for SkillsBrowsePage
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
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null) => url || '/default-avatar.png',
  formatRelativeTime: (d: string) => d,
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

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
  useAuth: vi.fn(() => ({ user: { id: 1, first_name: 'Test' }, isAuthenticated: true, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null })),
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
vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/components/skills/SkillSelector', () => ({
  default: () => null,
}));

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

import { SkillsBrowsePage } from './SkillsBrowsePage';

describe('SkillsBrowsePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    mockApiGet.mockResolvedValue({ success: true, data: [] });
    const { container } = render(<SkillsBrowsePage />);
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('renders page heading', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: [] });
    render(<SkillsBrowsePage />);
    expect(screen.getByText('Community Skills Directory')).toBeInTheDocument();
  });

  it('renders explainer text', () => {
    mockApiGet.mockResolvedValue({ success: true, data: [] });
    render(<SkillsBrowsePage />);
    expect(screen.getByText(/Browse skills shared by members in your community/i)).toBeInTheDocument();
  });

  it('renders categories when API returns data', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: [
        { id: 1, name: 'IT & Technology', icon: '💻', skills_count: 5, children: [] },
        { id: 2, name: 'Home & Garden', icon: '🏡', skills_count: 3, children: [] },
      ],
    });
    render(<SkillsBrowsePage />);
    await waitFor(() => {
      expect(screen.getByText('IT & Technology')).toBeInTheDocument();
      expect(screen.getByText('Home & Garden')).toBeInTheDocument();
    });
    // AWID: "clear categories" — each category tile in its own colour (all were one tint).
    const tiles = screen.getAllByTestId('skills-category-tile');
    expect(tiles).toHaveLength(2);
    expect(new Set(tiles.map((tile) => tile.getAttribute('data-colour'))).size).toBe(2);
  });

  it('renders empty state when no categories', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: [] });
    render(<SkillsBrowsePage />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders error state on API failure', async () => {
    mockApiGet.mockRejectedValue(new Error('Network error'));
    render(<SkillsBrowsePage />);
    await waitFor(() => {
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });
  });

  it('renders "Add your own skills" link for authenticated users', () => {
    mockApiGet.mockResolvedValue({ success: true, data: [] });
    render(<SkillsBrowsePage />);
    expect(screen.getByText('Add your own skills')).toBeInTheDocument();
  });
});
