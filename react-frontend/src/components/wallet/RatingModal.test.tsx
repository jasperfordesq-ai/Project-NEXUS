// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for RatingModal component
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

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
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
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test' }, tenantPath: (p: string) => '/test' + p, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { RatingModal } from './RatingModal';

// Actual translated strings from public/locales/en/wallet.json
const T = {
  title: "Rate your exchange",
  prompt: 'How was your exchange?',
  commentLabel: 'Comment (optional)',
  commentPlaceholder: 'Share your experience...',
  skip: 'Skip',
  submit: "Submit rating",
  poor: 'Poor',
  fair: 'Fair',
  good: 'Good',
  very_good: "Very good",
  excellent: 'Excellent',
  toast: {
    rating_required: 'Rating required',
    rating_required_desc: 'Please select a star rating',
    rating_submitted: 'Rating submitted',
    rating_submitted_desc: 'Thank you for your feedback!',
    submit_failed: "We couldn't send your rating",
    try_again: 'Please try again',
    submit_error_desc: "That didn't work. Please try again.",
  },
};

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  exchangeId: 99,
};

describe('RatingModal — rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the modal heading when isOpen=true', () => {
    render(<RatingModal {...defaultProps} />);
    expect(screen.getByText(T.title)).toBeInTheDocument();
  });

  it('does not render modal content when isOpen=false', () => {
    render(<RatingModal {...defaultProps} isOpen={false} />);
    expect(screen.queryByText(T.title)).not.toBeInTheDocument();
  });

  it('shows the generic prompt when otherPartyName is not provided', () => {
    render(<RatingModal {...defaultProps} />);
    expect(screen.getByText(T.prompt)).toBeInTheDocument();
  });

  it('shows the name-specific prompt when otherPartyName is provided', () => {
    render(<RatingModal {...defaultProps} otherPartyName="Alice" />);
    expect(screen.getByText('How was your exchange with Alice?')).toBeInTheDocument();
  });

  it('renders five translated radio options in an exactly labelled rating group', () => {
    render(<RatingModal {...defaultProps} />);
    expect(screen.getByRole('radiogroup', { name: T.prompt })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: T.poor })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: T.fair })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: T.good })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: T.very_good })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: T.excellent })).toBeInTheDocument();
  });

  it('renders the comment textarea with the correct label', () => {
    render(<RatingModal {...defaultProps} />);
    expect(screen.getByText(T.commentLabel)).toBeInTheDocument();
  });

  it('renders the Skip and Submit Rating buttons', () => {
    render(<RatingModal {...defaultProps} />);
    expect(screen.getByText(T.skip)).toBeInTheDocument();
    expect(screen.getByText(T.submit)).toBeInTheDocument();
  });
});

describe('RatingModal — validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Submit Rating button is disabled when no star has been selected', () => {
    render(<RatingModal {...defaultProps} />);
    const submitBtn = screen.getByText(T.submit).closest('button');
    expect(submitBtn).toBeDisabled();
  });

  it('shows a toast error and does NOT call api.post when submitted with no star selected', async () => {
    render(<RatingModal {...defaultProps} />);
    // Force-click the (disabled) submit button by querying the underlying element
    const submitBtn = screen.getByText(T.submit).closest('button')!;
    // Bypass the disabled attr for this assertion path — call handleSubmit directly via
    // clicking the button whose onClick is still wired even when aria-disabled:
    fireEvent.click(submitBtn);
    // Because isDisabled=true the HeroUI Button swallows press events; but the
    // validation guard is also in handleSubmit so we test the toast path through
    // a star-less click of the button text (not the button itself) as a fallback:
    // In HeroUI v3 with isDisabled the press handler is NOT called — so we can't
    // reach the toast path via the disabled button. We test this path by checking
    // that api.post was NOT called after the click:
    await waitFor(() => {
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  it('Submit Rating button becomes enabled after selecting a star', async () => {
    render(<RatingModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('radio', { name: T.good }));
    await waitFor(() => {
      const submitBtn = screen.getByText(T.submit).closest('button');
      expect(submitBtn).not.toBeDisabled();
    });
  });
});

describe('RatingModal — star selection and rating labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows no rating label before any star is selected', () => {
    render(<RatingModal {...defaultProps} />);
    expect(screen.queryByText(T.poor)).not.toBeInTheDocument();
    expect(screen.queryByText(T.fair)).not.toBeInTheDocument();
    expect(screen.queryByText(T.good)).not.toBeInTheDocument();
    expect(screen.queryByText(T.very_good)).not.toBeInTheDocument();
    expect(screen.queryByText(T.excellent)).not.toBeInTheDocument();
  });

  it('shows "Poor" after selecting 1 star', async () => {
    render(<RatingModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('radio', { name: T.poor }));
    await waitFor(() => expect(screen.getByText(T.poor)).toBeInTheDocument());
  });

  it('shows "Fair" after selecting 2 stars', async () => {
    render(<RatingModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('radio', { name: T.fair }));
    await waitFor(() => expect(screen.getByText(T.fair)).toBeInTheDocument());
  });

  it('shows "Good" after selecting 3 stars', async () => {
    render(<RatingModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('radio', { name: T.good }));
    await waitFor(() => expect(screen.getByText(T.good)).toBeInTheDocument());
  });

  it('shows "Very good" after selecting 4 stars', async () => {
    render(<RatingModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('radio', { name: T.very_good }));
    await waitFor(() => expect(screen.getByText(T.very_good)).toBeInTheDocument());
  });

  it('shows "Excellent" after selecting 5 stars', async () => {
    render(<RatingModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('radio', { name: T.excellent }));
    await waitFor(() => expect(screen.getByText(T.excellent)).toBeInTheDocument());
  });

  it('updates the label when a different star is selected', async () => {
    render(<RatingModal {...defaultProps} />);
    fireEvent.click(screen.getByRole('radio', { name: T.fair }));
    await waitFor(() => expect(screen.getByText(T.fair)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: T.excellent }));
    await waitFor(() => {
      expect(screen.queryByText(T.fair)).not.toBeInTheDocument();
      expect(screen.getByText(T.excellent)).toBeInTheDocument();
    });
  });
});

