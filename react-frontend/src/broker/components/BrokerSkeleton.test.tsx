// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () => createMockContexts());

import { BrokerSkeleton } from './BrokerSkeleton';

describe('BrokerSkeleton', () => {
  it.each(['stats', 'table', 'cards', 'detail', 'timeline', 'chart'] as const)(
    'renders the %s variant as a busy status region',
    (variant) => {
      render(<BrokerSkeleton variant={variant} />);
      const region = screen.getAllByRole('status')[0] as HTMLElement;
      expect(region).toHaveAttribute('aria-busy', 'true');
      expect(region).toHaveAttribute('aria-label', 'Loading...');
    },
  );

  // The stat tile is vertical (icon tile, two-line label, number) so the
  // placeholder must be too, or the page jumps when the real tiles arrive.
  it('draws stat placeholders in the vertical shape of BrokerStatCard', () => {
    render(<BrokerSkeleton variant="stats" count={3} />);
    const region = screen.getAllByRole('status')[0] as HTMLElement;
    expect(region.querySelectorAll('[data-skeleton-tile]')).toHaveLength(3);
    const tile = region.querySelector('[data-skeleton-tile]') as HTMLElement;
    expect(tile.className).toContain('flex-col');
    expect(tile.className).not.toContain('items-center');
  });

  it('draws the requested number of timeline rows', () => {
    render(<BrokerSkeleton variant="timeline" count={4} />);
    const region = screen.getAllByRole('status')[0] as HTMLElement;
    expect(region.querySelectorAll('li')).toHaveLength(4);
  });

  it('draws a chart placeholder with bars', () => {
    render(<BrokerSkeleton variant="chart" />);
    const region = screen.getAllByRole('status')[0] as HTMLElement;
    expect(region.querySelectorAll('[data-skeleton-bar]').length).toBeGreaterThanOrEqual(7);
  });
});
