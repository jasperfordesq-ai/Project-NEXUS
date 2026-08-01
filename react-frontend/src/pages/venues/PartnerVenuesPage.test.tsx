// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
  },
}));

vi.mock('@/contexts', () => createMockContexts());

import { api } from '@/lib/api';
import PartnerVenuesPage from './PartnerVenuesPage';

const VENUES = [
  {
    id: 1,
    name: 'The Time Union Cafe',
    category: 'cafe',
    offer_summary: '10% off hot drinks',
    address_line: '1 Union Street',
    city: 'Coventry',
    website: 'https://cafe.example.test',
  },
  {
    id: 2,
    name: 'Union Books',
    category: 'shop',
    offer_summary: null,
    address_line: null,
    city: null,
    website: null,
  },
];

describe('PartnerVenuesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists venues with their informational offers', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { venues: VENUES } });

    render(<PartnerVenuesPage />);

    await waitFor(() => {
      expect(screen.getByText('The Time Union Cafe')).toBeInTheDocument();
    });
    expect(screen.getByText('Union Books')).toBeInTheDocument();
    expect(screen.getByText('10% off hot drinks')).toBeInTheDocument();
    // Directory calls the member endpoint, not the admin one.
    expect(api.get).toHaveBeenCalledWith('/v2/partner-venues');
  });

  it('links to the member pass', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { venues: VENUES } });

    render(<PartnerVenuesPage />);

    const passLink = await screen.findByRole('link', { name: 'My pass' });
    expect(passLink).toHaveAttribute('href', expect.stringContaining('/venues/pass'));
  });

  it('shows the empty state when no venues exist', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { venues: [] } });

    render(<PartnerVenuesPage />);

    await waitFor(() => {
      expect(screen.getByText('No partner venues have been added yet.')).toBeInTheDocument();
    });
  });
});
