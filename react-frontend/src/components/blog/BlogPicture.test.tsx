// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { BlogPicture } from './BlogPicture';

const IMAGE = { src: '/storage/tenant_2/uploads/blog/hero.png' };

describe('BlogPicture', () => {
  it('shows the whole picture and never crops it to fill the box', () => {
    render(<BlogPicture image={IMAGE} alt="We need you" shape="card" />);
    const picture = screen.getByRole('img', { name: 'We need you' });
    expect(picture).toHaveClass('object-contain');
    expect(picture).not.toHaveClass('object-cover');
  });

  // A card keeps one shape at every screen width. Fixed heights (`h-48`,
  // `h-72`) are what made the box anything from 1.28:1 to 3:1, so the same
  // picture lost its sides on a tablet and its top and bottom on a large phone.
  it('gives a card picture one shape instead of a fixed height', () => {
    render(<BlogPicture image={IMAGE} alt="We need you" shape="card" />);
    const box = screen.getByTestId('blog-picture');
    expect(box).toHaveClass('aspect-[1200/630]');
    expect(box.className).not.toMatch(/(^|\s)(md:)?h-\d/);
  });

  it('lets the picture on a post keep its own shape, up to a height limit', () => {
    render(<BlogPicture image={IMAGE} alt="We need you" shape="natural" />);
    const picture = screen.getByRole('img', { name: 'We need you' });
    expect(picture).toHaveClass('h-auto', 'w-full', 'object-contain');
    expect(screen.getByTestId('blog-picture')).not.toHaveClass('aspect-[1200/630]');
  });

  // Where the picture's shape leaves a gap, a blurred copy fills it. That copy
  // is decoration: it must not be announced or counted as a second picture.
  it('fills any gap with a blurred copy that assistive technology ignores', () => {
    const { container } = render(<BlogPicture image={IMAGE} alt="We need you" shape="card" />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    const backdrop = container.querySelector('img[aria-hidden="true"]');
    expect(backdrop).not.toBeNull();
    expect(backdrop).toHaveAttribute('alt', '');
    expect(backdrop).toHaveAttribute('src', IMAGE.src);
    expect(backdrop).toHaveAttribute('loading', 'lazy');
  });

  it('loads a priority picture eagerly, at high priority, with its size reserved', () => {
    render(<BlogPicture image={IMAGE} alt="We need you" shape="natural" priority width={1200} height={675} />);
    const picture = screen.getByRole('img', { name: 'We need you' });
    expect(picture).toHaveAttribute('loading', 'eager');
    expect(picture).toHaveAttribute('fetchpriority', 'high');
    expect(picture).toHaveAttribute('width', '1200');
    expect(picture).toHaveAttribute('height', '675');
  });

  it('loads an ordinary picture lazily', () => {
    render(<BlogPicture image={IMAGE} alt="We need you" shape="card" />);
    expect(screen.getByRole('img', { name: 'We need you' })).toHaveAttribute('loading', 'lazy');
  });
});
