// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
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

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAssetUrl: (url: string) => url,
  resolveAvatarUrl: (url: string) => url,
  resolveThumbnailUrl: (url: string) => url,
}));

// ─── Contexts ────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Test User' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

// ─── Stub HeroUI components ───────────────────────────────────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<Record<string, unknown>>();
  return {
    ...orig,
    Chip: ({ children, size, variant, color }: {
      children: React.ReactNode;
      size?: string;
      variant?: string;
      color?: string;
    }) => (
      <span data-testid="chip" data-color={color}>{children}</span>
    ),
    Skeleton: ({ className }: { className?: string }) => (
      <div data-testid="skeleton" className={className} />
    ),
  };
});

// ─── Fixtures ────────────────────────────────────────────────────────────────
function makeListingResponse(overrides = {}) {
  return {
    success: true,
    data: {
      title: 'Piano Lessons',
      image_url: null,
      status: 'active',
      ...overrides,
    },
  };
}

function makeEventResponse(overrides = {}) {
  return {
    success: true,
    data: {
      title: 'Community Meeting',
      cover_image: null,
      status: 'upcoming',
      ...overrides,
    },
  };
}

function makeJobResponse(overrides = {}) {
  return {
    success: true,
    data: {
      title: 'Gardening Help',
      thumbnail: null,
      status: 'open',
      ...overrides,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
describe('MessageContextCard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('shows skeletons while loading', async () => {
    mockApi.get.mockReturnValue(new Promise(() => {})); // never resolves
    const { MessageContextCard } = await import('./MessageContextCard');
    render(<MessageContextCard contextType="listing" contextId={1} />);

    const skeletons = screen.getAllByTestId('skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('renders listing context card with title', async () => {
    mockApi.get.mockResolvedValue(makeListingResponse());
    const { MessageContextCard } = await import('./MessageContextCard');
    render(<MessageContextCard contextType="listing" contextId={7} />);

    await waitFor(() => {
      expect(screen.getByText('Piano Lessons')).toBeInTheDocument();
    });
  });

  it('calls correct listing API endpoint', async () => {
    mockApi.get.mockResolvedValue(makeListingResponse());
    const { MessageContextCard } = await import('./MessageContextCard');
    render(<MessageContextCard contextType="listing" contextId={7} />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/listings/7');
    });
  });

  it('renders event context card with correct API path', async () => {
    mockApi.get.mockResolvedValue(makeEventResponse());
    const { MessageContextCard } = await import('./MessageContextCard');
    render(<MessageContextCard contextType="event" contextId={42} />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/events/42');
      expect(screen.getByText('Community Meeting')).toBeInTheDocument();
    });
  });

  it('renders job context card with correct API path', async () => {
    mockApi.get.mockResolvedValue(makeJobResponse());
    const { MessageContextCard } = await import('./MessageContextCard');
    render(<MessageContextCard contextType="job" contextId={99} />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/jobs/99');
      expect(screen.getByText('Gardening Help')).toBeInTheDocument();
    });
  });

  it('renders volunteering context card with correct API path', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: { name: 'Beach Cleanup', thumbnail: null },
    });
    const { MessageContextCard } = await import('./MessageContextCard');
    render(<MessageContextCard contextType="volunteering" contextId={5} />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/volunteering/opportunities/5');
      expect(screen.getByText('Beach Cleanup')).toBeInTheDocument();
    });
  });

  it('returns null for unknown context type', async () => {
    const { MessageContextCard } = await import('./MessageContextCard');
    render(<MessageContextCard contextType="unknown_type" contextId={1} />);

    // Should render nothing meaningful — no link, no skeleton, no chip
    await waitFor(() => {
      expect(mockApi.get).not.toHaveBeenCalled();
    });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chip')).not.toBeInTheDocument();
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
  });

  it('shows fallback title when API fails', async () => {
    mockApi.get.mockRejectedValue(new Error('Network failure'));
    const { MessageContextCard } = await import('./MessageContextCard');
    render(<MessageContextCard contextType="listing" contextId={3} />);

    await waitFor(() => {
      // Fallback: "Listing #3"
      expect(screen.getByText(/Listing #3/i)).toBeInTheDocument();
    });
  });

  it('shows type chip for listing', async () => {
    mockApi.get.mockResolvedValue(makeListingResponse());
    const { MessageContextCard } = await import('./MessageContextCard');
    render(<MessageContextCard contextType="listing" contextId={1} />);

    await waitFor(() => {
      const chip = screen.getByTestId('chip');
      expect(chip).toBeInTheDocument();
      // chip color should be accent for listing
      expect(chip).toHaveAttribute('data-color', 'accent');
    });
  });

  // The tile's colour was built at runtime (`bg-${color}/10`), which Tailwind
  // cannot find, so it never had one; events were grey. Each kind now has the
  // colour it has in the feed, written out in full.
  it('colours the picture tile like that kind of post in the feed', async () => {
    mockApi.get.mockResolvedValue(makeEventResponse());
    const { MessageContextCard } = await import('./MessageContextCard');
    render(<MessageContextCard contextType="event" contextId={42} />);

    const tile = await screen.findByTestId('message-context-tile');
    expect(tile.className).toContain('bg-emerald-100');
    expect(tile.className).not.toMatch(/bg-(accent|default|warning|danger)\/10/);
    expect(screen.getByTestId('chip')).toHaveAttribute('data-color', 'success');
  });

  it('renders image when image_url is provided', async () => {
    mockApi.get.mockResolvedValue(makeListingResponse({ image_url: 'https://example.com/img.jpg' }));
    const { MessageContextCard } = await import('./MessageContextCard');
    render(<MessageContextCard contextType="listing" contextId={1} />);

    await waitFor(() => {
      const img = screen.getByRole('img');
      expect(img).toHaveAttribute('src', 'https://example.com/img.jpg');
      expect(img).toHaveAttribute('alt', 'Piano Lessons');
    });
  });

  it('renders as a link pointing to correct tenant path', async () => {
    mockApi.get.mockResolvedValue(makeListingResponse());
    const { MessageContextCard } = await import('./MessageContextCard');
    render(<MessageContextCard contextType="listing" contextId={7} />);

    await waitFor(() => {
      const link = screen.getByRole('link');
      expect(link).toHaveAttribute('href', '/test/listings/7');
    });
  });

  it('hides skeletons and shows content after load completes', async () => {
    mockApi.get.mockResolvedValue(makeListingResponse());
    const { MessageContextCard } = await import('./MessageContextCard');
    render(<MessageContextCard contextType="listing" contextId={1} />);

    await waitFor(() => {
      expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
      expect(screen.getByText('Piano Lessons')).toBeInTheDocument();
    });
  });

  it('renders nothing after load when success is false', async () => {
    mockApi.get.mockResolvedValue({ success: false, data: null });
    const { MessageContextCard } = await import('./MessageContextCard');
    render(<MessageContextCard contextType="listing" contextId={1} />);

    await waitFor(() => {
      // no skeletons after loading completes
      expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    });
    // context is null so no link or content card renders
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chip')).not.toBeInTheDocument();
  });
});
