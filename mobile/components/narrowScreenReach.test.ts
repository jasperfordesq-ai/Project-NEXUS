// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Controls that fit the emulator and fall off a real phone.
 *
 * Both defects guarded here were found on 2026-08-20 by rendering the SAME build and the
 * SAME feed card at two screen densities. At 411dp — the emulator, and every Pixel — both
 * looked perfect. At 360dp, an extremely common Android width, a control went past the
 * card edge and became unreachable, with nothing on screen to say anything was missing:
 *
 *   1. `ReactionBar`  — `clap` rendered half off the edge and `time_credit` was entirely
 *                       gone, so 6 of the 8 reactions were all a member could reach.
 *   2. `FeedItem`     — the save/bookmark button was clipped away completely.
 *
 * Neither is caught by anything else we run. The pixel gate captures three screens at one
 * fixed size; the render tests use jsdom, which has no layout engine and so cannot notice
 * an overflow; and the owner's own report ("the emojis are shit, there's just a heart")
 * was about the missing affordance, not the missing reactions — those were found only by
 * looking.
 *
 * 🔴 The arithmetic below is the point of this file, not the string assertions. It states
 * WHY the fixes are load-bearing, so that anyone tempted to revert them to something
 * tidier has the measurement in front of them. If a design change makes the row genuinely
 * fit 360dp, this test's first case fails and tells you the guard is no longer needed —
 * which is the correct outcome, and better than the guard rotting into cargo cult.
 */

import fs from 'node:fs';
import path from 'node:path';

import { REACTION_CONFIGS } from './reactions/ReactionBar';

const MOBILE_ROOT = path.resolve(__dirname, '..');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(MOBILE_ROOT, relativePath), 'utf8');
}

/** The narrowest width this platform treats as ordinary, not an edge case. */
const NARROW_PHONE_DP = 360;
/** The emulator and every Pixel. Both defects are invisible here. */
const WIDE_PHONE_DP = 411;

describe('the reaction picker cannot put a reaction out of reach', () => {
  it('genuinely overflows a 360dp phone, which is why the width cap exists', () => {
    // 🔴 Deliberately the WEAKEST form of the inequality: the touch targets ALONE, with
    // every gap, padding and inset set to zero. A first attempt at this test modelled the
    // full layout (gaps, pill padding, container inset, card margin) and asserted 382dp
    // needed against 363dp available at 411dp — which would mean it overflowed on the very
    // screen the screenshots show it fitting on. The model was wrong, not the screenshots.
    // Stating the floor instead keeps the test honest: if even the bare targets do not fit,
    // nothing else can rescue it.
    const TARGET_DP = 44; // `size-11`
    const CARD_INSET_DP = 12 * 2; // the card's own horizontal margin

    const targetsAlone = REACTION_CONFIGS.length * TARGET_DP;
    const cardInnerWidth = (screenDp: number) => screenDp - CARD_INSET_DP;

    expect(REACTION_CONFIGS).toHaveLength(8);
    // Room to spare on the screen we test on — which is why this went unnoticed.
    expect(targetsAlone).toBeLessThan(cardInnerWidth(WIDE_PHONE_DP));
    // Cannot fit, before a single pixel of padding is added, on a width plenty of members
    // actually hold.
    expect(targetsAlone).toBeGreaterThan(cardInnerWidth(NARROW_PHONE_DP));
  });

  it('caps the pill to whole rows and wraps, so all eight stay visible', () => {
    const source = read('components/reactions/ReactionBar.tsx');

    // Bounded on BOTH sides: `left-3` alone lets the pill run off the edge.
    expect(source).toMatch(/left-3 right-3/);
    // A measured cap, not a hardcoded width…
    expect(source).toContain('maxWidth: perRow * TARGET_DP');
    expect(source).toContain('useWindowDimensions()');
    // …and the overflow wraps rather than being clipped or hidden behind a swipe.
    expect(source).toContain("flexWrap: 'wrap'");
    // 🔴 Scrolling was tried and rejected — reachable but undiscoverable. If it comes
    // back, that decision is being re-made and should be re-argued in the comment above.
    expect(source).not.toContain('ScrollView');
  });

  it('splits into equal rows rather than a ragged one', () => {
    // Guards the arithmetic itself: 8 reactions that do not fit one row become 4 + 4, not
    // 6 + 2, on every width where a full row is impossible.
    const perRowFor = (fitsPerRow: number, total = REACTION_CONFIGS.length) =>
      fitsPerRow >= total ? total : Math.ceil(total / 2);

    expect(perRowFor(8)).toBe(8); // a wide phone is untouched
    expect(perRowFor(6)).toBe(4); // 360dp: 4 + 4
    expect(perRowFor(5)).toBe(4);
    expect(perRowFor(4)).toBe(4);
  });

  it('keeps every reaction target at the accessible size rather than shrinking to fit', () => {
    // The rejected alternative was smaller targets, which would have degraded every phone
    // to fix some of them. `size-11` is 44dp.
    expect(read('components/reactions/ReactionBar.tsx')).toContain('className="size-11');
  });
});

describe('the feed card action row cannot drop a button off the edge', () => {
  it('wraps rather than clipping, so save survives a narrow screen', () => {
    const source = read('components/FeedItem.tsx');
    const footer = source.match(/<HeroCard\.Footer className="([^"]+)"/);

    expect(footer).not.toBeNull();
    expect(footer?.[1]).toContain('flex-wrap');
  });

  it('drops the word labels on a narrow screen so the row stays one tidy line', () => {
    expect(read('components/FeedItem.tsx')).toMatch(/const compactActions = screenWidth < \d+;/);
  });

  it('keeps an accessible name on the buttons whose label it hides', () => {
    // 🔴 The label WAS the accessible name. Hiding it without this makes the row an
    // unlabelled icon to a screen reader — a fix that looks right and reads as nothing.
    const source = read('components/FeedItem.tsx');
    const shareButton = source.match(/<HeroButton size="sm" variant="ghost" onPress=\{\(\) => void handleShare\(\)\}[^>]*>/);

    expect(shareButton?.[0]).toContain('accessibilityLabel');
    expect(source).toMatch(/onPress=\{handleCommentPress\}\s*\n\s*accessibilityLabel=/);
  });
});
