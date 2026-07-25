// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@/test/test-utils';
import { FilterSheet } from './FilterSheet';

describe('FilterSheet', () => {
  const onClose = vi.fn();
  const onApply = vi.fn();
  const onClearAll = vi.fn();
  const onBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the body inside a titled bottom sheet', () => {
    render(
      <FilterSheet isOpen onClose={onClose} title="Filters">
        <p>Filter sections</p>
      </FilterSheet>,
    );

    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByText('Filter sections')).toBeInTheDocument();
  });

  it('renders no footer for the simple archetype (immediate-apply sheets)', () => {
    render(
      <FilterSheet isOpen onClose={onClose} title="Filters">
        <p>Filter sections</p>
      </FilterSheet>,
    );

    expect(screen.queryByText('Clear all')).toBeNull();
    expect(screen.queryByText('Show results')).toBeNull();
  });

  it('renders the draft footer with Clear all and a live-count apply button', () => {
    render(
      <FilterSheet isOpen onClose={onClose} title="Filters" resultCount={23} onApply={onApply} onClearAll={onClearAll}>
        <p>Filter sections</p>
      </FilterSheet>,
    );

    expect(screen.getByText('Show 23 results')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Show 23 results'));
    expect(onApply).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText('Clear all'));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it('falls back to the unknown-count label when the endpoint has no total', () => {
    render(
      <FilterSheet isOpen onClose={onClose} title="Filters" resultCount={null} onApply={onApply}>
        <p>Filter sections</p>
      </FilterSheet>,
    );

    expect(screen.getByText('Show results')).toBeInTheDocument();
  });

  it('pluralises the shared apply label', () => {
    const { rerender } = render(
      <FilterSheet isOpen onClose={onClose} title="Filters" resultCount={1} onApply={onApply}>
        <p>Body</p>
      </FilterSheet>,
    );
    expect(screen.getByText('Show 1 result')).toBeInTheDocument();

    rerender(
      <FilterSheet isOpen onClose={onClose} title="Filters" resultCount={2} onApply={onApply}>
        <p>Body</p>
      </FilterSheet>,
    );
    expect(screen.getByText('Show 2 results')).toBeInTheDocument();
  });

  it('omits the secondary button entirely when the current view has no handler', () => {
    render(
      <FilterSheet isOpen onClose={onClose} title="Filters" resultCount={3} onApply={onApply}>
        <p>Filter sections</p>
      </FilterSheet>,
    );

    // A page with a single filter dimension has no sensible clear-all: the footer
    // must collapse to the apply button rather than ship a dead button.
    expect(screen.queryByText('Clear all')).toBeNull();
    expect(screen.getByText('Show 3 results')).toBeInTheDocument();
  });

  it('gives a simple (immediate-apply) sheet a Back-only footer for its sub-view', () => {
    render(
      <FilterSheet
        isOpen
        onClose={onClose}
        title="Filters"
        onBack={onBack}
        subView={<p>Searchable categories</p>}
      >
        <p>Filter sections</p>
      </FilterSheet>,
    );

    expect(screen.getByText('Searchable categories')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Show results')).toBeNull();
  });

  it('treats a falsy subView node as no sub-view at all', () => {
    const isSearching = false;
    render(
      <FilterSheet
        isOpen
        onClose={onClose}
        title="Filters"
        resultCount={4}
        onApply={onApply}
        onClearAll={onClearAll}
        onBack={onBack}
        subView={isSearching && <p>Searchable categories</p>}
      >
        <p>Filter sections</p>
      </FilterSheet>,
    );

    // `subView={cond && <View/>}` must not blank the body or swap Clear all for Back.
    expect(screen.getByText('Filter sections')).toBeInTheDocument();
    expect(screen.getByText('Clear all')).toBeInTheDocument();
    expect(screen.queryByText('Back')).toBeNull();
  });

  it('lets a page override the footer copy with entity-specific strings', () => {
    render(
      <FilterSheet
        isOpen
        onClose={onClose}
        title="Filters"
        resultCount={23}
        onApply={onApply}
        onClearAll={onClearAll}
        labels={{
          clearAll: 'Reset',
          showResults: (count) => `Show ${count} listings`,
          showResultsUnknown: 'Show listings',
        }}
      >
        <p>Filter sections</p>
      </FilterSheet>,
    );

    expect(screen.getByText('Show 23 listings')).toBeInTheDocument();
    expect(screen.getByText('Reset')).toBeInTheDocument();
  });

  it('swaps the body for the sub-view and turns the left action into Back', () => {
    render(
      <FilterSheet
        isOpen
        onClose={onClose}
        title="Filters"
        resultCount={5}
        onApply={onApply}
        onClearAll={onClearAll}
        onBack={onBack}
        subView={<p>Searchable categories</p>}
      >
        <p>Filter sections</p>
      </FilterSheet>,
    );

    expect(screen.getByText('Searchable categories')).toBeInTheDocument();
    expect(screen.queryByText('Filter sections')).toBeNull();
    expect(screen.queryByText('Clear all')).toBeNull();

    fireEvent.click(screen.getByText('Back'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onClearAll).not.toHaveBeenCalled();
  });

  it('keeps the apply button available while a sub-view is open', () => {
    render(
      <FilterSheet
        isOpen
        onClose={onClose}
        title="Filters"
        resultCount={5}
        onApply={onApply}
        onBack={onBack}
        subView={<p>Searchable categories</p>}
      >
        <p>Filter sections</p>
      </FilterSheet>,
    );

    fireEvent.click(screen.getByText('Show 5 results'));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('accents the apply button per page', () => {
    const { rerender } = render(
      <FilterSheet isOpen onClose={onClose} title="Filters" accent="emerald" resultCount={1} onApply={onApply}>
        <p>Body</p>
      </FilterSheet>,
    );
    expect(screen.getByText('Show 1 result').closest('button')?.className).toContain('bg-emerald-600');

    rerender(
      <FilterSheet isOpen onClose={onClose} title="Filters" resultCount={1} onApply={onApply}>
        <p>Body</p>
      </FilterSheet>,
    );
    expect(screen.getByText('Show 1 result').closest('button')?.className).toContain('bg-accent');
  });

  it('renders nothing while closed', () => {
    render(
      <FilterSheet isOpen={false} onClose={onClose} title="Filters" onApply={onApply}>
        <p>Filter sections</p>
      </FilterSheet>,
    );

    expect(screen.queryByText('Filter sections')).toBeNull();
  });

  it('closes through the sheet close button', () => {
    render(
      <FilterSheet isOpen onClose={onClose} title="Filters">
        <p>Filter sections</p>
      </FilterSheet>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
