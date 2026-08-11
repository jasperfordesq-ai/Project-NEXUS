// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The total-hours cap on a listing ("Hours available").
 *
 * `hours_estimate` is how long ONE exchange takes; `hours_available` is the
 * total the member is willing to give. Blank means no cap.
 *
 * The trap this file exists to pin: an emptied number field arrives as an empty
 * string, and the API's decimal cast would turn that into 0 — making the listing
 * read as "no hours left" rather than "no limit". The form must send null.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
// Partial mock: keep every real helper, replace one. See the helpers
// partial-mock convention — spreading the original is required, or unrelated
// helpers silently become undefined.
vi.mock('@/lib/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/helpers')>()),
  resolveThumbnailUrl: vi.fn((url: string | undefined) => url || ''),
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

// createMockContexts infers its override type from defaults where `user` is
// null, so a signed-in override needs one cast for the whole object rather than
// a sprinkle of `any` inside it.
vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Test User', location: 'Dublin', latitude: 53.33, longitude: -6.26 },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
      listingConfig: {
        'listing.min_title_length': 5,
        'listing.min_description_length': 20,
        'listing.require_category': false,
        'listing.require_hours_estimate': false,
      },
    }),
  } as unknown as Parameters<typeof createMockContexts>[0])
);

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
  useDraftPersistence: vi.fn(() => [{ title: '', description: '', type: 'offer' as const }, vi.fn(), vi.fn()]),
  useMediaQuery: vi.fn(() => false),
}));
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: vi.fn(() => false) }));

vi.mock('@/components/listings/SkillTagsInput', () => ({
  SkillTagsInput: () => <div data-testid="skill-tags-input" />,
}));
vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message: string }) => <div data-testid="loading-screen">{message}</div>,
}));

import { ListingForm } from '../ListingForm';

/** The cap input, found by its accessible label rather than by position. */
function capInput(): HTMLInputElement {
  return screen.getByLabelText(/hours available/i) as HTMLInputElement;
}

function fillRequired(): void {
  fireEvent.change(screen.getByLabelText(/^title/i), {
    target: { value: 'Weekly grocery shopping run' },
  });
  fireEvent.change(screen.getByLabelText(/^description/i), {
    target: { value: 'A detailed description of the service being offered here.' },
  });
}

describe('ListingForm — hours available (total cap)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: [] });
    mockApi.post.mockResolvedValue({ success: true, data: { id: 99 } });
  });

  it('renders the cap field, empty, alongside the per-exchange estimate', async () => {
    render(<ListingForm variant="page" />);

    await waitFor(() => expect(capInput()).toBeInTheDocument());

    // Blank by default — a listing with no cap is the normal case.
    expect(capInput().value).toBe('');
    // And it is a separate field from the duration, not a replacement for it.
    expect(screen.getByLabelText(/estimated hours/i)).toBeInTheDocument();
  });

  it('explains that blank means no limit', async () => {
    render(<ListingForm variant="page" />);

    await waitFor(() => expect(capInput()).toBeInTheDocument());
    expect(screen.getByText(/leave blank for no limit/i)).toBeInTheDocument();
  });

  it('sends null — not 0 or an empty string — when left blank', async () => {
    render(<ListingForm variant="page" />);
    await waitFor(() => expect(capInput()).toBeInTheDocument());

    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: /create|publish|save/i }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled());

    const payload = (mockApi.post.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(payload.hours_available).toBeNull();
  });

  it('sends the number when a cap is entered', async () => {
    render(<ListingForm variant="page" />);
    await waitFor(() => expect(capInput()).toBeInTheDocument());

    fillRequired();
    fireEvent.change(capInput(), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: /create|publish|save/i }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalled());

    const payload = (mockApi.post.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
    expect(payload.hours_available).toBe(20);
  });

  it('refuses a cap smaller than one exchange, and does not submit', async () => {
    render(<ListingForm variant="page" />);
    await waitFor(() => expect(capInput()).toBeInTheDocument());

    fillRequired();
    // Default estimate is 1 hour; a 0.5-hour total could never be booked.
    fireEvent.change(capInput(), { target: { value: '0.5' } });
    fireEvent.click(screen.getByRole('button', { name: /create|publish|save/i }));

    await waitFor(() =>
      expect(screen.getByText(/cannot be less than the estimated hours/i)).toBeInTheDocument()
    );
    expect(mockApi.post).not.toHaveBeenCalled();
  });
});
