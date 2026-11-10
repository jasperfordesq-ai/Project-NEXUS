// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Contexts ────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts());

// ─── Fixtures ────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: 1, name: 'Clothing', slug: 'clothing', listing_count: 5 },
  { id: 2, name: 'Electronics', slug: 'electronics', listing_count: 12 },
  { id: 3, name: 'Books', slug: 'books', listing_count: 3 },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('CategoryChips', () => {
  const onSelect = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders the All button', async () => {
    const { CategoryChips } = await import('./CategoryChips');
    render(<CategoryChips categories={CATEGORIES} onSelect={onSelect} />);
    const allBtn = screen.getByRole('radio', { name: /all/i });
    expect(allBtn).toBeInTheDocument();
  });

  it('renders a button for each category', async () => {
    const { CategoryChips } = await import('./CategoryChips');
    render(<CategoryChips categories={CATEGORIES} onSelect={onSelect} />);
    expect(screen.getByRole('radio', { name: /clothing/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /electronics/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /books/i })).toBeInTheDocument();
  });

  it('renders exactly categories.length + 1 buttons (including All)', async () => {
    const { CategoryChips } = await import('./CategoryChips');
    render(<CategoryChips categories={CATEGORIES} onSelect={onSelect} />);
    const options = screen.getAllByRole('radio');
    expect(options.length).toBe(CATEGORIES.length + 1);
  });

  it('clicking a category chip calls onSelect with the category id', async () => {
    const { CategoryChips } = await import('./CategoryChips');
    render(<CategoryChips categories={CATEGORIES} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('radio', { name: /clothing/i }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('clicking the All button calls onSelect with null', async () => {
    const { CategoryChips } = await import('./CategoryChips');
    render(<CategoryChips categories={CATEGORIES} activeId={1} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('radio', { name: /all/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('clicking Electronics calls onSelect with id 2', async () => {
    const { CategoryChips } = await import('./CategoryChips');
    render(<CategoryChips categories={CATEGORIES} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('radio', { name: /electronics/i }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('All button is marked as selected when no activeId is given', async () => {
    const { CategoryChips } = await import('./CategoryChips');
    render(<CategoryChips categories={CATEGORIES} onSelect={onSelect} />);
    expect(screen.getByRole('radio', { name: /all/i })).toHaveAttribute('aria-checked', 'true');
  });

  it('active category button is marked as selected when activeId matches', async () => {
    const { CategoryChips } = await import('./CategoryChips');
    render(<CategoryChips categories={CATEGORIES} activeId={2} onSelect={onSelect} />);
    expect(screen.getByRole('radio', { name: /electronics/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('renders with empty categories list without crashing', async () => {
    const { CategoryChips } = await import('./CategoryChips');
    render(<CategoryChips categories={[]} onSelect={onSelect} />);
    expect(screen.getByRole('radio', { name: /all/i })).toBeInTheDocument();
  });

  it('group has accessible aria-label from i18n', async () => {
    const { CategoryChips } = await import('./CategoryChips');
    render(<CategoryChips categories={CATEGORIES} onSelect={onSelect} />);
    const group = screen.getByRole('radiogroup');
    // The i18n key resolves to the key in test env ("categories.label") or similar
    expect(group).toHaveAttribute('aria-label');
    expect(group.getAttribute('aria-label')).not.toBe('');
  });

  it('onSelect is not called on initial render', async () => {
    const { CategoryChips } = await import('./CategoryChips');
    render(<CategoryChips categories={CATEGORIES} onSelect={onSelect} />);
    expect(onSelect).not.toHaveBeenCalled();
  });

  // AWID feedback: "clear categories". Every category was the same grey pill;
  // each now carries a small mark in its own colour, the same every visit.
  it('gives each category a mark in its own colour', async () => {
    const { CategoryChips } = await import('./CategoryChips');
    render(<CategoryChips categories={[...CATEGORIES, { id: 4, name: 'Garden', slug: 'garden', icon: 'Leaf', listing_count: 1 }]} onSelect={onSelect} />);
    const marks = screen.getAllByTestId('category-chip-mark');
    expect(marks).toHaveLength(4);
    for (const mark of marks) {
      expect(mark).toHaveAttribute('aria-hidden', 'true');
      expect(mark.getAttribute('data-colour')).toBeTruthy();
    }
    expect(new Set(marks.map((m) => m.getAttribute('data-colour'))).size).toBeGreaterThan(1);
  });

  // Warmth plan W3 (10 Nov 2026): with colours picked from each name alone,
  // two categories often matched. They now share the palette out in id order.
  it('never gives two categories the same colour until the palette runs out', async () => {
    const { CategoryChips } = await import('./CategoryChips');
    const { paletteFor } = await import('@/lib/categoryColours');
    const palette = paletteFor(null);
    const many = Array.from({ length: palette.length }, (_, i) => ({ id: i + 1, name: `Category ${i + 1}`, slug: `category-${i + 1}`, listing_count: 1 }));
    render(<CategoryChips categories={many} onSelect={onSelect} />);
    const colours = screen.getAllByTestId('category-chip-mark').map((m) => m.getAttribute('data-colour'));
    expect(new Set(colours).size).toBe(palette.length);
    expect(colours[0]).toBe(palette[0]);
  });

  it("keeps a category's colour the same from one visit to the next", async () => {
    const { CategoryChips } = await import('./CategoryChips');
    const { unmount } = render(<CategoryChips categories={CATEGORIES} onSelect={onSelect} />);
    const first = screen.getAllByTestId('category-chip-mark').map((m) => m.getAttribute('data-colour'));
    unmount();
    render(<CategoryChips categories={[...CATEGORIES].reverse()} onSelect={onSelect} />);
    const again = screen.getAllByTestId('category-chip-mark').map((m) => m.getAttribute('data-colour')).reverse();
    expect(again).toEqual(first);
  });
});
