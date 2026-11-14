// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for RatingModal component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  })
);

import { api } from '@/lib/api';
import { RatingModal } from './RatingModal';

const DEFAULT_PROPS = {
  orderId: 42,
  isOpen: true,
  onClose: vi.fn(),
  onSuccess: vi.fn(),
};

/** Query the nth star radio (1-indexed) by its translated accessible name. */
function getStar(n: number): HTMLElement {
  return screen.getByRole('radio', { name: `${n} stars` });
}

describe('RatingModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Rendering ──────────────────────────────────────────────────────────────

  it('renders the modal title when open', () => {
    render(<RatingModal {...DEFAULT_PROPS} />);
    expect(screen.getByText('Rate Your Order')).toBeInTheDocument();
  });

  it('renders 5 star radios with translated accessible names', () => {
    render(<RatingModal {...DEFAULT_PROPS} />);
    for (let i = 1; i <= 5; i++) {
      expect(screen.getByRole('radio', { name: `${i} stars` })).toBeInTheDocument();
    }
  });

  it('renders a radiogroup wrapper around the stars', () => {
    render(<RatingModal {...DEFAULT_PROPS} />);
    expect(screen.getByRole('radiogroup', { name: 'Rating' })).toHaveAttribute(
      'aria-required',
      'true',
    );
  });

  it('renders the comment textarea', () => {
    render(<RatingModal {...DEFAULT_PROPS} />);
    expect(screen.getByLabelText(/comment/i)).toBeInTheDocument();
  });

  it('renders the anonymous checkbox', () => {
    render(<RatingModal {...DEFAULT_PROPS} />);
    expect(screen.getByText('Submit anonymously')).toBeInTheDocument();
  });

  it('renders Cancel and Submit Rating buttons', () => {
    render(<RatingModal {...DEFAULT_PROPS} />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /submit rating/i })).toBeInTheDocument();
  });

  // ─── Validation ─────────────────────────────────────────────────────────────

  it('Submit Rating button has data-disabled=true when no star is selected', () => {
    render(<RatingModal {...DEFAULT_PROPS} />);
    const submitButton = screen.getByRole('button', { name: /submit rating/i });
    // HeroUI v3 uses data-disabled="true" (not aria-disabled) for isDisabled prop
    expect(submitButton).toHaveAttribute('data-disabled', 'true');
  });

  it('Submit Rating button loses data-disabled after selecting a star', async () => {
    render(<RatingModal {...DEFAULT_PROPS} />);
    fireEvent.click(getStar(3));
    await waitFor(() => {
      const submitButton = screen.getByRole('button', { name: /submit rating/i });
      expect(submitButton).not.toHaveAttribute('data-disabled', 'true');
    });
  });

  // ─── Star selection state ─────────────────────────────────────────────────
  // HeroUI v3 Radio exposes native checked state and preserves the selected
  // value in the submitted API payload.

  it('clicking any star enables the Submit Rating button (confirms state update)', async () => {
    render(<RatingModal {...DEFAULT_PROPS} />);
    expect(getStar(1)).toBeInTheDocument(); // star buttons exist
    fireEvent.click(getStar(1));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /submit rating/i })
      ).not.toHaveAttribute('data-disabled', 'true');
    });
  });

  it('clicking a higher star still enables Submit Rating (any star value sets rating)', async () => {
    render(<RatingModal {...DEFAULT_PROPS} />);
    fireEvent.click(getStar(5));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /submit rating/i })
      ).not.toHaveAttribute('data-disabled', 'true');
    });
  });

  // ─── Submit — success path ───────────────────────────────────────────────────

  it('calls POST /v2/marketplace/orders/{id}/rate with correct payload', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    render(<RatingModal {...DEFAULT_PROPS} />);
    fireEvent.click(getStar(4)); // rating = 4

    const textarea = screen.getByLabelText(/comment/i);
    fireEvent.change(textarea, { target: { value: 'Great seller!' } });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /submit rating/i })
      ).not.toHaveAttribute('data-disabled', 'true');
    });
    fireEvent.click(screen.getByRole('button', { name: /submit rating/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/v2/marketplace/orders/42/rate',
        expect.objectContaining({
          rating: 4,
          comment: 'Great seller!',
          is_anonymous: false,
        })
      );
    });
  });

  it('calls onSuccess and onClose after successful submission', async () => {
    const onSuccess = vi.fn();
    const onClose = vi.fn();
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    render(
      <RatingModal
        {...DEFAULT_PROPS}
        onSuccess={onSuccess}
        onClose={onClose}
      />
    );
    fireEvent.click(getStar(1));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /submit rating/i })
      ).not.toHaveAttribute('data-disabled', 'true');
    });
    fireEvent.click(screen.getByRole('button', { name: /submit rating/i }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledOnce();
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  it('shows success toast after successful submission', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    render(<RatingModal {...DEFAULT_PROPS} />);
    fireEvent.click(getStar(3));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /submit rating/i })
      ).not.toHaveAttribute('data-disabled', 'true');
    });
    fireEvent.click(screen.getByRole('button', { name: /submit rating/i }));

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Rating submitted successfully!');
    });
  });

  it('omits comment from payload when comment is blank', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    render(<RatingModal {...DEFAULT_PROPS} />);
    fireEvent.click(getStar(5));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /submit rating/i })
      ).not.toHaveAttribute('data-disabled', 'true');
    });
    fireEvent.click(screen.getByRole('button', { name: /submit rating/i }));

    await waitFor(() => {
      const [, payload] = vi.mocked(api.post).mock.calls[0];
      expect((payload as Record<string, unknown>).comment).toBeUndefined();
    });
  });

  it('sends is_anonymous=true when anonymous checkbox is toggled on', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: true });

    render(<RatingModal {...DEFAULT_PROPS} />);
    fireEvent.click(getStar(1));

    // Click the anonymous label/text to toggle the HeroUI Checkbox
    fireEvent.click(screen.getByText('Submit anonymously'));

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /submit rating/i })
      ).not.toHaveAttribute('data-disabled', 'true');
    });
    fireEvent.click(screen.getByRole('button', { name: /submit rating/i }));

    await waitFor(() => {
      const [, payload] = vi.mocked(api.post).mock.calls[0];
      expect((payload as Record<string, unknown>).is_anonymous).toBe(true);
    });
  });

  // ─── Submit — error paths ────────────────────────────────────────────────────

  it('shows server error message from response when API returns success:false with error', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: false, error: 'Already rated' });

    render(<RatingModal {...DEFAULT_PROPS} />);
    fireEvent.click(getStar(2));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /submit rating/i })
      ).not.toHaveAttribute('data-disabled', 'true');
    });
    fireEvent.click(screen.getByRole('button', { name: /submit rating/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Already rated');
    });
  });

  it('shows generic error toast when API response has no error field', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ success: false });

    render(<RatingModal {...DEFAULT_PROPS} />);
    fireEvent.click(getStar(1));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /submit rating/i })
      ).not.toHaveAttribute('data-disabled', 'true');
    });
    fireEvent.click(screen.getByRole('button', { name: /submit rating/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("We couldn't send your rating");
    });
  });

  it('shows error toast when API throws a network error', async () => {
    vi.mocked(api.post).mockRejectedValueOnce(new Error('Network error'));

    render(<RatingModal {...DEFAULT_PROPS} />);
    fireEvent.click(getStar(3));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /submit rating/i })
      ).not.toHaveAttribute('data-disabled', 'true');
    });
    fireEvent.click(screen.getByRole('button', { name: /submit rating/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("We couldn't send your rating");
    });
  });

  it('does not call onSuccess on API failure', async () => {
    const onSuccess = vi.fn();
    vi.mocked(api.post).mockResolvedValueOnce({ success: false });

    render(<RatingModal {...DEFAULT_PROPS} onSuccess={onSuccess} />);
    fireEvent.click(getStar(1));
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /submit rating/i })
      ).not.toHaveAttribute('data-disabled', 'true');
    });
    fireEvent.click(screen.getByRole('button', { name: /submit rating/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  // ─── Close ───────────────────────────────────────────────────────────────────

  it('calls onClose when Cancel is pressed', () => {
    const onClose = vi.fn();
    render(<RatingModal {...DEFAULT_PROPS} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
