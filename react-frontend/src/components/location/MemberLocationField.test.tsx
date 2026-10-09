// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, userEvent, waitFor } from '@/test/test-utils';
import type { MemberLocationValue } from '@/lib/memberLocation';

// Stand-in for the real place search. It is a different element from the plain
// box, which is exactly what makes keyboard focus fall away when it swaps in.
vi.mock('@/components/location/PlaceAutocompleteInput', () => ({
  PlaceAutocompleteInput: (props: {
    label?: React.ReactNode;
    placeholder?: string;
    value: string;
    onChange?: (v: string) => void;
  }) => (
    <input
      data-testid="place-input"
      aria-label={String(props.label)}
      placeholder={props.placeholder}
      value={props.value}
      onChange={(e) => props.onChange?.(e.target.value)}
    />
  ),
}));

import { MemberLocationField } from './MemberLocationField';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState<MemberLocationValue>({ location: initial });
  return (
    <MemberLocationField
      value={value}
      onChange={setValue}
      label="Where are you based?"
      placeholder="Your town or city"
    />
  );
}

describe('MemberLocationField focus', () => {
  it('keeps keyboard focus and typed text when the place search swaps in', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByPlaceholderText('Your town or city'));
    // Type straight away, before the lazy place search has had time to load.
    await user.keyboard('Gal');

    const placeInput = (await screen.findByTestId('place-input')) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(placeInput));
    expect(placeInput.value).toBe('Gal');
    expect(placeInput.selectionStart).toBe(3);

    // Typing carries on in the new box.
    await user.keyboard('way');
    expect(placeInput.value).toBe('Galway');
  });

  it('puts the caret at the end of text that was already there', async () => {
    const user = userEvent.setup();
    render(<Harness initial="Cork" />);

    await user.click(screen.getByPlaceholderText('Your town or city'));
    const placeInput = (await screen.findByTestId('place-input')) as HTMLInputElement;
    await waitFor(() => expect(document.activeElement).toBe(placeInput));
    expect(placeInput.selectionStart).toBe(4);
    await user.keyboard(' City');
    expect(placeInput.value).toBe('Cork City');
  });

  it('does not pull focus back after the member moves on', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Harness />
        <button type="button">elsewhere</button>
      </>,
    );

    await user.click(screen.getByPlaceholderText('Your town or city'));
    await screen.findByTestId('place-input');
    const other = screen.getByRole('button', { name: 'elsewhere' });
    await user.click(other);
    expect(document.activeElement).toBe(other);
  });
});
