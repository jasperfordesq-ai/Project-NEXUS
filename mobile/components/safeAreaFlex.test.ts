// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 `className` DOES NOTHING on the SafeAreaView this app uses.
 *
 * Isolated on a device 2026-08-20, after two screens were found showing a title bar above
 * an entirely blank body — the rewards/leaderboard screen and Goals.
 *
 * Every screen here imports `SafeAreaView` from **react-native-safe-area-context**, a
 * third-party package. uniwind patches className onto React Native's OWN components — its
 * resolver list in `node_modules/uniwind/src/bundler/adapters/metro/resolvers.ts` includes
 * `SafeAreaView`, but that is the one exported by `react-native` — and it does not touch
 * third-party packages. Nothing registers this one, and uniwind exposes no
 * `cssInterop`-style API to do so. Measured: 112 files write
 * `className="flex-1 bg-background"` on it and **zero** import it from `react-native`, so
 * on all of them neither the flex NOR the background is applied.
 *
 * Most screens survive that, which is why it went unnoticed: content with an intrinsic
 * height still lays out. A screen breaks only when a child needs the PARENT to have
 * height — a `flex-1` ScrollView or FlatList, or the `flex-1 items-center justify-center`
 * pattern. Then the SafeAreaView sizes to its content, the child collapses to zero height,
 * and the member sees a header above nothing.
 *
 * How it was isolated, rather than guessed: a fixed-height probe placed as a SIBLING of
 * the ScrollView rendered; the identical probe placed INSIDE it did not. Adding
 * `style={{ flex: 1 }}` to the SafeAreaView made 1.75M pixels appear. Three earlier
 * hypotheses were tested and rejected first — the RefreshControl's colours (`primary` was
 * a valid `#006FEE`), `contentContainerClassName`, and the ScrollView's own `className`.
 *
 * 🔴 This also explains a bug recorded as unsolved in `app/+not-found.tsx`, whose comment
 * says content wrapped in `flex-1 items-center justify-center` "rendered at zero size" and
 * that "the centring container is the likely culprit but that was not isolated". It is the
 * same root cause, and it is now isolated.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..');

function sourceFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) found.push(full);
    }
  };
  walk(path.join(MOBILE_ROOT, 'app'));
  walk(path.join(MOBILE_ROOT, 'components'));
  return found;
}

/** Files whose SafeAreaView comes from the third-party package, where className is inert. */
function filesUsingContextSafeArea(): string[] {
  return sourceFiles().filter((file) =>
    /SafeAreaView[^\n]*from ['"]react-native-safe-area-context['"]/.test(
      fs.readFileSync(file, 'utf8')
    )
  );
}

/**
 * Screens where the inert className would actually break the layout: a SafeAreaView
 * relying on `flex-1` from className, with no explicit flex style, whose next element is
 * one that needs the parent to have height.
 *
 * The predicate was validated against the device rather than trusted: it flags `goals`
 * (confirmed blank) and does not flag `jobs` or `activity` (confirmed rendering).
 */
function atRiskScreens(): string[] {
  const offenders: string[] = [];

  for (const file of filesUsingContextSafeArea()) {
    const source = fs.readFileSync(file, 'utf8');
    const tagPattern = /<SafeAreaView\b([^>]*?)>/g;
    let match: RegExpExecArray | null;

    while ((match = tagPattern.exec(source)) !== null) {
      const attrs = match[1] ?? '';
      if (!/className="[^"]*\bflex-1\b/.test(attrs)) continue;
      if (/style=/.test(attrs)) continue; // carries its own style — out of scope here

      const after = source.slice(match.index + match[0].length, match.index + match[0].length + 1200);
      const childNeedsParentHeight =
        /<(ScrollView|FlatList|SectionList|KeyboardAvoidingView)\b[^>]{0,300}className="[^"]*\bflex-1\b/.test(after) ||
        /<View\b[^>]{0,200}className="[^"]*flex-1 items-center justify-center/.test(after);

      if (childNeedsParentHeight) offenders.push(path.relative(MOBILE_ROOT, file).replace(/\\/g, '/'));
    }
  }

  return [...new Set(offenders)].sort();
}

describe('SafeAreaView flex', () => {
  it('reads a realistic number of files, so a green result is not an empty search', () => {
    // 197 files under app/ + components/ at the time of writing, 113 of them importing
    // the context SafeAreaView. The thresholds sit comfortably below both: their job is to
    // catch a scan that silently matched nothing — a renamed directory, a changed
    // attribute spelling — not to pin an exact file count that every new screen changes.
    expect(sourceFiles().length).toBeGreaterThan(150);
    expect(filesUsingContextSafeArea().length).toBeGreaterThan(100);
  });

  it('🔴 no screen relies on className alone for flex while a child needs the parent height', () => {
    // 19 screens were fixed on 2026-08-20 by adding `style={{ flex: 1 }}`. Two of them —
    // the rewards/leaderboard screen and Goals — were confirmed BLANK on a device before
    // the fix and rendering after it. A new screen written in the same style would be
    // blank on arrival, and no rendering test would notice, because the component tree is
    // correct; only the measured height is wrong.
    expect(atRiskScreens()).toEqual([]);
  });

  /**
   * 🔴 This used to be a tolerance of 115, on the reasoning that "on most screens the dead
   * className is harmless" and that rewriting them "would risk changing layouts that
   * currently look right". That reasoning was wrong, and a device proved it on 2026-08-22.
   *
   * The Alerts tab of `app/(modals)/jobs.tsx` rendered its list BELOW the bottom of the
   * screen with nothing to scroll — the job alert the member had just created could not be
   * reached at all, at any scroll position. Nothing in the component tree was wrong; only
   * the measured height was, because the root had no flex.
   *
   * Whether a given screen breaks depends on rendered heights, which no source scan can
   * know: `settings` scrolls perfectly with the same inert className, `jobs` does not. So
   * the tolerance could never be turned into a smarter predicate — the only safe position
   * is zero. 86 tags across 56 files were given an explicit `style={{ flex: 1 }}` on
   * 2026-08-22, matching the 97 screens that already had it. The whole suite stayed green
   * and three screens were re-checked on a device.
   */
  it('🔴 no SafeAreaView declares flex through className alone', () => {
    const inert: string[] = [];

    for (const file of filesUsingContextSafeArea()) {
      const source = fs.readFileSync(file, 'utf8');
      const tagPattern = /<SafeAreaView\b([^>]*?)>/g;
      let match: RegExpExecArray | null;

      while ((match = tagPattern.exec(source)) !== null) {
        const attrs = match[1] ?? '';
        if (!/className="[^"]*\bflex-1\b/.test(attrs)) continue;
        if (/style=/.test(attrs)) continue;
        inert.push(path.relative(MOBILE_ROOT, file).replace(/\\/g, '/'));
      }
    }

    // `flex-1` in the className is fine to keep — it documents the intent and costs
    // nothing. What must always accompany it is a style that actually applies.
    expect([...new Set(inert)].sort()).toEqual([]);
  });

  it('🔴 nobody has switched to react-native’s SafeAreaView to "fix" this', () => {
    // It would make className work, and it is the wrong trade: the react-native export is
    // deprecated and does not handle insets properly, which is the entire reason the
    // context package is used. The fix is an explicit flex style, not a different import.
    const wrongImport = sourceFiles().filter((file) =>
      /import\s*\{[^}]*\bSafeAreaView\b[^}]*\}\s*from\s*['"]react-native['"]/.test(
        fs.readFileSync(file, 'utf8')
      )
    );

    expect(wrongImport).toEqual([]);
  });
});
