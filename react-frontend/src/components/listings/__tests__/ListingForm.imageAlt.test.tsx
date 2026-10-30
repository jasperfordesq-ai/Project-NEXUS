// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Regression (AWID pilot, Oct 2026): a listing photo had no way to carry a
 * description for screen-reader users. The form now offers a "describe this
 * photo" box whenever a photo is shown, and sends it as `image_alt`.
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

// The signed-in editor (id 1) lives in "Editor Street".
vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Staff Editor', location: 'Editor Street', latitude: 53.33, longitude: -6.26 },
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

function serveListing(image: { url: string | null; alt: string | null }): void {
  mockApi.get.mockImplementation((url: string) =>
    Promise.resolve(
      url === '/v2/listings/7'
        ? {
            success: true,
            data: {
              id: 7,
              user_id: 1,
              title: 'Weekly grocery shopping run',
              description: 'A detailed description of the service being offered here.',
              type: 'offer',
              service_type: 'hybrid',
              hours_estimate: 1,
              location: 'Member Town',
              image_url: image.url,
              image_alt: image.alt,
            },
          }
        : { success: true, data: [] },
    ),
  );
}

async function save(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByRole('button', { name: 'Update Listing' }));
  await waitFor(() => expect(mockApi.put).toHaveBeenCalled());
  return (mockApi.put.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
}

describe('ListingForm — photo description (alt text)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.put.mockResolvedValue({ success: true, data: {} });
  });

  it('shows the saved description and sends an edited one as image_alt', async () => {
    serveListing({ url: '/uploads/listings/photo.jpg', alt: 'Old words' });
    render(<ListingForm variant="page" listingId="7" />);

    const box = await screen.findByLabelText(/describe this photo/i);
    await waitFor(() => expect(box).toHaveValue('Old words'));
    fireEvent.change(box, { target: { value: 'Two women talking in a community kitchen' } });

    const payload = await save();
    expect(payload.image_alt).toBe('Two women talking in a community kitchen');
  });

  it('uses the description as the preview image alt', async () => {
    serveListing({ url: '/uploads/listings/photo.jpg', alt: 'A red bicycle' });
    render(<ListingForm variant="page" listingId="7" />);

    expect(await screen.findByAltText('A red bicycle')).toBeInTheDocument();
  });

  it('offers no description box and sends no description when there is no photo', async () => {
    serveListing({ url: null, alt: null });
    render(<ListingForm variant="page" listingId="7" />);

    await waitFor(() => expect(screen.getByLabelText(/^title/i)).toHaveValue('Weekly grocery shopping run'));
    expect(screen.queryByLabelText(/describe this photo/i)).not.toBeInTheDocument();

    const payload = await save();
    expect(payload.image_alt).toBeNull();
  });
});