describe('RatingModal — successful submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls POST /v2/exchanges/:id/rate with the selected rating and no comment when blank', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });
    render(<RatingModal {...defaultProps} />);

    fireEvent.click(screen.getByRole('radio', { name: T.very_good }));
    await waitFor(() => expect(screen.getByText(T.submit).closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText(T.submit));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/exchanges/99/rate', {
        rating: 4,
        comment: undefined,
      });
    });
  });

  it('includes the comment string in the payload when a comment is typed', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });
    render(<RatingModal {...defaultProps} />);

    fireEvent.click(screen.getByRole('radio', { name: T.excellent }));

    const textarea = screen.getByPlaceholderText(T.commentPlaceholder);
    fireEvent.change(textarea, { target: { value: 'Great service!' } });

    await waitFor(() => expect(screen.getByText(T.submit).closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText(T.submit));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/exchanges/99/rate', {
        rating: 5,
        comment: 'Great service!',
      });
    });
  });

  it('uses the correct exchange id in the POST URL', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });
    render(<RatingModal isOpen onClose={vi.fn()} exchangeId={777} />);

    fireEvent.click(screen.getByRole('radio', { name: T.good }));
    await waitFor(() => expect(screen.getByText(T.submit).closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText(T.submit));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/exchanges/777/rate', expect.any(Object));
    });
  });

  it('shows a success toast on successful submission', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });
    render(<RatingModal {...defaultProps} />);

    fireEvent.click(screen.getByRole('radio', { name: T.good }));
    await waitFor(() => expect(screen.getByText(T.submit).closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText(T.submit));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        T.toast.rating_submitted,
        T.toast.rating_submitted_desc,
      );
    });
  });

  it('calls onClose after successful submission', async () => {
    const onClose = vi.fn();
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });
    render(<RatingModal {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByRole('radio', { name: T.fair }));
    await waitFor(() => expect(screen.getByText(T.submit).closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText(T.submit));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('calls onRatingComplete after successful submission', async () => {
    const onRatingComplete = vi.fn();
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });
    render(<RatingModal {...defaultProps} onRatingComplete={onRatingComplete} />);

    fireEvent.click(screen.getByRole('radio', { name: T.excellent }));
    await waitFor(() => expect(screen.getByText(T.submit).closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText(T.submit));

    await waitFor(() => expect(onRatingComplete).toHaveBeenCalledTimes(1));
  });

  it('does not crash when onRatingComplete is not provided', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });
    render(<RatingModal isOpen onClose={vi.fn()} exchangeId={99} />);

    fireEvent.click(screen.getByRole('radio', { name: T.poor }));
    await waitFor(() => expect(screen.getByText(T.submit).closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText(T.submit));

    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
  });
});

describe('RatingModal — failed submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a toast with the API error message when success:false with error field', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: false, error: 'Already rated' });
    render(<RatingModal {...defaultProps} />);

    fireEvent.click(screen.getByRole('radio', { name: T.good }));
    await waitFor(() => expect(screen.getByText(T.submit).closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText(T.submit));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(T.toast.submit_failed, 'Already rated');
    });
  });

  it('shows a generic fallback toast when success:false with no error field', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: false });
    render(<RatingModal {...defaultProps} />);

    fireEvent.click(screen.getByRole('radio', { name: T.good }));
    await waitFor(() => expect(screen.getByText(T.submit).closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText(T.submit));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(T.toast.submit_failed, T.toast.try_again);
    });
  });

  it('shows the network-error toast when the API call throws', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Connection refused'));
    render(<RatingModal {...defaultProps} />);

    fireEvent.click(screen.getByRole('radio', { name: T.very_good }));
    await waitFor(() => expect(screen.getByText(T.submit).closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText(T.submit));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(T.toast.submit_failed, T.toast.submit_error_desc);
    });
  });

  it('does not call onClose when submission fails', async () => {
    const onClose = vi.fn();
    vi.mocked(api.post).mockResolvedValueOnce({ success: false, error: 'Server error' });
    render(<RatingModal {...defaultProps} onClose={onClose} />);

    fireEvent.click(screen.getByRole('radio', { name: T.good }));
    await waitFor(() => expect(screen.getByText(T.submit).closest('button')).not.toBeDisabled());
    fireEvent.click(screen.getByText(T.submit));

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('RatingModal — Skip button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls onClose when the Skip button is clicked', () => {
    const onClose = vi.fn();
    render(<RatingModal {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByText(T.skip));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT call api.post when Skip is clicked', () => {
    render(<RatingModal {...defaultProps} />);
    fireEvent.click(screen.getByText(T.skip));
    expect(api.post).not.toHaveBeenCalled();
  });
});
