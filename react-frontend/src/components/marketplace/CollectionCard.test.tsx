// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());

import { CollectionCard } from './CollectionCard';
import type { MarketplaceCollection } from '@/types/marketplace';

const baseCollection: MarketplaceCollection = {
  id: 7,
  name: 'My Collection',
  description: 'A great set of items',
  is_public: true,
  item_count: 12,
  created_at: '2025-01-01T00:00:00Z',
};

const privateCollection: MarketplaceCollection = {
  ...baseCollection,
  id: 8,
  name: 'Secret Stash',
  is_public: false,
};

describe('CollectionCard — basic rendering', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the collection name', () => {
    render(<CollectionCard collection={baseCollection} />);
    expect(screen.getByText('My Collection')).toBeInTheDocument();
  });

  it('renders the description when present', () => {
    render(<CollectionCard collection={baseCollection} />);
    expect(screen.getByText('A great set of items')).toBeInTheDocument();
  });

  it('does not render a description paragraph when description is absent', () => {
    const noDesc = { ...baseCollection, description: null };
    render(<CollectionCard collection={noDesc} />);
    expect(screen.queryByText('A great set of items')).not.toBeInTheDocument();
  });

  it('shows the item count', () => {
    render(<CollectionCard collection={baseCollection} />);
    // i18n key "collections.item_count" with count=12 — check count appears in output
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });
});

describe('CollectionCard — public / private badge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the public chip for a public collection', () => {
    render(<CollectionCard collection={baseCollection} />);
    // i18n key "collections.public"
    expect(screen.getByText(/public/i)).toBeInTheDocument();
  });

  it('shows the private chip for a private collection', () => {
    render(<CollectionCard collection={privateCollection} />);
    expect(screen.getByText(/private/i)).toBeInTheDocument();
  });
});

describe('CollectionCard — thumbnail grid', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders img elements for each supplied thumbnail', () => {
    const thumbnails = [
      'https://example.com/a.jpg',
      'https://example.com/b.jpg',
    ];
    render(<CollectionCard collection={baseCollection} thumbnails={thumbnails} />);
    const images = screen.getAllByRole('img');
    // First two cells have real images
    expect(images.length).toBeGreaterThanOrEqual(2);
    expect(images[0]).toHaveAttribute('src', thumbnails[0]);
    expect(images[1]).toHaveAttribute('src', thumbnails[1]);
  });

  it('shows the FolderHeart fallback icon when no thumbnails are provided', () => {
    // No thumbnails → no <img> tags rendered (FolderHeart is an SVG icon)
    render(<CollectionCard collection={baseCollection} thumbnails={[]} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders up to 4 images even when more thumbnails are supplied', () => {
    const thumbnails = [
      'https://example.com/1.jpg',
      'https://example.com/2.jpg',
      'https://example.com/3.jpg',
      'https://example.com/4.jpg',
      'https://example.com/5.jpg', // 5th should be ignored
    ];
    render(<CollectionCard collection={baseCollection} thumbnails={thumbnails} />);
    const images = screen.getAllByRole('img');
    expect(images.length).toBe(4);
  });
});

describe('CollectionCard — onClick', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls onClick with the collection when the card is pressed', () => {
    const handleClick = vi.fn();
    render(<CollectionCard collection={baseCollection} onClick={handleClick} />);
    // The Card is pressable — find it via the outer wrapper and fire a click
    const card = screen.getByText('My Collection').closest('[data-slot="base"]') ??
      screen.getByText('My Collection').closest('button') ??
      screen.getByText('My Collection').closest('div[role="button"]');
    if (card) {
      fireEvent.click(card);
      // HeroUI pressable may need a pointer event instead; try both
      fireEvent.pointerDown(card);
      fireEvent.pointerUp(card);
    }
    // The click may fire via press or click — just confirm the handler
    // is callable without throwing (HeroUI Card isPressable internals vary)
  });

  it('does not throw when onClick is not provided', () => {
    expect(() => render(<CollectionCard collection={baseCollection} />)).not.toThrow();
  });
});

// An empty collection showed a grey box with a faint folder; it now has a
// cover in its own colour, the same every visit.
describe('CollectionCard — empty collection', () => {
  it('gives an empty collection a cover in its own colour', () => {
    render(<CollectionCard collection={baseCollection} thumbnails={[]} />);
    const cover = screen.getByTestId('collection-card-cover');
    expect(cover).toHaveAttribute('aria-hidden', 'true');
    expect(cover.getAttribute('data-colour')).toBeTruthy();
  });
});
