// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import GraduationCap from 'lucide-react/icons/graduation-cap';
import { render, screen } from '@/test/test-utils';
import { DetailCover } from './DetailCover';
import { coverSeed } from '@/lib/coverSeeds';

describe('DetailCover', () => {
  it('shows a cover in the item\'s own colour when there is no picture', () => {
    render(<DetailCover seed="course-7" icon={GraduationCap} data-testid="cover" />);
    const cover = screen.getByTestId('cover');
    expect(cover).toHaveAttribute('aria-hidden', 'true');
    expect(cover.getAttribute('data-colour')).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('gives the same item the same colour every time, and items differ', () => {
    const { unmount } = render(<DetailCover seed="course-7" icon={GraduationCap} data-testid="cover" />);
    const first = screen.getByTestId('cover').getAttribute('data-colour');
    unmount();
    const { unmount: unmount2 } = render(<DetailCover seed="course-7" icon={GraduationCap} data-testid="cover" />);
    expect(screen.getByTestId('cover').getAttribute('data-colour')).toBe(first);
    unmount2();
    const colours = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((seed) => {
      const { unmount: u } = render(<DetailCover seed={seed} icon={GraduationCap} data-testid="cover" />);
      const colour = screen.getByTestId('cover').getAttribute('data-colour');
      u();
      return colour;
    }));
    expect(colours.size).toBeGreaterThan(1);
  });

  it('shows the picture instead when there is one, described for screen readers', () => {
    render(<DetailCover seed="course-7" icon={GraduationCap} imageUrl="/uploads/c.jpg" imageAlt="A garden course" data-testid="cover" />);
    expect(screen.getByRole('img', { name: 'A garden course' })).toHaveAttribute('src', '/uploads/c.jpg');
    expect(screen.queryByTestId('cover')).toBeNull();
  });
});

describe('coverSeed', () => {
  it('matches a card and its page: one seed per kind of item', () => {
    expect(coverSeed.course({ id: 3, category: { name: 'Gardening' } })).toBe('course-category-gardening');
    expect(coverSeed.course({ id: 3, category: null })).toBe('course-3');
    expect(coverSeed.podcastShow('my-show')).toBe('podcast-show-my-show');
    expect(coverSeed.jobType('paid')).toBe('job-type-paid');
  });
});
