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

describe('the jobs tab strip keeps its labels readable', () => {
  it('wraps to two per row on a narrow phone instead of truncating', () => {
    const source = read('app/(modals)/jobs.tsx');

    expect(source).toMatch(/const tabsPerRow = screenWidth < \d+ \? 2 : 4;/);
    expect(source).toMatch(/<View className="min-w-0 flex-row flex-wrap gap-1">/);
    expect(source).toContain("flexBasis: tabsPerRow === 2 ? '46%' : '22%'");
  });

  it('keeps the labels on ONE line, because two did not help', () => {
    // 🔴 `numberOfLines={2}` was tried and rejected on the device: "My Applications" was
    // still truncated to "My Appli…" and "My Postings" broke mid-word as "My Pos / tings".
    // A quarter of a 360dp screen is not enough for these words on any number of lines.
    const source = read('app/(modals)/jobs.tsx');
    const strip = source.slice(source.indexOf('flex-row flex-wrap gap-1'));

    expect(strip).toMatch(/numberOfLines=\{1\}/);
  });
});

describe('the shared form footer cannot clip its submit button', () => {
  it('puts the actions below the text and lets them wrap', () => {
    const source = read('components/ui/FormActionFooter.tsx');

    expect(source).toContain('<View className="flex-row flex-wrap gap-2">');
    expect(source).toContain('flexGrow: 1');
    expect(source).toContain("flexBasis: 'auto'");
  });

  it('does NOT decide by screen width', () => {
    // 🔴 The first fix stacked only below 380dp. Zooming into the 411dp capture showed
    // "Save changes" clipped there too — the title needs ~150dp and the buttons ~250dp,
    // which does not fit the 395dp a 411dp phone offers. A width threshold here would
    // have shipped the bug on the majority of phones while looking like a fix.
    expect(read('components/ui/FormActionFooter.tsx')).not.toContain('useWindowDimensions');
  });

  it('does not put flex-1 on the text block now that the container is a column', () => {
    // 🔴 `flex-1` in a column means "leftover HEIGHT from a basis of zero". Carried over
    // from the row layout, it collapsed the title and subtitle to nothing.
    // 🔴 Asserted on the JSX attribute, not on a slice of the file: the comment above
    // that element explains the trap and therefore mentions `flex-1` itself, so a
    // substring search over the region matched the explanation and "failed" the fix.
    expect(read('components/ui/FormActionFooter.tsx')).not.toContain('className="min-w-0 flex-1"');
  });
});

describe('the community picker rows are full width', () => {
  it('wraps each row in NativePressable, not HeroButton', () => {
    // 🔴 A HeroButton sized the card to its own content and gave the `flex-1` name block
    // ZERO width, so every community showed only a one-letter badge and a chevron — on the
    // screen used to choose which community to sign in to. Broken at EVERY width; the
    // 411dp control is the only reason it was not filed as a narrow-screen fault.
    const source = read('app/(auth)/select-tenant.tsx');
    const row = source.slice(source.indexOf('renderItem='), source.indexOf('ListEmptyComponent') > -1
      ? source.indexOf('ListEmptyComponent')
      : source.length);

    expect(row).toContain('<NativePressable');
    expect(row).not.toContain('<HeroButton');
    // The selected row must still announce itself, which HeroButton was providing.
    expect(row).toContain('accessibilityState={{ selected: isActive }}');
  });
});
