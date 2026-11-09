// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for MessageContextCard component.
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
    post: vi.fn().mockResolvedValue({ success: true }),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAssetUrl: (url: string) => url || '',
  resolveThumbnailUrl: (url: string) => url || '',
}));

import { MessageContextCard } from '../MessageContextCard';

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test']}>
        {children}
      </MemoryRouter>
    </>
  );
}

describe('MessageContextCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({
      success: true,
      data: { title: 'Test Listing', status: 'active' },
    });
  });

  it('renders without crashing', () => {
    const { container } = render(
      <W><MessageContextCard contextType="listing" contextId={1} /></W>,
    );
    expect(container).toBeTruthy();
  });

  it('shows loading skeleton initially', () => {
    // Don't resolve the API call yet
    mockApiGet.mockReturnValue(new Promise(() => {}));
    const { container } = render(
      <W><MessageContextCard contextType="listing" contextId={1} /></W>,
    );
    // Skeleton elements should be present
    expect(container.querySelector('[class*="skeleton"]') || container.querySelector('div')).toBeTruthy();
  });

  it('returns null for unknown context types', () => {
    const { container } = render(
      <W><MessageContextCard contextType="unknown" contextId={1} /></W>,
    );
    // For unknown types, config is null, component returns null — no link or card rendered
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[class*="skeleton"]')).toBeNull();
  });

  it('displays context title after loading', async () => {
    render(
      <W><MessageContextCard contextType="listing" contextId={1} /></W>,
    );
    await waitFor(() => {
      expect(screen.getByText('Test Listing')).toBeInTheDocument();
    });
  });

  it('displays correct type badge for listing', async () => {
    render(
      <W><MessageContextCard contextType="listing" contextId={1} /></W>,
    );
    await waitFor(() => {
      expect(screen.getByText('Offer or request')).toBeInTheDocument();
    });
  });

  it('displays "Regarding" label', async () => {
    render(
      <W><MessageContextCard contextType="listing" contextId={1} /></W>,
    );
    await waitFor(() => {
      expect(screen.getByText('Regarding')).toBeInTheDocument();
    });
  });

  it('creates correct link to detail page', async () => {
    render(
      <W><MessageContextCard contextType="event" contextId={5} /></W>,
    );
    await waitFor(() => {
      const link = screen.getByRole('link');
      expect(link.getAttribute('href')).toBe('/test/events/5');
    });
  });

  it('shows fallback title on API error', async () => {
    mockApiGet.mockRejectedValue(new Error('Network error'));
    render(
      <W><MessageContextCard contextType="job" contextId={42} /></W>,
    );
    await waitFor(() => {
      expect(screen.getByText('Job #42')).toBeInTheDocument();
    });
  });
});
