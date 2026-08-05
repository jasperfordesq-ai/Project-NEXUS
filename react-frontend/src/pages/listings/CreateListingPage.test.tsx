// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for CreateListingPage
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

// vi.hoisted so the react-router-dom factory (which runs as soon as
// @/test/test-utils imports react-router-dom) can reference these without a
// temporal-dead-zone crash.
const { mockNavigate, mockUseParams } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseParams: vi.fn(() => ({ id: undefined as string | undefined })),
}));

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
}));
import { api } from '@/lib/api';
import { useToast, useTenant } from '@/contexts';

vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    listingConfig: {
      'listing.min_title_length': 5,
      'listing.min_description_length': 20,
      'listing.require_category': true,
      'listing.require_hours_estimate': false,
    },
  })),
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
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
}));

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() })),
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  resolveAssetUrl: vi.fn((url) => url || null),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  resolveThumbnailUrl: vi.fn((url) => url || ''),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useParams: () => mockUseParams(),
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/lib/motion', async () => {
  const { framerMotionMock } = await import('@/test/mocks');
  return framerMotionMock;
});

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/components/navigation', () => ({
  Breadcrumbs: ({ items }: { items: { label: string }[] }) => (
    <nav aria-label="breadcrumb">{items.map((i) => <span key={i.label}>{i.label}</span>)}</nav>
  ),
}));

vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message: string }) => <div data-testid="loading-screen">{message}</div>,
}));

