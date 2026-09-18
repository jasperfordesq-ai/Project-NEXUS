// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Guards the shared test mocks themselves.
 *
 * `framerMotionMock.motion` is a Proxy. If its `get` trap builds a fresh
 * component on every access, `<motion.div>` is a NEW component type on every
 * render, so React unmounts and remounts the whole subtree beneath it on every
 * render. Queries then resolve to a node that is detached microseconds later,
 * which shows up as an intermittent "element could not be found in the
 * document" in whichever suite happens to lose the race (this cost the
 * GroupDetailPage suite a blocked production deploy on 2026-09-18).
 *
 * The real shim at `@/lib/motion` caches per tag; the mock must do the same.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { framerMotionMock } from './mocks';

const { motion } = framerMotionMock;

describe('framerMotionMock.motion', () => {
  it('returns a stable component identity for the same tag', () => {
    expect(motion.div).toBe(motion.div);
    expect(motion.section).toBe(motion.section);
  });

  it('returns distinct components for different tags', () => {
    expect(motion.div).not.toBe(motion.span);
  });

  it('does not remount its children when the parent re-renders', async () => {
    let mounts = 0;
    function Child() {
      useEffect(() => { mounts += 1; }, []);
      return <div data-testid="child" />;
    }
    function Parent() {
      const [tick, setTick] = useState(0);
      useEffect(() => {
        if (tick < 3) setTick((value) => value + 1);
      }, [tick]);
      const Wrapper = motion.div;
      return <Wrapper initial={{ opacity: 0 }}><Child /></Wrapper>;
    }

    render(<Parent />);
    const first = screen.getByTestId('child');
    await screen.findByTestId('child');

    expect(mounts).toBe(1);
    expect(first.isConnected).toBe(true);
  });
});
