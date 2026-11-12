// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { FormWithPreview } from '@/components/ui/FormWithPreview';
import { GroupPreviewCard } from './GroupPreviewCard';

describe('GroupPreviewCard — how the group will look, as it is typed', () => {
  it('shows the name and description as they are typed', () => {
    render(<GroupPreviewCard name="Riverside walkers" description="A gentle walk every Sunday." visibility="public" coverSrc={null} />);
    const preview = screen.getByTestId('group-preview');
    expect(preview).toHaveTextContent('Riverside walkers');
    expect(preview).toHaveTextContent('A gentle walk every Sunday.');
  });

  it('invites the words before anything is typed, in a quieter colour', () => {
    render(<GroupPreviewCard name="  " description="" visibility="public" coverSrc={null} />);
    expect(screen.getByTestId('group-preview-name').className).toContain('text-theme-subtle');
    expect(screen.getByTestId('group-preview-name').textContent).not.toBe('');
    expect(screen.getByTestId('group-preview-description').textContent).not.toBe('');
  });

  it('shows a coloured cover and a nudge to add a picture until there is one', () => {
    const { rerender } = render(<GroupPreviewCard name="Walkers" description="x" visibility="public" coverSrc={null} />);
    expect(screen.getByTestId('group-preview-cover')).toBeInTheDocument();
    expect(screen.getByTestId('group-preview-cover-nudge')).toBeInTheDocument();

    rerender(<GroupPreviewCard name="Walkers" description="x" visibility="public" coverSrc="blob:cover" />);
    expect(screen.queryByTestId('group-preview-cover')).toBeNull();
    expect(screen.queryByTestId('group-preview-cover-nudge')).toBeNull();
    // Decorative here: the same picture and its description are in the form.
    expect(screen.getByTestId('group-preview').querySelector('img')).toHaveAttribute('alt', '');
  });

  it('says whether the group is public or private, in words as well as a picture', () => {
    const { rerender } = render(<GroupPreviewCard name="Walkers" description="x" visibility="public" coverSrc={null} />);
    expect(screen.getByTestId('group-preview-visibility')).toHaveTextContent('Public group');
    rerender(<GroupPreviewCard name="Walkers" description="x" visibility="private" coverSrc={null} />);
    expect(screen.getByTestId('group-preview-visibility')).toHaveTextContent('Private group');
  });

  it('is a picture of a card, not a card: nothing in it can be clicked', () => {
    render(<GroupPreviewCard name="Walkers" description="x" visibility="public" coverSrc={null} />);
    const preview = screen.getByTestId('group-preview');
    expect(preview.querySelector('a')).toBeNull();
    expect(preview.querySelector('button')).toBeNull();
  });
});

describe('FormWithPreview — a form with its live picture beside it', () => {
  it('puts the form first and the picture in a side column that stays in view on wide screens', () => {
    render(
      <FormWithPreview preview={<div data-testid="the-preview" />}>
        <div data-testid="the-form" />
      </FormWithPreview>,
    );
    const layout = screen.getByTestId('form-with-preview');
    expect(layout.className).toContain('lg:grid-cols-[minmax(0,1fr)_20rem]');
    const aside = screen.getByTestId('the-preview').closest('aside');
    expect(aside?.className).toContain('lg:sticky');
    // On a phone the picture follows the form: form first in the document.
    expect(layout.firstElementChild).toContainElement(screen.getByTestId('the-form'));
  });
});
