// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { Autocomplete } from './Autocomplete';
import { ListBoxItem as AutocompleteItem } from './ListBox';

describe('Autocomplete', () => {
  it('mounts with all compound parts and renders the label', () => {
    render(
      <Autocomplete label="Country" searchPlaceholder="Search countries" placeholder="Select a country">
        <AutocompleteItem id="ie">Ireland</AutocompleteItem>
        <AutocompleteItem id="de">Germany</AutocompleteItem>
        <AutocompleteItem id="fr">France</AutocompleteItem>
      </Autocomplete>
    );

    // Label renders, a trigger button is present, and the collection items make it
    // into RAC's hidden native <select> (proves ListBoxItem traversal inside Autocomplete).
    expect(screen.getByText('Country')).toBeTruthy();
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    expect(screen.getByText('Ireland')).toBeTruthy();
    expect(screen.getByText('Germany')).toBeTruthy();
  });

  // B1 walk 6.5 (13 Nov 2026): the trigger is an inline-flex row with no gap, so an
  // icon passed as startContent sat jammed against the first letter of the value.
  it('keeps a gap between the start icon and the value', () => {
    render(
      <Autocomplete
        label="Category"
        placeholder="Select a category"
        startContent={<svg data-testid="start-icon" />}
      >
        <AutocompleteItem id="a">Alpha</AutocompleteItem>
      </Autocomplete>
    );

    const holder = screen.getByTestId('start-icon').parentElement as HTMLElement;
    expect(holder.getAttribute('data-slot')).toBe('start-content');
    expect(holder.className).toMatch(/\bme-2\b/);
    expect(holder.className).toMatch(/\bshrink-0\b/);
  });

  it('accepts a render function over items', () => {
    const items = [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }];
    expect(() =>
      render(
        <Autocomplete aria-label="Letters" items={items}>
          {(item: { id: string; name: string }) => (
            <AutocompleteItem id={item.id}>{item.name}</AutocompleteItem>
          )}
        </Autocomplete>
      )
    ).not.toThrow();
  });
});
