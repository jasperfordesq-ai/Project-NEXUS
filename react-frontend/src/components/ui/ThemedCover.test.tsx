// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Users from 'lucide-react/icons/users';
import { ThemedCover } from './ThemedCover';

describe('ThemedCover', () => {
  it('fills the space with the colour it is given, in light and dark mode', () => {
    render(<ThemedCover colour="teal" icon={Users} data-testid="cover" />);
    const cover = screen.getByTestId('cover');
    expect(cover).toHaveAttribute('data-colour', 'teal');
    expect(cover.className).toContain('from-teal-100');
    expect(cover.className).toContain('dark:from-teal-500/45');
    expect(cover.className).toContain('text-teal-800');
    expect(cover.className).toContain('dark:text-teal-200');
  });

  it('is decoration only: screen readers skip it', () => {
    render(<ThemedCover colour="rose" icon={Users} label="Gardening" data-testid="cover" />);
    expect(screen.getByTestId('cover')).toHaveAttribute('aria-hidden', 'true');
  });

  it('shows the label when there is one', () => {
    render(<ThemedCover colour="rose" icon={Users} label="Gardening" data-testid="cover" />);
    expect(screen.getByTestId('cover')).toHaveTextContent('Gardening');
  });

  it('centres the icon and shows no text when there is no label', () => {
    render(<ThemedCover colour="amber" icon={Users} data-testid="cover" />);
    const cover = screen.getByTestId('cover');
    expect(cover.textContent).toBe('');
    expect(cover.querySelector('svg')).not.toBeNull();
  });

  it('puts the icon in the same place with or without a label, so a grid of cards lines up', () => {
    const { rerender } = render(<ThemedCover colour="rose" icon={Users} label="Gardening" data-testid="cover" />);
    const withLabel = screen.getByTestId('cover').querySelector('[data-cover-icon]');
    expect(withLabel?.parentElement?.className).toContain('justify-center');
    rerender(<ThemedCover colour="rose" icon={Users} data-testid="cover" />);
    const withoutLabel = screen.getByTestId('cover').querySelector('[data-cover-icon]');
    expect(withoutLabel?.parentElement?.className).toBe(withLabel?.parentElement?.className);
  });

  it('falls back to a neutral colour it knows for an unknown name', () => {
    render(<ThemedCover colour="no-such-colour" icon={Users} data-testid="cover" />);
    expect(screen.getByTestId('cover').className).toContain('from-slate-100');
  });

  // Owner, 9 Nov 2026: on dark mode the dot texture read as "loads of white dots".
  // It stays a whisper: at most 5% in light mode, and fainter still in dark mode,
  // where the dots are a light colour on a dark cover.
  it('keeps the dot texture faint, and fainter in dark mode than in light', () => {
    render(<ThemedCover colour="green" icon={Users} data-testid="cover" />);
    const texture = screen.getByTestId('cover').querySelector('[data-cover-texture]');
    const cls = texture?.className ?? '';
    const light = Number(/(?:^|\s)opacity-\[([\d.]+)\]/.exec(cls)?.[1]);
    const dark = Number(/dark:opacity-\[([\d.]+)\]/.exec(cls)?.[1]);
    expect(light).toBeGreaterThan(0);
    expect(light).toBeLessThanOrEqual(0.05);
    expect(dark).toBeLessThan(light);
  });

  // Warmth plan W6 (10 Nov 2026): a grid of covers in a few colours looked
  // stamped out. With a seed, each cover's gradient runs its own way and its
  // soft light sits in its own corner — the same every time for the same
  // item — while the icon stays centred, so the grid still lines up.
  const direction = (el: HTMLElement) => /bg-linear-to-(br|bl|tr|tl)/.exec(el.className)?.[1];
  const light = (el: HTMLElement) => el.querySelector('[data-cover-light]')?.className ?? '';

  it('varies a cover by its seed, without moving the icon', () => {
    const seeds = Array.from({ length: 12 }, (_, i) => `item-${i}`);
    const looks = new Set<string>();
    for (const seed of seeds) {
      const { unmount } = render(<ThemedCover colour="green" icon={Users} seed={seed} data-testid="cover" />);
      const cover = screen.getByTestId('cover');
      looks.add(`${direction(cover)}|${light(cover)}`);
      expect(cover.querySelector('[data-cover-icon]')?.parentElement?.className).toContain('justify-center');
      unmount();
    }
    expect(looks.size).toBeGreaterThan(2);
  });

  it('gives the same item the same look every time', () => {
    const first = render(<ThemedCover colour="green" seed="listing-42" data-testid="cover" />);
    const look = `${direction(screen.getByTestId('cover'))}|${light(screen.getByTestId('cover'))}`;
    first.unmount();
    render(<ThemedCover colour="green" seed="listing-42" data-testid="cover" />);
    expect(`${direction(screen.getByTestId('cover'))}|${light(screen.getByTestId('cover'))}`).toBe(look);
  });

  it('keeps the usual look without a seed', () => {
    render(<ThemedCover colour="green" data-testid="cover" />);
    expect(direction(screen.getByTestId('cover'))).toBe('br');
    expect(light(screen.getByTestId('cover'))).toContain('-top-12');
    expect(light(screen.getByTestId('cover'))).toContain('-end-10');
  });
});
