// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for ExchangeDetailPage
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));
import { api } from '@/lib/api';

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 2, first_name: 'Bob', name: 'Bob Provider' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
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
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
}));

vi.mock('@/lib/exchange-status', () => ({
  EXCHANGE_STATUS_CONFIG: {
    pending_provider: { label: 'Pending Provider', color: 'warning', description: 'Awaiting provider response' },
    accepted: { label: 'Accepted', color: 'success', description: 'Exchange accepted' },
    in_progress: { label: "In progress", color: 'primary', description: 'Exchange in progress' },
    completed: { label: 'Completed', color: 'success', description: 'Exchange completed' },
    cancelled: { label: 'Cancelled', color: 'danger', description: 'Exchange cancelled' },
    pending_confirmation: { label: 'Pending Confirmation', color: 'warning', description: 'Awaiting confirmation' },
    disputed: { label: 'Disputed', color: 'danger', description: 'Exchange disputed' },
    pending_broker: { label: 'Pending Broker', color: 'warning', description: 'Awaiting broker approval' },
  },
  MAX_EXCHANGE_HOURS: 100,
  getStatusIconBgClass: vi.fn(() => 'bg-warning/20'),
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

vi.mock('@/components/wallet', () => ({
  RatingModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="rating-modal" /> : null,
}));

import { ExchangeDetailPage } from './ExchangeDetailPage';

const mockExchange = {
  id: 1,
  listing_id: 10,
  listing: { id: 10, title: 'Piano Lessons' },
  requester_id: 1,
  provider_id: 2,
  requester: { id: 1, name: 'Alice Requester', avatar: null },
  provider: { id: 2, name: 'Bob Provider', avatar: null },
  status: 'pending_provider',
  proposed_hours: 3,
  final_hours: null,
  message: 'Looking forward to this!',
  created_at: '2026-01-15T10:00:00Z',
  status_history: [
    {
      action: 'created',
      new_status: 'pending_provider',
      actor_name: 'Alice Requester',
      created_at: '2026-01-15T10:00:00Z',
      notes: null,
    },
  ],
  requester_confirmed_at: null,
  provider_confirmed_at: null,
  requester_confirmed_hours: null,
  provider_confirmed_hours: null,
  prep_time: null,
  broker_notes: null,
};

describe('ExchangeDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ success: true, data: mockExchange });
    api.post.mockResolvedValue({ success: true });
    api.delete.mockResolvedValue({ success: true });
  });

  it('shows loading screen initially', () => {
    api.get.mockImplementation(() => new Promise(() => {}));
    render(<ExchangeDetailPage />);
    expect(screen.getByTestId('loading-screen')).toBeInTheDocument();
  });

  it('renders exchange listing title after load', async () => {
    render(<ExchangeDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Piano Lessons').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders status chip for exchange status', async () => {
    render(<ExchangeDetailPage />);
    await waitFor(() => {
      // Outside the step line, which also names the current step.
      expect(screen.getAllByText('Pending Provider').filter((el) => !el.closest('ol'))).toHaveLength(1);
    });
  });

  it('shows where the exchange is on its four steps (warmth plan B5)', async () => {
    render(<ExchangeDetailPage />);
    const steps = await screen.findAllByRole('listitem');
    const tracker = steps[0]!.closest('ol')!;
    expect(tracker.querySelectorAll('li')).toHaveLength(4);
    expect(tracker.querySelector('li')).toHaveAttribute('aria-current', 'step');
  });

  it('renders requester and provider names', async () => {
    render(<ExchangeDetailPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Alice Requester').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Bob Provider/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders proposed hours', async () => {
    render(<ExchangeDetailPage />);
    await waitFor(() => {
      // Outside the step line, whose third step is numbered 3.
      expect(screen.getAllByText('3').filter((el) => !el.closest('ol'))).toHaveLength(1);
    });
  });

  it('renders exchange message from requester', async () => {
    render(<ExchangeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText('Looking forward to this!')).toBeInTheDocument();
    });
  });

  it('shows accept and decline buttons when user is provider with pending status', async () => {
    render(<ExchangeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText("Accept request")).toBeInTheDocument();
      expect(screen.getByText('Decline')).toBeInTheDocument();
    });
  });

  it('shows empty state on API error', async () => {
    api.get.mockRejectedValue(new Error('Not found'));
    render(<ExchangeDetailPage />);
    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('renders timeline section', async () => {
    render(<ExchangeDetailPage />);
    await waitFor(() => {
      expect(screen.getByText("Exchange timeline")).toBeInTheDocument();
    });
  });
});

// AWID feedback (Nov 2026, "warmth, and community"): a thank-you when the
// member's confirmation completes the exchange.
describe('ExchangeDetailPage — thank-you on completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { ...mockExchange, status: 'pending_confirmation' } });
    vi.mocked(api.delete).mockResolvedValue({ success: true });
  });

  async function confirmHours() {
    render(<ExchangeDetailPage />);
    await userEvent.click(await screen.findByRole('button', { name: "Confirm hours" }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: "Confirm hours" }));
  }

  it('says thank you, with the year so far, when confirming completes the exchange', async () => {
    vi.mocked(api.post).mockResolvedValue({
      success: true,
      data: { ...mockExchange, status: 'completed', thanks: { neighbours_this_year: 3, hours_this_year: 6 } },
    });
    await confirmHours();

    const panel = await screen.findByTestId('exchange-thanks');
    expect(within(panel).getByText('Thank you!')).toBeInTheDocument();
    expect(within(panel).getByText('3')).toBeInTheDocument();
    expect(within(panel).getByText('6')).toBeInTheDocument();
  });

  it('says nothing extra while the exchange still waits for the other person', async () => {
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { ...mockExchange, status: 'pending_confirmation' } });
    await confirmHours();

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    expect(screen.queryByTestId('exchange-thanks')).toBeNull();
  });
});
