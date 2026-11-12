// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { colourForSeed, paletteFor } from '@/lib/categoryColours';
import { MarketplacePreviewCard, type MarketplacePreviewCardProps } from './MarketplacePreviewCard';

const base: MarketplacePreviewCardProps = {
  title: '', price: '', currency: 'EUR', priceType: 'fixed', condition: '', location: '', imageSrc: null, sellerName: null,
};

describe('MarketplacePreviewCard — how the item will look, as it is typed', () => {
  it('invites a title before one is typed, in a quieter colour', () => {
    render(<MarketplacePreviewCard {...base} />);
    expect(screen.getByTestId('marketplace-preview-title').className).toContain('text-theme-subtle');
    expect(screen.getByTestId('marketplace-preview-title').textContent).not.toBe('');
  });

  it('shows the title, place and seller as they are typed', () => {
    render(<MarketplacePreviewCard {...base} title="Child's bike" location="Riverside" sellerName="Maeve" />);
    const preview = screen.getByTestId('marketplace-preview');
    expect(preview).toHaveTextContent("Child's bike");
    expect(preview).toHaveTextContent('Riverside');
    expect(preview).toHaveTextContent('Maeve');
    expect(screen.getByTestId('marketplace-preview-title').className).toContain('text-theme-primary');
  });

  it('shows the price exactly as the real card will, through the same price badge', () => {
    render(<MarketplacePreviewCard {...base} price="25" />);
    expect(screen.getByTestId('marketplace-preview-price').textContent).toMatch(/25/);
  });

  it('does not invent a price from something that is not a number', () => {
    render(<MarketplacePreviewCard {...base} price="abc" />);
    expect(screen.getByTestId('marketplace-preview-price').textContent).not.toMatch(/NaN/);
  });

  it('shows the condition only once one is chosen', () => {
    const { rerender } = render(<MarketplacePreviewCard {...base} />);
    expect(screen.queryByTestId('marketplace-preview-condition')).toBeNull();
    rerender(<MarketplacePreviewCard {...base} condition="new" />);
    expect(screen.getByTestId('marketplace-preview-condition')).toBeInTheDocument();
  });

  it('nudges for a photo until there is one', () => {
    const { rerender } = render(<MarketplacePreviewCard {...base} />);
    expect(screen.getByTestId('marketplace-preview-photo-nudge')).toBeInTheDocument();
    rerender(<MarketplacePreviewCard {...base} imageSrc="blob:photo" />);
    expect(screen.queryByTestId('marketplace-preview-photo-nudge')).toBeNull();
    expect(screen.getByTestId('marketplace-preview').querySelector('img')).toHaveAttribute('alt', '');
  });

  // Editing an item with no photo showed a different colour from its card on
  // the marketplace page: the preview used a fixed seed, the card the item's
  // id (audit of the live previews, 12 Nov 2026).
  it("when editing, colours the photo placeholder by the item's id, as its card does", () => {
    const palette = paletteFor(null);
    const id = [77, 42, 7, 3, 11].find((n) => colourForSeed(n, palette) !== colourForSeed('marketplace-preview', palette))!;
    render(<MarketplacePreviewCard {...base} id={id} />);
    const placeholder = screen.getByTestId('marketplace-preview').querySelector('[data-colour]');
    expect(placeholder).toHaveAttribute('data-colour', colourForSeed(id, palette));
  });

  it('is a picture of a card, not a card: nothing in it can be clicked', () => {
    render(<MarketplacePreviewCard {...base} title="Child's bike" price="25" condition="new" />);
    const preview = screen.getByTestId('marketplace-preview');
    expect(preview.querySelector('a')).toBeNull();
    expect(preview.querySelector('button')).toBeNull();
  });
});
