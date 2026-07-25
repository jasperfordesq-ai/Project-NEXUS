// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Pins the Feed sheet's shipped contract after it moved onto the shared
 * FilterSheet / FilterChipGroup primitives: SIMPLE archetype (no footer),
 * immediate apply, self-closing unless the picked filter has sub-filters.
 * FeedPage.test.tsx asserts the same radiogroup/radio anatomy from the page side.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@/test/test-utils';
import { FeedFilterSheet } from './FeedFilterSheet';
import type { FeedFilter } from './types';

const OPTIONS: { key: FeedFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'posts', label: 'Posts' },
  { key: 'listings', label: 'Listings' },
];
const WITH_SUBFILTERS = new Set<FeedFilter>(['listings']);

describe('FeedFilterSheet', () => {
  const onClose = vi.fn();
  const onFilterChange = vi.fn();
  const onSubFilterChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderSheet(filter: FeedFilter = 'all', subFilter: string | null = null) {
    return render(
      <FeedFilterSheet
        isOpen
        onClose={onClose}
        options={OPTIONS}
        filter={filter}
        onFilterChange={onFilterChange}
        filtersWithSubFilters={WITH_SUBFILTERS}
        subFilter={subFilter}
        onSubFilterChange={onSubFilterChange}
      />,
    );
  }

  it('renders every filter as a radio in the named group', () => {
    renderSheet();

    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Select feed filter' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'All' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Posts' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Listings' })).toBeInTheDocument();
  });

  it('renders no footer — the feed applies filters immediately', () => {
    renderSheet();

    expect(screen.queryByText('Show results')).toBeNull();
    expect(screen.queryByText('Clear all')).toBeNull();
  });

  it('applies and closes for a filter without sub-filters', () => {
    renderSheet();

    fireEvent.click(screen.getByRole('radio', { name: 'Posts' }));
    expect(onFilterChange).toHaveBeenCalledWith('posts');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open for a filter that reveals sub-filters', () => {
    renderSheet();

    fireEvent.click(screen.getByRole('radio', { name: 'Listings' }));
    expect(onFilterChange).toHaveBeenCalledWith('listings');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows sub-filter chips for listings and closes once one is picked', () => {
    renderSheet('listings');

    fireEvent.click(screen.getByRole('gridcell', { name: 'Offers' }));
    expect(onSubFilterChange).toHaveBeenCalledWith('offer');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('uses the theme accent, not a page hue', () => {
    renderSheet();

    expect(screen.getByRole('radio', { name: 'All' }).className).toContain('data-[selected=true]:bg-accent');
    expect(screen.getByRole('radio', { name: 'All' }).className).not.toContain('emerald');
  });
});
