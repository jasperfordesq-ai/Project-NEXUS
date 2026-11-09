// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for AlgorithmLabel component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
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

// Reset module-level cache before each test by reimporting
const mockAlgorithmsResponse = {
  feed: { name: 'SmartFeed', key: 'smart_feed', description: 'Personalised feed algorithm' },
  listings: { name: 'Relevance', key: 'relevance', description: 'Relevance ranking' },
  members: { name: 'Proximity', key: 'proximity', description: 'Location-based suggestions' },
  matching: { name: 'ML Match', key: 'ml_match', description: 'Machine learning matching' },
};

const mockDefaultAlgorithm = {
  feed: { name: 'Chronological', key: 'chronological', description: 'Latest first' },
  listings: { name: 'Newest', key: 'newest', description: 'Newest first' },
  members: { name: 'Alphabetical', key: 'alphabetical', description: 'A-Z order' },
  matching: { name: 'Disabled', key: 'disabled', description: 'Not enabled' },
};

describe('AlgorithmLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module-level cache by re-mocking
    vi.resetModules();
  });

  it('renders nothing when API returns a default algorithm (chronological)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: mockDefaultAlgorithm,
    });

    // Re-import after resetting modules
    const { AlgorithmLabel } = await import('../AlgorithmLabel');

    const { container } = render(<AlgorithmLabel area="feed" />);
    await waitFor(() => {
      expect(container.textContent?.trim()).toBe('');
    });
  });

  it('renders a chip when a smart algorithm is active', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: mockAlgorithmsResponse,
    });

    const { AlgorithmLabel } = await import('../AlgorithmLabel');

    render(<AlgorithmLabel area="feed" />);
    await waitFor(() => {
      expect(screen.getByText('Sorted for you')).toBeInTheDocument();
    });
  });

  it('renders chip for listings area with smart algorithm', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: mockAlgorithmsResponse,
    });

    const { AlgorithmLabel } = await import('../AlgorithmLabel');

    render(<AlgorithmLabel area="listings" />);
    await waitFor(() => {
      expect(screen.getByText('Sorted for you')).toBeInTheDocument();
    });
  });

  it('renders nothing when API request fails', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));

    const { AlgorithmLabel } = await import('../AlgorithmLabel');

    const { container } = render(<AlgorithmLabel area="feed" />);
    await waitFor(() => {
      expect(container.textContent?.trim()).toBe('');
    });
  });

  it('renders nothing when API returns no data', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ success: false, data: null });

    const { AlgorithmLabel } = await import('../AlgorithmLabel');

    const { container } = render(<AlgorithmLabel area="feed" />);
    await waitFor(() => {
      expect(container.textContent?.trim()).toBe('');
    });
  });

  it('renders nothing for "disabled" key algorithm', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: mockDefaultAlgorithm,
    });

    const { AlgorithmLabel } = await import('../AlgorithmLabel');

    const { container } = render(<AlgorithmLabel area="matching" />);
    await waitFor(() => {
      expect(container.textContent?.trim()).toBe('');
    });
  });
});
