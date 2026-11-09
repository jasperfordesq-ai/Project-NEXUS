// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for QuickActionsWidget
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

// Stable mock references to prevent infinite render loops
const mockTenantPath = (p: string) => `/test${p}`;
const mockHasFeature = vi.fn((feature: string) =>
  ['events', 'polls', 'goals', 'groups'].includes(feature),
);

const mockUseTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  tenantPath: mockTenantPath,
  hasFeature: mockHasFeature,
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
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { QuickActionsWidget } from '../QuickActionsWidget';

describe('QuickActionsWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasFeature.mockImplementation((feature: string) =>
      ['events', 'polls', 'goals', 'groups'].includes(feature),
    );
  });

  it('renders without crashing', () => {
    const { container } = render(<QuickActionsWidget />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders nothing when user is not authenticated', async () => {
    const { useAuth } = await import('@/contexts');
    vi.mocked(useAuth).mockReturnValueOnce({
      isAuthenticated: false,
      user: null,
    } as ReturnType<typeof useAuth>);

    render(<QuickActionsWidget />);
    expect(screen.queryByText('Create an offer or request')).not.toBeInTheDocument();
  });

  it('renders Create New Listing primary CTA when authenticated', () => {
    render(<QuickActionsWidget />);
    expect(screen.getByText('Create an offer or request')).toBeInTheDocument();
  });

  it('primary CTA links to /listings/create', () => {
    render(<QuickActionsWidget />);
    const btn = screen.getByText('Create an offer or request').closest('a');
    expect(btn).toHaveAttribute('href', '/test/listings/create');
  });

  it('renders secondary action links for enabled features', () => {
    render(<QuickActionsWidget />);
    expect(screen.getByText('Host Event')).toBeInTheDocument();
    expect(screen.getByText('Create Poll')).toBeInTheDocument();
    expect(screen.getByText('Set Goal')).toBeInTheDocument();
    expect(screen.getByText('Groups')).toBeInTheDocument();
  });

  it('hides secondary actions when all features are disabled', async () => {
    const { useTenant } = await import('@/contexts');
    vi.mocked(useTenant).mockReturnValueOnce({
      ...mockUseTenant,
      hasFeature: vi.fn(() => false),
      hasModule: vi.fn(() => false),
    } as unknown as ReturnType<typeof useTenant>);

    render(<QuickActionsWidget />);
    expect(screen.queryByText('Host Event')).not.toBeInTheDocument();
    expect(screen.queryByText('Create Poll')).not.toBeInTheDocument();
    expect(screen.queryByText('Set Goal')).not.toBeInTheDocument();
    expect(screen.queryByText('Groups')).not.toBeInTheDocument();
  });

  it('only shows secondary actions for enabled features', async () => {
    const { useTenant } = await import('@/contexts');
    vi.mocked(useTenant).mockReturnValueOnce({
      ...mockUseTenant,
      hasFeature: vi.fn((f: string) => f === 'events'),
    } as unknown as ReturnType<typeof useTenant>);

    render(<QuickActionsWidget />);
    expect(screen.getByText('Host Event')).toBeInTheDocument();
    expect(screen.queryByText('Create Poll')).not.toBeInTheDocument();
    expect(screen.queryByText('Set Goal')).not.toBeInTheDocument();
    expect(screen.queryByText('Groups')).not.toBeInTheDocument();
  });

  it('secondary action links use tenantPath', () => {
    render(<QuickActionsWidget />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/events/create');
    expect(hrefs).toContain('/test/polls');
    expect(hrefs).toContain('/test/goals');
    expect(hrefs).toContain('/test/groups');
  });
});
