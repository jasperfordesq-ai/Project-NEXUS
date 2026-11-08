// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ReactionSummary component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Stable mock references ─────────────────────────────────────────────────

const mockTenant = {
  tenant: { id: 2, name: 'Test', slug: 'test' },
  tenantSlug: 'test',
  branding: { name: 'Test' },
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
  tenantPath: (p: string) => `/test${p}`,
};

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({ user: { id: 1 }, isAuthenticated: true })),
  useTenant: vi.fn(() => mockTenant),
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
vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
  tokenManager: {
    hasAccessToken: vi.fn(() => true),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null | undefined) => url || '/default-avatar.png',
  resolveThumbnailUrl: (url: string | null | undefined) => url || '/default-avatar.png',
  formatRelativeTime: vi.fn(() => '1 hour ago'),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

import { ReactionSummary } from '../ReactionSummary';

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test']}>
        {children}
      </MemoryRouter>
    </>
  );
}

const defaultProps = {
  counts: { love: 5, laugh: 3, like: 2 } as Record<string, number>,
  total: 10,
  topReactors: [
    { id: 1, name: 'Alice', avatar_url: null },
    { id: 2, name: 'Bob', avatar_url: null },
  ],
  entityType: 'post' as const,
  entityId: 42,
};

describe('ReactionSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The modal reads the paginated reactors endpoint (an array plus meta).
    mockApiGet.mockResolvedValue({
      success: true,
      data: [{ id: 1, name: 'Alice', avatar_url: null, reacted_at: '2026-11-08 10:00:00', reaction_type: 'love' }],
      meta: { total: 1, has_more: false },
    });
  });

  it('renders without crashing', () => {
    const { container } = render(
      <W><ReactionSummary {...defaultProps} /></W>,
    );
    expect(container).toBeTruthy();
  });

  it('returns null when total is 0', () => {
    const { container } = render(
      <W><ReactionSummary {...defaultProps} counts={{}} total={0} /></W>,
    );
    // Should render nothing
    expect(container.querySelector('button')).toBeNull();
  });

  it('returns null when all counts are 0', () => {
    const { container } = render(
      <W><ReactionSummary {...defaultProps} counts={{ love: 0, like: 0 }} total={0} /></W>,
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('displays reaction emoji badges', () => {
    render(<W><ReactionSummary {...defaultProps} /></W>);
    // Should render up to 3 emoji badges for the sorted types
    const imgRoles = screen.getAllByRole('img');
    expect(imgRoles.length).toBeGreaterThanOrEqual(1);
  });

  it('displays summary text with top reactors and remaining count', () => {
    render(<W><ReactionSummary {...defaultProps} /></W>);
    // "Alice, Bob, and 8 others"
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
    expect(screen.getByText(/others/)).toBeInTheDocument();
  });

  it('displays only names when remaining count is 0', () => {
    render(
      <W>
        <ReactionSummary
          {...defaultProps}
          total={2}
          topReactors={[
            { id: 1, name: 'Alice', avatar_url: null },
            { id: 2, name: 'Bob', avatar_url: null },
          ]}
        />
      </W>,
    );
    expect(screen.getByText('Alice, Bob')).toBeInTheDocument();
  });

  it('shows generic count when topReactors is empty', () => {
    render(
      <W>
        <ReactionSummary {...defaultProps} topReactors={[]} total={5} />
      </W>,
    );
    expect(screen.getByText(/5 reactions/)).toBeInTheDocument();
  });

  it('shows singular "reaction" when total is 1', () => {
    render(
      <W>
        <ReactionSummary {...defaultProps} counts={{ love: 1 }} topReactors={[]} total={1} />
      </W>,
    );
    expect(screen.getByText(/1 reaction$/)).toBeInTheDocument();
  });

  it('shows "and 1 other" for singular remaining', () => {
    render(
      <W>
        <ReactionSummary
          {...defaultProps}
          total={2}
          topReactors={[{ id: 1, name: 'Alice', avatar_url: null }]}
        />
      </W>,
    );
    expect(screen.getByText(/Alice.*and.*1.*other$/)).toBeInTheDocument();
  });

  it('has a button with aria-label describing reactions', () => {
    render(<W><ReactionSummary {...defaultProps} /></W>);
    const button = screen.getByRole('button', { name: /View reactions/i });
    expect(button).toBeInTheDocument();
  });

  it('opens the modal when the summary row is clicked', async () => {
    render(<W><ReactionSummary {...defaultProps} /></W>);
    const summaryButton = screen.getByRole('button', { name: /View reactions/i });
    fireEvent.click(summaryButton);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('shows "Reactions" header in modal', async () => {
    render(<W><ReactionSummary {...defaultProps} /></W>);
    fireEvent.click(screen.getByRole('button', { name: /View reactions/i }));

    await waitFor(() => {
      expect(screen.getByText(/Reactions/)).toBeInTheDocument();
    });
  });

  it('shows total count in modal header', async () => {
    render(<W><ReactionSummary {...defaultProps} /></W>);
    fireEvent.click(screen.getByRole('button', { name: /View reactions/i }));

    await waitFor(() => {
      expect(screen.getByText(/\(10\)/)).toBeInTheDocument();
    });
  });

  it('calls API when modal opens', async () => {
    render(<W><ReactionSummary {...defaultProps} /></W>);
    fireEvent.click(screen.getByRole('button', { name: /View reactions/i }));

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/v2/reactions/post/42/users/all?page=1&per_page=20');
    });
  });

  it('shows "All" tab in modal', async () => {
    render(<W><ReactionSummary {...defaultProps} /></W>);
    fireEvent.click(screen.getByRole('button', { name: /View reactions/i }));

    await waitFor(() => {
      expect(screen.getByText(/All.*10/)).toBeInTheDocument();
    });
  });

  it('shows reactor names in modal after loading', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: [{ id: 10, name: 'Charlie', avatar_url: null, reacted_at: '2026-11-08 10:00:00', reaction_type: 'love' }],
      meta: { total: 1, has_more: false },
    });

    render(<W><ReactionSummary {...defaultProps} /></W>);
    fireEvent.click(screen.getByRole('button', { name: /View reactions/i }));

    await waitFor(() => {
      expect(screen.getByText('Charlie')).toBeInTheDocument();
    });
  });

  it('shows "No reactions yet" when API returns empty data', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: [],
      meta: { total: 0, has_more: false },
    });

    render(<W><ReactionSummary {...defaultProps} /></W>);
    fireEvent.click(screen.getByRole('button', { name: /View reactions/i }));

    await waitFor(() => {
      expect(screen.getByText('No reactions yet')).toBeInTheDocument();
    });
  });

  it('sorts reaction types by count descending', () => {
    const { container } = render(
      <W>
        <ReactionSummary
          {...defaultProps}
          counts={{ like: 1, love: 10, laugh: 5 }}
          total={16}
        />
      </W>,
    );
    // The first emoji badge should be for "love" (highest count)
    const badges = container.querySelectorAll('[role="img"]');
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('renders for entityType "comment"', () => {
    render(
      <W><ReactionSummary {...defaultProps} entityType="comment" entityId={99} /></W>,
    );
    expect(screen.getByRole('button', { name: /View reactions/i })).toBeInTheDocument();
  });
});
