// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for PollsPage
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import React from 'react';

const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
    download: vi.fn().mockResolvedValue(new Blob()),
  },
  API_BASE: 'http://localhost:8090/api',
  tokenManager: { getTenantId: vi.fn() },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: (url: string | null) => url || '/default-avatar.png',
  formatRelativeTime: (d: string) => d,
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
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', role: 'member' },
    isAuthenticated: true,
    login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null,
  })),
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

import { PollsPage } from './PollsPage';

describe('PollsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiPost.mockResolvedValue({ success: true });
  });

  it('renders without crashing', () => {
    mockApiGet.mockResolvedValue({ success: true, data: { polls: [], has_more: false, next_cursor: null } });
    const { container } = render(<PollsPage />);
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('renders page heading', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: { polls: [], has_more: false, next_cursor: null } });
    render(<PollsPage />);
    await waitFor(() => {
      // The heading renders as "Polls" from the i18n locale file
      expect(screen.getAllByText('Polls').length).toBeGreaterThan(0);
    });
  });

  it('renders empty state when no polls', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: { polls: [], has_more: false, next_cursor: null } });
    render(<PollsPage />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders tabs', async () => {
    mockApiGet.mockResolvedValue({ success: true, data: { polls: [], has_more: false, next_cursor: null } });
    render(<PollsPage />);
    await waitFor(() => {
      expect(screen.getByText('My Polls')).toBeInTheDocument();
    });
  });

  /**
   * 🔴 The Create menu (header "+" and the tab-bar sheet) links here as
   * `/polls?create=1`, because there is no `/polls/create` route — the form is a
   * collapsed section on this page. Without the flag the menu item would land a
   * member on a list of other people's polls with no visible way to start one,
   * which is the "the feature does not exist" failure the menu exists to fix.
   */
  describe('?create=1', () => {
    afterEach(() => {
      window.history.pushState({}, '', '/polls');
    });

    it('opens the create form on arrival and clears the flag from the URL', async () => {
      mockApiGet.mockResolvedValue({ success: true, data: { polls: [], has_more: false, next_cursor: null } });
      window.history.pushState({}, '', '/polls?create=1');

      render(<PollsPage />);

      await waitFor(() => {
        expect(screen.getByRole('textbox', { name: 'Option 1' })).toBeInTheDocument();
      });
      // Consumed, so closing the form and reloading does not silently reopen it.
      expect(window.location.search).not.toContain('create=1');
    });

    it('leaves the form collapsed without the flag', async () => {
      mockApiGet.mockResolvedValue({ success: true, data: { polls: [], has_more: false, next_cursor: null } });
      window.history.pushState({}, '', '/polls');

      render(<PollsPage />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Create a poll' })).toBeInTheDocument();
      });
      expect(screen.queryByRole('textbox', { name: 'Option 1' })).not.toBeInTheDocument();
    });
  });

  // HELP-10: a member wrote a description in paragraphs with a numbered list,
  // and the poll card ran it all together into one paragraph.
  it('keeps the line breaks the author typed in a poll description', async () => {
    const description = 'Hi everyone!\n\nThese sessions will cover:\n\n1. Tool tutorials\n2. Live matching\n\nWould you attend?';
    const poll = {
      id: 40,
      question: 'Friday office hours?',
      description,
      expires_at: null,
      created_at: '2026-10-03T17:20:04Z',
      total_votes: 0,
      status: 'open',
      has_voted: false,
      voted_option_id: null,
      options: [
        { id: 140, label: 'Yes', vote_count: null, percentage: null },
        { id: 141, label: 'No', vote_count: null, percentage: null },
      ],
      creator: { id: 218, name: 'Poll Author', avatar_url: null },
    };
    mockApiGet.mockImplementation((url: string) => Promise.resolve(
      url.startsWith('/v2/polls?') ? { success: true, data: [poll] } : { success: true, data: [] },
    ));
    render(<PollsPage />);

    const shown = await screen.findByText(/1\. Tool tutorials/);

    expect(shown.textContent).toBe(description);
    expect(shown.className).toContain('whitespace-pre-wrap');
  });

  it("exports the owner's poll results through the authenticated client", async () => {
    const { api } = await import('@/lib/api');
    const poll = {
      id: 41, question: 'Own poll?', description: null, expires_at: null,
      created_at: '2026-10-03T17:20:04Z', total_votes: 2, status: 'open',
      has_voted: false, voted_option_id: null,
      options: [{ id: 150, label: 'Yes', vote_count: 2, percentage: 100 }],
      creator: { id: 1, name: 'Test', avatar_url: null },
    };
    mockApiGet.mockImplementation((url: string) => Promise.resolve(
      url.startsWith('/v2/polls?') ? { success: true, data: [poll] } : { success: true, data: [] },
    ));
    render(<PollsPage />);
    await screen.findByText('Own poll?');

    const exportBtn = screen.getAllByRole('button').find((b) => /export/i.test(b.getAttribute('aria-label') ?? ''));
    expect(exportBtn).toBeDefined();
    fireEvent.click(exportBtn!);

    await waitFor(() => expect(api.download).toHaveBeenCalledWith('/v2/polls/41/export', { filename: 'poll-41-results.csv' }));
  });

  describe('a member who has already voted', () => {
    // Open poll seen by a member who is not its creator: the server hides the
    // counts (ballot integrity), so every percentage is null.
    const openPoll = (overrides: Record<string, unknown> = {}) => ({
      id: 4,
      question: 'Is this platform awesome?',
      description: null,
      expires_at: null,
      created_at: '2025-12-24T20:00:46Z',
      total_votes: 0,
      status: 'open',
      has_voted: false,
      voted_option_id: null,
      options: [
        { id: 7, label: 'Yes', vote_count: null, percentage: null },
        { id: 8, label: 'No', vote_count: null, percentage: null },
      ],
      creator: { id: 14, name: 'Poll Creator', avatar_url: null },
      ...overrides,
    });
    const serve = (poll: Record<string, unknown>) => mockApiGet.mockImplementation((url: string) => Promise.resolve(
      url.startsWith('/v2/polls?') ? { success: true, data: [poll] } : { success: true, data: [] },
    ));

    // Regression: since April the card fell back to vote buttons whenever the
    // counts were hidden, so a member who had voted was invited to vote again.
    it('sees their choice and no vote buttons while the results are hidden', async () => {
      serve(openPoll({ has_voted: true, voted_option_id: 7 }));
      render(<PollsPage />);

      expect(await screen.findByText('Results revealed when poll closes')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Vote for Yes/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Vote for No/ })).not.toBeInTheDocument();
      expect(screen.getByText('Yes').closest('[data-voted-option]')).not.toBeNull();
    });

    // Since 12 Sept a repeat of the same choice is answered 200 with
    // idempotent_replay; the page then said "Vote recorded!".
    it('is told they have already voted when the server reports a repeat', async () => {
      const user = userEvent.setup();
      serve(openPoll());
      mockApiPost.mockResolvedValue({ success: true, data: { ...openPoll({ has_voted: true, voted_option_id: 7 }), idempotent_replay: true } });
      render(<PollsPage />);

      await user.click(await screen.findByRole('button', { name: /Vote for Yes/ }));

      await waitFor(() => expect(stableToast.info).toHaveBeenCalledWith("You've already voted on this poll."));
      expect(stableToast.success).not.toHaveBeenCalled();
    });

    it('is told they have already voted when a different choice is refused', async () => {
      const user = userEvent.setup();
      serve(openPoll());
      mockApiPost.mockResolvedValue({ success: false, code: 'RESOURCE_CONFLICT', error: 'Already voted on this poll' });
      render(<PollsPage />);

      await user.click(await screen.findByRole('button', { name: /Vote for No/ }));

      await waitFor(() => expect(stableToast.info).toHaveBeenCalledWith("You've already voted on this poll."));
      expect(stableToast.error).not.toHaveBeenCalled();
    });
  });

  it('keeps an option input mounted and focused while typing', async () => {
    const user = userEvent.setup();
    mockApiGet.mockResolvedValue({ success: true, data: { polls: [], has_more: false, next_cursor: null } });
    render(<PollsPage />);

    await user.click(screen.getByRole('button', { name: 'Create a poll' }));
    const optionInput = screen.getByRole('textbox', { name: 'Option 1' });

    await user.type(optionInput, 'Community garden');

    expect(screen.getByRole('textbox', { name: 'Option 1' })).toBe(optionInput);
    expect(optionInput).toHaveValue('Community garden');
    expect(optionInput).toHaveFocus();
  });
});
