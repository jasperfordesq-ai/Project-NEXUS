// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for RatingModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';
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

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
};

vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => mockToast),

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
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test', tagline: null }, branding: { name: 'Test', logo_url: null }, tenantSlug: 'test', tenantPath: (p) => '/test' + p, isLoading: false, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { RatingModal } from '../RatingModal';

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  exchangeId: 42,
};

describe('RatingModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders when isOpen is true', () => {
    render(<RatingModal {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('does not render when isOpen is false', () => {
    render(<RatingModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders "Rate your exchange" heading', () => {
    render(<RatingModal {...defaultProps} />);
    expect(screen.getByText("Rate your exchange")).toBeInTheDocument();
  });

  it('includes other party name in description when provided', () => {
    render(<RatingModal {...defaultProps} otherPartyName="Alice" />);
    expect(screen.getByText(/with Alice/i)).toBeInTheDocument();
  });

  it('renders 5 translated star radio options', () => {
    render(<RatingModal {...defaultProps} />);
    expect(screen.getAllByRole('radio')).toHaveLength(5);
  });

  it('star radios have translated accessible names', () => {
    render(<RatingModal {...defaultProps} />);
    expect(screen.getByRole('radio', { name: 'Poor' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Excellent' })).toBeInTheDocument();
  });

  it('does not show rating description text before a star is selected', () => {
    render(<RatingModal {...defaultProps} />);
    expect(screen.queryByText('Poor')).not.toBeInTheDocument();
    expect(screen.queryByText('Excellent')).not.toBeInTheDocument();
  });

  it('shows "Poor" text when 1 star is selected', async () => {
    render(<RatingModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Poor' }));
    await waitFor(() => {
      expect(screen.getByText('Poor')).toBeInTheDocument();
    });
  });

  it('shows "Excellent" text when 5 stars are selected', async () => {
    render(<RatingModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Excellent' }));
    await waitFor(() => {
      expect(screen.getByText('Excellent')).toBeInTheDocument();
    });
  });

  it('renders the Skip button', () => {
    render(<RatingModal {...defaultProps} />);
    expect(screen.getByRole('button', { name: /skip/i })).toBeInTheDocument();
  });

  it('calls onClose when Skip is clicked', () => {
    const onClose = vi.fn();
    render(<RatingModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /skip/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Submit Rating button is disabled until a star is selected', () => {
    render(<RatingModal {...defaultProps} />);
    const submitBtn = screen.getByRole('button', { name: /submit rating/i });
    expect(submitBtn).toBeDisabled();
  });

  it('enables Submit Rating button after selecting a star', async () => {
    render(<RatingModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Good' }));
    await waitFor(() => {
      const submitBtn = screen.getByRole('button', { name: /submit rating/i });
      expect(submitBtn).not.toBeDisabled();
    });
  });

  it('calls API and shows success toast on submit', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });
    const onClose = vi.fn();
    const onRatingComplete = vi.fn();

    render(
      <RatingModal
        {...defaultProps}
        onClose={onClose}
        onRatingComplete={onRatingComplete}
      />
    );

    fireEvent.click(screen.getByRole('radio', { name: "Very good" }));
    fireEvent.click(screen.getByRole('button', { name: /submit rating/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/v2/exchanges/42/rate',
        expect.objectContaining({ rating: 4 })
      );
      expect(mockToast.success).toHaveBeenCalled();
      expect(onRatingComplete).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows error toast when API returns failure', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: false, error: 'Error' });

    render(<RatingModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Fair' }));
    fireEvent.click(screen.getByRole('button', { name: /submit rating/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('shows error toast on API exception', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Network error'));

    render(<RatingModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Excellent' }));
    fireEvent.click(screen.getByRole('button', { name: /submit rating/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});
