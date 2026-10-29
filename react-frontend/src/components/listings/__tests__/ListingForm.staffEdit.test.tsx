// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Staff (admin, broker, coordinator) editing a member's listing.
 *
 * The form fills a listing's place from the SIGNED-IN person's profile. For an
 * owner that is the intended behaviour; for staff it would publish the
 * editor's own address on the member's listing. When the listing belongs to
 * someone else, the form must show the listing's own place and send none of
 * the editor's.
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

function listingOwnedBy(userId: number) {
  return {
    id: 7,
    user_id: userId,
    title: 'Weekly grocery shopping run',
    description: 'A detailed description of the service being offered here.',
    type: 'offer',
    service_type: 'hybrid',
    hours_estimate: 1,
    location: 'Member Town',
    image_url: null,
  };
}

function serveListing(userId: number): void {
  mockApi.get.mockImplementation((url: string) =>
    Promise.resolve(
      url === '/v2/listings/7'
        ? { success: true, data: listingOwnedBy(userId) }
        : { success: true, data: [] },
    ),
  );
}

async function saveAndReadPayload(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(screen.getByLabelText(/^title/i)).toHaveValue('Weekly grocery shopping run'));
  fireEvent.click(screen.getByRole('button', { name: 'Update Listing' }));
  await waitFor(() => expect(mockApi.put).toHaveBeenCalled());
  return (mockApi.put.mock.calls[0]?.[1] ?? {}) as Record<string, unknown>;
}

describe('ListingForm — staff editing a member\'s listing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.put.mockResolvedValue({ success: true, data: {} });
  });

  it('shows the member\'s place and sends none of the editor\'s own', async () => {
    serveListing(42);
    render(<ListingForm variant="page" listingId="7" />);

    const payload = await saveAndReadPayload();

    expect(mockApi.put.mock.calls[0]?.[0]).toBe('/v2/listings/7');
    expect(payload.location).toBe('Member Town');
    expect(payload.latitude).toBeUndefined();
    expect(payload.longitude).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('Editor Street');
    expect(screen.queryByText('From your profile — update in Settings')).not.toBeInTheDocument();
  });

  it('still takes the owner\'s own profile place when the owner edits', async () => {
    serveListing(1);
    render(<ListingForm variant="page" listingId="7" />);

    const payload = await saveAndReadPayload();

    expect(payload.location).toBe('Editor Street');
    expect(payload.latitude).toBe(53.33);
    expect(payload.longitude).toBe(-6.26);
  });
});
