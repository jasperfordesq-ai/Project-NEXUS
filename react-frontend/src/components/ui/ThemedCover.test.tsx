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
});
