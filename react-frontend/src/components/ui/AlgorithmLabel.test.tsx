// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── API mock ─────────────────────────────────────────────────────────────────
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

// ─── Contexts ─────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts());

// ─── Stub Chip and Tooltip to keep jsdom simple ───────────────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Chip: ({ children, className }: { children: React.ReactNode; className?: string }) => (
      <span data-testid="chip" className={className}>{children}</span>
    ),
    Tooltip: ({ children, content }: { children: React.ReactNode; content?: string }) => (
      <div data-testid="tooltip" data-content={content}>{children}</div>
    ),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
/**
 * The module caches data at module scope (`cachedData` / `fetchPromise`).
 * We must re-import fresh after each test to bust the cache.
 */
async function importFresh() {
  // Force Vitest to drop the cached module so the module-level vars reset
  vi.resetModules();
  const mod = await import('./AlgorithmLabel');
  return mod;
}

const makeAlgorithmsResponse = (overrides = {}) => ({
  success: true,
  data: {
    feed: { name: 'Smart Feed', key: 'smart_relevance', description: 'Personalised feed algorithm' },
    listings: { name: 'Trending', key: 'trending', description: 'Trending listings' },
    members: { name: 'Newest', key: 'newest', description: 'Newest members first' },
    matching: { name: 'Match Score', key: 'match_score', description: 'Best match for you' },
    ...overrides,
  },
});

// ─────────────────────────────────────────────────────────────────────────────
describe('AlgorithmLabel', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders nothing while the API call is in-flight', async () => {
    mockApi.get.mockImplementationOnce(() => new Promise(() => {})); // never resolves
    const { AlgorithmLabel } = await importFresh();
    render(<AlgorithmLabel area="feed" />);
    // Should be empty — info is undefined (loading); no chip is mounted
    expect(screen.queryByTestId('chip')).not.toBeInTheDocument();
  });

  it('renders nothing when the API returns a default key (chronological)', async () => {
    mockApi.get.mockResolvedValueOnce({
      ...makeAlgorithmsResponse(),
      data: {
        ...makeAlgorithmsResponse().data,
        feed: { name: 'Chronological', key: 'chronological', description: 'Time order' },
      },
    });
    const { AlgorithmLabel } = await importFresh();
    render(<AlgorithmLabel area="feed" />);
    await waitFor(() => {
      // API resolved but key is a default — component returns null, no chip rendered
      expect(screen.queryByTestId('chip')).not.toBeInTheDocument();
    });
  });

  it('renders nothing for the "newest" default key', async () => {
    mockApi.get.mockResolvedValueOnce({
      ...makeAlgorithmsResponse(),
      data: {
        ...makeAlgorithmsResponse().data,
        listings: { name: 'Newest', key: 'newest', description: 'Newest first' },
      },
    });
    const { AlgorithmLabel } = await importFresh();
    render(<AlgorithmLabel area="listings" />);
    await waitFor(() => {
      expect(screen.queryByTestId('chip')).not.toBeInTheDocument();
    });
  });

  it('says "Sorted for you" in plain words, not the technical name of the method', async () => {
    mockApi.get.mockResolvedValueOnce(makeAlgorithmsResponse());
    const { AlgorithmLabel } = await importFresh();
    render(<AlgorithmLabel area="feed" />);
    await waitFor(() => {
      expect(screen.getByTestId('chip')).toBeInTheDocument();
      expect(screen.getByText('Sorted for you')).toBeInTheDocument();
    });
    expect(screen.queryByText('Smart Feed')).toBeNull();
  });

  it('opens a popover with the algorithm description on press (touch-reachable)', async () => {
    mockApi.get.mockResolvedValueOnce(makeAlgorithmsResponse());
    const { AlgorithmLabel } = await importFresh();
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<AlgorithmLabel area="feed" />);
    const trigger = await screen.findByRole('button', { name: 'How this is sorted' });
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByText('Personalised feed algorithm')).toBeInTheDocument();
    });
    // The method's own name is still there for anyone who wants it.
    expect(screen.getByText('Method: Smart Feed')).toBeInTheDocument();
  });

  it('shows only its icon when compact (the phone feed bar), and still explains itself on press', async () => {
    mockApi.get.mockResolvedValueOnce(makeAlgorithmsResponse());
    const { AlgorithmLabel } = await importFresh();
    const user = (await import('@testing-library/user-event')).default.setup();
    render(<AlgorithmLabel area="feed" compact />);
    // Still named for screen readers, but no visible words to crowd the bar.
    const trigger = await screen.findByRole('button', { name: 'How this is sorted' });
    expect(screen.queryByText('Sorted for you')).toBeNull();
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByText('Personalised feed algorithm')).toBeInTheDocument();
    });
  });

  it('renders the matching algorithm chip for the "matching" area', async () => {
    mockApi.get.mockResolvedValueOnce(makeAlgorithmsResponse());
    const { AlgorithmLabel } = await importFresh();
    render(<AlgorithmLabel area="matching" />);
    await waitFor(() => {
      expect(screen.getByText('Sorted for you')).toBeInTheDocument();
    });
  });

  it('renders nothing when the API call fails', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('network error'));
    const { AlgorithmLabel } = await importFresh();
    render(<AlgorithmLabel area="feed" />);
    await waitFor(() => {
      expect(screen.queryByTestId('chip')).not.toBeInTheDocument();
    });
  });

  it('renders nothing when API returns success:false', async () => {
    mockApi.get.mockResolvedValueOnce({ success: false, data: null });
    const { AlgorithmLabel } = await importFresh();
    render(<AlgorithmLabel area="listings" />);
    await waitFor(() => {
      expect(screen.queryByTestId('chip')).not.toBeInTheDocument();
    });
  });

  it('calls the algorithms endpoint', async () => {
    mockApi.get.mockResolvedValueOnce(makeAlgorithmsResponse());
    const { AlgorithmLabel } = await importFresh();
    render(<AlgorithmLabel area="feed" />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/config/algorithms');
    });
  });

  it('renders the listings algorithm chip for the "listings" area', async () => {
    mockApi.get.mockResolvedValueOnce(makeAlgorithmsResponse());
    const { AlgorithmLabel } = await importFresh();
    render(<AlgorithmLabel area="listings" />);
    await waitFor(() => {
      expect(screen.getByText('Sorted for you')).toBeInTheDocument();
    });
  });

  it('renders nothing for the "alphabetical" default key', async () => {
    mockApi.get.mockResolvedValueOnce({
      ...makeAlgorithmsResponse(),
      data: {
        ...makeAlgorithmsResponse().data,
        members: { name: 'Alphabetical', key: 'alphabetical', description: 'A-Z' },
      },
    });
    const { AlgorithmLabel } = await importFresh();
    render(<AlgorithmLabel area="members" />);
    await waitFor(() => {
      expect(screen.queryByTestId('chip')).not.toBeInTheDocument();
    });
  });
});
