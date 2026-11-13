// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for CommunityFundCard component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() })),
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
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test' }, tenantPath: (p: string) => '/test' + p, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { CommunityFundCard } from './CommunityFundCard';

const FUND_DATA = {
  id: 1,
  balance: 42,
  total_deposited: 100,
  total_withdrawn: 20,
  total_donated: 38,
  description: 'Community time credit pool',
};

describe('CommunityFundCard — loading state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a skeleton while data is loading (no Community Fund heading visible)', () => {
    // Never resolves so the component stays in loading state
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    render(<CommunityFundCard />);
    // Community Fund heading must NOT appear during loading
    expect(screen.queryByText("Community fund")).not.toBeInTheDocument();
  });
});

describe('CommunityFundCard — error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the error message and retry button when the API returns success:false', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: false, error: 'Server error' });
    render(<CommunityFundCard />);
    await waitFor(() => {
      expect(screen.getByText("We couldn't load the community fund.")).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('shows the error message when the API call throws', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Network failure'));
    render(<CommunityFundCard />);
    await waitFor(() => {
      expect(screen.getByText("We couldn't load the community fund.")).toBeInTheDocument();
    });
  });

  it('retry button re-calls the API', async () => {
    // First call fails, second succeeds
    vi.mocked(api.get)
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: true, data: FUND_DATA });

    render(<CommunityFundCard />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledTimes(2);
    });
  });
});

describe('CommunityFundCard — populated (full view)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ success: true, data: FUND_DATA });
  });

  it('fetches from the correct endpoint', async () => {
    render(<CommunityFundCard />);
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/wallet/community-fund');
    });
  });

  it('renders the heading "Community fund"', async () => {
    render(<CommunityFundCard />);
    await waitFor(() => {
      expect(screen.getByText("Community fund")).toBeInTheDocument();
    });
  });

  it('renders the balance value', async () => {
    render(<CommunityFundCard />);
    await waitFor(() => {
      // Full view shows raw number in the centre block
      expect(screen.getByText('42')).toBeInTheDocument();
    });
  });

  it('renders the sub-description "hours available"', async () => {
    render(<CommunityFundCard />);
    await waitFor(() => {
      expect(screen.getByText('hours available')).toBeInTheDocument();
    });
  });

  it('renders deposited / withdrawn / donated stat labels', async () => {
    render(<CommunityFundCard />);
    await waitFor(() => {
      expect(screen.getByText('Deposited')).toBeInTheDocument();
      expect(screen.getByText('Withdrawn')).toBeInTheDocument();
      expect(screen.getByText('Donated')).toBeInTheDocument();
    });
  });

  it('does not render the donate button when onDonateClick is not provided', async () => {
    render(<CommunityFundCard />);
    await waitFor(() => {
      expect(screen.queryByText("Donate to community fund")).not.toBeInTheDocument();
    });
  });

  it('renders the "Donate to community fund" button when onDonateClick is provided', async () => {
    const onDonate = vi.fn();
    render(<CommunityFundCard onDonateClick={onDonate} />);
    await waitFor(() => {
      expect(screen.getByText("Donate to community fund")).toBeInTheDocument();
    });
  });

  it('calls onDonateClick when the donate button is pressed', async () => {
    const onDonate = vi.fn();
    render(<CommunityFundCard onDonateClick={onDonate} />);
    await waitFor(() => {
      expect(screen.getByText("Donate to community fund")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Donate to community fund"));
    expect(onDonate).toHaveBeenCalledTimes(1);
  });
});

describe('CommunityFundCard — compact view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ success: true, data: FUND_DATA });
  });

  it('renders compact donate button when compact=true and onDonateClick provided', async () => {
    const onDonate = vi.fn();
    render(<CommunityFundCard compact onDonateClick={onDonate} />);
    await waitFor(() => {
      // Compact view uses 'donate' key → "Donate"
      expect(screen.getByRole('button', { name: /donate/i })).toBeInTheDocument();
    });
  });

  it('does not render donate button in compact mode without onDonateClick', async () => {
    render(<CommunityFundCard compact />);
    // compact + no handler → no donate button
    await waitFor(() => {
      // In compact mode the community fund label is visible
      expect(screen.getByText("Community fund")).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: /donate/i })).not.toBeInTheDocument();
  });

  it('calls onDonateClick when compact donate button is pressed', async () => {
    const onDonate = vi.fn();
    render(<CommunityFundCard compact onDonateClick={onDonate} />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /donate/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /donate/i }));
    expect(onDonate).toHaveBeenCalledTimes(1);
  });

  it('renders the balance in compact mode using hours_value format', async () => {
    render(<CommunityFundCard compact />);
    await waitFor(() => {
      // hours_value: "{{count}}h" → "42h"
      expect(screen.getByText('42h')).toBeInTheDocument();
    });
  });
});
