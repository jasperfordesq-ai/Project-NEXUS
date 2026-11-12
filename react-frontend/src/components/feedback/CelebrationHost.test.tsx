// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { celebrate, celebrateFromMeta, celebrationFromMeta } from '@/lib/celebrate';
import { CelebrationHost } from './CelebrationHost';

const reducedMotion = vi.hoisted(() => ({ value: false }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/lib/motion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/motion')>();
  return { ...actual, useReducedMotion: () => reducedMotion.value };
});
vi.mock('@/components/ui/ConfettiCelebration', () => ({
  ConfettiCelebration: ({ show }: { show: boolean }) => (show ? <div data-testid="confetti" /> : null),
}));

describe('first-time celebrations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reducedMotion.value = false;
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads only our own names from a response', () => {
    expect(celebrationFromMeta({ celebrate: 'first_listing' })).toBe('first_listing');
    expect(celebrationFromMeta({ celebrate: 'first_event' })).toBe('first_event');
    expect(celebrationFromMeta({ celebrate: 'first_group' })).toBe('first_group');
    expect(celebrationFromMeta({ celebrate: '<script>' })).toBeNull();
    expect(celebrationFromMeta({ base_url: 'x' })).toBeNull();
    expect(celebrationFromMeta(undefined)).toBeNull();
    expect(celebrationFromMeta(null)).toBeNull();
  });

  it('shows nothing until something is celebrated', () => {
    render(<CelebrationHost memberId={7} />);
    expect(screen.queryByTestId('celebration')).toBeNull();
  });

  it('shows confetti and a line of thanks, announced politely, then clears itself', () => {
    render(<CelebrationHost memberId={7} />);

    act(() => celebrate('first_listing'));

    const message = screen.getByTestId('celebration');
    expect(message).toHaveAttribute('role', 'status');
    expect(message).toHaveTextContent('celebration_first_listing_title');
    expect(message).toHaveTextContent('celebration_first_listing_text');
    expect(screen.getByTestId('confetti')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(7000));
    expect(screen.queryByTestId('celebration')).toBeNull();
  });

  it('never blocks the page: clicks pass through it', () => {
    render(<CelebrationHost memberId={7} />);
    act(() => celebrate('first_event'));
    expect(screen.getByTestId('celebration-layer').className).toContain('pointer-events-none');
  });

  it('celebrates a first only once for a member, even if the server says it again', () => {
    render(<CelebrationHost memberId={7} />);

    act(() => celebrateFromMeta({ celebrate: 'first_group' }));
    expect(screen.getByTestId('celebration')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(7000));

    act(() => celebrateFromMeta({ celebrate: 'first_group' }));
    expect(screen.queryByTestId('celebration')).toBeNull();
  });

  it('keeps each member their own firsts on a shared computer', () => {
    const { unmount } = render(<CelebrationHost memberId={7} />);
    act(() => celebrate('first_listing'));
    act(() => vi.advanceTimersByTime(7000));
    unmount();

    render(<CelebrationHost memberId={8} />);
    act(() => celebrate('first_listing'));
    expect(screen.getByTestId('celebration')).toBeInTheDocument();
  });

  it('shows the words but no confetti for a member who asked for less motion', () => {
    reducedMotion.value = true;
    render(<CelebrationHost memberId={7} />);
    act(() => celebrate('first_listing'));
    expect(screen.getByTestId('celebration')).toBeInTheDocument();
    expect(screen.queryByTestId('confetti')).toBeNull();
  });

  it('does nothing for a visitor who is not signed in', () => {
    render(<CelebrationHost memberId={null} />);
    act(() => celebrate('first_listing'));
    expect(screen.queryByTestId('celebration')).toBeNull();
  });
});
