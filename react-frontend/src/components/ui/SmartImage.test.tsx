// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@/test/test-utils';
import { SmartImage } from './SmartImage';

describe('SmartImage (photos fade in from their colour, warmth plan C1)', () => {
  it('paints the frame in the item colour and fades the photo in once it loads', () => {
    render(<SmartImage src="/photo.jpg" alt="A red bicycle" colour="teal" frameClassName="aspect-video" />);
    const frame = screen.getByTestId('smart-image');
    const img = screen.getByAltText('A red bicycle');
    expect(frame.className).toContain('from-teal-100');
    expect(frame.className).toContain('aspect-video');
    expect(frame).toHaveAttribute('data-loaded', 'false');
    expect(img.className).toContain('opacity-0');
    expect(img.className).toContain('motion-reduce:transition-none');

    fireEvent.load(img);
    expect(frame).toHaveAttribute('data-loaded', 'true');
    expect(img.className).toContain('opacity-100');
  });

  it('shows the fallback, and tells the caller, when the photo fails', () => {
    let told = false;
    render(
      <SmartImage
        src="/missing.jpg"
        alt="Missing"
        onError={() => { told = true; }}
        fallback={<span data-testid="fallback">cover</span>}
      />,
    );
    fireEvent.error(screen.getByAltText('Missing'));
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(screen.queryByAltText('Missing')).not.toBeInTheDocument();
    expect(told).toBe(true);
  });

  it('lets the caller choose the frame display without a clash', () => {
    const { rerender } = render(<SmartImage src="/p.jpg" alt="" frameClassName="hidden sm:block h-20" />);
    expect(screen.getByTestId('smart-image').className.split(/\s+/)).not.toContain('block');
    rerender(<SmartImage src="/p.jpg" alt="" frameClassName="h-20" />);
    expect(screen.getByTestId('smart-image').className.split(/\s+/)).toContain('block');
  });
});
