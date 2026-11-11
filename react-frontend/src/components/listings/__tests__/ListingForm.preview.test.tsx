// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Warmth plan B6 (11 Nov 2026): the create form shows a live picture of the
 * finished card beside it, coloured section headings, and a nudge to add a
 * photo. First name only on the card (E-122).
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
vi.mock('@/lib/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/helpers')>()),
  resolveThumbnailUrl: vi.fn((url: string | undefined) => url || ''),
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

// The signed-in member: the card must show only the first name.
vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Grace Okafor', first_name: 'Grace', location: 'Editor Street', latitude: 53.33, longitude: -6.26 },
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

describe('ListingForm — live preview (B6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: [] });
  });

  it('draws the card from what the member types, with their first name only', async () => {
    render(<ListingForm variant="page" />);
    const preview = await screen.findByTestId('listing-preview');
    expect(preview).toHaveTextContent('How your offer will look');
    expect(preview).toHaveTextContent('Your title will appear here');

    fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: 'Bike repairs on Saturdays' } });
    await waitFor(() => expect(preview).toHaveTextContent('Bike repairs on Saturdays'));
    expect(preview).toHaveTextContent('Grace');
    expect(preview).not.toHaveTextContent('Okafor');
  });

  it('invites a photo while there is none', async () => {
    render(<ListingForm variant="page" />);
    expect(await screen.findByTestId('listing-preview-photo-nudge')).toBeInTheDocument();
    expect(screen.getByTestId('listing-preview-cover')).toBeInTheDocument();
  });

  it('gives every section a coloured icon, and shows no preview in the sheet', async () => {
    const { unmount } = render(<ListingForm variant="page" />);
    await screen.findByTestId('listing-preview');
    expect(screen.getAllByTestId('form-section-icon').length).toBeGreaterThanOrEqual(5);
    unmount();

    render(<ListingForm variant="sheet" />);
    await waitFor(() => expect(screen.getAllByTestId('form-section-icon').length).toBeGreaterThanOrEqual(5));
    expect(screen.queryByTestId('listing-preview')).not.toBeInTheDocument();
  });
});
