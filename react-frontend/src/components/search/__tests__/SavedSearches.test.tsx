// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for SavedSearches component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      if (key === 'saved_result_count') return `(${String(fallback?.count)} results)`;
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

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
  useToast: vi.fn(() => mockToast),
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
const mockApiPost = vi.fn();
const mockApiDelete = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

// SavedSearches calls useConfirm, which THROWS outside a <ConfirmDialogProvider>;
// test-utils' render() does not install one, so every test here collapsed on the
// first render. Stub the hook rather than the component, so SavedSearches itself
// stays under test. Same shape as PartnerVenuesAdminPage.test.tsx.
vi.mock('@/components/ui/ConfirmDialog', () => ({
  useConfirm: () => vi.fn(async () => true),
  ConfirmDialogProvider: ({ children }: { children: ReactNode }) => children,
}));


import { SavedSearches } from '../SavedSearches';

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter>{children}</MemoryRouter>
    </>
  );
}

const mockSavedSearches = [
  { id: 1, name: 'Web Dev', query_params: { q: 'web development' }, last_result_count: 15, notify_on_new: false },
  { id: 2, name: 'Gardening', query_params: { q: 'gardening' }, last_result_count: 8, notify_on_new: false },
];

describe('SavedSearches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ success: true, data: mockSavedSearches });
  });

  it('renders without crashing', () => {
    const { container } = render(
      <W><SavedSearches /></W>,
    );
    expect(container).toBeTruthy();
  });

  it('shows saved searches list after loading', async () => {
    render(<W><SavedSearches /></W>);
    await waitFor(() => {
      expect(screen.getByText('Web Dev')).toBeInTheDocument();
      expect(screen.getByText('Gardening')).toBeInTheDocument();
    });
  });

  it('shows "Save this search" button when currentQuery is provided', async () => {
    render(<W><SavedSearches currentQuery="test search" /></W>);
    await waitFor(() => {
      expect(screen.getByText('save_this_search')).toBeInTheDocument();
    });
  });

  it('does not show "Save this search" button when no currentQuery', async () => {
    render(<W><SavedSearches /></W>);
    await waitFor(() => {
      expect(screen.queryByText('save_this_search')).not.toBeInTheDocument();
    });
  });

  it('displays result counts', async () => {
    render(<W><SavedSearches /></W>);
    await waitFor(() => {
      expect(screen.getByText(/15 results/)).toBeInTheDocument();
      expect(screen.getByText(/8 results/)).toBeInTheDocument();
    });
  });

  it('renders run and delete buttons for each saved search', async () => {
    render(<W><SavedSearches /></W>);
    await waitFor(() => {
      const runButtons = screen.getAllByLabelText('run_search');
      const deleteButtons = screen.getAllByLabelText('delete_saved_search');
      expect(runButtons.length).toBe(2);
      expect(deleteButtons.length).toBe(2);
    });
  });

  it('calls API to load saved searches on mount', () => {
    render(<W><SavedSearches /></W>);
    expect(mockApiGet).toHaveBeenCalledWith('/v2/search/saved');
  });

  it('returns null when not authenticated', async () => {
    // Override useAuth for this test
    const contexts = await import('@/contexts');
    vi.mocked(contexts.useAuth).mockReturnValueOnce({
      user: null,
      isAuthenticated: false,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle',
      error: null,
    } as unknown as ReturnType<typeof contexts.useAuth>);

    const { container } = render(<W><SavedSearches /></W>);
    // When not authenticated, component returns null (no rendered content)
    expect(container.querySelector('h4')).toBeNull();
  });
});
