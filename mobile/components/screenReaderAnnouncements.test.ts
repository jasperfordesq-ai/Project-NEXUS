// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Things a screen reader must not be made to say, pinned at the source.
 *
 * 🔴 Every rule here comes from reading the live accessibility tree with TalkBack running
 * on emulator-5554 on 2026-08-24 — not from a style guide. What a sighted test sees and
 * what a blind member hears came apart in three places at once, and none of the three was
 * visible in any screenshot:
 *
 *  - every feed post was announced TWICE, once as a truncated 100-character summary on the
 *    card container and again in full by the group inside it;
 *  - the author's name was announced twice inside that second reading ("E2E UserA, E2E
 *    UserA"), because the avatar carried the name as a label while the name was also the
 *    next visible text — with heroui's own "Avatar" description as a third stop;
 *  - the home screen's floating button announced itself as "Action button".
 *
 * These are source scans on purpose. A rendering test cannot see them: the duplication is a
 * property of the *composed* Android tree, which react-test-renderer does not build.
 */

import fs from 'fs';
import path from 'path';

const MOBILE_ROOT = path.resolve(__dirname, '..');

function read(relative: string): string {
  return fs.readFileSync(path.join(MOBILE_ROOT, relative), 'utf8');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(MOBILE_ROOT, dir), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(relative, out);
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) out.push(relative);
  }
  return out;
}

describe('a feed post is announced once, not twice', () => {
  const source = read('components/FeedItem.tsx');

  it('does not make the whole card a single accessibility element', () => {
    // The card holds focusable buttons, so Android keeps them as separate stops: a
    // container label is an EXTRA announcement, never a replacement for them.
    expect(source).not.toMatch(/<View className="mx-4 my-2"[^>]*accessible/);
    expect(source).not.toMatch(/accessibilityRole="summary"/);
  });

  it('does not compose a truncated copy of the post as a label', () => {
    // The old summary cut the body at 100 characters, so the first of the two readings
    // stopped mid-sentence.
    expect(source).not.toMatch(/accessibilityLabel=\{cardLabel\}/);
    expect(source).not.toMatch(/item\.content\.slice\(0, 100\)/);
  });

  it('keeps the avatar out of the reading order beside the name', () => {
    expect(source).toMatch(/<Avatar[^/]*decorative/);
  });
});

describe('Avatar can be hidden from a screen reader', () => {
  const source = read('components/ui/Avatar.tsx');

  /**
   * 🔴 heroui's avatar primitive defaults `alt = 'Avatar'` and passes it as the image's
   * accessible name, so EVERY avatar in the app announced "Avatar" — not just in the feed.
   * Measured on a device: neither our own label nor `importantForAccessibility` on an
   * ancestor silenced it. Emptying `alt` is what removes the stop.
   */
  it("empties the primitive's default alt text", () => {
    /*
      🔴 Anchored to a line that is ONLY the attribute. The first version of this assertion
      was `/alt=""/`, which the explanatory comment above the attribute satisfied all by
      itself — so putting `alt="Avatar"` back left the test green. A source scan that its own
      documentation can satisfy is not a guard.
    */
    expect(source).toMatch(/^\s*alt=""\s*$/m);
  });

  it('drops the label and hides its descendants when decorative', () => {
    // Both are needed: heroui labels the inner image "Avatar" itself, so dropping our own
    // label alone still leaves a meaningless stop.
    expect(source).toMatch(/accessibilityLabel=\{decorative \? undefined/);
    expect(source).toMatch(/no-hide-descendants/);
  });
});

describe('decorative icons do not become their own stops', () => {
  /**
   * 🔴 heroui's `SearchField.SearchIcon` hardcodes `accessibilityLabel: "Search icon"` on
   * its SVG and accepts only `size` and `color` — accessibility props passed to it are
   * ignored. Measured on the members directory with TalkBack on 2026-08-24: every search
   * field announced "Search members…" and then "Search icon". Our own `Icon` wrapper hides
   * icons from the tree, which is the convention the rest of the app already follows.
   */
  it("the search field uses our icon rather than the library's labelled one", () => {
    const source = read('components/ui/SearchInput.tsx');
    // Anchored to the JSX element: the comment above the replacement names the old
    // component, and a bare name match would fail on that. (Second time today a source scan
    // was satisfied — or broken — by its own documentation.)
    expect(source).not.toMatch(/<SearchField\.SearchIcon/);
    expect(source).toMatch(/testID="search-icon-decorative"/);
  });
});

describe('no floating button is left with the placeholder name', () => {
  it('every <FAB reachable in the app passes an accessibilityLabel', () => {
    const offenders: string[] = [];
    for (const file of [...walk('app'), ...walk('components')]) {
      const source = read(file);
      // Each <FAB … /> usage, including multi-line ones.
      for (const match of source.matchAll(/<FAB\b[\s\S]*?\/>/g)) {
        if (!match[0].includes('accessibilityLabel')) {
          offenders.push(`${file}: ${match[0].replace(/\s+/g, ' ').slice(0, 80)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
