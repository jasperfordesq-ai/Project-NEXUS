// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for FeedModeToggle component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
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

import { FeedModeToggle } from './FeedModeToggle';

describe('FeedModeToggle', () => {
  const mockOnModeChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<FeedModeToggle mode="ranking" onModeChange={mockOnModeChange} />);
    expect(screen.getByText("For you")).toBeInTheDocument();
    expect(screen.getByText('Recent')).toBeInTheDocument();
  });

  it('renders the tabs container with aria-label', () => {
    render(<FeedModeToggle mode="ranking" onModeChange={mockOnModeChange} />);
    // ToggleButtonGroup (single-selection) renders as a radiogroup.
    expect(screen.getByRole('radiogroup', { name: 'Feed mode' })).toBeInTheDocument();
  });

  it('renders both tab options', () => {
    render(<FeedModeToggle mode="ranking" onModeChange={mockOnModeChange} />);
    const tabs = screen.getAllByRole('radio');
    expect(tabs).toHaveLength(2);
  });

  it('has "ranking" tab selected when mode is ranking', () => {
    render(<FeedModeToggle mode="ranking" onModeChange={mockOnModeChange} />);
    const tabs = screen.getAllByRole('radio');
    const rankingTab = tabs.find(tab => tab.textContent?.includes("For you"));
    expect(rankingTab).toHaveAttribute('aria-checked', 'true');
  });

  it("keeps HeroUI's own padding, so the selected pill frames its text instead of bleeding round it", () => {
    // HeroUI paints a selected ToggleButton as a soft pill with px-3 (size sm).
    // Zeroing the padding made the pill hug the icon and text (owner, 9 Nov).
    render(<FeedModeToggle mode="ranking" onModeChange={mockOnModeChange} />);
    for (const tab of screen.getAllByRole('radio')) {
      expect(tab.className).not.toMatch(/(^|\s)px-0(\s|$)/);
      // A touch tighter on phones, where the feed bar is shared with the
      // sorting chip and the Filters button; HeroUI's own px-3 from sm up.
      expect(tab.className).toContain('px-2.5');
      expect(tab.className).toContain('sm:px-3');
      // The selected text uses HeroUI's colour made for its pill.
      expect(tab.className).toContain('data-[selected=true]:text-accent-soft-foreground');
    }
  });

  it('has "recent" tab selected when mode is recent', () => {
    render(<FeedModeToggle mode="recent" onModeChange={mockOnModeChange} />);
    const tabs = screen.getAllByRole('radio');
    const recentTab = tabs.find(tab => tab.textContent?.includes('Recent'));
    expect(recentTab).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onModeChange when a tab is clicked', async () => {
    const user = userEvent.setup();
    render(<FeedModeToggle mode="ranking" onModeChange={mockOnModeChange} />);
    const recentTab = screen.getByText('Recent').closest('[role="radio"]')!;
    await user.click(recentTab);
    expect(mockOnModeChange).toHaveBeenCalledWith('recent');
  });
});
