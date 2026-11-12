// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Drift guard: the live preview beside the marketplace forms must look like
 * the real card on the marketplace page (MarketplaceListingCard). Both are
 * rendered from the same item and the parts that carry meaning are compared,
 * so a change to one that is not made to the other fails here (audit of the
 * live previews, 12 Nov 2026).
 *
 * Not compared: the seller's name. The preview shows the seller's first name;
 * the real card shows whatever name the server sends for the seller.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { MarketplaceListingItem } from '@/types/marketplace';

vi.mock('@/contexts', () => createMockContexts());
vi.mock('@/contexts/TenantContext', () => ({ useTenant: createMockContexts().useTenant }));

import { MarketplaceListingCard } from './MarketplaceListingCard';
import { MarketplacePreviewCard } from './MarketplacePreviewCard';

function renderBoth(listing: MarketplaceListingItem) {
  render(
    <>
      <div data-testid="real">
        <MarketplaceListingCard listing={listing} />
      </div>
      <MarketplacePreviewCard
        id={listing.id}
        title={listing.title}
        price={listing.price === null ? '' : String(listing.price)}
        currency={listing.price_currency}
        priceType={listing.price_type}
        condition={listing.condition ?? ''}
        location={listing.location ?? ''}
        imageSrc={listing.image?.url ?? null}
      />
    </>,
  );
  return { real: screen.getByTestId('real'), preview: screen.getByTestId('marketplace-preview') };
}

const listing: MarketplaceListingItem = {
  id: 77,
  title: "Child's bike",
  price: 25,
  price_currency: 'EUR',
  price_type: 'fixed',
  condition: 'good',
  location: 'Riverside',
  delivery_method: 'pickup',
  seller_type: 'private',
  status: 'active',
  image: null,
  image_count: 0,
  is_saved: false,
  is_own: false,
  is_promoted: false,
  views_count: 0,
  created_at: '2026-11-01T10:00:00Z',
};

describe('MarketplacePreviewCard and the real MarketplaceListingCard stay alike', () => {
  it('show the same title', () => {
    const { real } = renderBoth(listing);
    expect(screen.getByTestId('marketplace-preview-title').textContent).toBe(real.querySelector('h3')?.textContent);
  });

  it('give an item with no photo the same placeholder, in the same colour and texture', () => {
    const { real, preview } = renderBoth(listing);
    const realPlaceholder = real.querySelector('[data-colour]');
    const previewPlaceholder = preview.querySelector('[data-colour]');
    expect(realPlaceholder).not.toBeNull();
    expect(previewPlaceholder?.getAttribute('data-colour')).toBe(realPlaceholder?.getAttribute('data-colour'));
    expect(previewPlaceholder?.innerHTML).toBe(realPlaceholder?.innerHTML);
  });

  it.each([
    ['a fixed price', { price: 25, price_type: 'fixed' }],
    ['a free item', { price: null, price_type: 'free' }],
    ['a negotiable price', { price: 40, price_type: 'negotiable' }],
  ] as const)('show %s in the same price badge', (_label, price) => {
    const { real } = renderBoth({ ...listing, ...price });
    const realBadge = real.querySelector('.absolute.bottom-2.left-2');
    const previewBadge = screen.getByTestId('marketplace-preview-price');
    expect(previewBadge.innerHTML).toBe(realBadge?.innerHTML);
  });

  it('show the same condition badge', () => {
    const { real } = renderBoth(listing);
    expect(screen.getByTestId('marketplace-preview-condition').innerHTML).toBe(real.querySelector('.absolute.top-2.left-2')?.innerHTML);
  });

  it('show the same place', () => {
    const { real, preview } = renderBoth(listing);
    const place = (root: HTMLElement) => root.querySelector('.lucide-map-pin')?.parentElement?.textContent;
    expect(place(real)).toBe('Riverside');
    expect(place(preview)).toBe(place(real));
  });
});
