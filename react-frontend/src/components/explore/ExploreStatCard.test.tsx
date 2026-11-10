// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import { ExploreStatCard } from './ExploreStatCard';
import type { LucideIcon } from 'lucide-react';

vi.mock('@/contexts', () => createMockContexts());

// Minimal stub icon — avoids needing Lucide to render SVG in jsdom
const StubIcon: LucideIcon = (props) => <svg data-testid="stub-icon" {...props} />;

describe('ExploreStatCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Use fake timers so we control the setInterval animation without real delays
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the label', () => {
    render(<ExploreStatCard icon={StubIcon} label="Members" value={0} />);
    expect(screen.getByText('Members')).toBeInTheDocument();
  });

  it('renders the icon', () => {
    render(<ExploreStatCard icon={StubIcon} label="Members" value={0} />);
    expect(screen.getByTestId('stub-icon')).toBeInTheDocument();
  });

  it('displays 0 when value is 0 (no animation triggered)', () => {
    render(<ExploreStatCard icon={StubIcon} label="Members" value={0} />);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('renders the suffix when provided', () => {
    render(<ExploreStatCard icon={StubIcon} label="Hours" value={0} suffix="h" />);
    // "0h" should appear — suffix is appended directly after the number
    expect(screen.getByText(/0h/)).toBeInTheDocument();
  });

  it('eventually displays the final value after animation completes', async () => {
    const { container } = render(<ExploreStatCard icon={StubIcon} label="Members" value={100} />);
    // Wrap timer flush + React state update flush in act() so DOM reflects new state
    await act(async () => {
      vi.runAllTimers();
    });
    const valueSpan = container.querySelector('span.tabular-nums');
    expect(valueSpan?.textContent).toContain('100');
  });

  it('displays suffix after animated value', async () => {
    const { container } = render(<ExploreStatCard icon={StubIcon} label="Hours" value={50} suffix=" hrs" />);
    await act(async () => {
      vi.runAllTimers();
    });
    const valueSpan = container.querySelector('span.tabular-nums');
    expect(valueSpan?.textContent).toContain('hrs');
  });

  it('formats large integers with locale-safe toLocaleString (comma for en)', async () => {
    const { container } = render(<ExploreStatCard icon={StubIcon} label="Credits" value={1000} />);
    await act(async () => {
      vi.runAllTimers();
    });
    const valueSpan = container.querySelector('span.tabular-nums');
    // toLocaleString('en') → "1,000" in most environments;
    // accept either the comma form or the plain "1000" in case of minimal locale support.
    expect(valueSpan?.textContent).toMatch(/1[,.]?000/);
  });

  it('cleans up the interval on unmount without throwing', () => {
    const { unmount } = render(
      <ExploreStatCard icon={StubIcon} label="Members" value={200} />
    );
    // Should not throw
    expect(() => unmount()).not.toThrow();
  });

  it('starts animation from 0 (display value is 0 before timers fire)', () => {
    render(<ExploreStatCard icon={StubIcon} label="Members" value={500} />);
    // Before any timer fires the displayValue is still 0
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

// Warmth plan W1 (10 Nov 2026): a figure for one kind of thing uses that kind's colour.
describe('ExploreStatCard — kind colour', () => {
  it('takes the colour of the kind it counts', async () => {
    const { kindColour } = await import('@/components/feed/feedTypeColours');
    const Icon = (() => null) as unknown as LucideIcon;
    const { container } = render(<ExploreStatCard icon={Icon} label="Members" value={3} kind="member" />);
    const tile = container.querySelector('.rounded-xl')!;
    for (const cls of kindColour('member').label.split(' ')) expect(tile.className).toContain(cls);
  });
});
