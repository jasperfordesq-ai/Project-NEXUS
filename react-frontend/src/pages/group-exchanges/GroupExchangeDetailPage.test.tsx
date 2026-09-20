// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for GroupExchangeDetailPage
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
import { api } from '@/lib/api';

// Stable toast spies so a test can assert success vs error fired (the component
// stores the toast object in a ref, so each handler call uses the same instance).
const { toastSuccessSpy, toastErrorSpy } = vi.hoisted(() => ({
  toastSuccessSpy: vi.fn(),
  toastErrorSpy: vi.fn(),
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Alice', name: 'Alice Organizer' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
  })),
  useToast: vi.fn(() => ({ success: toastSuccessSpy, error: toastErrorSpy, info: vi.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,

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

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ success: toastSuccessSpy, error: toastErrorSpy, info: vi.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  resolveThumbnailUrl: vi.fn((url) => url || null),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => ({ id: '1' }),
    useNavigate: () => vi.fn(),
  };
});

vi.mock('@/lib/motion', async () => {
  const { framerMotionMock } = await import('@/test/mocks');
  return framerMotionMock;
});

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/components/navigation', () => ({
  Breadcrumbs: ({ items }: { items: { label: string }[] }) => (
    <nav>{items.map((i) => <span key={i.label}>{i.label}</span>)}</nav>
  ),
}));

vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message: string }) => <div data-testid="loading-screen">{message}</div>,
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <h2>{title}</h2>
      {description && <p>{description}</p>}
    </div>
  ),
}));

import { GroupExchangeDetailPage } from './GroupExchangeDetailPage';

const mockGroupExchange = {
  id: 1,
  title: 'Community Skills Swap',
  description: 'A group exchange for community skills',
  status: 'pending_participants',
  organizer_id: 1,
  organizer_name: 'Alice Organizer',
  organizer_avatar: null,
  split_type: 'equal',
  total_hours: 6,
  participants: [
    { user_id: 1, user_name: 'Alice Organizer', avatar: null, role: 'provider', hours: 3, weight: 1, confirmed: false },
    { user_id: 2, user_name: 'Bob Receiver', avatar: null, role: 'receiver', hours: 3, weight: 1, confirmed: false },
  ],
  created_at: '2026-01-15T10:00:00Z',
};

describe('GroupExchangeDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ success: true, data: mockGroupExchange });
    api.post.mockResolvedValue({ success: true });
    api.put.mockResolvedValue({ success: true });
    api.delete.mockResolvedValue({ success: true });
  });

  it('sends the displayed terms and reloads a refusal without retrying consent', async () => {
    api.get.mockResolvedValueOnce({ success: true, data: { ...mockGroupExchange, status: 'pending_confirmation', terms_token: 'seen' } });
    api.get.mockResolvedValue({ success: true, data: { ...mockGroupExchange, status: 'pending_confirmation', total_hours: 8, terms_token: 'fresh' } });
    api.post.mockResolvedValueOnce({ success: false, error: 'Terms changed' } as never);
    render(<GroupExchangeDetailPage />);
    fireEvent.click(await screen.findByRole('button', { name: /confirm my hours/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/v2/group-exchanges/1/confirm', { terms_token: 'seen' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(toastSuccessSpy).not.toHaveBeenCalled();
  });

  it('shows an error toast (not a fake success) when an action request fails', async () => {
    // Regression: handlers did `await api.X(...)` WITHOUT capturing the response,
    // then unconditionally showed a success toast and reloaded/navigated. Since
    // api.X resolves { success: false } on a 4xx without throwing, a failed action
    // reported a fake success. Here we exercise the "Start Exchange" path.
    api.post.mockResolvedValue({ success: false, error: 'Not allowed' } as never);

    render(<GroupExchangeDetailPage />);
    const startBtn = await screen.findByRole('button', { name: /start/i });
    fireEvent.click(startBtn);

    await waitFor(() => expect(toastErrorSpy).toHaveBeenCalled());
    expect(toastSuccessSpy).not.toHaveBeenCalled();
  });

  it('Start Exchange hits the dedicated /start action endpoint', async () => {
    // Regression F2: "Start" used to PUT {status}, which the update allow-list
    // silently drops — the exchange was stuck in draft forever. It must POST to the
    // dedicated /start action instead.
    render(<GroupExchangeDetailPage />);
    const startBtn = await screen.findByRole('button', { name: /start/i });
    fireEvent.click(startBtn);

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(vi.mocked(api.post).mock.calls[0][0]).toMatch(/\/group-exchanges\/1\/start$/);
    // status transitions never go through PUT.
    expect(api.put).not.toHaveBeenCalled();
  });

  it('renders the hour-split breakdown from a flat calculated_split list', async () => {
    // Regression F5: the page expected a nested provider→receiver map, but the
    // backend returns a flat per-participant list — the old code rendered garbage.
    api.get.mockResolvedValue({
      success: true,
      data: {
        ...mockGroupExchange,
        calculated_split: [
          { user_id: 1, role: 'provider', hours: 3 },
          { user_id: 2, role: 'receiver', hours: 3 },
        ],
      },
    });

    render(<GroupExchangeDetailPage />);
    // The "Hour Split" section only renders when buildSplitRows() returns rows.
    await waitFor(() => {
      expect(screen.getByText('Hour Split')).toBeInTheDocument();
    });
  });

  it('shows loading screen initially', () => {
    api.get.mockImplementation(() => new Promise(() => {}));
    render(<GroupExchangeDetailPage />);
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
  });

  it('renders group exchange title after load', async () => {
    render(<GroupExchangeDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Community Skills Swap').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders organizer name', async () => {
    render(<GroupExchangeDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/Alice Organizer/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders participant names in participants table', async () => {
    render(<GroupExchangeDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/Bob Receiver/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows empty state on API error', async () => {
    api.get.mockRejectedValue(new Error('Not found'));
    render(<GroupExchangeDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders split type information', async () => {
    render(<GroupExchangeDetailPage />);
    await waitFor(() => {
      // split_type 'equal' renders as 'Equal split'
      expect(screen.getAllByText(/Equal split/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders total hours', async () => {
    render(<GroupExchangeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('6')).toBeInTheDocument();
    });
  });
});
