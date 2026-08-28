// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for MatchesEmptyState
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

const stableTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  tenantPath: (p: string) => `/test${p}`,
};

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => stableTenant),
}));

import { MatchesEmptyState } from './MatchesEmptyState';

describe('MatchesEmptyState', () => {
  it('renders the no-coordinates variant with a set-location CTA', () => {
    render(<MatchesEmptyState variant="no_coordinates" />);
    expect(screen.getByText('We need your location to find matches')).toBeInTheDocument();
    expect(screen.getByText('Set your location')).toBeInTheDocument();
  });

  it('renders the no-listings variant with a create-listing CTA', () => {
    render(<MatchesEmptyState variant="no_listings" />);
    expect(screen.getByText('Matching works from your listings')).toBeInTheDocument();
    expect(screen.getByText('Create a listing')).toBeInTheDocument();
  });

  it('renders the safeguarding-unavailable variant with no CTA — the member cannot fix it', () => {
    render(<MatchesEmptyState variant="safeguarding_unavailable" />);
    expect(screen.getByText("Some matches can't be shown yet")).toBeInTheDocument();
    expect(
      screen.getByText(/safeguarding setup isn't finished/i),
    ).toBeInTheDocument();
    // No call to action: only the community team can complete safeguarding
    // setup, so a button would send the member somewhere useless.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders the default "none" variant with browse and preferences CTAs', () => {
    render(<MatchesEmptyState variant="none" />);
    expect(screen.getByText('No matches yet')).toBeInTheDocument();
    expect(screen.getByText('Browse Listings')).toBeInTheDocument();
    expect(screen.getByText('Adjust match preferences')).toBeInTheDocument();
  });
});
