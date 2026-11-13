// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for UpcomingEventsWidget
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

// Stable mock references to prevent infinite render loops
const mockTenantPath = (p: string) => `/test${p}`;

const mockUseTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  tenantPath: mockTenantPath,
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
};

const mockUseAuth = {
  isAuthenticated: true,
  user: { id: 1, first_name: 'Alice', last_name: 'Smith', username: 'asmith', avatar: '/alice.png' },
};

const mockUseToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => mockUseTenant),
  useAuth: vi.fn(() => mockUseAuth),
  useToast: vi.fn(() => mockUseToast),
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

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url: string | undefined) => url || '/default-avatar.png'),
  resolveAssetUrl: vi.fn((url: string | undefined) => url || ''),
  formatMonthShort: vi.fn(() => 'Apr'),
  formatDayOfMonth: vi.fn(() => '15'),
  formatTime: vi.fn((time: string) => time),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { UpcomingEventsWidget } from '../UpcomingEventsWidget';
import type { UpcomingEvent } from '../UpcomingEventsWidget';

const sampleEvents: UpcomingEvent[] = [
  { id: 1, title: 'Community Meetup', start_date: '2026-04-15', start_time: '10:00', location: 'Dublin' },
  { id: 2, title: 'Skill Swap', start_date: '2026-04-20', start_time: undefined, location: undefined },
];

describe('UpcomingEventsWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing with events', () => {
    const { container } = render(<UpcomingEventsWidget events={sampleEvents} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders nothing when events array is empty', () => {
    render(<UpcomingEventsWidget events={[]} />);
    expect(screen.queryByText("Upcoming events")).not.toBeInTheDocument();
  });

  it('renders the Upcoming Events heading when events exist', () => {
    render(<UpcomingEventsWidget events={sampleEvents} />);
    expect(screen.getByText("Upcoming events")).toBeInTheDocument();
  });

  it('renders event titles', () => {
    render(<UpcomingEventsWidget events={sampleEvents} />);
    expect(screen.getByText('Community Meetup')).toBeInTheDocument();
    expect(screen.getByText('Skill Swap')).toBeInTheDocument();
  });

  it('shows time when provided', () => {
    render(<UpcomingEventsWidget events={sampleEvents} />);
    expect(screen.getByText('10:00')).toBeInTheDocument();
  });

  it('shows location when provided', () => {
    render(<UpcomingEventsWidget events={sampleEvents} />);
    expect(screen.getByText('Dublin')).toBeInTheDocument();
  });

  it('does not render time for events without start_time', () => {
    render(<UpcomingEventsWidget events={[sampleEvents[1]]} />);
    // Skill Swap has no start_time, so no time element should appear
    expect(screen.queryByText('10:00')).not.toBeInTheDocument();
  });

  it('does not render location for events without location', () => {
    render(<UpcomingEventsWidget events={[sampleEvents[1]]} />);
    expect(screen.queryByText('Dublin')).not.toBeInTheDocument();
  });

  it('renders See All link pointing to /events', () => {
    render(<UpcomingEventsWidget events={sampleEvents} />);
    const seeAll = screen.getByText("See all");
    expect(seeAll.closest('a')).toHaveAttribute('href', '/test/events');
  });

  it('renders individual event links', () => {
    render(<UpcomingEventsWidget events={sampleEvents} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/events/1');
    expect(hrefs).toContain('/test/events/2');
  });

  it('renders formatted month and day from start_date', () => {
    // 2026-04-15 => month = APR, day = 15
    render(<UpcomingEventsWidget events={[sampleEvents[0]]} />);
    expect(screen.getByText('15')).toBeInTheDocument();
    // Month is uppercased short form — could be APR depending on locale
    expect(screen.getByText(/APR/i)).toBeInTheDocument();
  });

  it('renders correct number of event links plus See All', () => {
    render(<UpcomingEventsWidget events={sampleEvents} />);
    const links = screen.getAllByRole('link');
    // 2 event links + 1 "See all" link = 3 total
    expect(links.length).toBe(3);
  });
});
