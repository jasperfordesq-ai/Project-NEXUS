// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Service delivery" on the offer/request form (B1 walk 6.6, 13 Nov 2026).
 *
 * The two-column grid used to be the radio group's own class, so the group's
 * label became the first grid cell: one choice sat alone top-right and one
 * alone at the bottom. The grid must hold the four choices and nothing else.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@/test/test-utils';
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

describe('ListingForm — service delivery choices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.get.mockResolvedValue({ success: true, data: [] });
  });

  it('lays the four choices out in their own grid, with the label above it', async () => {
    render(<ListingForm variant="page" />);

    const group = await screen.findByRole('radiogroup', { name: /where it can happen/i });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(4);

    // Exactly one element carries the two-column grid, and every child of it is a choice.
    const grids = [...group.querySelectorAll('*'), group].filter((el) =>
      (el.getAttribute('class') || '').split(/\s+/).includes('sm:grid-cols-2'),
    );
    expect(grids).toHaveLength(1);
    const grid = grids[0] as Element;
    expect(grid).not.toBe(group);
    expect(grid.children).toHaveLength(4);
    for (const child of Array.from(grid.children)) {
      expect(child.querySelector('input[type="radio"]')).not.toBeNull();
    }
  });
});
