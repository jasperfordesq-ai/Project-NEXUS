// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ListingAnalyticsPanel component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({ user: { id: 1 }, isAuthenticated: true })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantSlug: 'test',
    branding: { name: 'Test' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    tenantPath: (p: string) => `/test${p}`,
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  useTheme: vi.fn(() => ({ resolvedTheme: 'light', theme: 'light', setTheme: vi.fn() })),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

const mockApiGet = vi.fn();
vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { ListingAnalyticsPanel } from '../ListingAnalyticsPanel';

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter>{children}</MemoryRouter>
    </>
  );
}

const mockAnalytics = {
  summary: {
    total_views: 150,
    unique_viewers: 80,
    total_contacts: 12,
    contact_rate: 8,
    total_saves: 25,
    save_rate: 16.7,
    views_trend_percent: 15,
  },
  views_over_time: [
    { date: '2026-01-01', count: 5 },
    { date: '2026-01-02', count: 8 },
    { date: '2026-01-03', count: 3 },
  ],
  period_days: 30,
};

describe('ListingAnalyticsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ success: true, data: mockAnalytics });
  });

  it('renders without crashing', () => {
    const { container } = render(
      <W><ListingAnalyticsPanel listingId={1} /></W>,
    );
    expect(container).toBeTruthy();
  });

  it('shows loading spinner initially', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <W><ListingAnalyticsPanel listingId={1} /></W>,
    );
    expect(container.querySelector('[class*="spinner"]') || container.querySelector('svg')).toBeTruthy();
  });

  it('displays analytics title after loading', async () => {
    render(<W><ListingAnalyticsPanel listingId={1} /></W>);
    await waitFor(() => {
      expect(screen.getByText("How it's doing")).toBeInTheDocument();
    });
  });

  it('displays total views', async () => {
    render(<W><ListingAnalyticsPanel listingId={1} /></W>);
    await waitFor(() => {
      expect(screen.getByText('150')).toBeInTheDocument();
      expect(screen.getByText("Total views")).toBeInTheDocument();
    });
  });

  it('displays contacts stat', async () => {
    render(<W><ListingAnalyticsPanel listingId={1} /></W>);
    await waitFor(() => {
      expect(screen.getByText('12')).toBeInTheDocument();
      expect(screen.getByText('Contacts')).toBeInTheDocument();
    });
  });

  it('displays saves stat', async () => {
    render(<W><ListingAnalyticsPanel listingId={1} /></W>);
    await waitFor(() => {
      expect(screen.getByText('25')).toBeInTheDocument();
      expect(screen.getByText('Saves')).toBeInTheDocument();
    });
  });

  it('displays positive trend', async () => {
    render(<W><ListingAnalyticsPanel listingId={1} /></W>);
    await waitFor(() => {
      expect(screen.getByText('+15%')).toBeInTheDocument();
      expect(screen.getByText("7-day trend")).toBeInTheDocument();
    });
  });

  it('returns null when analytics data is unavailable', async () => {
    mockApiGet.mockResolvedValue({ success: false, data: null });
    const { container } = render(
      <W><ListingAnalyticsPanel listingId={1} /></W>,
    );
    await waitFor(() => {
      expect(container.querySelector('h3')).toBeNull();
    });
  });

  it('calls API with correct listing ID', () => {
    render(<W><ListingAnalyticsPanel listingId={42} /></W>);
    expect(mockApiGet).toHaveBeenCalledWith('/v2/listings/42/analytics?days=30');
  });
});