vi.mock('@/components/location', () => ({
  PlaceAutocompleteInput: ({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) => (
    <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

import { CreateListingPage } from './CreateListingPage';

const mockCategories = [
  { id: 1, name: 'Technology', type: 'listing' },
  { id: 2, name: 'Gardening', type: 'listing' },
];

describe('CreateListingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ id: undefined });
    vi.mocked(api.get).mockResolvedValue({ success: true, data: mockCategories });
    vi.mocked(api.post).mockResolvedValue({ success: true, data: { id: 42 } });
    vi.mocked(api.put).mockResolvedValue({ success: true });
  });

  it('renders create listing form heading', async () => {
    render(<CreateListingPage />);
    await waitFor(() => {
      expect(screen.getAllByText(/Create New Listing/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders offer and request radio options', async () => {
    render(<CreateListingPage />);
    await waitFor(() => {
      expect(screen.getAllByText('Offer Help').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Request Help').length).toBeGreaterThan(0);
    });
  });

  it('shows create form (not edit mode) with no id param', async () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {})); // never resolves
    render(<CreateListingPage />);
    // In create mode (no id), the form renders immediately (no loading screen)
    // The heading should be present
    expect(screen.queryByTestId('loading-screen')).not.toBeInTheDocument();
  });

  it('shows validation errors on empty submit', async () => {
    const { container } = render(<CreateListingPage />);
    await waitFor(() => screen.getByText(/Create New Listing/i));

    // The generic Button stub forces type="button", so submit the <form>
    // directly to exercise the real handleSubmit/validateForm path. The Input
    // stub does not render the `errorMessage` prop, so we assert the
    // behavioural consequence of validation failing on empty fields: the
    // create endpoint is never called.
    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  it('shows description validation error when too short', async () => {
    const { container } = render(<CreateListingPage />);
    await waitFor(() => screen.getByText(/Create New Listing/i));

    // Fill title (>=5 chars) — the Input stub forwards `placeholder`, not the
    // floating `label`, so query by placeholder. Leave description empty.
    const titleInput = screen.getByPlaceholderText(/grocery shopping/i);
    fireEvent.change(titleInput, { target: { value: 'Valid title here' } });

    // With a valid title but empty description, validation still fails so the
    // create endpoint must not be called.
    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(api.post).not.toHaveBeenCalled();
    });
  });

  it('renders cancel button linking to listings', async () => {
    render(<CreateListingPage />);
    await waitFor(() => {
      expect(screen.getByText('Cancel')).toBeInTheDocument();
    });
  });

  it('renders image upload area', async () => {
    render(<CreateListingPage />);
    await waitFor(() => {
      expect(screen.getByText('Click to add a photo')).toBeInTheDocument();
    });
  });

  it('fires only ONE create request when the form is submitted twice in rapid succession', async () => {
    // Regression: same double-submit class as CreateGroupPage. The submit button is
    // not natively disabled while a request is in flight, so a double-Enter /
    // double-click submitted the native form twice and created duplicate listings.
    // A synchronous useRef re-entry guard now blocks the second submit. The sibling
    // group form was live-verified (two POSTs → one); this guards the identical fix
    // on the listing form.
    //
    // The file-default useTenant mock sets 'listing.require_category': true, but
    // this test never selects a category (the real Autocomplete can't be driven
    // from jsdom), so validation blocked the submit and api.post was never
    // called. Relax the category requirement so the submit reaches the API and
    // the double-submit guard is actually exercised.
    vi.mocked(useTenant).mockReturnValue({
      tenant: { id: 2, slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
      listingConfig: {
        'listing.min_title_length': 5,
        'listing.min_description_length': 20,
        'listing.require_category': false,
        'listing.require_hours_estimate': false,
      },
    });
    let resolvePost: (v: { success: boolean; data: { id: number } }) => void = () => {};
    vi.mocked(api.post).mockReturnValue(new Promise((resolve) => { resolvePost = resolve; }));

    const { container } = render(<CreateListingPage />);
    await waitFor(() => screen.getByText(/Create New Listing/i));

    fireEvent.change(
      screen.getByPlaceholderText(/grocery shopping/i),
      { target: { value: 'Valid listing title' } },
    );
    fireEvent.change(
      container.querySelector('textarea') as HTMLTextAreaElement,
      { target: { value: 'A listing description long enough to pass validation.' } },
    );

    const form = container.querySelector('form') as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(api.post).toHaveBeenCalledTimes(1);

    resolvePost({ success: true, data: { id: 42 } });
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  });

  describe('submit failure handling (regression)', () => {
    // Regression: api.post/api.put resolve { success: false } on a 4xx WITHOUT
    // throwing (the global error toast only fires on 5xx), so handleSubmit must
    // check response.success itself. Before the fix, the edit path discarded the
    // api.put result entirely and the create path only read response.data —
    // both then showed the success toast and navigated away even though nothing
    // was saved, silently losing the failure (and, on create, the user's input).
    let successToast: ReturnType<typeof vi.fn>;
    let errorToast: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      successToast = vi.fn();
      errorToast = vi.fn();
      vi.mocked(useToast).mockReturnValue({
        success: successToast,
        error: errorToast,
        info: vi.fn(),
        warning: vi.fn(),
      });
      // Category optional here so a filled title + description passes
      // validation and the submit reaches the API call under test.
      vi.mocked(useTenant).mockReturnValue({
        tenant: { id: 2, slug: 'test' },
        tenantPath: (p: string) => `/test${p}`,
        hasFeature: vi.fn(() => true),
        hasModule: vi.fn(() => true),
        listingConfig: {
          'listing.min_title_length': 5,
          'listing.min_description_length': 20,
          'listing.require_category': false,
          'listing.require_hours_estimate': false,
        },
      });
    });

    function fillAndSubmitCreateForm(container: HTMLElement) {
      fireEvent.change(
        screen.getByPlaceholderText(/grocery shopping/i),
        { target: { value: 'Garden help offered locally' } },
      );
      fireEvent.change(
        container.querySelector('textarea') as HTMLTextAreaElement,
        { target: { value: 'I can help with weeding, planting and general garden maintenance.' } },
      );
      fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    }

    it('shows an error toast and does not navigate when creation fails', async () => {
      vi.mocked(api.post).mockResolvedValue({ success: false, error: 'Listing limit reached', code: 'HTTP_422' });

      const { container } = render(<CreateListingPage />);
      await waitFor(() => screen.getByText(/Create New Listing/i));
      fillAndSubmitCreateForm(container);

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/v2/listings', expect.objectContaining({
          title: 'Garden help offered locally',
        }));
      });
      await waitFor(() => {
        expect(errorToast).toHaveBeenCalledWith('Failed to save listing', 'Listing limit reached');
      });
      expect(successToast).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
      // Early return: the tags/image sub-steps must not run after a failed create
      expect(api.put).not.toHaveBeenCalled();
      // Form state is preserved so the user's input isn't lost
      expect(screen.getByDisplayValue('Garden help offered locally')).toBeInTheDocument();
    });

    it('shows per-field server validation messages on the fields themselves', async () => {
      // TBUK J-05: the API reports validation failures as
      // {errors: [{code, message, field}]} but the form used to discard them and
      // show only a generic toast, so the member was told the save failed and
      // never which field was wrong.
      vi.mocked(api.post).mockResolvedValue({
        success: false,
        code: 'VALIDATION_ERROR',
        error: 'Validation failed',
        errors: [
          { code: 'VALIDATION_ERROR', message: 'Title must be at least 5 characters.', field: 'title' },
          { code: 'VALIDATION_ERROR', message: 'Estimated hours must be greater than zero.', field: 'hours_estimate' },
        ],
      });

      const { container } = render(<CreateListingPage />);
      await waitFor(() => screen.getByText(/Create New Listing/i));
      fillAndSubmitCreateForm(container);

      // Both field messages are rendered against their inputs.
      await waitFor(() => {
        expect(screen.getByText('Title must be at least 5 characters.')).toBeInTheDocument();
      });
      expect(screen.getByText('Estimated hours must be greater than zero.')).toBeInTheDocument();

      // The generic subtitle is suppressed once we have something specific to say.
      expect(errorToast).toHaveBeenCalledWith('Failed to save listing', undefined);
      expect(successToast).not.toHaveBeenCalled();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('puts server errors with no recognised field into the toast', async () => {
      vi.mocked(api.post).mockResolvedValue({
        success: false,
        errors: [{ code: 'VALIDATION_ERROR', message: 'Something global went wrong.' }],
      });

      const { container } = render(<CreateListingPage />);
      await waitFor(() => screen.getByText(/Create New Listing/i));
      fillAndSubmitCreateForm(container);

      await waitFor(() => {
        expect(errorToast).toHaveBeenCalledWith('Failed to save listing', 'Something global went wrong.');
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('falls back to the translated error subtitle when the API returns no error detail', async () => {
      vi.mocked(api.post).mockResolvedValue({ success: false });

      const { container } = render(<CreateListingPage />);
      await waitFor(() => screen.getByText(/Create New Listing/i));
      fillAndSubmitCreateForm(container);

      await waitFor(() => {
        expect(errorToast).toHaveBeenCalledWith(
          'Failed to save listing',
          'Please check your information and try again.',
        );
      });
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('still shows the success toast and navigates when creation succeeds', async () => {
      const { container } = render(<CreateListingPage />);
      await waitFor(() => screen.getByText(/Create New Listing/i));
      fillAndSubmitCreateForm(container);

      await waitFor(() => {
        expect(successToast).toHaveBeenCalledWith('Listing created successfully');
      });
      expect(mockNavigate).toHaveBeenCalledWith('/test/listings/42');
      expect(errorToast).not.toHaveBeenCalled();
    });

    describe('edit mode', () => {
      const existingListing = {
        id: 42,
        title: 'Existing listing title',
        description: 'A perfectly valid existing description for the listing.',
        type: 'offer',
        service_type: 'hybrid',
        category_id: null,
        hours_estimate: 2,
        skill_tags: [],
        image_url: null,
      };

      beforeEach(() => {
        mockUseParams.mockReturnValue({ id: '42' });
        vi.mocked(api.get).mockImplementation((url: string) => {
          if (url.includes('/v2/listings/42')) {
            return Promise.resolve({ success: true, data: existingListing });
          }
          return Promise.resolve({ success: true, data: mockCategories });
        });
      });

      it('shows an error toast and does not navigate when the update fails', async () => {
        vi.mocked(api.put).mockResolvedValue({ success: false, error: 'You cannot edit this listing', code: 'HTTP_403' });

        const { container } = render(<CreateListingPage />);
        await waitFor(() => {
          expect(screen.getByDisplayValue('Existing listing title')).toBeInTheDocument();
        });

        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
          expect(api.put).toHaveBeenCalledWith('/v2/listings/42', expect.objectContaining({
            title: 'Existing listing title',
          }));
        });
        await waitFor(() => {
          expect(errorToast).toHaveBeenCalledWith('Failed to save listing', 'You cannot edit this listing');
        });
        expect(successToast).not.toHaveBeenCalled();
        expect(mockNavigate).not.toHaveBeenCalled();
        // Early return: the tags PUT never fires after a failed update
        expect(api.put).toHaveBeenCalledTimes(1);
        // Form state (the user's edits) is preserved
        expect(screen.getByDisplayValue('Existing listing title')).toBeInTheDocument();
      });

      it('still shows the success toast and navigates when the update succeeds', async () => {
        const { container } = render(<CreateListingPage />);
        await waitFor(() => {
          expect(screen.getByDisplayValue('Existing listing title')).toBeInTheDocument();
        });

        fireEvent.submit(container.querySelector('form') as HTMLFormElement);

        await waitFor(() => {
          expect(successToast).toHaveBeenCalledWith('Listing updated successfully');
        });
        expect(mockNavigate).toHaveBeenCalledWith('/test/listings/42');
        expect(errorToast).not.toHaveBeenCalled();
      });

      it('does not place an active API-provided image scheme in the DOM', async () => {
        vi.mocked(api.get).mockImplementation((url: string) => {
          if (url.includes('/v2/listings/42')) {
            return Promise.resolve({
              success: true,
              data: { ...existingListing, image_url: 'javascript:alert(document.domain)' },
            });
          }
          return Promise.resolve({ success: true, data: mockCategories });
        });

        const { container } = render(<CreateListingPage />);
        await waitFor(() => {
          expect(screen.getByDisplayValue('Existing listing title')).toBeInTheDocument();
        });

        expect(container.querySelector('img[src^="javascript:"]')).toBeNull();
        expect(screen.getByText('Click to add a photo')).toBeInTheDocument();
      });
    });
  });
});
