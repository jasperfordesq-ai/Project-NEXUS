// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@/test/test-utils';
import { MobileFilterBar, type MobileFilterBarChip } from './MobileFilterBar';

function chip(key: string, label: string, onRemove = vi.fn()): MobileFilterBarChip {
  return { key, label, onRemove };
}

function region(): HTMLElement {
  return screen.getByTestId('filter-bar');
}

describe('MobileFilterBar', () => {
  const onFiltersPress = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the Filters button with the shared common vocabulary by default', () => {
    render(<MobileFilterBar isVisible onFiltersPress={onFiltersPress} testId="filter-bar" />);

    const button = screen.getByLabelText('More filters');
    expect(button).toBeInTheDocument();
    expect(screen.getByText('Filters')).toBeInTheDocument();
    fireEvent.click(button);
    expect(onFiltersPress).toHaveBeenCalledTimes(1);
  });

  it('stays phone-only and visible when isVisible is true', () => {
    render(<MobileFilterBar isVisible onFiltersPress={onFiltersPress} testId="filter-bar" />);

    const bar = region();
    expect(bar.className).toMatch(/\bsm:hidden\b/);
    expect(bar.className).toMatch(/\bsticky\b/);
    expect(bar.className).not.toMatch(/opacity-0/);
    expect(bar.className).not.toMatch(/pointer-events-none/);
  });

  it('translates and fades itself out when isVisible is false', () => {
    render(<MobileFilterBar isVisible={false} onFiltersPress={onFiltersPress} testId="filter-bar" />);

    const bar = region();
    expect(bar.className).toMatch(/pointer-events-none/);
    expect(bar.className).toMatch(/-translate-y-3/);
    expect(bar.className).toMatch(/opacity-0/);
  });

  it('omits the search pill entirely when onSearchPress is not given', () => {
    render(<MobileFilterBar isVisible onFiltersPress={onFiltersPress} testId="filter-bar" />);

    expect(screen.queryByText('Search')).toBeNull();
  });

  it('renders the search pill with the placeholder, then the live query', () => {
    const onSearchPress = vi.fn();
    const { rerender } = render(
      <MobileFilterBar isVisible onFiltersPress={onFiltersPress} onSearchPress={onSearchPress} testId="filter-bar" />,
    );

    fireEvent.click(screen.getByText('Search').closest('button') as HTMLElement);
    expect(onSearchPress).toHaveBeenCalledTimes(1);

    rerender(
      <MobileFilterBar
        isVisible
        onFiltersPress={onFiltersPress}
        onSearchPress={onSearchPress}
        searchValue="ladders"
        testId="filter-bar"
      />,
    );
    expect(screen.getByText('ladders')).toBeInTheDocument();
    expect(screen.queryByText('Search')).toBeNull();
  });

  // Locks the 2026-07-26 touch-target decision so it cannot silently drift back.
  // TouchTarget.contract.test.ts cannot see this component: it only reads JSX opening
  // elements, so a className held in a module-level constant is opaque to it, and its
  // tag filter matches only Button/OverlayActionButton, so the lowercase <button>
  // chips are invisible to it entirely.
  it('gives the two primary controls a 44px touch target, and documents the chip exemption', () => {
    const onSearchPress = vi.fn();
    render(
      <MobileFilterBar
        isVisible
        onFiltersPress={onFiltersPress}
        onSearchPress={onSearchPress}
        chips={[{ key: 'a', label: 'Offers', onRemove: vi.fn() }]}
        onClearAll={vi.fn()}
        testId="filter-bar"
      />,
    );

    // h-11 = 44px, matching FilterChipGroup (min-h-11), BottomSheet (min-h-[44px])
    // and OverlayActionButton (size-11).
    const searchPill = screen.getByText('Search').closest('button') as HTMLElement;
    expect(searchPill.className).toMatch(/\bh-11\b/);
    expect(searchPill.className).not.toMatch(/\bh-10\b/);

    const filtersButton = screen.getByRole('button', { name: 'More filters' });
    expect(filtersButton.className).toMatch(/\bh-11\b/);
    expect(filtersButton.className).not.toMatch(/\bh-10\b/);

    // The applied-filter chips are a DELIBERATE exemption at 28px: they wrap, so 44px
    // would roughly double the bar's height once a few filters apply, and every filter
    // is also removable inside the sheet. 28px still clears WCAG 2.5.8 AA (24x24).
    // Asserted so the exemption is a recorded decision rather than an accident.
    const chip = screen.getByRole('button', { name: 'Remove filter: Offers' });
    expect(chip.className).toMatch(/\bmin-h-7\b/);
  });

  it('shows the active count badge and switches to the solid accent style', () => {
    const { rerender } = render(
      <MobileFilterBar isVisible accent="emerald" onFiltersPress={onFiltersPress} testId="filter-bar" />,
    );

    expect(screen.getByLabelText('More filters').className).toContain('bg-theme-elevated');
    expect(screen.queryByText('2')).toBeNull();

    rerender(
      <MobileFilterBar isVisible accent="emerald" filterCount={2} onFiltersPress={onFiltersPress} testId="filter-bar" />,
    );
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByLabelText('More filters').className).toContain('bg-emerald-600');
  });

  it('defaults the badge count to the number of applied chips', () => {
    render(
      <MobileFilterBar
        isVisible
        accent="emerald"
        onFiltersPress={onFiltersPress}
        chips={[chip('type', 'Offers'), chip('category', 'DIY')]}
        testId="filter-bar"
      />,
    );

    // No explicit filterCount: the badge must still agree with the chip row.
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByLabelText('More filters').className).toContain('bg-emerald-600');
  });

  it('lets an explicit filterCount override the chip count', () => {
    render(
      <MobileFilterBar
        isVisible
        onFiltersPress={onFiltersPress}
        filterCount={3}
        chips={[chip('type', 'Offers')]}
        testId="filter-bar"
      />,
    );

    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('uses the theme accent by default', () => {
    render(<MobileFilterBar isVisible filterCount={1} onFiltersPress={onFiltersPress} testId="filter-bar" />);

    expect(screen.getByLabelText('More filters').className).toContain('bg-accent');
  });

  it('renders the trailing slot and leaves no element behind when omitted', () => {
    const { rerender } = render(
      <MobileFilterBar
        isVisible
        onFiltersPress={onFiltersPress}
        testId="filter-bar"
        trailing={<button type="button">View mode</button>}
      />,
    );
    expect(screen.getByText('View mode')).toBeInTheDocument();

    rerender(<MobileFilterBar isVisible onFiltersPress={onFiltersPress} testId="filter-bar" />);
    expect(screen.queryByText('View mode')).toBeNull();
    // Top row holds only the Filters button — no empty trailing wrapper.
    expect(region().firstElementChild?.children).toHaveLength(1);
  });

  it('hides the chip row completely when nothing is applied', () => {
    render(<MobileFilterBar isVisible onFiltersPress={onFiltersPress} chips={[]} onClearAll={vi.fn()} testId="filter-bar" />);

    expect(screen.queryByLabelText('Active filters')).toBeNull();
    expect(screen.queryByText('Clear all')).toBeNull();
  });

  it('renders one removable chip per applied filter', () => {
    const removeType = vi.fn();
    const removeCategory = vi.fn();
    render(
      <MobileFilterBar
        isVisible
        onFiltersPress={onFiltersPress}
        chips={[chip('type', 'Offers', removeType), chip('category', 'DIY', removeCategory)]}
        testId="filter-bar"
      />,
    );

    expect(screen.getByLabelText('Active filters')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Remove filter: Offers'));
    expect(removeType).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText('Remove filter: DIY'));
    expect(removeCategory).toHaveBeenCalledTimes(1);
  });

  it('only renders Clear all when onClearAll is provided', () => {
    const onClearAll = vi.fn();
    const { rerender } = render(
      <MobileFilterBar isVisible onFiltersPress={onFiltersPress} chips={[chip('type', 'Offers')]} testId="filter-bar" />,
    );
    expect(screen.queryByText('Clear all')).toBeNull();

    rerender(
      <MobileFilterBar
        isVisible
        onFiltersPress={onFiltersPress}
        chips={[chip('type', 'Offers')]}
        onClearAll={onClearAll}
        testId="filter-bar"
      />,
    );
    fireEvent.click(screen.getByText('Clear all'));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('lets a page override every label with entity-specific copy', () => {
    render(
      <MobileFilterBar
        isVisible
        onFiltersPress={onFiltersPress}
        onSearchPress={vi.fn()}
        chips={[chip('type', 'Offers')]}
        onClearAll={vi.fn()}
        testId="filter-bar"
        labels={{
          region: 'Filter listings',
          filters: 'Refine',
          moreFilters: 'More listing filters',
          search: 'Search listings',
          clearAll: 'Reset',
          activeFilters: 'Applied listing filters',
          removeFilter: (filter) => `Drop ${filter}`,
        }}
      />,
    );

    expect(screen.getByLabelText('Filter listings')).toBeInTheDocument();
    expect(screen.getByText('Refine')).toBeInTheDocument();
    expect(screen.getByLabelText('More listing filters')).toBeInTheDocument();
    expect(screen.getByText('Search listings')).toBeInTheDocument();
    expect(screen.getByText('Reset')).toBeInTheDocument();
    expect(screen.getByLabelText('Applied listing filters')).toBeInTheDocument();
    expect(screen.getByLabelText('Drop Offers')).toBeInTheDocument();
  });

  it('appends caller classes to the sticky region', () => {
    render(
      <MobileFilterBar isVisible onFiltersPress={onFiltersPress} className="custom-bar" testId="filter-bar" />,
    );

    expect(region().className).toContain('custom-bar');
  });
});
