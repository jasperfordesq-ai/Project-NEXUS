// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@/test/test-utils';
import { FilterChipGroup } from './FilterChipGroup';

// HeroUI's ToggleButtonGroup with selectionMode="single" maps to ARIA
// radiogroup/radio (react-aria's useToggleButtonGroup), which is what the
// Feed and Listings sheets already assert against.
const OPTIONS = [
  { key: 'any', label: 'Any' },
  { key: 'remote', label: 'Remote' },
  { key: 'in_person', label: 'In person' },
];

describe('FilterChipGroup', () => {
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a labelled row of chips', () => {
    render(<FilterChipGroup label="Service mode" selected="any" options={OPTIONS} onChange={onChange} />);

    expect(screen.getByRole('heading', { name: 'Service mode' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Service mode' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Remote' })).toBeInTheDocument();
  });

  it('reports the tapped option key', () => {
    render(<FilterChipGroup label="Service mode" selected="any" options={OPTIONS} onChange={onChange} />);

    fireEvent.click(screen.getByRole('radio', { name: 'Remote' }));
    expect(onChange).toHaveBeenCalledWith('remote');
  });

  it('marks the selected chip', () => {
    render(<FilterChipGroup label="Service mode" selected="remote" options={OPTIONS} onChange={onChange} />);

    expect(screen.getByRole('radio', { name: 'Remote' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Remote' })).toHaveAttribute('data-selected', 'true');
    expect(screen.getByRole('radio', { name: 'Any' })).toHaveAttribute('aria-checked', 'false');
  });

  it('omits the heading row for an unlabelled group but keeps an accessible name', () => {
    render(
      <FilterChipGroup ariaLabel="Select feed filter" selected="any" options={OPTIONS} onChange={onChange} />,
    );

    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('radiogroup', { name: 'Select feed filter' })).toBeInTheDocument();
  });

  it('never renders a <section> — glass.css would paint it solid inside a dialog', () => {
    const { container } = render(
      <FilterChipGroup label="Service mode" selected="any" options={OPTIONS} onChange={onChange} />,
    );

    expect(container.querySelector('section')).toBeNull();
  });

  it('renders the trailing and extra slots', () => {
    render(
      <FilterChipGroup
        label="Sort"
        selected="any"
        options={OPTIONS}
        onChange={onChange}
        trailing={<span>Personalised</span>}
        extra={<button type="button">Show all (42)</button>}
      />,
    );

    expect(screen.getByText('Personalised')).toBeInTheDocument();
    expect(screen.getByText('Show all (42)')).toBeInTheDocument();
  });

  it('disables the whole group for a dependent filter', () => {
    render(
      <FilterChipGroup label="Radius" selected="any" options={OPTIONS} onChange={onChange} isDisabled />,
    );

    const chip = screen.getByRole('radio', { name: 'Remote' });
    fireEvent.click(chip);
    expect(onChange).not.toHaveBeenCalled();
    expect(chip).toHaveAttribute('data-disabled', 'true');
  });

  it('disables a single option', () => {
    render(
      <FilterChipGroup
        label="Service mode"
        selected="any"
        options={[{ key: 'any', label: 'Any' }, { key: 'remote', label: 'Remote', isDisabled: true }]}
        onChange={onChange}
      />,
    );

    expect(screen.getByRole('radio', { name: 'Remote' })).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByRole('radio', { name: 'Any' })).not.toHaveAttribute('data-disabled');
  });

  it('applies the requested accent to the chips', () => {
    const { rerender } = render(
      <FilterChipGroup accent="emerald" label="Type" selected="any" options={OPTIONS} onChange={onChange} />,
    );
    expect(screen.getByRole('radio', { name: 'Any' }).className).toContain('data-[selected=true]:bg-emerald-600');

    rerender(<FilterChipGroup label="Type" selected="any" options={OPTIONS} onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Any' }).className).toContain('data-[selected=true]:bg-accent');
  });

  it('keeps chips at a 44px touch target and overrides the HeroUI group BEM layout', () => {
    render(<FilterChipGroup label="Type" selected="any" options={OPTIONS} onChange={onChange} />);

    expect(screen.getByRole('radio', { name: 'Any' }).className).toContain('min-h-11');
    const group = screen.getByRole('radiogroup', { name: 'Type' });
    expect(group.className).toContain('flex-wrap');
    expect(group.className).toContain('justify-start');
    expect(group.className).toContain('p-0');
  });
});
