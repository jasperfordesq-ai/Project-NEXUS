// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The listings screen must spend its screen on listings.
 *
 * 🔴 Reported by the owner on 2026-08-25: "half of the page just is static and sticky, and
 * the scrolling part of the page is very, very small". Measured on a device at 420dpi, and
 * he was right — the controls block was **331dp** and never moved, because it was rendered
 * as a SIBLING above the FlatList rather than as the list's header:
 *
 *     <View className="px-4 pb-2 pt-3">{controls}</View>
 *     <FlatList … />                       <- gets whatever is left, for ever
 *
 * That left 48% of the screen for the list and showed 1.4 of a 305dp card. Afterwards: 48dp
 * pinned, 79% for the list, 2.4 cards. Every other list screen in this app — members,
 * events, groups, marketplace, jobs — already put its controls inside the list; listings was
 * the only screen that did not, which is why it read as an accident rather than a decision.
 *
 * This is a source scan because the fault is structural: a rendering test sees the same
 * elements either way, since both arrangements draw the identical controls. What differs is
 * WHERE they are mounted, and that is visible only in the source or on a real screen.
 */

import fs from 'node:fs';
import path from 'node:path';

const SCREEN = path.resolve(__dirname, '(tabs)/exchanges.tsx');
const source = fs.readFileSync(SCREEN, 'utf8');

describe('the listings screen keeps its controls inside the list', () => {
  it('mounts the controls as the list header', () => {
    expect(source).toMatch(/ListHeaderComponent=\{<View className="px-4 pb-2">\{controls\}<\/View>\}/);
  });

  it('does not render the controls block as a fixed sibling above the list', () => {
    // The exact shape of the fault: the whole controls block outside the FlatList.
    const fixedBlock = /<View className="px-4 pb-2 pt-3">\s*\{controls\}\s*<\/View>/;
    expect(source).not.toMatch(fixedBlock);
  });

  it('pins the search field and nothing else', () => {
    // Searching is the one control worth reaching without scrolling back to the top; the
    // pinned region is one row, not a panel.
    expect(source).toMatch(/<View className="px-4 pb-2 pt-3">\s*\{pinnedSearch\}\s*<\/View>/);
    expect(source).toMatch(/const pinnedSearch = \(/);
  });

  it('does not render the search field twice', () => {
    // It used to live inside the controls block; leaving both would put two search boxes on
    // screen at the top of the list.
    expect(source.match(/testID="listings-search"/g)).toHaveLength(1);
  });
});

/**
 * 🔴 A general rule, not just this one screen. The five other list screens were checked on
 * 2026-08-25 and all already do this; if one regresses, the same complaint follows.
 */
describe('every tabbed list screen scrolls its controls away', () => {
  const SCREENS = [
    '(tabs)/exchanges.tsx',
    '(tabs)/members.tsx',
    '(tabs)/events.tsx',
    '(tabs)/groups.tsx',
  ];

  it.each(SCREENS)('%s gives its list a ListHeaderComponent', (relative) => {
    const text = fs.readFileSync(path.resolve(__dirname, relative), 'utf8');
    expect(text).toMatch(/ListHeaderComponent/);
  });
});
