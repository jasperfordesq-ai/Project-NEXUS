// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for NexusScorePage
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
vi.mock('@/lib/chartColors', () => ({
  CHART_COLORS: ['#6366f1'],
  CHART_COLOR_MAP: { primary: '#6366f1', primaryLight: '#818cf8', secondary: '#8b5cf6' },
}));

const stableToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const stableTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  branding: { name: 'Test Community' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn((_module: string) => true),
  isLoading: false,
};

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { id: 1, first_name: 'Test' }, isAuthenticated: true })),
}));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => stableTenant),
}));
vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => stableToast),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

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
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

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

import NexusScorePage from './NexusScorePage';

const mockScoreData = {
  total_score: 650,
  max_score: 1000,
  percentage: 65,
  percentile: 80,
  tier: { name: 'Advanced', icon: '🏅', color: 'text-accent' },
  breakdown: [
    { key: 'engagement', label: 'Engagement', score: 120, max: 200, percentage: 60, details: {} },
    { key: 'quality', label: 'Quality', score: 150, max: 200, percentage: 75, details: {} },
  ],
  insights: ['Join more events to boost your score'],
};

describe('NexusScorePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stableTenant.hasModule.mockReturnValue(true);
  });

  it('renders heading after loading', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockScoreData });
    render(<NexusScorePage />);
    await waitFor(() => {
      expect(screen.getByText('NexusScore')).toBeInTheDocument();
    });
  });

  it('hides the profile shortcut when Profile is disabled', async () => {
    stableTenant.hasModule.mockImplementation((module: string) => module !== 'profile');
    mockApiGet.mockResolvedValue({ success: true, data: mockScoreData });

    render(<NexusScorePage />);

    await waitFor(() => expect(screen.getByText('NexusScore')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /profile/i })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /leaderboard/i })).toBeInTheDocument();
  });

  it('renders total score', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockScoreData });
    render(<NexusScorePage />);
    await waitFor(() => {
      expect(screen.getByText('650')).toBeInTheDocument();
    });
  });

  it('renders tier name', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockScoreData });
    render(<NexusScorePage />);
    await waitFor(() => {
      // "Advanced" appears in both the tier display and tier ladder
      expect(screen.getAllByText('Advanced').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders score breakdown categories', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockScoreData });
    render(<NexusScorePage />);
    await waitFor(() => {
      expect(screen.getByText('Engagement')).toBeInTheDocument();
      expect(screen.getByText('Quality')).toBeInTheDocument();
    });
  });

  it('renders error state when API fails', async () => {
    mockApiGet.mockRejectedValue(new Error('Network error'));
    render(<NexusScorePage />);
    await waitFor(() => {
      expect(screen.getByText('Try again')).toBeInTheDocument();
    });
  });

  it('renders insights', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: mockScoreData });
    render(<NexusScorePage />);
    await waitFor(() => {
      expect(screen.getByText('Join more events to boost your score')).toBeInTheDocument();
    });
  });
});
